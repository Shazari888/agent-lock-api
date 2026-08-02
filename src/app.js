const path = require("path");
const express = require("express");
const cors = require("cors");
const { buildDashboardMarkdown } = require("./lib/markdownDashboard");
const { generateApiKey } = require("./lib/agentKeys");
const { PRICING, getMemoryWritePriceUsdc } = require("./lib/pricing");

const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 24 * 30;
const MAX_MEMORY_PAYLOAD_BYTES = 100 * 1024;

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function parseTtlHours(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_TTL_HOURS;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TTL_HOURS) {
    return null;
  }

  return parsed;
}

function calculatePayloadBytes(key, value) {
  return Buffer.byteLength(JSON.stringify({ key, value }), "utf8");
}

function createRateLimiter({ windowMs, maxRequests, getKey, errorMessage }) {
  const requestWindowByKey = new Map();

  return function rateLimit(req, res, next) {
    const key = getKey(req);
    const nowMs = Date.now();

    for (const [existingKey, value] of requestWindowByKey.entries()) {
      if (nowMs - value.windowStartMs > windowMs) {
        requestWindowByKey.delete(existingKey);
      }
    }

    const existing = requestWindowByKey.get(key);

    if (!existing || nowMs - existing.windowStartMs > windowMs) {
      requestWindowByKey.set(key, {
        count: 1,
        windowStartMs: nowMs
      });
      return next();
    }

    existing.count += 1;

    if (existing.count > maxRequests) {
      return res.status(429).json({ error: errorMessage });
    }

    next();
  };
}

function createApp({ repository, authService, security = {}, now = () => new Date() }) {
  const rateLimitWindowMs = Number(security.rateLimitWindowMs) || 60 * 1000;
  const agentRouteRateLimitMax = Number(security.agentRouteRateLimitMax) || 240;
  const userRouteRateLimitMax = Number(security.userRouteRateLimitMax) || 120;
  const app = express();
  const publicDir = path.join(process.cwd(), "public");

  app.use(cors());
  app.use(express.json({ limit: "120kb" }));
  app.use("/ui", express.static(publicDir));
  app.disable("x-powered-by");

  const agentRateLimit = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: agentRouteRateLimitMax,
    getKey(req) {
      const apiKey = req.headers["x-api-key"];
      return `agent:${typeof apiKey === "string" && apiKey ? apiKey : req.ip || "unknown"}`;
    },
    errorMessage: "Rate limit exceeded for agent routes"
  });

  const userRateLimit = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: userRouteRateLimitMax,
    getKey(req) {
      const authorization = req.headers.authorization;
      return `user:${typeof authorization === "string" && authorization ? authorization : req.ip || "unknown"}`;
    },
    errorMessage: "Rate limit exceeded for user routes"
  });

  const authenticateApiKey = async (req, res, next) => {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({ error: "Unauthorized: API Key missing" });
    }

    const agent = await repository.findAgentByApiKey(apiKey);

    if (!agent) {
      return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }

    req.agent = agent;
    req.user_id = agent.user_id;

    await repository.recordAgentLastUsed(agent.id, now().toISOString());

    next();
  };

  const authenticateUser = async (req, res, next) => {
    const accessToken = extractBearerToken(req.headers.authorization);

    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized: Access token missing" });
    }

    const userContext = await authService.getUserContext(accessToken);

    if (!userContext) {
      return res.status(401).json({ error: "Unauthorized: Invalid bearer token" });
    }

    const { user, repository: userRepository } = userContext;

    req.user = user;
    req.user_id = user.id;
    req.userRepository = userRepository;

    next();
  };

  app.get("/", (_req, res) => {
    res.send("Agent Guard API is running!");
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", message: "Agent Guard API is healthy" });
  });

  app.get("/pricing", (_req, res) => {
    res.status(200).json({
      model: "premium",
      pricing: PRICING,
      notes: {
        ttl_hours_default: DEFAULT_TTL_HOURS,
        ttl_hours_max: MAX_TTL_HOURS,
        payload_limit_bytes: MAX_MEMORY_PAYLOAD_BYTES
      }
    });
  });

  app.get("/ui", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/test-auth", agentRateLimit, authenticateApiKey, (req, res) => {
    res.status(200).json({ message: "Authenticated!", agent: req.agent });
  });

  app.post("/pulse", agentRateLimit, authenticateApiKey, async (req, res) => {
    const { task, progress, current_cost } = req.body;
    const normalizedProgress = parseNumber(progress);
    const normalizedCurrentCost = parseNumber(current_cost);

    if (!task || normalizedProgress === null || normalizedCurrentCost === null) {
      return res.status(400).json({ error: "Missing or invalid required fields: task, progress, current_cost" });
    }

    await repository.insertPulseLog({
      agentId: req.agent.id,
      task,
      progress: normalizedProgress,
      currentCost: normalizedCurrentCost
    });

    res.status(200).json({ message: "Pulse logged successfully" });
  });

  app.post("/check-budget", agentRateLimit, authenticateApiKey, async (req, res) => {
    const estimatedCost = parseNumber(req.body.estimated_cost_of_next_action);
    const dailyBudget = parseNumber(req.agent.daily_budget);

    if (estimatedCost === null) {
      return res.status(400).json({ error: "Missing or invalid required field: estimated_cost_of_next_action" });
    }

    if (dailyBudget === null) {
      return res.status(500).json({ error: "Invalid agent daily budget configuration" });
    }

    const startOfDay = now();
    startOfDay.setHours(0, 0, 0, 0);

    const pulseLogs = await repository.listPulseLogsSince(req.agent.id, startOfDay.toISOString());
    const currentDailySpend = pulseLogs.reduce((sum, log) => sum + Number(log.current_cost || 0), 0);
    const projectedSpend = currentDailySpend + estimatedCost;

    if (projectedSpend > dailyBudget) {
      return res.status(200).json({
        status: "STOP",
        message: `Daily budget of $${dailyBudget.toFixed(2)} exceeded. Current spend: $${currentDailySpend.toFixed(2)}. Projected spend: $${projectedSpend.toFixed(2)}.`,
        remaining_budget: 0
      });
    }

    const remainingBudget = Number((dailyBudget - projectedSpend).toFixed(2));

    return res.status(200).json({
      status: "CONTINUE",
      message: `Budget OK. Remaining budget: $${remainingBudget.toFixed(2)}.`,
      remaining_budget: remainingBudget
    });
  });

  app.get("/kill-switch", agentRateLimit, authenticateApiKey, async (req, res) => {
    const killSwitchEntry = await repository.getKillSwitchCommand(req.agent.id);

    res.status(200).json({ command: killSwitchEntry ? killSwitchEntry.command : "CONTINUE" });
  });

  app.post("/save-state", agentRateLimit, authenticateApiKey, async (req, res) => {
    const { state_summary } = req.body;

    if (!state_summary) {
      return res.status(400).json({ error: "Missing required field: state_summary" });
    }

    await repository.saveStateSnapshot(req.agent.id, state_summary, now().toISOString());

    res.status(200).json({ message: "State snapshot saved successfully" });
  });

  app.get("/load-state", agentRateLimit, authenticateApiKey, async (req, res) => {
    const stateSnapshot = await repository.getStateSnapshot(req.agent.id);

    res.status(200).json({ state_summary: stateSnapshot ? stateSnapshot.state_summary : null });
  });

  app.post("/memory/set", agentRateLimit, authenticateApiKey, async (req, res) => {
    const memoryKey = typeof req.body.key === "string" ? req.body.key.trim() : "";
    const memoryValue = req.body.value;
    const ttlHours = parseTtlHours(req.body.ttl_hours);

    if (!memoryKey) {
      return res.status(400).json({ error: "Missing required field: key" });
    }

    if (memoryValue === undefined) {
      return res.status(400).json({ error: "Missing required field: value" });
    }

    if (ttlHours === null) {
      return res.status(400).json({ error: `Invalid ttl_hours. Use 1 to ${MAX_TTL_HOURS}.` });
    }

    const payloadBytes = calculatePayloadBytes(memoryKey, memoryValue);

    if (payloadBytes > MAX_MEMORY_PAYLOAD_BYTES) {
      return res.status(413).json({
        error: `Payload exceeds ${MAX_MEMORY_PAYLOAD_BYTES} bytes limit`,
        payload_bytes: payloadBytes,
        max_payload_bytes: MAX_MEMORY_PAYLOAD_BYTES
      });
    }

    const nowIso = now().toISOString();
    const expiresAt = new Date(now().getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    const billedAmount = getMemoryWritePriceUsdc(ttlHours);

    await repository.upsertMemoryItem({
      agentId: req.agent.id,
      key: memoryKey,
      value: memoryValue,
      ttlHours,
      payloadBytes,
      expiresAt,
      updatedAt: nowIso
    });

    return res.status(200).json({
      message: "Memory saved successfully",
      key: memoryKey,
      ttl_hours: ttlHours,
      expires_at: expiresAt,
      payload_bytes: payloadBytes,
      billed_amount_usdc: billedAmount
    });
  });

  app.get("/memory/get/:key", agentRateLimit, authenticateApiKey, async (req, res) => {
    const memoryKey = req.params.key;

    const item = await repository.getMemoryItem({
      agentId: req.agent.id,
      key: memoryKey,
      nowIso: now().toISOString()
    });

    if (!item) {
      return res.status(404).json({ error: "Memory key not found" });
    }

    return res.status(200).json({
      key: item.memory_key,
      value: item.memory_value,
      ttl_hours: item.ttl_hours,
      expires_at: item.expires_at,
      billed_amount_usdc: PRICING.base.read_usdc
    });
  });

  app.delete("/memory/delete/:key", agentRateLimit, authenticateApiKey, async (req, res) => {
    const memoryKey = req.params.key;
    const deleted = await repository.deleteMemoryItem({
      agentId: req.agent.id,
      key: memoryKey
    });

    return res.status(200).json({
      key: memoryKey,
      deleted,
      billed_amount_usdc: PRICING.base.delete_usdc
    });
  });

  app.post("/agents", userRateLimit, authenticateUser, async (req, res) => {
    const { agent_name, daily_budget } = req.body;
    const normalizedDailyBudget = parseNumber(daily_budget);

    if (!agent_name || normalizedDailyBudget === null || normalizedDailyBudget < 0) {
      return res.status(400).json({ error: "Missing or invalid required fields: agent_name, daily_budget" });
    }

    const apiKey = generateApiKey();
    const createdAgent = await req.userRepository.createAgentForUser({
      userId: req.user.id,
      agentName: agent_name,
      dailyBudget: normalizedDailyBudget,
      apiKey,
      createdAt: now().toISOString()
    });

    res.status(201).json({
      message: "Agent created successfully",
      agent: createdAgent,
      api_key: apiKey
    });
  });

  app.get("/agents", userRateLimit, authenticateUser, async (req, res) => {
    const agents = await req.userRepository.listAgentsForUser(req.user.id);

    res.status(200).json({ agents });
  });

  app.patch("/agents/:agentId", userRateLimit, authenticateUser, async (req, res) => {
    const updates = {};

    if (req.body.agent_name !== undefined) {
      if (!req.body.agent_name) {
        return res.status(400).json({ error: "Invalid agent_name" });
      }

      updates.agent_name = req.body.agent_name;
    }

    if (req.body.daily_budget !== undefined) {
      const normalizedDailyBudget = parseNumber(req.body.daily_budget);

      if (normalizedDailyBudget === null || normalizedDailyBudget < 0) {
        return res.status(400).json({ error: "Invalid daily_budget" });
      }

      updates.daily_budget = normalizedDailyBudget;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    updates.updated_at = now().toISOString();

    const updatedAgent = await req.userRepository.updateAgentForUser({
      userId: req.user.id,
      agentId: req.params.agentId,
      updates
    });

    if (!updatedAgent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.status(200).json({ message: "Agent updated successfully", agent: updatedAgent });
  });

  app.post("/agents/:agentId/rotate-key", userRateLimit, authenticateUser, async (req, res) => {
    const apiKey = generateApiKey();
    const rotatedAgent = await req.userRepository.rotateAgentKeyForUser({
      userId: req.user.id,
      agentId: req.params.agentId,
      apiKey,
      rotatedAt: now().toISOString()
    });

    if (!rotatedAgent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.status(200).json({
      message: "Agent API key rotated successfully",
      agent: rotatedAgent,
      api_key: apiKey,
      billed_amount_usdc: PRICING.premium.security_action_usdc
    });
  });

  app.post("/agents/:agentId/revoke", userRateLimit, authenticateUser, async (req, res) => {
    const revokedAgent = await req.userRepository.revokeAgentForUser({
      userId: req.user.id,
      agentId: req.params.agentId,
      revokedAt: now().toISOString()
    });

    if (!revokedAgent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.status(200).json({
      message: "Agent revoked successfully",
      agent: revokedAgent,
      billed_amount_usdc: PRICING.premium.security_action_usdc
    });
  });

  app.post("/agents/:agentId/kill-switch", userRateLimit, authenticateUser, async (req, res) => {
    const { command } = req.body;

    if (!["CONTINUE", "STOP"].includes(command)) {
      return res.status(400).json({ error: "Invalid command. Expected CONTINUE or STOP." });
    }

    const killSwitch = await req.userRepository.upsertKillSwitchCommandForUser({
      userId: req.user.id,
      agentId: req.params.agentId,
      command,
      updatedAt: now().toISOString()
    });

    if (!killSwitch) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.status(200).json({
      message: "Kill switch updated successfully",
      kill_switch: killSwitch,
      billed_amount_usdc: PRICING.premium.security_action_usdc
    });
  });

  app.get("/dashboard", userRateLimit, authenticateUser, async (req, res) => {
    const dashboardData = await req.userRepository.getDashboardForUser(req.user.id, now());
    const markdown = buildDashboardMarkdown(dashboardData);

    res.type("text/markdown").set("x-agent-guard-price-usdc", String(PRICING.premium.dashboard_generation_usdc)).send(markdown);
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = {
  createApp
};
