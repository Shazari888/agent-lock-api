import { createApiKeyMaterial } from "../lib/crypto.js";
import type {
  ApiKeyRecord,
  AuditRecord,
  AuditRecordCreate,
  CreateApiKeyInput,
  PolicyRecord,
  RepositoryBundle
} from "./interfaces.js";

type InMemoryState = {
  tenants: { id: string; name: string }[];
  keys: ApiKeyRecord[];
  policies: PolicyRecord[];
  audits: AuditRecord[];
};

export function createInMemoryRepository(seed?: Partial<InMemoryState>): RepositoryBundle {
  const state: InMemoryState = {
    tenants: seed?.tenants ?? [],
    keys: seed?.keys ?? [],
    policies: seed?.policies ?? [],
    audits: seed?.audits ?? []
  };

  return {
    async findActiveApiKeyByHash(tenant_id, key_hash) {
      return state.keys.find((key) => key.tenant_id === tenant_id && key.key_hash === key_hash && key.revoked_at === null) ?? null;
    },
    async updateApiKeyLastUsed(tenant_id, key_id, timestamp) {
      const record = state.keys.find((key) => key.tenant_id === tenant_id && key.id === key_id);
      if (record) {
        record.last_used_at = timestamp;
      }
    },
    async createApiKey(input: CreateApiKeyInput) {
      const material = createApiKeyMaterial();
      const id = `key_${state.keys.length + 1}`;
      state.keys.push({
        id,
        tenant_id: input.tenant_id,
        name: input.name,
        key_hash: material.hash,
        key_prefix: material.prefix,
        scopes: input.scopes,
        revoked_at: null,
        created_at: new Date().toISOString(),
        last_used_at: null
      });
      return { id, key_prefix: material.prefix, plaintext_key: material.raw };
    },
    async countTenantKeys(tenant_id) {
      return state.keys.filter((key) => key.tenant_id === tenant_id).length;
    },
    async ensureTenant(tenant_id, tenant_name) {
      const existing = state.tenants.find((tenant) => tenant.id === tenant_id);
      if (existing) {
        existing.name = tenant_name;
        return;
      }
      state.tenants.push({ id: tenant_id, name: tenant_name });
    },
    async getPolicyById(tenant_id, policy_id) {
      return state.policies.find((policy) => policy.tenant_id === tenant_id && policy.id === policy_id) ?? null;
    },
    async createAuditRecord(entry: AuditRecordCreate) {
      state.audits.push({
        id: `audit_${state.audits.length + 1}`,
        ...entry,
        created_at: new Date().toISOString()
      });
    },
    async listAuditRecords(tenant_id, limit) {
      return state.audits.filter((audit) => audit.tenant_id === tenant_id).slice(0, limit);
    }
  };
}
