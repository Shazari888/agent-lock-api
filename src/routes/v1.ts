import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { authenticateRequest, assertScope } from "../plugins/auth.js";
import { evaluatePolicy, failClosed } from "../domain/policyEngine.js";
import type { ContextTrustModel, IntegrityFields, ValidateInput } from "../types.js";

const trustEnum = z.enum(["unknown", "untrusted", "trusted"]);

const validateBodySchema = z.object({
  policy_id: z.string().min(1),
  command: z.string().min(1).max(4096),
  shell: z.enum(["bash", "zsh"]),
  context_trust: z.object({
    declared: trustEnum,
    observed: trustEnum,
    verified: trustEnum
  }),
  integrity: z.object({
    command_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expected_execution_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    identity_binding: z.record(z.string()).optional(),
    context_binding: z.record(z.string()).optional(),
    policy_version: z.string().min(1).optional(),
    expires_at: z.string().datetime().optional(),
    execution_status: z.enum(["pending", "executed", "rejected", "unknown"]).optional()
  })
});

const batchBodySchema = z.object({
  items: z.array(validateBodySchema).min(1).max(50)
});

const createKeySchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1).max(128),
  scopes: z.array(z.string().min(1)).min(1).max(12)
});

const queryAuditSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50)
});

function toValidateInput(input: z.infer<typeof validateBodySchema>): ValidateInput {
  return {
    policy_id: input.policy_id,
    command: input.command,
    shell: input.shell,
    context_trust: input.context_trust as ContextTrustModel,
    integrity: input.integrity as IntegrityFields
  };
}

export async function registerV1Routes(app: FastifyInstance) {
  app.post("/v1/validate", async (request, reply) => {
    const auth = await authenticateRequest(request, reply, app.repositories);
    if (!auth) {
      return;
    }
    if (!assertScope(request, reply, auth, "validate:write")) {
      return;
    }

    const parse = validateBodySchema.safeParse(request.body);
    if (!parse.success) {
      const failure = failClosed("MALFORMED_INPUT");
      await app.repositories.createAuditRecord({
        tenant_id: auth.tenant_id,
        policy_id: null,
        request_id: request.id,
        decision: failure.decision,
        reason_codes: failure.reason_codes,
        command_hash: null,
        expected_execution_hash: null,
        execution_status: null,
        identity_binding: null,
        context_binding: null,
        policy_version: null,
        expires_at: null,
        context_declared: null,
        context_observed: null,
        context_verified: null
      });
      return reply.code(400).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["MALFORMED_INPUT"],
        error: {
          code: "MALFORMED_INPUT",
          message: "Request body failed validation",
          details: parse.error.issues
        }
      });
    }

    const payload = toValidateInput(parse.data);
    const policy = await app.repositories.getPolicyById(auth.tenant_id, payload.policy_id);
    if (!policy) {
      const failure = failClosed("POLICY_NOT_FOUND");
      await app.repositories.createAuditRecord({
        tenant_id: auth.tenant_id,
        policy_id: payload.policy_id,
        request_id: request.id,
        decision: failure.decision,
        reason_codes: failure.reason_codes,
        command_hash: payload.integrity.command_hash ?? null,
        expected_execution_hash: payload.integrity.expected_execution_hash ?? null,
        execution_status: payload.integrity.execution_status ?? null,
        identity_binding: payload.integrity.identity_binding ?? null,
        context_binding: payload.integrity.context_binding ?? null,
        policy_version: payload.integrity.policy_version ?? null,
        expires_at: payload.integrity.expires_at ?? null,
        context_declared: payload.context_trust.declared,
        context_observed: payload.context_trust.observed,
        context_verified: payload.context_trust.verified
      });
      return reply.code(404).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["POLICY_NOT_FOUND"],
        error: {
          code: "POLICY_NOT_FOUND",
          message: "Policy does not exist for tenant"
        }
      });
    }

    const result = evaluatePolicy(payload, policy);
    await app.repositories.createAuditRecord({
      tenant_id: auth.tenant_id,
      policy_id: policy.id,
      request_id: request.id,
      decision: result.decision,
      reason_codes: result.reason_codes,
      command_hash: payload.integrity.command_hash ?? null,
      expected_execution_hash: payload.integrity.expected_execution_hash ?? null,
      execution_status: payload.integrity.execution_status ?? null,
      identity_binding: payload.integrity.identity_binding ?? null,
      context_binding: payload.integrity.context_binding ?? null,
      policy_version: payload.integrity.policy_version ?? policy.version,
      expires_at: payload.integrity.expires_at ?? null,
      context_declared: payload.context_trust.declared,
      context_observed: payload.context_trust.observed,
      context_verified: payload.context_trust.verified
    });

    return reply.code(200).send({
      request_id: request.id,
      decision: result.decision,
      reason_codes: result.reason_codes,
      normalized_command: result.normalized_command,
      tokens: result.tokens
    });
  });

  app.post("/v1/validate/batch", async (request, reply) => {
    const auth = await authenticateRequest(request, reply, app.repositories);
    if (!auth) {
      return;
    }
    if (!assertScope(request, reply, auth, "validate:write")) {
      return;
    }

    const parse = batchBodySchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["MALFORMED_INPUT"],
        error: {
          code: "MALFORMED_INPUT",
          message: "Request body failed validation",
          details: parse.error.issues
        }
      });
    }

    const results = [];
    for (const [index, item] of parse.data.items.entries()) {
      const payload = toValidateInput(item);
      const policy = await app.repositories.getPolicyById(auth.tenant_id, payload.policy_id);
      const result = policy ? evaluatePolicy(payload, policy) : failClosed("POLICY_NOT_FOUND");
      await app.repositories.createAuditRecord({
        tenant_id: auth.tenant_id,
        policy_id: policy?.id ?? payload.policy_id,
        request_id: `${request.id}:${index}`,
        decision: result.decision,
        reason_codes: result.reason_codes,
        command_hash: payload.integrity.command_hash ?? null,
        expected_execution_hash: payload.integrity.expected_execution_hash ?? null,
        execution_status: payload.integrity.execution_status ?? null,
        identity_binding: payload.integrity.identity_binding ?? null,
        context_binding: payload.integrity.context_binding ?? null,
        policy_version: payload.integrity.policy_version ?? policy?.version ?? null,
        expires_at: payload.integrity.expires_at ?? null,
        context_declared: payload.context_trust.declared,
        context_observed: payload.context_trust.observed,
        context_verified: payload.context_trust.verified
      });
      results.push({
        index,
        decision: result.decision,
        reason_codes: result.reason_codes,
        normalized_command: result.normalized_command,
        tokens: result.tokens
      });
    }

    return reply.code(200).send({
      request_id: request.id,
      summary: {
        allow: results.filter((entry) => entry.decision === "ALLOW").length,
        block: results.filter((entry) => entry.decision === "BLOCK").length,
        review: results.filter((entry) => entry.decision === "REVIEW").length
      },
      results
    });
  });

  app.get("/v1/policies/:policyId", async (request, reply) => {
    const auth = await authenticateRequest(request, reply, app.repositories);
    if (!auth) {
      return;
    }
    if (!assertScope(request, reply, auth, "policies:read")) {
      return;
    }

    const params = z.object({ policyId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["MALFORMED_INPUT"],
        error: { code: "MALFORMED_INPUT", message: "Invalid policyId parameter" }
      });
    }

    const policy = await app.repositories.getPolicyById(auth.tenant_id, params.data.policyId);
    if (!policy) {
      return reply.code(404).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["POLICY_NOT_FOUND"],
        error: { code: "POLICY_NOT_FOUND", message: "Policy not found for tenant" }
      });
    }

    return reply.code(200).send(policy);
  });

  app.get("/v1/audit", async (request, reply) => {
    const auth = await authenticateRequest(request, reply, app.repositories);
    if (!auth) {
      return;
    }
    if (!assertScope(request, reply, auth, "audit:read")) {
      return;
    }

    const query = queryAuditSchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["MALFORMED_INPUT"],
        error: { code: "MALFORMED_INPUT", message: "Invalid query values" }
      });
    }

    const rows = await app.repositories.listAuditRecords(auth.tenant_id, query.data.limit);
    return reply.code(200).send({
      request_id: request.id,
      rows
    });
  });

  app.post("/v1/keys", async (request, reply) => {
    const parse = createKeySchema.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({
        request_id: request.id,
        decision: "BLOCK",
        reason_codes: ["MALFORMED_INPUT"],
        error: { code: "MALFORMED_INPUT", message: "Invalid key creation payload", details: parse.error.issues }
      });
    }

    const payload = parse.data;
    const auth = await authenticateRequest(request, reply, app.repositories, { suppressFailure: true });
    if (auth) {
      if (!assertScope(request, reply, auth, "keys:write")) {
        return;
      }
      if (auth.tenant_id !== payload.tenant_id) {
        return reply.code(403).send({
          request_id: request.id,
          decision: "BLOCK",
          reason_codes: ["AUTH_FAILED"],
          error: { code: "FORBIDDEN_SCOPE", message: "Cannot create keys for another tenant" }
        });
      }
    } else {
      const bootstrap = request.headers["x-bootstrap-token"];
      const hasNoKeys = (await app.repositories.countTenantKeys(payload.tenant_id)) === 0;
      if (typeof bootstrap !== "string" || bootstrap !== app.env.BOOTSTRAP_TOKEN || !hasNoKeys) {
        return reply.code(401).send({
          request_id: request.id,
          decision: "BLOCK",
          reason_codes: ["AUTH_FAILED"],
          error: {
            code: "AUTH_FAILED",
            message: "Key creation requires keys:write scope or valid bootstrap token for empty tenant"
          }
        });
      }
      await app.repositories.ensureTenant(payload.tenant_id, `Tenant ${payload.tenant_id}`);
    }

    const created = await app.repositories.createApiKey(payload);
    return reply.code(201).send({
      request_id: request.id,
      key_id: created.id,
      key_prefix: created.key_prefix,
      api_key: created.plaintext_key
    });
  });
}
