import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "app" / "static"
RUNNER_DIR = ROOT / "runner"
sys.path.insert(0, str(RUNNER_DIR))

import run_checks  # noqa: E402


def json_response(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_latest_report():
    reports = sorted((ROOT / "reports").glob("daily-*.json"), reverse=True)
    if not reports:
        return None
    return json.loads(reports[0].read_text(encoding="utf-8"))


def project_payload():
    config = run_checks.load_config()
    latest = read_latest_report()
    latest_by_name = {}
    if latest:
        latest_by_name = {project["name"]: project for project in latest.get("projects", [])}

    projects = []
    for project in config["projects"]:
        path = run_checks.resolve_project_path(project)
        latest_project = latest_by_name.get(project["name"])
        projects.append(
            {
                "name": project["name"],
                "path": str(path),
                "exists": path.exists(),
                "summary": latest_project.get("summary") if latest_project else None,
                "checks": latest_project.get("checks", []) if latest_project else [],
                "operations": [
                    {
                        "id": check["id"],
                        "name": check["name"],
                        "human_goal": check.get("human_goal", ""),
                    }
                    for check in project["checks"]
                ],
            }
        )

    return {"projects": projects, "latest_report": latest}


class AutomationHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/projects":
            json_response(self, project_payload())
            return

        if self.path == "/api/reports/latest":
            json_response(self, read_latest_report() or {"projects": []})
            return

        path = "index.html" if self.path == "/" else unquote(self.path.lstrip("/"))
        file_path = (STATIC_DIR / path).resolve()

        if not str(file_path).startswith(str(STATIC_DIR.resolve())) or not file_path.exists():
            self.send_error(404)
            return

        content_type = "text/html; charset=utf-8"
        if file_path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"

        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parts = self.path.strip("/").split("/")
        if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "operations" and parts[5] == "run":
            project_name = unquote(parts[2])
            operation_id = unquote(parts[4])
            config = run_checks.load_config()
            project = next((item for item in config["projects"] if item["name"] == project_name), None)
            if not project:
                json_response(self, {"error": "Proyecto no encontrado."}, status=404)
                return

            try:
                result = run_checks.run_project(project, operation_id=operation_id)
                report = run_checks.write_report([result])
                json_response(self, {"project": result, "report": report})
            except Exception as exc:
                json_response(self, {"error": str(exc)}, status=500)
            return

        self.send_error(404)

    def log_message(self, format, *args):
        return


def main():
    server = ThreadingHTTPServer(("0.0.0.0", 8000), AutomationHandler)
    print("automationCenter running on http://localhost:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
