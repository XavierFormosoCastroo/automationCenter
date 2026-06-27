let state = {
  projects: [],
  insights: { most_failing: [] },
  selected: null,
  view: "dashboard",
  activeOperation: null,
  operationResults: {},
  flowPage: 0,
  focusOperation: null,
  selectedOperation: null,
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

function dotFocusMarkup(position, status) {
  if (!position) return "";
  const offsets = [-48, -32, -16, 0, 16, 32, 48];
  const dots = offsets
    .flatMap((y) =>
      offsets.map((x) => {
        const distance = Math.sqrt(x * x + y * y);
        if (distance < 34 || distance > 76) return "";
        return `<i style="--x:${x}px; --y:${y}px; --delay:${Math.round(distance)}ms"></i>`;
      }),
    )
    .join("");
  return `
    <div class="focus-dots ${status}" style="left:${position.left}%; top:${position.top}%;" aria-hidden="true">
      ${dots}
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function operationIcon(operation) {
  const name = `${operation.id} ${operation.name}`.toLowerCase();
  if (name.includes("test")) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6" />
        <path d="M10 3v5l-4.5 8A3.5 3.5 0 0 0 8.6 21h6.8a3.5 3.5 0 0 0 3.1-5L14 8V3" />
        <path d="M8 16h8" />
      </svg>
    `;
  }
  if (name.includes("build")) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 15.5 12 20l8-4.5" />
        <path d="M4 10.5 12 15l8-4.5" />
        <path d="M4 6l8 4.5L20 6l-8-4.5L4 6Z" />
      </svg>
    `;
  }
  if (name.includes("start") || name.includes("run")) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 5 11 7-11 7V5Z" />
      </svg>
    `;
  }
  if (name.includes("lint") || name.includes("check")) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h8" />
        <path d="m16 17 2 2 4-5" />
      </svg>
    `;
  }
  if (name.includes("git")) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h.01" />
        <path d="M17 17h.01" />
        <path d="M7 7v6a4 4 0 0 0 4 4h6" />
        <path d="M7 7h6a4 4 0 0 1 4 4v6" />
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </svg>
  `;
}

function selectedOperation() {
  if (!state.selected) return null;
  return state.selected.operations?.find((operation) => operation.id === state.selectedOperation) || null;
}

function operationConditions(operation) {
  if (!operation) return "No conditions configured.";
  if (operation.only_if_exists) return `Only runs if ${operation.only_if_exists} exists.`;
  if (operation.only_if_exists_any?.length) {
    return `Only runs if any of these files exists: ${operation.only_if_exists_any.join(", ")}.`;
  }
  return "Always available for this project.";
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
        <small>${relativeTime(data.latest_run_at)} - ${data.failure_rate_24h}% failure rate</small>
        <small>${project.path}</small>
      </span>
      <em class="${data.failure_level}" title="${data.failure_level}"></em>
    `;
    button.addEventListener("click", () => {
      state.selected = project;
      state.view = "project-detail";
      state.operationResults = {};
      state.activeOperation = null;
      state.flowPage = 0;
      state.focusOperation = project.operations?.[0]?.id || null;
      state.selectedOperation = null;
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

  const pageSize = 3;
  const allOperations = project.operations || [];
  const totalPages = Math.max(1, Math.ceil(allOperations.length / pageSize));
  state.flowPage = Math.min(state.flowPage, totalPages - 1);
  const pageStart = state.flowPage * pageSize;
  const operations = allOperations.slice(pageStart, pageStart + pageSize);
  const hasNextPage = state.flowPage < totalPages - 1;
  const hasPreviousPage = state.flowPage > 0;
  if (!operations.some((operation) => operation.id === state.focusOperation)) {
    state.focusOperation = operations[0]?.id || null;
  }
  const positions = [
    { left: 20, top: 54 },
    { left: 50, top: 34 },
    { left: 78, top: 62 },
  ];
  const routes = [
    "M 25 54 H 35 V 34 H 43",
    "M 57 34 H 66 V 62 H 71",
  ];
  const routeMarkup = routes
    .map((path, index) => {
      if (!operations[index + 1]) return "";
      const previous = state.operationResults[operations[index]?.id];
      const isRunning = state.activeOperation === operations[index]?.id;
      return `<path class="flow-route ${statusForResult(previous)} ${isRunning ? "running" : ""}" d="${path}" pathLength="1" />`;
    })
    .join("");
  const pageExitResult = state.operationResults[operations.at(-1)?.id];
  const exitRouteMarkup = hasNextPage
    ? `<path class="flow-route exit-route ${statusForResult(pageExitResult)} ${state.activeOperation === operations.at(-1)?.id ? "running" : ""}" d="M 85 62 H 91" pathLength="1" />`
    : "";
  const nodeMarkup = operations
    .map((operation, index) => {
      const result = state.operationResults[operation.id];
      const status = statusForResult(result);
      const isActive = state.activeOperation === operation.id;
      const isFocused = state.focusOperation === operation.id;
      const position = positions[index];
      return `
        <button
          class="flow-node ${status} ${isActive ? "active" : ""} ${isFocused ? "focused" : ""}"
          style="left:${position.left}%; top:${position.top}%"
          type="button"
          data-operation="${operation.id}"
        >
          <span class="node-icon">${operationIcon(operation)}</span>
          <strong>${operation.name}</strong>
          <small>${operation.human_goal || "Automation step"}</small>
        </button>
      `;
    })
    .join("");
  const focusOperationId = state.activeOperation || state.focusOperation || operations[0]?.id;
  const focusIndex = operations.findIndex((operation) => operation.id === focusOperationId);
  const focusPosition = focusIndex >= 0 ? positions[focusIndex] : null;
  const focusStatus = focusIndex >= 0 ? statusForResult(state.operationResults[operations[focusIndex].id]) : "idle";
  const focusDots = dotFocusMarkup(focusPosition, focusStatus);
  const pagerMarkup = Array.from({ length: totalPages }, (_, index) => {
    const label = index + 1;
    return `<button class="${index === state.flowPage ? "active" : ""}" type="button" data-flow-page="${index}" aria-label="Go to automation page ${label}">${label}</button>`;
  }).join("");

  track.innerHTML = `
    <div class="flow-board">
      <svg class="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${routeMarkup}
        ${exitRouteMarkup}
      </svg>
      ${focusDots}
      ${nodeMarkup}
      <button class="arrow-node arrow-node-left ${hasPreviousPage ? "available" : ""}" type="button" aria-label="Previous automation section" ${hasPreviousPage ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <button class="arrow-node arrow-node-right ${hasNextPage ? "available" : ""}" type="button" aria-label="Next automation section" ${hasNextPage ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
      <div class="flow-pager" aria-label="Automation path pages">
        ${hasPreviousPage ? `<button type="button" data-flow-page="${state.flowPage - 1}" aria-label="Go to previous automation page">&lt;</button>` : ""}
        ${pagerMarkup}
        ${hasNextPage ? `<button type="button" data-flow-page="${state.flowPage + 1}" aria-label="Go to next automation page">&gt;</button>` : ""}
      </div>
    </div>
  `;

  track.querySelectorAll("[data-operation]").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      state.focusOperation = button.dataset.operation;
      renderFlow();
    });
    button.addEventListener("focus", () => {
      state.focusOperation = button.dataset.operation;
      renderFlow();
    });
    button.addEventListener("click", () => {
      state.focusOperation = button.dataset.operation;
      state.selectedOperation = button.dataset.operation;
      state.view = "operation-detail";
      render();
    });
  });
  track.querySelector(".arrow-node-right")?.addEventListener("click", () => {
    if (!hasNextPage) return;
    state.flowPage += 1;
    state.focusOperation = allOperations[state.flowPage * pageSize]?.id || null;
    renderFlow();
  });
  track.querySelector(".arrow-node-left")?.addEventListener("click", () => {
    if (!hasPreviousPage) return;
    state.flowPage -= 1;
    state.focusOperation = allOperations[state.flowPage * pageSize]?.id || null;
    renderFlow();
  });
  track.querySelectorAll("[data-flow-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.flowPage = Number(button.dataset.flowPage);
      state.focusOperation = allOperations[state.flowPage * pageSize]?.id || null;
      renderFlow();
    });
  });
}

function renderOperationDetail() {
  const operation = selectedOperation();
  if (!operation || !state.selected) return;
  setText("operationProject", state.selected.name);
  setText("operationTitle", operation.name);
  setText("operationDescription", operation.human_goal || "No description configured.");
  setText("operationScript", operation.script || "No script configured.");
  setText("operationConditions", operationConditions(operation));
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
            <strong>${escapeHtml(check.name)}</strong>
            <span class="status-dot ${check.status}">${check.status}</span>
          </header>
          <pre>${escapeHtml(output)}</pre>
        </article>
      `;
    })
    .join("");
}

function render() {
  renderViews();
  renderProjectMenu();
  renderSelectedProject();
  renderFragileList();
  renderFlow();
  renderOperationDetail();
  renderLog(state.selected);
}

function renderViews() {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".side-link").forEach((link) => link.classList.remove("active"));

  const viewByName = {
    dashboard: "dashboardView",
    projects: "projectsView",
    "project-detail": "projectDetailView",
    "operation-detail": "operationDetailView",
  };
  const activeView = document.getElementById(viewByName[state.view] || "dashboardView");
  activeView.classList.add("active");

  const activeNav = state.view === "project-detail" || state.view === "operation-detail" ? "projects" : state.view;
  const activeButton = document.querySelector(`[data-view="${activeNav}"]`);
  if (activeButton) activeButton.classList.add("active");
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
  const operationIndex = state.selected?.operations?.findIndex((operation) => operation.id === operationId) ?? -1;
  if (operationIndex >= 0) state.flowPage = Math.floor(operationIndex / 3);
  state.activeOperation = operationId;
  state.focusOperation = operationId;
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
  state.focusOperation = operationId;
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
document.getElementById("backToPath").addEventListener("click", () => {
  state.view = "project-detail";
  render();
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    if (state.view !== "project-detail") state.activeOperation = null;
    if (state.view !== "operation-detail") state.selectedOperation = null;
    render();
  });
});
loadProjects();
