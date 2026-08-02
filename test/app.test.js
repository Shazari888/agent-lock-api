const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

function createInMemoryServices() {
  const usersByToken = new Map([["valid-user-token", { id: "user-1", email: "owner@example.com" }]]);
  const agents = new Map();
  const memoryItems = new Map();
  const pulseLogs = [];
  const stateSnapshots = new Map();
  const killSwitches = new Map();

  let agentCounter = 1;

  const repository = {
    async findAgentByApiKey(apiKey) {
      for (const agent of agents.values()) {
        if (agent.api_key === apiKey && agent.status !== "revoked") {
          return { ...agent };
        }
      }

      return null;
    },
    async recordAgentLastUsed(agentId, timestamp) {
      const agent = agents.get(agentId);

      if (agent) {
        agent.last_used_at = timestamp;
        agent.updated_at = timestamp;
      }
    },
    async insertPulseLog({ agentId, task, progress, currentCost }) {
      pulseLogs.push({
        agent_id: agentId,
        task,
        progress,
        current_cost: currentCost,
        timestamp: new Date().toISOString()
      });
    },
    async listPulseLogsSince(agentId, sinceIso) {
      const since = new Date(sinceIso);
      return pulseLogs.filter((log) => log.agent_id === agentId && new Date(log.timestamp) >= since);
    },
    async getKillSwitchCommand(agentId) {
      const command = killSwitches.get(agentId);
      return command ? { command } : null;
    },
    async saveStateSnapshot(agentId, stateSummary, savedAt) {
      stateSnapshots.set(agentId, { state_summary: stateSummary, saved_at: savedAt });
    },
    async getStateSnapshot(agentId) {
      return stateSnapshots.get(agentId) || null;
    },
    async upsertMemoryItem({ agentId, key, value, ttlHours, payloadBytes, expiresAt, updatedAt }) {
      memoryItems.set(`${agentId}:${key}`, {
        agent_id: agentId,
        memory_key: key,
        memory_value: value,
        ttl_hours: ttlHours,
        payload_bytes: payloadBytes,
        expires_at: expiresAt,
        created_at: updatedAt,
        updated_at: updatedAt
      });
    },
    async getMemoryItem({ agentId, key, nowIso }) {
      const item = memoryItems.get(`${agentId}:${key}`) || null;
      if (!item) {
        return null;
      }

      if (new Date(item.expires_at) <= new Date(nowIso)) {
        return null;
      }

      return item;
    },
    async deleteMemoryItem({ agentId, key }) {
      return memoryItems.delete(`${agentId}:${key}`);
    },
    async deleteExpiredMemory(nowIso) {
      let deleted = 0;
      for (const [storeKey, value] of memoryItems.entries()) {
        if (new Date(value.expires_at) <= new Date(nowIso)) {
          memoryItems.delete(storeKey);
          deleted += 1;
        }
      }
      return deleted;
    },
    async createAgentForUser({ userId, agentName, dailyBudget, apiKey, createdAt }) {
      const agent = {
        id: `agent-${agentCounter++}`,
        user_id: userId,
        agent_name: agentName,
        daily_budget: dailyBudget,
        api_key: apiKey,
        api_key_prefix: apiKey.slice(0, 14),
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
        last_used_at: null,
        rotated_at: null,
        revoked_at: null
      };

      agents.set(agent.id, agent);

      return { ...agent, api_key: undefined };
    },
    async listAgentsForUser(userId) {
      return Array.from(agents.values())
        .filter((agent) => agent.user_id === userId)
        .map((agent) => ({
          ...agent,
          api_key: undefined
        }));
    },
    async updateAgentForUser({ userId, agentId, updates }) {
      const agent = agents.get(agentId);

      if (!agent || agent.user_id !== userId) {
        return null;
      }

      Object.assign(agent, updates);
      return { ...agent, api_key: undefined };
    },
    async rotateAgentKeyForUser({ userId, agentId, apiKey, rotatedAt }) {
      const agent = agents.get(agentId);

      if (!agent || agent.user_id !== userId) {
        return null;
      }

      agent.api_key = apiKey;
      agent.api_key_prefix = apiKey.slice(0, 14);
      agent.status = "active";
      agent.rotated_at = rotatedAt;
      agent.revoked_at = null;
      agent.updated_at = rotatedAt;

      return { ...agent, api_key: undefined };
    },
    async revokeAgentForUser({ userId, agentId, revokedAt }) {
      const agent = agents.get(agentId);

      if (!agent || agent.user_id !== userId) {
        return null;
      }

      agent.status = "revoked";
      agent.revoked_at = revokedAt;
      agent.updated_at = revokedAt;

      return { ...agent, api_key: undefined };
    },
    async upsertKillSwitchCommandForUser({ userId, agentId, command }) {
      const agent = agents.get(agentId);

      if (!agent || agent.user_id !== userId) {
        return null;
      }

      killSwitches.set(agentId, command);
      return { agent_id: agentId, command };
    },
    async getDashboardForUser(userId, generatedAt) {
      const userAgents = Array.from(agents.values()).filter((agent) => agent.user_id === userId);

      return {
        generatedAt,
        userId,
        agents: userAgents.map((agent) => {
          const agentPulseLogs = pulseLogs
            .filter((log) => log.agent_id === agent.id)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          const todaySpend = agentPulseLogs.reduce((sum, log) => sum + log.current_cost, 0);

          return {
            ...agent,
            today_spend: todaySpend,
            last_pulse: agentPulseLogs[0] || null,
            state_summary: stateSnapshots.get(agent.id)?.state_summary || null,
            kill_switch_command: killSwitches.get(agent.id) || "CONTINUE"
          };
        })
      };
    }
  };

  const authService = {
    async getUserContext(accessToken) {
      const user = usersByToken.get(accessToken) || null;

      if (!user) {
        return null;
      }

      return {
        user,
        repository
      };
    }
  };

  return { repository, authService };
}

async function startTestServer(options = {}) {
  const services = createInMemoryServices();
  const app = createApp({
    ...services,
    ...options
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    services
  };
}

test("core agent and management flows work together", async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const rootResponse = await fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 200);
    assert.equal(await rootResponse.text(), "Agent Guard API is running!");

    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      status: "ok",
      message: "Agent Guard API is healthy"
    });

    test("user routes accept lowercase bearer scheme and enforce rate limits", async () => {
      const { baseUrl, close } = await startTestServer({
        security: {
          rateLimitWindowMs: 60 * 1000,
          userRouteRateLimitMax: 2,
          agentRouteRateLimitMax: 100
        }
      });

      try {
        const firstResponse = await fetch(`${baseUrl}/agents`, {
          headers: {
            authorization: "bearer valid-user-token"
          }
        });
        assert.equal(firstResponse.status, 200);

        const secondResponse = await fetch(`${baseUrl}/agents`, {
          headers: {
            authorization: "bearer valid-user-token"
          }
        });
        assert.equal(secondResponse.status, 200);

        const thirdResponse = await fetch(`${baseUrl}/agents`, {
          headers: {
            authorization: "bearer valid-user-token"
          }
        });
        assert.equal(thirdResponse.status, 429);
        assert.deepEqual(await thirdResponse.json(), {
          error: "Rate limit exceeded for user routes"
        });
      } finally {
        await close();
      }
    });

    test("visualizer ui assets load with expected controls", async () => {
      const { baseUrl, close } = await startTestServer();

      try {
        const uiResponse = await fetch(`${baseUrl}/ui`);
        assert.equal(uiResponse.status, 200);
        const html = await uiResponse.text();
        assert.match(html, /Visual Dashboard & Editor/);
        assert.match(html, /id="applyKillSwitch"/);
        assert.match(html, /<option>DELETE<\/option>/);

        const appJsResponse = await fetch(`${baseUrl}/ui/app.js`);
        assert.equal(appJsResponse.status, 200);
        const appJs = await appJsResponse.text();
        assert.match(appJs, /applyKillSwitch/);
        assert.match(appJs, /updateKillSwitch\(getValue\("killSwitchCommand"\)\)/);

        const stylesResponse = await fetch(`${baseUrl}/ui/styles.css`);
        assert.equal(stylesResponse.status, 200);
      } finally {
        await close();
      }
    });

    const pricingResponse = await fetch(`${baseUrl}/pricing`);
    assert.equal(pricingResponse.status, 200);
    const pricingPayload = await pricingResponse.json();
    assert.equal(pricingPayload.model, "premium");
    assert.equal(pricingPayload.pricing.base.read_usdc, 0.008);

    const uiResponse = await fetch(`${baseUrl}/ui`);
    assert.equal(uiResponse.status, 200);
    assert.match(await uiResponse.text(), /Visual Dashboard & Editor/);

    const unauthenticatedAgentResponse = await fetch(`${baseUrl}/test-auth`);
    assert.equal(unauthenticatedAgentResponse.status, 401);

    const createAgentResponse = await fetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-user-token"
      },
      body: JSON.stringify({
        agent_name: "Scout",
        daily_budget: 1.25
      })
    });

    assert.equal(createAgentResponse.status, 201);
    const createdAgentPayload = await createAgentResponse.json();
    assert.equal(createdAgentPayload.agent.agent_name, "Scout");
    assert.ok(createdAgentPayload.api_key.startsWith("ag_"));

    const agentId = createdAgentPayload.agent.id;
    const firstApiKey = createdAgentPayload.api_key;

    const listAgentsResponse = await fetch(`${baseUrl}/agents`, {
      headers: {
        authorization: "Bearer valid-user-token"
      }
    });

    const listAgentsPayload = await listAgentsResponse.json();
    assert.equal(listAgentsPayload.agents.length, 1);

    const pulseResponse = await fetch(`${baseUrl}/pulse`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        task: "Analyzing market data",
        progress: 50,
        current_cost: 0.4
      })
    });

    assert.equal(pulseResponse.status, 200);

    const memorySetResponse = await fetch(`${baseUrl}/memory/set`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        key: "checkpoint",
        value: { cursor: 42 },
        ttl_hours: 24
      })
    });
    assert.equal(memorySetResponse.status, 200);
    const memorySetPayload = await memorySetResponse.json();
    assert.equal(memorySetPayload.billed_amount_usdc, 0.009);

    const memoryGetResponse = await fetch(`${baseUrl}/memory/get/checkpoint`, {
      headers: {
        "x-api-key": firstApiKey
      }
    });
    assert.equal(memoryGetResponse.status, 200);
    const memoryGetPayload = await memoryGetResponse.json();
    assert.equal(memoryGetPayload.value.cursor, 42);
    assert.equal(memoryGetPayload.billed_amount_usdc, 0.008);

    const memoryLargePayload = "x".repeat(102401);
    const memoryTooLargeResponse = await fetch(`${baseUrl}/memory/set`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        key: "too-large",
        value: memoryLargePayload
      })
    });
    assert.equal(memoryTooLargeResponse.status, 413);

    const memoryDeleteResponse = await fetch(`${baseUrl}/memory/delete/checkpoint`, {
      method: "DELETE",
      headers: {
        "x-api-key": firstApiKey
      }
    });
    assert.equal(memoryDeleteResponse.status, 200);
    const memoryDeletePayload = await memoryDeleteResponse.json();
    assert.equal(memoryDeletePayload.billed_amount_usdc, 0.005);

    const continueBudgetResponse = await fetch(`${baseUrl}/check-budget`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        estimated_cost_of_next_action: 0.5
      })
    });

    const continueBudgetPayload = await continueBudgetResponse.json();
    assert.equal(continueBudgetPayload.status, "CONTINUE");

    const stopBudgetResponse = await fetch(`${baseUrl}/check-budget`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        estimated_cost_of_next_action: 1
      })
    });

    const stopBudgetPayload = await stopBudgetResponse.json();
    assert.equal(stopBudgetPayload.status, "STOP");

    const saveStateResponse = await fetch(`${baseUrl}/save-state`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": firstApiKey
      },
      body: JSON.stringify({
        state_summary: "Last successful step: processed 100 records"
      })
    });

    assert.equal(saveStateResponse.status, 200);

    const loadStateResponse = await fetch(`${baseUrl}/load-state`, {
      headers: {
        "x-api-key": firstApiKey
      }
    });

    assert.equal(loadStateResponse.status, 200);
    assert.deepEqual(await loadStateResponse.json(), {
      state_summary: "Last successful step: processed 100 records"
    });

    const defaultKillSwitchResponse = await fetch(`${baseUrl}/kill-switch`, {
      headers: {
        "x-api-key": firstApiKey
      }
    });

    assert.deepEqual(await defaultKillSwitchResponse.json(), { command: "CONTINUE" });

    const updateKillSwitchResponse = await fetch(`${baseUrl}/agents/${agentId}/kill-switch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-user-token"
      },
      body: JSON.stringify({
        command: "STOP"
      })
    });

    assert.equal(updateKillSwitchResponse.status, 200);

    const stopKillSwitchResponse = await fetch(`${baseUrl}/kill-switch`, {
      headers: {
        "x-api-key": firstApiKey
      }
    });

    assert.deepEqual(await stopKillSwitchResponse.json(), { command: "STOP" });

    const dashboardResponse = await fetch(`${baseUrl}/dashboard`, {
      headers: {
        authorization: "Bearer valid-user-token"
      }
    });

    const dashboardMarkdown = await dashboardResponse.text();
    assert.equal(dashboardResponse.status, 200);
    assert.match(dashboardMarkdown, /# Agent Guard Dashboard/);
    assert.match(dashboardMarkdown, /Scout/);
    assert.match(dashboardMarkdown, /Analyzing market data/);

    const rotateKeyResponse = await fetch(`${baseUrl}/agents/${agentId}/rotate-key`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-user-token"
      }
    });

    assert.equal(rotateKeyResponse.status, 200);
    const rotateKeyPayload = await rotateKeyResponse.json();
    const secondApiKey = rotateKeyPayload.api_key;

    const oldKeyResponse = await fetch(`${baseUrl}/test-auth`, {
      headers: {
        "x-api-key": firstApiKey
      }
    });

    assert.equal(oldKeyResponse.status, 401);

    const newKeyResponse = await fetch(`${baseUrl}/test-auth`, {
      headers: {
        "x-api-key": secondApiKey
      }
    });

    assert.equal(newKeyResponse.status, 200);

    const revokeResponse = await fetch(`${baseUrl}/agents/${agentId}/revoke`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-user-token"
      }
    });

    assert.equal(revokeResponse.status, 200);

    const revokedKeyResponse = await fetch(`${baseUrl}/test-auth`, {
      headers: {
        "x-api-key": secondApiKey
      }
    });

    assert.equal(revokedKeyResponse.status, 401);
  } finally {
    await close();
  }
});
