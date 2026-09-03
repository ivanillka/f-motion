# Agent getting started (Hermes, OpenClaw, Cursor, scripts)

F-Motion’s machine surface is the versioned REST API. `/v1` and `/api` are aliases.
Authenticate with an **owner API key** (`Authorization: Bearer fm_…`), not the OpenClaw gateway operator token and not a browser-only cookie.

Never put a user's name, email, phone, account identifiers, or keys in chat,
logs, commits, listings, or video copy. The skill spells this out under Privacy.

Browser sign-in still uses Supabase PKCE/JWT. API keys are created in **Settings → Machine API keys** after you sign in on the web.

## Host metering (not FAL)

- New accounts receive a free starter balance of **render units** (`FENGINE_FREE_RENDER_UNITS`, default 25).
- Costs: preview = 1 unit, final = 2 units.
- When exhausted, render create returns HTTP **402** with `{ "type": "quota_exceeded" }`.
- FAL and Pexels remain **BYOK**. F-Motion never resells provider credits. Any future FAL spend must stay quote → confirm.

## Happy path

Simple creator loop (media first **or** chat only): see
[`docs/contracts/agent-compose.md`](../contracts/agent-compose.md).

1. Auth with API key  
2. If the user attached files, `read_media` then at most four questions  
3. `compose_reel` (or: create project / commands / upload / Pexels)  
4. Return the preview download **and** `draft_url` (`/app/?project=`)  
5. Selective edits: `run_command` or open the draft in the app  

Lower-level `/v1` path is unchanged: commands → render → SSE → download.

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
npx fmotion media read ./still.jpg --json
npx fmotion compose --purpose "Island lighthouse reel" --media ./still.jpg --json
npx fmotion batch ./manifest.json --out ./out --json
npx fmotion draft <projectId> --json
npx fmotion render <projectId> preview --json
npx fmotion wait <jobId> --json
npx fmotion download <jobId> --json
```

Credentials are stored at `~/.fmotion/credentials` with mode `0600`, or via `FMOTION_API_KEY` / `FMOTION_API_ORIGIN`.

Exit codes map typed API errors (`3` = `quota_exceeded`).

## MCP (`fmotion-mcp`)

Tools: `read_media`, `compose_reel`, `open_draft`, `create_project`, `run_command`, `request_render`, `wait_render`, `download_render`, `usage`, `delete_project`.

Result-only bulk is the same `compose_reel` call once per item, then
`delete_project`. `fmotion batch` is that loop; it does not add a second
compose pipeline.

### Hermes `mcp_servers` snippet

```yaml
mcp_servers:
  fmotion:
    command: npx
    args: ["fmotion-mcp"]
    env:
      FMOTION_API_KEY: "fm_…"
      FMOTION_API_ORIGIN: "https://your-api.example"
      FMOTION_WEB_ORIGIN: "https://f-motion.com"
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
        "FMOTION_API_ORIGIN": "https://your-api.example",
        "FMOTION_WEB_ORIGIN": "https://f-motion.com"
      }
    }
  }
}
```

## Host recipes

Import-and-open, API render pipeline, and MCP agent loop:
[`docs/agents/host-recipes.md`](./host-recipes.md).

Partner import + Edit-in-F-Motion + webhook contract:
[`docs/contracts/partner-import.md`](../contracts/partner-import.md).

## OpenClaw

See [`docs/agents/openclaw/README.md`](./openclaw/README.md). Prefer HTTP tool wrappers with a per-user F-Motion API key; do not reuse the gateway operator bearer as F-Motion auth.

Public page: [f-motion.com/agents.html](https://f-motion.com/agents.html).
Skill listings (ClawHub, Cursor, MCP, and pending directories):
[`skill-sources.md`](./skill-sources.md). After the first ClawHub publish:

```bash
npx clawhub@latest install fmotion
```

## Smoke check

```bash
npm run smoke:agents
```

This exercises the CLI client and MCP tool list against a local stub (no live database required).
