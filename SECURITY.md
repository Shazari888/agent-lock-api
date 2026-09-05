# Security Notes

## Built-in controls

- Strict env validation with startup failure on invalid config.
- Rate limiting for all routes.
- Request timeout via Fastify `requestTimeout`.
- Stable error shape with `request_id`.
- Redaction of `authorization` and `x-api-key` in logs.
- Tenant-scoped repositories and scoped API key auth.
- Fail-closed behavior for malformed/auth/parser/internal failures.

## API key model

- Keys are generated as random `alk_*` values.
- Only `sha256` hash and prefix are stored.
- Keys can be revoked by setting `revoked_at`.
- Scopes are explicit and required per endpoint.

## Adversarial testing coverage

- malformed body requests
- missing/invalid auth headers
- parser uncertainty (`$(` or backticks)
- scope denial paths

