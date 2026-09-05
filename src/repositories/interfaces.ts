import type { Decision, EnforcementMode, ReasonCode } from "../types.js";

export type PolicyRecord = {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  mode: EnforcementMode;
  emergency_bypass: boolean;
  blocked_commands: string[];
  blocked_patterns: string[];
  require_verified_context: boolean;
  created_at: string;
  updated_at: string;
};

export type ApiKeyRecord = {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type AuditRecordCreate = {
  tenant_id: string;
  policy_id: string | null;
  request_id: string;
  decision: Decision;
  reason_codes: ReasonCode[];
  command_hash: string | null;
  expected_execution_hash: string | null;
  execution_status: string | null;
  identity_binding: Record<string, string> | null;
  context_binding: Record<string, string> | null;
  policy_version: string | null;
  expires_at: string | null;
  context_declared: string | null;
  context_observed: string | null;
  context_verified: string | null;
};

export type AuditRecord = AuditRecordCreate & {
  id: string;
  created_at: string;
};

export type CreateApiKeyInput = {
  tenant_id: string;
  name: string;
  scopes: string[];
};

export type AuthRepository = {
  findActiveApiKeyByHash(tenant_id: string, key_hash: string): Promise<ApiKeyRecord | null>;
  updateApiKeyLastUsed(tenant_id: string, key_id: string, timestamp: string): Promise<void>;
  createApiKey(input: CreateApiKeyInput): Promise<{ id: string; key_prefix: string; plaintext_key: string }>;
  countTenantKeys(tenant_id: string): Promise<number>;
};

export type PolicyRepository = {
  getPolicyById(tenant_id: string, policy_id: string): Promise<PolicyRecord | null>;
};

export type AuditRepository = {
  createAuditRecord(entry: AuditRecordCreate): Promise<void>;
  listAuditRecords(tenant_id: string, limit: number): Promise<AuditRecord[]>;
};

export type RepositoryBundle = AuthRepository & PolicyRepository & AuditRepository;

