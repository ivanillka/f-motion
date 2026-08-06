# F-Motion skill (OpenClaw / agent hosts)

Use the F-Motion versioned HTTP API with an owner API key.

## Auth

- Header: `Authorization: Bearer fm_…`
- Env: `FMOTION_API_KEY`, `FMOTION_API_ORIGIN`
- Never use an OpenClaw gateway operator token as F-Motion auth

## Metering

Host `render_unit` balance: preview costs 1, final costs 2. Exhaustion → `quota_exceeded` (HTTP 402). FAL/Pexels stay BYOK.

## Minimal flow

1. `GET /v1/me/usage`
2. `POST /v1/projects` `{ "purpose": "…" }`
3. Commands via `POST /v1/projects/{id}/commands`
4. `POST /v1/projects/{id}/render` `{ "kind": "preview" }`
5. SSE `GET /v1/render-jobs/{id}/events` or CLI/MCP wait
6. `GET /v1/render-jobs/{id}/download`

See `docs/agents/getting-started.md` and `docs/agents/openclaw/README.md`.
