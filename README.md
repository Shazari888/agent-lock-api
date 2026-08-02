# Agent Guard API

A lightweight API for monitoring, controlling, and securing autonomous AI agents.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in your Supabase values.
2. Run `npm install`.
3. Run `npm run dev`.
4. Apply SQL migrations in `supabase/migrations` in timestamp order.

## Available endpoints

### Public

- `GET /` - basic runtime check
- `GET /health` - health status
- `GET /pricing` - premium price schedule and limits
- `GET /ui` - visual dashboard and request editor

### Agent API key routes

- `GET /test-auth`
- `POST /pulse`
- `POST /check-budget`
- `GET /kill-switch`
- `POST /save-state`
- `GET /load-state`
- `POST /memory/set`
- `GET /memory/get/:key`
- `DELETE /memory/delete/:key`

Send the agent key in the `x-api-key` header.

### User bearer-token routes

- `POST /agents`
- `GET /agents`
- `PATCH /agents/:agentId`
- `POST /agents/:agentId/rotate-key`
- `POST /agents/:agentId/revoke`
- `POST /agents/:agentId/kill-switch`
- `GET /dashboard`

Send a Supabase access token in the `Authorization` header using the standard bearer format.
These routes use the Supabase **anon key + user JWT** so RLS stays active.

## Premium pricing model (USDC)

- Base read (`GET`): **0.008**
- Base write (`POST/PATCH`): **0.009**
- Base delete (`DELETE`): **0.005**
- Dashboard/report generation: **0.012**
- Security actions (rotate/revoke/kill-switch update): **0.012**

### Memory TTL pricing

- `ttl_hours <= 24`: **0.009**
- `25..168` (up to 7 days): **0.012**
- `169..720` (custom up to 30 days): **0.014**

### Memory limits and retention

- Default TTL: **24h**
- Supported TTL: **1..720h** (up to 30 days)
- Payload limit: **100KB** hard cap per item
- Expired memory is filtered at read time and cleaned by scheduled background cleanup.

## Testing

Run `npm test` to execute the automated API tests.

## Deployment

`vercel.json` and `api/index.js` are included so the app can be deployed to Vercel.

## Schema updates

Migrations now cover:

- base tables and RLS policies
- synced `public.users` rows for Supabase auth users
- hashed agent API keys and lifecycle columns
- unique snapshot/kill-switch constraints
- memory storage table with TTL metadata and RLS
