# Threat Model (v1)

## Assets

- policy definitions
- API keys (hashed at rest)
- tenant audit history
- command and execution integrity bindings

## Trust boundaries

1. Caller to API boundary over HTTPS.
2. API process to PostgreSQL boundary.
3. Tenant boundaries in all repository reads/writes.

## Primary threats and controls

1. Cross-tenant data access  
   - Control: mandatory `tenant_id` scoping in repository interfaces.
2. Stolen API keys  
   - Control: key hashing, scope checks, revocation support, last-used tracking.
3. Parser ambiguity exploitation  
   - Control: deterministic tokenizer with uncertainty fallback to `BLOCK`.
4. Replay/tampering of command intent  
   - Control: optional integrity contract (`command_hash`, identity/context binding, expiry).
5. Information disclosure via logs  
   - Control: request structured logging with header redaction.

## Residual risk

Advanced shell grammar coverage is intentionally conservative in v1; uncertain cases fail closed.

