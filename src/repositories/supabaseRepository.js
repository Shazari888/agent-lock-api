const { generateApiKey, getApiKeyPrefix, hashApiKey } = require("../lib/agentKeys");

const NO_ROWS_CODE = "PGRST116";
const MISSING_COLUMN_CODE = "42703";

function isNoRowsError(error) {
  return Boolean(error && error.code === NO_ROWS_CODE);
}

function isMissingColumnError(error, columnName) {
  return Boolean(
    error &&
      (error.code === MISSING_COLUMN_CODE ||
        (typeof error.message === "string" && error.message.includes(columnName)))
  );
}

function sanitizeAgentRecord(agent) {
  if (!agent) {
    return null;
  }

  return {
    id: agent.id,
    user_id: agent.user_id,
    agent_name: agent.agent_name,
    daily_budget: Number(agent.daily_budget),
    status: agent.status || "active",
    api_key_prefix: agent.api_key_prefix || null,
    created_at: agent.created_at || null,
    updated_at: agent.updated_at || null,
    last_used_at: agent.last_used_at || null,
    rotated_at: agent.rotated_at || null,
    revoked_at: agent.revoked_at || null
  };
}

function createSupabaseRepository(supabase) {
  async function maybeSelectSingle(query, missingValue) {
    const { data, error } = await query.maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return missingValue;
      }

      throw error;
    }

    return data || missingValue;
  }

  async function findAgentByApiKey(apiKey) {
    const apiKeyHash = hashApiKey(apiKey);
    const enhancedQuery = supabase
      .from("agents")
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .eq("api_key_hash", apiKeyHash)
      .eq("status", "active");

    const { data: enhancedAgent, error: enhancedError } = await enhancedQuery.maybeSingle();

    if (!enhancedError && enhancedAgent) {
      return sanitizeAgentRecord(enhancedAgent);
    }

    if (enhancedError && !isMissingColumnError(enhancedError, "api_key_hash")) {
      if (!isNoRowsError(enhancedError)) {
        throw enhancedError;
      }
    }

    const { data: legacyAgent, error: legacyError } = await supabase
      .from("agents")
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (legacyError) {
      if (isNoRowsError(legacyError)) {
        return null;
      }

      throw legacyError;
    }

    return sanitizeAgentRecord(legacyAgent);
  }

  async function recordAgentLastUsed(agentId, timestamp) {
    const { error } = await supabase
      .from("agents")
      .update({ last_used_at: timestamp })
      .eq("id", agentId);

    if (error && !isMissingColumnError(error, "last_used_at")) {
      throw error;
    }
  }

  async function insertPulseLog({ agentId, task, progress, currentCost }) {
    const { error } = await supabase
      .from("pulse_logs")
      .insert([{ agent_id: agentId, task, progress, current_cost: currentCost }]);

    if (error) {
      throw error;
    }
  }

  async function listPulseLogsSince(agentId, sinceIso) {
    const { data, error } = await supabase
      .from("pulse_logs")
      .select("agent_id, task, progress, current_cost, timestamp")
      .eq("agent_id", agentId)
      .gte("timestamp", sinceIso)
      .order("timestamp", { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  async function getKillSwitchCommand(agentId) {
    const { data, error } = await supabase
      .from("kill_switch")
      .select("command")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return data || null;
  }

  async function saveStateSnapshot(agentId, stateSummary, savedAt) {
    const existingState = await maybeSelectSingle(
      supabase
        .from("state_snapshots")
        .select("id")
        .eq("agent_id", agentId),
      null
    );

    if (existingState) {
      const { error } = await supabase
        .from("state_snapshots")
        .update({ state_summary: stateSummary, saved_at: savedAt })
        .eq("agent_id", agentId);

      if (error) {
        throw error;
      }

      return;
    }

    const { error } = await supabase
      .from("state_snapshots")
      .insert([{ agent_id: agentId, state_summary: stateSummary, saved_at: savedAt }]);

    if (error) {
      throw error;
    }
  }

  async function getStateSnapshot(agentId) {
    const { data, error } = await supabase
      .from("state_snapshots")
      .select("state_summary, saved_at")
      .eq("agent_id", agentId)
      .order("saved_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return data || null;
  }

  async function upsertMemoryItem({ agentId, key, value, ttlHours, payloadBytes, expiresAt, updatedAt }) {
    const existing = await maybeSelectSingle(
      supabase
        .from("memory_items")
        .select("id")
        .eq("agent_id", agentId)
        .eq("memory_key", key),
      null
    );

    if (existing) {
      const { error } = await supabase
        .from("memory_items")
        .update({
          memory_value: value,
          ttl_hours: ttlHours,
          payload_bytes: payloadBytes,
          expires_at: expiresAt,
          updated_at: updatedAt
        })
        .eq("id", existing.id);

      if (error) {
        throw error;
      }

      return;
    }

    const { error } = await supabase
      .from("memory_items")
      .insert([
        {
          agent_id: agentId,
          memory_key: key,
          memory_value: value,
          ttl_hours: ttlHours,
          payload_bytes: payloadBytes,
          expires_at: expiresAt,
          created_at: updatedAt,
          updated_at: updatedAt
        }
      ]);

    if (error) {
      throw error;
    }
  }

  async function getMemoryItem({ agentId, key, nowIso }) {
    const { data, error } = await supabase
      .from("memory_items")
      .select("memory_key, memory_value, ttl_hours, expires_at")
      .eq("agent_id", agentId)
      .eq("memory_key", key)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return data || null;
  }

  async function deleteMemoryItem({ agentId, key }) {
    const existing = await maybeSelectSingle(
      supabase
        .from("memory_items")
        .select("id")
        .eq("agent_id", agentId)
        .eq("memory_key", key),
      null
    );

    if (!existing) {
      return false;
    }

    const { error } = await supabase
      .from("memory_items")
      .delete()
      .eq("id", existing.id);

    if (error) {
      throw error;
    }

    return true;
  }

  async function deleteExpiredMemory(nowIso) {
    const expiredItems = await supabase
      .from("memory_items")
      .select("id")
      .lte("expires_at", nowIso);

    if (expiredItems.error) {
      throw expiredItems.error;
    }

    const ids = (expiredItems.data || []).map((item) => item.id);

    if (!ids.length) {
      return 0;
    }

    const { error } = await supabase
      .from("memory_items")
      .delete()
      .in("id", ids);

    if (error) {
      throw error;
    }

    return ids.length;
  }

  async function createAgentForUser({ userId, agentName, dailyBudget, apiKey, createdAt }) {
    const enhancedPayload = {
      user_id: userId,
      agent_name: agentName,
      daily_budget: dailyBudget,
      api_key: apiKey,
      api_key_hash: hashApiKey(apiKey),
      api_key_prefix: getApiKeyPrefix(apiKey),
      status: "active",
      created_at: createdAt,
      updated_at: createdAt
    };

    const enhancedInsert = await supabase
      .from("agents")
      .insert([enhancedPayload])
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .maybeSingle();

    if (!enhancedInsert.error && enhancedInsert.data) {
      return sanitizeAgentRecord(enhancedInsert.data);
    }

    if (enhancedInsert.error && !isMissingColumnError(enhancedInsert.error, "api_key_hash")) {
      throw enhancedInsert.error;
    }

    const { data, error } = await supabase
      .from("agents")
      .insert([
        {
          user_id: userId,
          agent_name: agentName,
          daily_budget: dailyBudget,
          api_key: apiKey,
          created_at: createdAt,
          updated_at: createdAt
        }
      ])
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .maybeSingle();

    if (error) {
      throw error;
    }

    return sanitizeAgentRecord({
      ...data,
      status: "active",
      api_key_prefix: getApiKeyPrefix(apiKey)
    });
  }

  async function listAgentsForUser(userId) {
    const enhancedQuery = await supabase
      .from("agents")
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!enhancedQuery.error) {
      return (enhancedQuery.data || []).map(sanitizeAgentRecord);
    }

    if (!isMissingColumnError(enhancedQuery.error, "status")) {
      throw enhancedQuery.error;
    }

    const { data, error } = await supabase
      .from("agents")
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []).map((agent) =>
      sanitizeAgentRecord({
        ...agent,
        status: "active",
        api_key_prefix: null
      })
    );
  }

  async function updateAgentForUser({ userId, agentId, updates }) {
    const payload = {
      ...updates,
      updated_at: updates.updated_at
    };

    const enhancedUpdate = await supabase
      .from("agents")
      .update(payload)
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .maybeSingle();

    if (!enhancedUpdate.error) {
      return sanitizeAgentRecord(enhancedUpdate.data);
    }

    if (!isMissingColumnError(enhancedUpdate.error, "status")) {
      if (isNoRowsError(enhancedUpdate.error)) {
        return null;
      }

      throw enhancedUpdate.error;
    }

    const { data, error } = await supabase
      .from("agents")
      .update(payload)
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return sanitizeAgentRecord(data);
  }

  async function rotateAgentKeyForUser({ userId, agentId, apiKey, rotatedAt }) {
    const enhancedPayload = {
      api_key: apiKey,
      api_key_hash: hashApiKey(apiKey),
      api_key_prefix: getApiKeyPrefix(apiKey),
      status: "active",
      revoked_at: null,
      rotated_at: rotatedAt,
      updated_at: rotatedAt
    };

    const enhancedUpdate = await supabase
      .from("agents")
      .update(enhancedPayload)
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .maybeSingle();

    if (!enhancedUpdate.error) {
      return sanitizeAgentRecord(enhancedUpdate.data);
    }

    if (!isMissingColumnError(enhancedUpdate.error, "api_key_hash")) {
      if (isNoRowsError(enhancedUpdate.error)) {
        return null;
      }

      throw enhancedUpdate.error;
    }

    const { data, error } = await supabase
      .from("agents")
      .update({ api_key: apiKey, updated_at: rotatedAt })
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return sanitizeAgentRecord({
      ...data,
      status: "active",
      api_key_prefix: getApiKeyPrefix(apiKey),
      rotated_at: rotatedAt
    });
  }

  async function revokeAgentForUser({ userId, agentId, revokedAt }) {
    const enhancedUpdate = await supabase
      .from("agents")
      .update({ status: "revoked", revoked_at: revokedAt, updated_at: revokedAt, api_key: generateApiKey(), api_key_hash: null, api_key_prefix: null })
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, status, api_key_prefix, created_at, updated_at, last_used_at, rotated_at, revoked_at")
      .maybeSingle();

    if (!enhancedUpdate.error) {
      return sanitizeAgentRecord(enhancedUpdate.data);
    }

    if (!isMissingColumnError(enhancedUpdate.error, "status")) {
      if (isNoRowsError(enhancedUpdate.error)) {
        return null;
      }

      throw enhancedUpdate.error;
    }

    const fallbackApiKey = generateApiKey();
    const { data, error } = await supabase
      .from("agents")
      .update({ api_key: fallbackApiKey, updated_at: revokedAt })
      .eq("id", agentId)
      .eq("user_id", userId)
      .select("id, user_id, agent_name, daily_budget, created_at, updated_at")
      .maybeSingle();

    if (error) {
      if (isNoRowsError(error)) {
        return null;
      }

      throw error;
    }

    return sanitizeAgentRecord({
      ...data,
      status: "revoked",
      revoked_at: revokedAt
    });
  }

  async function upsertKillSwitchCommandForUser({ userId, agentId, command, updatedAt }) {
    const ownedAgent = await maybeSelectSingle(
      supabase
        .from("agents")
        .select("id")
        .eq("id", agentId)
        .eq("user_id", userId),
      null
    );

    if (!ownedAgent) {
      return null;
    }

    const existingKillSwitch = await maybeSelectSingle(
      supabase
        .from("kill_switch")
        .select("id")
        .eq("agent_id", agentId),
      null
    );

    if (existingKillSwitch) {
      const { data, error } = await supabase
        .from("kill_switch")
        .update({ command, updated_at: updatedAt })
        .eq("id", existingKillSwitch.id)
        .select("agent_id, command, updated_at")
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    }

    const { data, error } = await supabase
      .from("kill_switch")
      .insert([{ agent_id: agentId, command, updated_at: updatedAt }])
      .select("agent_id, command, updated_at")
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  async function getDashboardForUser(userId, generatedAt) {
    const agents = await listAgentsForUser(userId);

    if (!agents.length) {
      return {
        generatedAt,
        userId,
        agents: []
      };
    }

    const agentIds = agents.map((agent) => agent.id);
    const startOfDay = new Date(generatedAt);
    startOfDay.setHours(0, 0, 0, 0);

    const [pulseLogResult, stateSnapshotResult, killSwitchResult] = await Promise.all([
      supabase
        .from("pulse_logs")
        .select("agent_id, task, progress, current_cost, timestamp")
        .in("agent_id", agentIds)
        .order("timestamp", { ascending: false }),
      supabase
        .from("state_snapshots")
        .select("agent_id, state_summary, saved_at")
        .in("agent_id", agentIds)
        .order("saved_at", { ascending: false }),
      supabase
        .from("kill_switch")
        .select("agent_id, command, updated_at")
        .in("agent_id", agentIds)
        .order("updated_at", { ascending: false })
    ]);

    if (pulseLogResult.error) {
      throw pulseLogResult.error;
    }

    if (stateSnapshotResult.error) {
      throw stateSnapshotResult.error;
    }

    if (killSwitchResult.error) {
      throw killSwitchResult.error;
    }

    const latestPulseByAgent = new Map();
    const todaySpendByAgent = new Map();

    for (const log of pulseLogResult.data || []) {
      if (!latestPulseByAgent.has(log.agent_id)) {
        latestPulseByAgent.set(log.agent_id, log);
      }

      if (new Date(log.timestamp) >= startOfDay) {
        const priorTotal = todaySpendByAgent.get(log.agent_id) || 0;
        todaySpendByAgent.set(log.agent_id, priorTotal + Number(log.current_cost || 0));
      }
    }

    const latestStateByAgent = new Map();

    for (const state of stateSnapshotResult.data || []) {
      if (!latestStateByAgent.has(state.agent_id)) {
        latestStateByAgent.set(state.agent_id, state);
      }
    }

    const latestKillSwitchByAgent = new Map();

    for (const entry of killSwitchResult.data || []) {
      if (!latestKillSwitchByAgent.has(entry.agent_id)) {
        latestKillSwitchByAgent.set(entry.agent_id, entry);
      }
    }

    return {
      generatedAt,
      userId,
      agents: agents.map((agent) => ({
        ...agent,
        today_spend: todaySpendByAgent.get(agent.id) || 0,
        last_pulse: latestPulseByAgent.get(agent.id) || null,
        state_summary: latestStateByAgent.get(agent.id)?.state_summary || null,
        kill_switch_command: latestKillSwitchByAgent.get(agent.id)?.command || "CONTINUE"
      }))
    };
  }

  return {
    createAgentForUser,
    deleteExpiredMemory,
    deleteMemoryItem,
    findAgentByApiKey,
    getDashboardForUser,
    getKillSwitchCommand,
    getMemoryItem,
    getStateSnapshot,
    insertPulseLog,
    listAgentsForUser,
    listPulseLogsSince,
    recordAgentLastUsed,
    revokeAgentForUser,
    rotateAgentKeyForUser,
    saveStateSnapshot,
    upsertMemoryItem,
    updateAgentForUser,
    upsertKillSwitchCommandForUser
  };
}

module.exports = {
  createSupabaseRepository
};
