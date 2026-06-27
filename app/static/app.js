let state = {
  projects: [],
  insights: { most_failing: [] },
  selected: null,
  activeOperation: null,
  operationResults: {},
};

const riskLabels = {
  good: "Green",
  warning: "Orange",
  critical: "Red",
};

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function history(project) {
  return project?.history || {
    latest_run_at: null,
    checks_24h: 0,
    failures_24h: 0,
    failure_rate_24h: 0,
    failure_level: "good",
  };
}

function relativeTime(value) {
  if (!value) return "No runs yet";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSeconds < 60) return "just now";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function riskLevel(rate) {
  if (rate < 5) return "good";
  if (rate < 10) return "warning";
  return "critical";
}

function statusForResult(result) {
  if (!result) return "idle";
  if (result.status === "passed") return "passed";
  if (result.status === "failed") return "failed";
  if (result.status === "skipped") return "skipped";
  return "idle";
}

function updateSummary(payload) {
  const projects = payload.projects;
  const totalChecks = projects.reduce((sum, project) => sum + history(project).checks_24h, 0);
  const totalFailures = projects.reduce((sum, project) => sum + history(project).failures_24h, 0);
  const rate = totalChecks ? Math.round((totalFailures / totalChecks) * 1000) / 10 : 0;
  const latest = projects
    .map((project) => history(project).latest_run_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  setText("projectCount", projects.length);
  setText("lastRun", relativeTime(latest));
  setText("failureRate", `${rate}%`);
  setText("riskBand", riskLabels[riskLevel(rate)]);
  setText("globalStatus", rate >= 10 ? "Attention" : "Ready");
}

function renderProjectMenu() {
  const menu = document.getElementById("projectMenu");
  menu.innerHTML = "";

  state.projects.forEach((project) => {
    const data = history(project);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-card ${state.selected?.name === project.name ? "active" : ""}`;
    button.innerHTML = `
      <span class="project-thumb" aria-hidden="true"></span>
      <span class="project-copy">
        <strong>${project.name}</strong>
        <small>${relativeTime(data.latest_run_at)} · ${data.failure_rate_24h}% failure rate</small>
        <small>${project.path}</small>
      </span>
      <em class="${data.failure_level}" title="${data.failure_level}"></em>
    `;
    button.addEventListener("click", () => {
      state.selected = project;
      state.operationResults = {};
      state.activeOperation = null;
      render();
    });
    menu.appendChild(button);
  });
}

function renderSelectedProject() {
  const project = state.selected;
  if (!project) return;
  const data = history(project);
  setText("selectedTitle", project.name);
  setText("selectedPath", project.path);
  setText("selectedLastRun", relativeTime(data.latest_run_at));
  setText("selectedFailures", data.failures_24h);
  setText("selectedFailureRate", `${data.failure_rate_24h}%`);

  const badge = document.getElementById("selectedRisk");
  badge.textContent = riskLabels[data.failure_level];
  badge.className = `risk-badge ${data.failure_level}`;
}

function renderFragileList() {
  const list = document.getElementById("fragileList");
  const items = state.insights.most_failing || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">No execution data yet.</div>`;
    return;
  }

  list.innerHTML = items
    .map(
      (item) => `
        <article class="fragile-item">
          <span>${item.name}</span>
          <strong class="${item.failure_level}">${item.failure_rate_24h}%</strong>
        </article>
      `,
    )
    .join("");
}

function renderFlow() {
  const track = document.getElementById("flowTrack");
  const project = state.selected;
  if (!project) {
    track.innerHTML = `<div class="empty">Select a project.</div>`;
    return;
  }

  const operations = project.operations.slice(0, 4);
  const positions = [
    { left: 18, top: 48 },
    { left: 48, top: 30 },
    { left: 80, top: 63 },
    { left: 84, top: 46 },
  ];
  const routes = [
    "M 23 53 H 35 V 35 H 43",
    "M 53 35 H 64 V 68 H 75",
    "M 85 68 H 88 V 51 H 84",
  ];
  const routeMarkup = routes
    .map((path, index) => {
      const previous = state.operationResults[operations[index]?.id];
      return `<path class="flow-route ${statusForResult(previous)}" d="${path}" />`;
    })
    .join("");
  const nodeMarkup = operations
    .map((operation, index) => {
      const result = state.operationResults[operation.id];
      const status = statusForResult(result);
      const isActive = state.activeOperation === operation.id;
      const position = positions[index];
      return `
        <button
          class="flow-node ${status} ${isActive ? "active" : ""}"
          style="left:${position.left}%; top:${position.top}%"
          type="button"
          data-operation="${operation.id}"
        >
          <strong>${operation.name}</strong>
        </button>
      `;
    })
    .join("");

  track.innerHTML = `
    <div class="flow-board">
      <svg class="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${routeMarkup}
      </svg>
      ${nodeMarkup}
      <button class="arrow-node" type="button" aria-label="Next automation page"></button>
      <div class="flow-pager" aria-hidden="true">
        <span>1</span><span>2</span><i></i><i></i><i></i>
      </div>
    </div>
  `;

  track.querySelectorAll("[data-operation]").forEach((button) => {
    button.addEventListener("click", () => runOperation(project.name, button.dataset.operation));
  });
}

function renderLog(project) {
  const log = document.getElementById("runLog");
  const operationChecks = project?.operations
    ? project.operations.map((operation) => state.operationResults[operation.id]).filter(Boolean)
    : [];
  const checks = operationChecks.length ? operationChecks : project?.checks || [];
  if (!checks.length) {
    log.innerHTML = `<div class="empty">Run an operation to see the latest output.</div>`;
    return;
  }

  log.innerHTML = checks
    .map((check) => {
      const output = check.stdout || check.stderr || check.reason || "No output.";
      return `
        <article class="log-entry">
          <header>
            <strong>${check.name}</strong>
            <span class="status-dot ${check.status}">${check.status}</span>
          </header>
          <pre>${output}</pre>
        </article>
      `;
    })
    .join("");
}

function render() {
  renderProjectMenu();
  renderSelectedProject();
  renderFragileList();
  renderFlow();
  renderLog(state.selected);
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  state.projects = payload.projects;
  state.insights = payload.insights || { most_failing: [] };
  state.selected = state.selected
    ? state.projects.find((project) => project.name === state.selected.name) || state.projects[0]
    : state.projects[0];
  updateSummary(payload);
  render();
}

async function runOperation(projectName, operationId) {
  state.activeOperation = operationId;
  renderFlow();
  const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/operations/${encodeURIComponent(operationId)}/run`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    state.operationResults[operationId] = { status: "failed", stderr: payload.error || "Operation failed" };
  } else {
    const check = payload.project.checks[0];
    state.operationResults[operationId] = check;
    state.projects = state.projects.map((project) =>
      project.name === projectName
        ? {
            ...project,
            path: payload.project.path,
            summary: payload.project.summary,
            checks: payload.project.checks,
          }
        : project,
    );
    state.selected = state.projects.find((project) => project.name === projectName) || state.selected;
  }
  state.activeOperation = null;
  render();
  await loadProjects();
}

async function runSequence() {
  const project = state.selected;
  if (!project) return;
  state.operationResults = {};
  for (const operation of project.operations) {
    await runOperation(project.name, operation.id);
  }
}

document.getElementById("runSequence").addEventListener("click", runSequence);
loadProjects();
