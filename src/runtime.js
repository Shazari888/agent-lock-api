const { createClient } = require("@supabase/supabase-js");
const { getConfig } = require("./config");
const { createApp } = require("./app");
const { createSupabaseRepository } = require("./repositories/supabaseRepository");

function createRuntimeDependencies() {
  const config = getConfig();

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAnonKey) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const repository = createSupabaseRepository(supabase);
  const authService = {
    async getUserContext(accessToken) {
      const userSupabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      });

      const { data, error } = await userSupabase.auth.getUser(accessToken);

      if (error) {
        if (error.status === 401) {
          return null;
        }

        throw error;
      }

      if (!data.user) {
        return null;
      }

      return {
        user: data.user,
        repository: createSupabaseRepository(userSupabase)
      };
    }
  };

  let cleanupTimer = null;
  const maintenance = {
    start() {
      if (cleanupTimer || process.env.VERCEL === "1") {
        return;
      }

      cleanupTimer = setInterval(async () => {
        try {
          await repository.deleteExpiredMemory(new Date().toISOString());
        } catch (error) {
          console.error("Memory cleanup error:", error);
        }
      }, config.memoryCleanupIntervalMs);
    },
    stop() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    }
  };

  return {
    app: createApp({ repository, authService }),
    config,
    maintenance
  };
}

module.exports = {
  createRuntimeDependencies
};
