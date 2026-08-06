# Agent getting started (Hermes, OpenClaw, Cursor, scripts)

F-Motion’s machine surface is the versioned REST API. `/v1` and `/api` are aliases.
Authenticate with an **owner API key** (`Authorization: Bearer fm_…`), not the OpenClaw gateway operator token and not a browser-only cookie.

Browser sign-in still uses Supabase PKCE/JWT. API keys are created in **Settings → Machine API keys** after you sign in on the web.

## Host metering (not FAL)

- New accounts receive a free starter balance of **render units** (`FENGINE_FREE_RENDER_UNITS`, default 25).
- Costs: preview = 1 unit, final = 2 units.
- When exhausted, render create returns HTTP **402** with `{ "type": "quota_exceeded" }`.
- FAL and Pexels remain **BYOK**. F-Motion never resells provider credits. Any future FAL spend must stay quote → confirm.

## Happy path

1. Auth with API key  
2. Create project / select concept / replace storyboard (commands)  
3. Attach media (upload or connected Pexels)  
4. `POST /v1/projects/{id}/render` with `{ "kind": "preview" | "final" }`  
5. Poll SSE `/v1/render-jobs/{id}/events` (or `fmotion wait` / MCP `wait_render`)  
6. `GET /v1/render-jobs/{id}/download`

OpenAPI: [`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml)  
Route inventory: [`packages/contracts/route-inventory.json`](../../packages/contracts/route-inventory.json)

## curl

```bash
export FMOTION_API_ORIGIN=https://your-api.example
export FMOTION_API_KEY=fm_…

curl -sS -H "Authorization: Bearer $FMOTION_API_KEY" \
  "$FMOTION_API_ORIGIN/v1/me/usage"

curl -sS -X POST -H "Authorization: Bearer $FMOTION_API_KEY" \
  -H "content-type: application/json" \
  -d '{"purpose":"Island lighthouse reel"}' \
  "$FMOTION_API_ORIGIN/v1/projects"
```

## CLI (`fmotion`)

```bash
npm run build --workspace packages/fmotion-cli
npx fmotion login --api-key "$FMOTION_API_KEY" --api-origin "$FMOTION_API_ORIGIN"
npx fmotion usage --json
npx fmotion projects create --purpose "Island lighthouse reel" --json
npx fmotion render <projectId> preview --json
npx fmotion wait <jobId> --json
npx fmotion download <jobId> --json
```

Credentials are stored at `~/.fmotion/credentials` with mode `0600`, or via `FMOTION_API_KEY` / `FMOTION_API_ORIGIN`.

Exit codes map typed API errors (`3` = `quota_exceeded`).

## MCP (`fmotion-mcp`)

Tools: `create_project`, `run_command`, `request_render`, `wait_render`, `download_render`, `usage`.

### Hermes `mcp_servers` snippet

```yaml
mcp_servers:
  fmotion:
    command: npx
    args: ["fmotion-mcp"]
    env:
      FMOTION_API_KEY: "fm_…"
      FMOTION_API_ORIGIN: "https://your-api.example"
```

### Cursor MCP config snippet

```json
{
  "mcpServers": {
    "fmotion": {
      "command": "npx",
      "args": ["fmotion-mcp"],
      "env": {
        "FMOTION_API_KEY": "fm_…",
        "FMOTION_API_ORIGIN": "https://your-api.example"
      }
    }
  }
}
```

## OpenClaw

See [`docs/agents/openclaw/README.md`](./openclaw/README.md). Prefer HTTP tool wrappers with a per-user F-Motion API key; do not reuse the gateway operator bearer as F-Motion auth.

## Smoke check

```bash
npm run smoke:agents
```

This exercises the CLI client and MCP tool list against a local stub (no live database required).
