# Architecture Decisions (v1)

## ADR-001: Deterministic-only decisioning

- AgentLock v1 returns only `ALLOW`, `BLOCK`, or `REVIEW`.
- LLM output is never authoritative for `ALLOW`.
- The policy engine is pure and side-effect free.

## ADR-002: Fail-closed default

The following conditions always resolve to `BLOCK`:

- malformed input
- auth failure
- parser uncertainty
- internal failure
- command/integrity mismatch
- expired requests

## ADR-003: Enforcement mode matrix

Given base policy output:

- `ENFORCE`: keep base decision.
- `REVIEW`: convert non-fail-closed non-terminal outcomes to `REVIEW`.
- `OBSERVE`: downgrade policy-rule `BLOCK` to `REVIEW`; fail-closed remains `BLOCK`.

## ADR-004: Emergency bypass semantics

Emergency bypass is modeled on the policy and only downgrades policy-rule `BLOCK` to `REVIEW`. It does not override fail-closed reasons.

## ADR-005: Tenant isolation contract

Every repository method accepts `tenant_id` and applies mandatory tenant scoping in the query path.

