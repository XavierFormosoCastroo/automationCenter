import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "projects.json"
REPORTS_DIR = ROOT / "reports"


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        return json.load(config_file)


def should_run(check, project_path):
    only_if_exists = check.get("only_if_exists")
    if only_if_exists and not (project_path / only_if_exists).exists():
        return False, f"No existe {only_if_exists}."

    only_if_exists_any = check.get("only_if_exists_any")
    if only_if_exists_any:
        existing = [name for name in only_if_exists_any if (project_path / name).exists()]
        if not existing:
            return False, "No existe ningun archivo requerido: " + ", ".join(only_if_exists_any) + "."

    return True, ""


def run_command(command, cwd):
    resolved_command = [sys.executable if part == "{python}" else part for part in command]
    if resolved_command and resolved_command[0] == "git":
        resolved_command = [
            "git",
            "-c",
            f"safe.directory={cwd.as_posix()}",
            *resolved_command[1:],
        ]

    started = time.monotonic()
    completed = subprocess.run(
        resolved_command,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=300,
        shell=False,
    )
    duration_seconds = round(time.monotonic() - started, 3)

    return {
        "command": resolved_command,
        "exit_code": completed.returncode,
        "duration_seconds": duration_seconds,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
        "status": "passed" if completed.returncode == 0 else "failed",
    }


def run_check(check, project_path):
    can_run, reason = should_run(check, project_path)
    result = {
        "name": check["name"],
        "human_goal": check.get("human_goal", ""),
    }

    if not can_run:
        result.update(
            {
                "status": "skipped",
                "reason": reason,
                "command": check["command"],
                "exit_code": None,
                "duration_seconds": 0,
                "stdout": "",
                "stderr": "",
            }
        )
        return result

    result.update(run_command(check["command"], project_path))
    return result


def summarize_project(checks):
    failed = [check for check in checks if check["status"] == "failed"]
    passed = [check for check in checks if check["status"] == "passed"]
    skipped = [check for check in checks if check["status"] == "skipped"]

    if failed:
        status = "attention"
        message = f"Necesita revision: {len(failed)} check(s) fallaron."
    elif passed:
        status = "healthy"
        message = "Sin incidencias en los checks ejecutados."
    else:
        status = "not_ready"
        message = "Todavia no hay tests o linters configurados para ejecutar."

    return {
        "status": status,
        "message": message,
        "passed": len(passed),
        "failed": len(failed),
        "skipped": len(skipped),
    }


def build_markdown_report(report):
    lines = [
        f"# Informe diario - {report['generated_at']}",
        "",
        "## Resumen",
        "",
    ]

    for project in report["projects"]:
        summary = project["summary"]
        lines.extend(
            [
                f"### {project['name']}",
                "",
                f"Estado: {summary['message']}",
                "",
                f"- Checks correctos: {summary['passed']}",
                f"- Checks fallidos: {summary['failed']}",
                f"- Checks saltados: {summary['skipped']}",
                "",
                "Checks:",
                "",
            ]
        )

        for check in project["checks"]:
            label = {
                "passed": "OK",
                "failed": "FALLO",
                "skipped": "SALTADO",
            }.get(check["status"], check["status"].upper())
            lines.append(f"- {label}: {check['name']} - {check.get('human_goal', '')}")
            if check["status"] == "skipped":
                lines.append(f"  Motivo: {check['reason']}")
            if check["status"] == "failed" and check.get("stderr"):
                lines.append(f"  Error principal: {check['stderr'].splitlines()[0]}")

        lines.append("")

    return "\n".join(lines).strip() + "\n"


def main():
    REPORTS_DIR.mkdir(exist_ok=True)
    config = load_config()
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    report = {
        "generated_at": generated_at,
        "projects": [],
    }

    for project in config["projects"]:
        project_path = (ROOT / project["path"]).resolve()
        checks = []

        for check in project["checks"]:
            checks.append(run_check(check, project_path))

        report["projects"].append(
            {
                "name": project["name"],
                "path": str(project_path),
                "summary": summarize_project(checks),
                "checks": checks,
            }
        )

    json_path = REPORTS_DIR / f"daily-{stamp}.json"
    markdown_path = REPORTS_DIR / f"daily-{stamp}.md"

    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    markdown_path.write_text(build_markdown_report(report), encoding="utf-8")

    print(f"JSON report: {json_path}")
    print(f"Markdown report: {markdown_path}")

    has_failures = any(
        check["status"] == "failed"
        for project in report["projects"]
        for check in project["checks"]
    )
    return 1 if has_failures else 0


if __name__ == "__main__":
    sys.exit(main())
