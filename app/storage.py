import json
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "automation.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()


def using_postgres():
    return bool(DATABASE_URL)


@contextmanager
def connect():
    if using_postgres():
        import psycopg
        from psycopg.rows import dict_row

        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    else:
        DATA_DIR.mkdir(exist_ok=True)
        connection = sqlite3.connect(DB_PATH)
        connection.row_factory = sqlite3.Row

    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def execute(connection, query, params=()):
    if using_postgres():
        query = query.replace("?", "%s")
    return connection.execute(query, params)


def execute_script(connection, sqlite_script, postgres_script):
    if using_postgres():
        connection.execute(postgres_script)
    else:
        connection.executescript(sqlite_script)


def init_db():
    sqlite_script = """
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
    postgres_script = """
        CREATE TABLE IF NOT EXISTS runs (
            id SERIAL PRIMARY KEY,
            project_name TEXT NOT NULL,
            project_path TEXT NOT NULL,
            started_at TEXT NOT NULL,
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS run_steps (
            id SERIAL PRIMARY KEY,
            run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            operation_name TEXT NOT NULL,
            status TEXT NOT NULL,
            command_json TEXT NOT NULL,
            stdout TEXT NOT NULL DEFAULT '',
            stderr TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            duration_seconds REAL NOT NULL DEFAULT 0,
            exit_code INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_runs_project_started
            ON runs(project_name, started_at);

        CREATE INDEX IF NOT EXISTS idx_steps_run_id
            ON run_steps(run_id);
    """

    last_error = None
    for _ in range(20):
        try:
            with connect() as connection:
                execute_script(connection, sqlite_script, postgres_script)
            return
        except Exception as exc:
            last_error = exc
            if not using_postgres():
                break
            time.sleep(1)

    raise RuntimeError(f"No se pudo inicializar la base de datos: {last_error}")


def insert_run(connection, project, generated_at):
    cursor = execute(
        connection,
        """
        INSERT INTO runs (project_name, project_path, started_at, status, summary_json)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
        """
        if using_postgres()
        else """
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
    if using_postgres():
        return cursor.fetchone()["id"]
    return cursor.lastrowid


def save_report(report):
    init_db()
    run_ids = []
    generated_at = report.get("generated_at") or datetime.now(timezone.utc).isoformat(timespec="seconds")

    with connect() as connection:
        for project in report.get("projects", []):
            run_id = insert_run(connection, project, generated_at)
            run_ids.append(run_id)

            for check in project.get("checks", []):
                execute(
                    connection,
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
        run = execute(
            connection,
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

        steps = execute(
            connection,
            """
            SELECT * FROM run_steps
            WHERE run_id = ?
            ORDER BY id
            """,
            (row_value(run, "id"),),
        ).fetchall()

    return row_to_project(run, steps)


def project_history(project_name):
    init_db()
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")

    with connect() as connection:
        latest = execute(
            connection,
            """
            SELECT started_at FROM runs
            WHERE project_name = ?
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            """,
            (project_name,),
        ).fetchone()

        stats = execute(
            connection,
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

    total = row_value(stats, "total") or 0
    failed = row_value(stats, "failed") or 0
    rate = round((failed / total) * 100, 1) if total else 0

    return {
        "latest_run_at": row_value(latest, "started_at") if latest else None,
        "checks_24h": total,
        "failures_24h": failed,
        "failure_rate_24h": rate,
        "failure_level": failure_level(rate),
    }


def most_failing(limit=3):
    init_db()
    with connect() as connection:
        projects = execute(connection, "SELECT DISTINCT project_name FROM runs").fetchall()

    ranked = []
    for project in projects:
        name = row_value(project, "project_name")
        history = project_history(name)
        ranked.append(
            {
                "name": name,
                "failure_rate_24h": history["failure_rate_24h"],
                "failure_level": history["failure_level"],
                "failures_24h": history["failures_24h"],
            }
        )

    return sorted(ranked, key=lambda item: item["failure_rate_24h"], reverse=True)[:limit]


def recent_runs(limit=20):
    init_db()
    with connect() as connection:
        rows = execute(
            connection,
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
            "id": row_value(row, "id"),
            "project_name": row_value(row, "project_name"),
            "project_path": row_value(row, "project_path"),
            "started_at": row_value(row, "started_at"),
            "status": row_value(row, "status"),
            "summary": json.loads(row_value(row, "summary_json")),
        }
        for row in rows
    ]


def row_to_project(run, steps):
    checks = []
    for step in steps:
        checks.append(
            {
                "name": row_value(step, "operation_name"),
                "status": row_value(step, "status"),
                "command": json.loads(row_value(step, "command_json")),
                "stdout": row_value(step, "stdout"),
                "stderr": row_value(step, "stderr"),
                "reason": row_value(step, "reason"),
                "duration_seconds": row_value(step, "duration_seconds"),
                "exit_code": row_value(step, "exit_code"),
            }
        )

    return {
        "name": row_value(run, "project_name"),
        "path": row_value(run, "project_path"),
        "summary": json.loads(row_value(run, "summary_json")),
        "checks": checks,
    }


def row_value(row, key):
    if row is None:
        return None
    return row[key]
