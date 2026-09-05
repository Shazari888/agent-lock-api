import { createApp } from "../../src/app.js";
import { sha256 } from "../../src/lib/crypto.js";
import { createInMemoryRepository } from "../../src/repositories/inMemoryRepositories.js";
import type { PolicyRecord } from "../../src/repositories/interfaces.js";

export const TEST_API_KEY = "alk_test_valid_key_1234567890";
export const TEST_TENANT = "tenant_test";
export const TEST_POLICY_ID = "policy_test_1";
export const TEST_BOOTSTRAP_TOKEN = "bootstrap_token_test_1234567890";

type TestAppOptions = {
  policy?: PolicyRecord;
  includeApiKey?: boolean;
};

export function createSeedPolicy(mode: "OBSERVE" | "REVIEW" | "ENFORCE" = "ENFORCE"): PolicyRecord {
  return {
    id: TEST_POLICY_ID,
    tenant_id: TEST_TENANT,
    name: "Default v1 policy",
    version: "v1",
    mode,
    emergency_bypass: false,
    blocked_commands: ["rm"],
    blocked_patterns: ["curl | sh", "wget | bash"],
    require_verified_context: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function createTestApp(options: TestAppOptions = {}) {
  const policy = options.policy ?? createSeedPolicy();
  const includeApiKey = options.includeApiKey ?? true;
  const repositories = createInMemoryRepository({
    keys: includeApiKey
      ? [
          {
            id: "key_1",
            tenant_id: TEST_TENANT,
            name: "test",
            key_hash: sha256(TEST_API_KEY),
            key_prefix: TEST_API_KEY.slice(0, 12),
            scopes: ["validate:write", "audit:read", "policies:read", "keys:write"],
            revoked_at: null,
            created_at: new Date().toISOString(),
            last_used_at: null
          }
        ]
      : [],
    policies: [policy]
  });

  const env = {
    NODE_ENV: "test",
    PORT: 3000,
    DATABASE_URL: "postgresql://unused",
    LOG_LEVEL: "silent",
    RATE_LIMIT_MAX: 500,
    RATE_LIMIT_WINDOW_MS: 60000,
    REQUEST_TIMEOUT_MS: 5000,
    BOOTSTRAP_TOKEN: TEST_BOOTSTRAP_TOKEN
  } as const;

  return createApp(env, repositories);
}

