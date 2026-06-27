import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "automation.db"


def connect():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_name TEXT NOT NULL,
                project_path TEXT NOT NULL,
                started_at TEXT NOT NULL,
                status TEXT NOT NULL,
                summary_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS run_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                operation_name TEXT NOT NULL,
                status TEXT NOT NULL,
                command_json TEXT NOT NULL,
                stdout TEXT NOT NULL DEFAULT '',
                stderr TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                duration_seconds REAL NOT NULL DEFAULT 0,
                exit_code INTEGER,
                FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_runs_project_started
                ON runs(project_name, started_at);

            CREATE INDEX IF NOT EXISTS idx_steps_run_id
                ON run_steps(run_id);
            """
        )


def save_report(report):
    init_db()
    run_ids = []
    generated_at = report.get("generated_at") or datetime.now(timezone.utc).isoformat(timespec="seconds")

    with connect() as connection:
        for project in report.get("projects", []):
            cursor = connection.execute(
                """
                INSERT INTO runs (project_name, project_path, started_at, status, summary_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    project["name"],
                    project.get("path", ""),
                    generated_at,
                    project.get("summary", {}).get("status", "unknown"),
                    json.dumps(project.get("summary", {}), ensure_ascii=False),
                ),
            )
            run_id = cursor.lastrowid
            run_ids.append(run_id)

            for check in project.get("checks", []):
                connection.execute(
                    """
                    INSERT INTO run_steps (
                        run_id, operation_name, status, command_json, stdout, stderr,
                        reason, duration_seconds, exit_code
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        check.get("name", ""),
                        check.get("status", "unknown"),
                        json.dumps(check.get("command", []), ensure_ascii=False),
                        check.get("stdout", ""),
                        check.get("stderr", ""),
                        check.get("reason", ""),
                        check.get("duration_seconds") or 0,
                        check.get("exit_code"),
                    ),
                )

    return run_ids


def failure_level(rate):
    if rate < 5:
        return "good"
    if rate < 10:
        return "warning"
    return "critical"


def latest_project_run(project_name):
    init_db()
    with connect() as connection:
        run = connection.execute(
            """
            SELECT * FROM runs
            WHERE project_name = ?
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            """,
            (project_name,),
        ).fetchone()

        if not run:
            return None

        steps = connection.execute(
            """
            SELECT * FROM run_steps
            WHERE run_id = ?
            ORDER BY id
            """,
            (run["id"],),
        ).fetchall()

    return row_to_project(run, steps)


def project_history(project_name):
    init_db()
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")

    with connect() as connection:
        latest = connection.execute(
            """
            SELECT started_at FROM runs
            WHERE project_name = ?
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            """,
            (project_name,),
        ).fetchone()

        stats = connection.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN run_steps.status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM run_steps
            JOIN runs ON runs.id = run_steps.run_id
            WHERE runs.project_name = ?
              AND runs.started_at >= ?
              AND run_steps.status != 'skipped'
            """,
            (project_name, since),
        ).fetchone()

    total = stats["total"] or 0
    failed = stats["failed"] or 0
    rate = round((failed / total) * 100, 1) if total else 0

    return {
        "latest_run_at": latest["started_at"] if latest else None,
        "checks_24h": total,
        "failures_24h": failed,
        "failure_rate_24h": rate,
        "failure_level": failure_level(rate),
    }


def most_failing(limit=3):
    init_db()
    with connect() as connection:
        projects = connection.execute("SELECT DISTINCT project_name FROM runs").fetchall()

    ranked = []
    for project in projects:
        history = project_history(project["project_name"])
        ranked.append(
            {
                "name": project["project_name"],
                "failure_rate_24h": history["failure_rate_24h"],
                "failure_level": history["failure_level"],
                "failures_24h": history["failures_24h"],
            }
        )

    return sorted(ranked, key=lambda item: item["failure_rate_24h"], reverse=True)[:limit]


def recent_runs(limit=20):
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, project_name, project_path, started_at, status, summary_json
            FROM runs
            ORDER BY started_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [
        {
            "id": row["id"],
            "project_name": row["project_name"],
            "project_path": row["project_path"],
            "started_at": row["started_at"],
            "status": row["status"],
            "summary": json.loads(row["summary_json"]),
        }
        for row in rows
    ]


def row_to_project(run, steps):
    checks = []
    for step in steps:
        checks.append(
            {
                "name": step["operation_name"],
                "status": step["status"],
                "command": json.loads(step["command_json"]),
                "stdout": step["stdout"],
                "stderr": step["stderr"],
                "reason": step["reason"],
                "duration_seconds": step["duration_seconds"],
                "exit_code": step["exit_code"],
            }
        )

    return {
        "name": run["project_name"],
        "path": run["project_path"],
        "summary": json.loads(run["summary_json"]),
        "checks": checks,
    }
