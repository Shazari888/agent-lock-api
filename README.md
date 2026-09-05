# AgentLock API (v1)

AgentLock is a deterministic command policy decision API. It never executes commands and returns only `ALLOW`, `BLOCK`, or `REVIEW`.

## Product boundary

1. Deterministic policy decisions only.
2. No command execution.
3. Fail closed on malformed input, auth failure, parser uncertainty, and internal failures.
4. v1 excludes LLM-authoritative allow paths.

## Stack

- TypeScript (strict)
- Fastify
- Prisma + PostgreSQL
- Zod env parsing
- OpenAPI scaffold at `docs/openapi.yaml` and `/docs`
- Structured logging with header redaction
- Vitest unit/integration/security tests

## Quick start

1. Copy `.env.example` to `.env.local`.
2. Install dependencies:
   - `npm install`
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Apply database migrations:
   - `npx prisma migrate deploy`
5. Start dev server:
   - `npm run dev`
6. Seed a first tenant and policy:
   - `npm run seed`

## Endpoints (v1)

- `GET /health`
- `POST /v1/validate`
- `POST /v1/validate/batch`
- `GET /v1/policies/:policyId`
- `GET /v1/audit`
- `POST /v1/keys`

All `/v1/*` endpoints are tenant-scoped via:

- `x-tenant-id`
- `x-api-key` (except bootstrap key creation flow)

## First-run API flow

1. Create first API key for a tenant with bootstrap token:

```bash
curl -sS -X POST http://localhost:3000/v1/keys \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: replace-with-long-random-bootstrap-token" \
  -d '{
    "tenant_id": "tenant_demo",
    "name": "default-client",
    "scopes": ["validate:write", "audit:read", "policies:read", "keys:write"]
  }'
```

2. Validate one command:

```bash
curl -sS -X POST http://localhost:3000/v1/validate \
  -H "content-type: application/json" \
  -H "x-tenant-id: tenant_demo" \
  -H "x-api-key: <returned_api_key>" \
  -d '{
    "policy_id": "policy_default",
    "command": "echo hello",
    "shell": "bash",
    "context_trust": {
      "declared": "trusted",
      "observed": "trusted",
      "verified": "trusted"
    },
    "integrity": {}
  }'
```

## Enforcement modes

- `OBSERVE`: policy violations downgrade to `REVIEW` (except fail-closed reasons).
- `REVIEW`: decisions require human review (except fail-closed reasons remain `BLOCK`).
- `ENFORCE`: strict policy result.

Emergency bypass only downgrades policy-rule blocks to `REVIEW`; fail-closed conditions still `BLOCK`.

## Security controls

- Rate limiting
- Request timeout
- Stable error shape with request ID
- Tenant isolation on repository interfaces
- API key hashing + revocation
- Redacted auth headers in logs
