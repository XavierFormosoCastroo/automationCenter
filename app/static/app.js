let state = {
  projects: [],
  selected: null,
};

const statusLabels = {
  healthy: "Healthy",
  attention: "Attention",
  not_ready: "Not ready",
};

function statusClass(project) {
  return project.summary?.status || "not_ready";
}

function statusText(project) {
  return statusLabels[statusClass(project)] || "Pending";
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function updateMetrics(payload) {
  const projects = payload.projects;
  const healthy = projects.filter((project) => statusClass(project) === "healthy").length;
  const attention = projects.filter((project) => statusClass(project) === "attention").length;
  setText("projectCount", projects.length);
  setText("healthyCount", healthy);
  setText("attentionCount", attention);
  setText("lastRun", payload.latest_report?.generated_at ? new Date(payload.latest_report.generated_at).toLocaleTimeString() : "None");
  setText("globalStatus", attention > 0 ? "Needs attention" : "Ready");
}

function renderProjects() {
  const list = document.getElementById("projectList");
  list.innerHTML = "";

  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = `project-card ${state.selected?.name === project.name ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <div class="project-title">
        <strong>${project.name}</strong>
        <span class="badge ${statusClass(project)}">${statusText(project)}</span>
      </div>
      <span class="project-path">${project.path}</span>
    `;
    button.addEventListener("click", () => {
      state.selected = project;
      render();
    });
    list.appendChild(button);
  });
}

function checkOutput(check) {
  const output = check.stdout || check.stderr || check.reason || "";
  return output ? `<pre class="check-output">${output}</pre>` : "";
}

function renderDetail() {
  const panel = document.getElementById("detailPanel");
  const project = state.selected;

  if (!project) {
    panel.innerHTML = `<div class="empty">No project selected.</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${project.name}</h2>
        <span class="project-path">${project.path}</span>
      </div>
      <span class="badge ${statusClass(project)}">${statusText(project)}</span>
    </div>
    <div class="operation-grid">
      ${project.operations
        .map(
          (operation) => `
            <button class="operation" type="button" data-operation="${operation.id}">
              <strong>${operation.name}</strong>
              <span class="check-goal">${operation.human_goal}</span>
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="check-list">
      ${(project.checks || [])
        .map(
          (check) => `
            <article class="check-row">
              <header>
                <strong>${check.name}</strong>
                <span class="badge ${check.status}">${check.status}</span>
              </header>
              <p class="check-goal">${check.human_goal || ""}</p>
              ${checkOutput(check)}
            </article>
          `,
        )
        .join("") || `<div class="empty">No runs yet.</div>`}
    </div>
  `;

  panel.querySelectorAll("[data-operation]").forEach((button) => {
    button.addEventListener("click", () => runOperation(project.name, button.dataset.operation));
  });
}

function render() {
  renderProjects();
  renderDetail();
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  state.projects = payload.projects;
  state.selected = state.selected
    ? state.projects.find((project) => project.name === state.selected.name) || state.projects[0]
    : state.projects[0];
  updateMetrics(payload);
  render();
}

async function runOperation(projectName, operationId) {
  const panel = document.getElementById("detailPanel");
  panel.classList.add("loading");
  const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/operations/${encodeURIComponent(operationId)}/run`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    alert(payload.error || "Operation failed");
  }
  await loadProjects();
  panel.classList.remove("loading");
}

loadProjects();
