import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createApiKeyMaterial } from "../lib/crypto.js";
import type {
  ApiKeyRecord,
  AuditRecord,
  AuditRecordCreate,
  PolicyRecord,
  RepositoryBundle,
  CreateApiKeyInput
} from "./interfaces.js";

function mapPolicyRecord(input: {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  mode: "OBSERVE" | "REVIEW" | "ENFORCE";
  emergencyBypass: boolean;
  blockedCommands: unknown;
  blockedPatterns: unknown;
  requireVerifiedContext: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PolicyRecord {
  return {
    id: input.id,
    tenant_id: input.tenantId,
    name: input.name,
    version: input.version,
    mode: input.mode,
    emergency_bypass: input.emergencyBypass,
    blocked_commands: Array.isArray(input.blockedCommands)
      ? input.blockedCommands.filter((value): value is string => typeof value === "string")
      : [],
    blocked_patterns: Array.isArray(input.blockedPatterns)
      ? input.blockedPatterns.filter((value): value is string => typeof value === "string")
      : [],
    require_verified_context: input.requireVerifiedContext,
    created_at: input.createdAt.toISOString(),
    updated_at: input.updatedAt.toISOString()
  };
}

function mapApiKeyRecord(input: {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: unknown;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiKeyRecord {
  return {
    id: input.id,
    tenant_id: input.tenantId,
    name: input.name,
    key_hash: input.keyHash,
    key_prefix: input.keyPrefix,
    scopes: Array.isArray(input.scopes) ? input.scopes.filter((value): value is string => typeof value === "string") : [],
    revoked_at: input.revokedAt?.toISOString() ?? null,
    created_at: input.createdAt.toISOString(),
    last_used_at: input.lastUsedAt?.toISOString() ?? null
  };
}

function mapAuditRecord(input: {
  id: string;
  tenantId: string;
  policyId: string | null;
  requestId: string;
  decision: "ALLOW" | "BLOCK" | "REVIEW";
  reasonCodes: unknown;
  commandHash: string | null;
  expectedExecutionHash: string | null;
  executionStatus: string | null;
  identityBinding: unknown;
  contextBinding: unknown;
  policyVersion: string | null;
  expiresAt: Date | null;
  contextDeclared: string | null;
  contextObserved: string | null;
  contextVerified: string | null;
  createdAt: Date;
}): AuditRecord {
  return {
    id: input.id,
    tenant_id: input.tenantId,
    policy_id: input.policyId,
    request_id: input.requestId,
    decision: input.decision,
    reason_codes: Array.isArray(input.reasonCodes) ? (input.reasonCodes as AuditRecord["reason_codes"]) : [],
    command_hash: input.commandHash,
    expected_execution_hash: input.expectedExecutionHash,
    execution_status: input.executionStatus,
    identity_binding:
      input.identityBinding && typeof input.identityBinding === "object"
        ? (input.identityBinding as Record<string, string>)
        : null,
    context_binding:
      input.contextBinding && typeof input.contextBinding === "object"
        ? (input.contextBinding as Record<string, string>)
        : null,
    policy_version: input.policyVersion,
    expires_at: input.expiresAt?.toISOString() ?? null,
    context_declared: input.contextDeclared,
    context_observed: input.contextObserved,
    context_verified: input.contextVerified,
    created_at: input.createdAt.toISOString()
  };
}

export function createPrismaRepository(prisma: PrismaClient): RepositoryBundle {
  return {
    async findActiveApiKeyByHash(tenant_id, key_hash) {
      const record = await prisma.apiKey.findFirst({
        where: { tenantId: tenant_id, keyHash: key_hash, revokedAt: null }
      });
      return record ? mapApiKeyRecord(record) : null;
    },
    async updateApiKeyLastUsed(tenant_id, key_id, timestamp) {
      await prisma.apiKey.updateMany({
        where: { id: key_id, tenantId: tenant_id },
        data: { lastUsedAt: new Date(timestamp) }
      });
    },
    async createApiKey(input: CreateApiKeyInput) {
      const key = createApiKeyMaterial();
      const created = await prisma.apiKey.create({
        data: {
          tenantId: input.tenant_id,
          name: input.name,
          keyHash: key.hash,
          keyPrefix: key.prefix,
          scopes: input.scopes
        }
      });
      return { id: created.id, key_prefix: key.prefix, plaintext_key: key.raw };
    },
    async countTenantKeys(tenant_id) {
      return prisma.apiKey.count({ where: { tenantId: tenant_id } });
    },
    async getPolicyById(tenant_id, policy_id) {
      const record = await prisma.policy.findFirst({ where: { id: policy_id, tenantId: tenant_id } });
      return record ? mapPolicyRecord(record) : null;
    },
    async createAuditRecord(entry: AuditRecordCreate) {
      await prisma.auditEvent.create({
        data: {
          tenantId: entry.tenant_id,
          policyId: entry.policy_id,
          requestId: entry.request_id,
          decision: entry.decision,
          reasonCodes: entry.reason_codes,
          commandHash: entry.command_hash,
          expectedExecutionHash: entry.expected_execution_hash,
          executionStatus: entry.execution_status,
          identityBinding: entry.identity_binding ?? Prisma.JsonNull,
          contextBinding: entry.context_binding ?? Prisma.JsonNull,
          policyVersion: entry.policy_version,
          expiresAt: entry.expires_at ? new Date(entry.expires_at) : null,
          contextDeclared: entry.context_declared,
          contextObserved: entry.context_observed,
          contextVerified: entry.context_verified
        }
      });
    },
    async listAuditRecords(tenant_id, limit) {
      const rows = await prisma.auditEvent.findMany({
        where: { tenantId: tenant_id },
        orderBy: { createdAt: "desc" },
        take: limit
      });
      return rows.map(mapAuditRecord);
    }
  };
}
