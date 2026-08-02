const state = {
  agents: [],
  selectedAgentId: "",
  selectedAgentName: "",
  bearerToken: "",
  apiKey: "",
  baseUrl: "http://127.0.0.1:3000"
};

const els = {};

function getValue(id) {
  return document.getElementById(id).value.trim();
}

function setValue(id, value) {
  document.getElementById(id).value = value == null ? "" : value;
}

function setStatus(message, isError = false) {
  const el = els.connectionStatus;
  el.textContent = message;
  el.style.background = isError ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)";
  el.style.color = isError ? "#fecaca" : "#86efac";
  el.style.borderColor = isError ? "rgba(239, 68, 68, 0.3)" : "rgba(34, 197, 94, 0.3)";
}

function logResponse(value) {
  if (typeof value === "string") {
    els.responseOutput.textContent = value;
    return;
  }

  els.responseOutput.textContent = JSON.stringify(value, null, 2);
}

function normalizeBaseUrl() {
  return getValue("baseUrl").replace(/\/$/, "");
}

function authHeaders(mode) {
  if (mode === "bearer" && state.bearerToken) {
    return { Authorization: `Bearer ${state.bearerToken}` };
  }

  if (mode === "apiKey" && state.apiKey) {
    return { "x-api-key": state.apiKey };
  }

  return {};
}

async function request(path, options = {}) {
  const url = `${normalizeBaseUrl()}${path}`;
  const headers = Object.assign({}, options.headers || {});

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(`${response.status} ${response.statusText}\n${message}`);
  }

  return body;
}

function renderAgents() {
  const tbody = els.agentTable;
  tbody.innerHTML = "";

  if (!state.agents.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No agents loaded.</td></tr>`;
    els.agentSummary.textContent = "No agents loaded yet.";
    return;
  }

  els.agentSummary.textContent = `${state.agents.length} agent(s) loaded.`;

  for (const agent of state.agents) {
    const row = document.createElement("tr");
    if (agent.id === state.selectedAgentId) {
      row.classList.add("selected");
    }

    row.innerHTML = `
      <td><button class="secondary" data-select="${agent.id}">Select</button></td>
      <td>${agent.agent_name || ""}</td>
      <td>${agent.status || "active"}</td>
      <td>${agent.daily_budget ?? ""}</td>
      <td>${agent.api_key_prefix || ""}</td>
    `;
    tbody.appendChild(row);
  }
}

async function loadAgents() {
  if (!state.bearerToken) {
    throw new Error("Bearer token is required to load agents.");
  }

  const agents = await request("/agents", {
    headers: { Authorization: `Bearer ${state.bearerToken}` }
  });

  state.agents = agents.agents || [];
  renderAgents();
  logResponse(agents);
}

async function loadDashboard() {
  if (!state.bearerToken) {
    throw new Error("Bearer token is required to load the dashboard.");
  }

  const dashboard = await request("/dashboard", {
    headers: { Authorization: `Bearer ${state.bearerToken}` }
  });

  els.dashboardOutput.textContent = dashboard;
  logResponse(dashboard);
}

function selectedAgent() {
  return state.agents.find((agent) => agent.id === state.selectedAgentId) || null;
}

async function createAgent() {
  const body = {
    agent_name: getValue("createAgentName"),
    daily_budget: Number(getValue("createAgentBudget"))
  };

  const result = await request("/agents", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.bearerToken}` },
    body
  });

  state.apiKey = result.api_key;
  setValue("apiKey", state.apiKey);
  state.selectedAgentId = result.agent.id;
  state.selectedAgentName = result.agent.agent_name;
  setValue("selectedAgentId", result.agent.id);
  setValue("selectedAgentName", result.agent.agent_name);
  await loadAgents();
  await loadDashboard();
  logResponse(result);
  setStatus("Agent created", false);
}

async function sendPulse() {
  const result = await request("/pulse", {
    method: "POST",
    headers: { "x-api-key": state.apiKey },
    body: {
      task: getValue("pulseTask"),
      progress: Number(getValue("pulseProgress")),
      current_cost: Number(getValue("pulseCost"))
    }
  });

  await loadDashboard();
  logResponse(result);
}

async function checkBudget() {
  const result = await request("/check-budget", {
    method: "POST",
    headers: { "x-api-key": state.apiKey },
    body: { estimated_cost_of_next_action: Number(getValue("budgetEstimate")) }
  });

  logResponse(result);
}

async function saveState() {
  const result = await request("/save-state", {
    method: "POST",
    headers: { "x-api-key": state.apiKey },
    body: { state_summary: getValue("stateSummary") }
  });

  await loadDashboard();
  logResponse(result);
}

async function loadState() {
  const result = await request("/load-state", {
    headers: { "x-api-key": state.apiKey }
  });

  setValue("stateSummary", result.state_summary || "");
  logResponse(result);
}

async function updateKillSwitch(command) {
  const agent = selectedAgent();
  if (!agent) {
    throw new Error("Select an agent first.");
  }

  const result = await request(`/agents/${agent.id}/kill-switch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.bearerToken}` },
    body: { command }
  });

  await loadAgents();
  await loadDashboard();
  logResponse(result);
}

async function rotateKey() {
  const agent = selectedAgent();
  if (!agent) {
    throw new Error("Select an agent first.");
  }

  const result = await request(`/agents/${agent.id}/rotate-key`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.bearerToken}` }
  });

  state.apiKey = result.api_key;
  setValue("apiKey", state.apiKey);
  await loadAgents();
  await loadDashboard();
  logResponse(result);
}

async function revokeAgent() {
  const agent = selectedAgent();
  if (!agent) {
    throw new Error("Select an agent first.");
  }

  const result = await request(`/agents/${agent.id}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.bearerToken}` }
  });

  await loadAgents();
  await loadDashboard();
  logResponse(result);
}

async function sendRequest() {
  const method = getValue("requestMethod");
  const path = getValue("requestPath");
  const authMode = getValue("requestAuth");
  const rawBody = getValue("requestBody");
  const headers = authHeaders(authMode);
  let body;

  if (rawBody) {
    body = JSON.parse(rawBody);
  }

  const result = await request(path, {
    method,
    headers,
    body
  });

  if (typeof result === "string") {
    els.dashboardOutput.textContent = result;
  } else {
    els.dashboardOutput.textContent = JSON.stringify(result, null, 2);
  }

  logResponse(result);
}

function bindEvents() {
  els.saveSettings.addEventListener("click", () => {
    state.baseUrl = getValue("baseUrl");
    state.bearerToken = getValue("bearerToken");
    state.apiKey = getValue("apiKey");
    localStorage.setItem("agent-guard-ui", JSON.stringify({
      baseUrl: state.baseUrl,
      bearerToken: state.bearerToken,
      apiKey: state.apiKey
    }));
    setStatus("Settings saved");
  });

  els.refreshAgents.addEventListener("click", async () => {
    try {
      state.bearerToken = getValue("bearerToken");
      await loadAgents();
      setStatus("Agents refreshed");
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.refreshDashboard.addEventListener("click", async () => {
    try {
      state.bearerToken = getValue("bearerToken");
      await loadDashboard();
      setStatus("Dashboard refreshed");
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.createAgent.addEventListener("click", async () => {
    try {
      await createAgent();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.sendPulse.addEventListener("click", async () => {
    try {
      await sendPulse();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.checkBudget.addEventListener("click", async () => {
    try {
      await checkBudget();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.saveState.addEventListener("click", async () => {
    try {
      await saveState();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.loadState.addEventListener("click", async () => {
    try {
      await loadState();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.rotateKey.addEventListener("click", async () => {
    try {
      await rotateKey();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.revokeAgent.addEventListener("click", async () => {
    try {
      await revokeAgent();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.setContinue.addEventListener("click", async () => {
    try {
      await updateKillSwitch("CONTINUE");
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.setStop.addEventListener("click", async () => {
    try {
      await updateKillSwitch("STOP");
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.sendRequest.addEventListener("click", async () => {
    try {
      await sendRequest();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  });

  els.agentTable.addEventListener("click", (event) => {
    const target = event.target;
    const id = target.getAttribute && target.getAttribute("data-select");
    if (!id) {
      return;
    }

    const agent = state.agents.find((item) => item.id === id);
    if (!agent) {
      return;
    }

    state.selectedAgentId = agent.id;
    state.selectedAgentName = agent.agent_name;
    setValue("selectedAgentId", agent.id);
    setValue("selectedAgentName", agent.agent_name);
    renderAgents();
  });
}

function loadSavedSettings() {
  const saved = localStorage.getItem("agent-guard-ui");
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    if (parsed.baseUrl) setValue("baseUrl", parsed.baseUrl);
    if (parsed.bearerToken) setValue("bearerToken", parsed.bearerToken);
    if (parsed.apiKey) setValue("apiKey", parsed.apiKey);
  } catch {
    // ignore corrupt local state
  }
}

function cacheElements() {
  [
    "connectionStatus",
    "agentSummary",
    "agentTable",
    "dashboardOutput",
    "responseOutput",
    "saveSettings",
    "refreshAgents",
    "refreshDashboard",
    "createAgent",
    "sendPulse",
    "checkBudget",
    "saveState",
    "loadState",
    "rotateKey",
    "revokeAgent",
    "setContinue",
    "setStop",
    "sendRequest"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

async function init() {
  cacheElements();
  loadSavedSettings();
  bindEvents();
  setStatus("Ready");

  state.baseUrl = getValue("baseUrl");
  state.bearerToken = getValue("bearerToken");
  state.apiKey = getValue("apiKey");

  if (state.bearerToken) {
    try {
      await loadAgents();
      await loadDashboard();
    } catch (error) {
      setStatus(error.message, true);
      logResponse(error.message);
    }
  }
}

init();
