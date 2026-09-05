import type { FastifyReply, FastifyRequest } from "fastify";
import { sha256 } from "../lib/crypto.js";
import type { RepositoryBundle } from "../repositories/interfaces.js";

export type AuthContext = {
  tenant_id: string;
  key_id: string;
  scopes: string[];
};

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  repositories: RepositoryBundle,
  options?: { suppressFailure?: boolean }
): Promise<AuthContext | null> {
  const tenantId = request.headers["x-tenant-id"];
  const apiKey = request.headers["x-api-key"];

  if (typeof tenantId !== "string" || !tenantId || typeof apiKey !== "string" || !apiKey) {
    if (options?.suppressFailure) {
      return null;
    }
    void reply.code(401).send({
      request_id: request.id,
      decision: "BLOCK",
      reason_codes: ["AUTH_FAILED"],
      error: {
        code: "AUTH_FAILED",
        message: "Missing x-tenant-id or x-api-key header"
      }
    });
    return null;
  }

  const keyHash = sha256(apiKey);
  const keyRecord = await repositories.findActiveApiKeyByHash(tenantId, keyHash);

  if (!keyRecord) {
    if (options?.suppressFailure) {
      return null;
    }
    void reply.code(401).send({
      request_id: request.id,
      decision: "BLOCK",
      reason_codes: ["AUTH_FAILED"],
      error: {
        code: "AUTH_FAILED",
        message: "Invalid API key for tenant"
      }
    });
    return null;
  }

  await repositories.updateApiKeyLastUsed(tenantId, keyRecord.id, new Date().toISOString());

  return {
    tenant_id: tenantId,
    key_id: keyRecord.id,
    scopes: keyRecord.scopes
  };
}

export function assertScope(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthContext,
  requiredScope: string
): boolean {
  if (auth.scopes.includes(requiredScope)) {
    return true;
  }
  void reply.code(403).send({
    request_id: request.id,
    decision: "BLOCK",
    reason_codes: ["AUTH_FAILED"],
    error: {
      code: "FORBIDDEN_SCOPE",
      message: `Missing required scope: ${requiredScope}`
    }
  });
  return false;
}
