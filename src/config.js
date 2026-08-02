const path = require("path");
const dotenv = require("dotenv");

let hasLoadedEnvironment = false;

function loadEnvironment() {
  if (hasLoadedEnvironment) {
    return;
  }

  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
  dotenv.config();

  hasLoadedEnvironment = true;
}

function getConfig() {
  loadEnvironment();

  return {
    agentRouteRateLimitMax: Number(process.env.AGENT_ROUTE_RATE_LIMIT_MAX) || 60,
    memoryCleanupIntervalMs: Number(process.env.MEMORY_CLEANUP_INTERVAL_MS) || 5 * 60 * 1000,
    port: Number(process.env.PORT) || 3000,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    userRouteRateLimitMax: Number(process.env.USER_ROUTE_RATE_LIMIT_MAX) || 30,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

module.exports = {
  getConfig,
  loadEnvironment
};
