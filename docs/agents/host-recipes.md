# Host recipes

Three supported ways to use F-Motion from another product. Prefer these over
inventing a parallel API.

## 1) Import-and-open (Fotium admin / CMS)

**When:** Host already has media + copy; human will tweak the reel.

1. Host `POST /v1/integrations/project-imports` with Bearer import token.
2. Open returned `projectUrl` (new tab).
3. User signs in on f-motion.com if needed → draft opens.
4. User attaches/adjusts scenes → `preview` render → download or continue later.

Idempotent on `external_id`. Re-import with new `media_urls` repairs storyboard
media when the draft was text-only.

See [`docs/contracts/partner-import.md`](../contracts/partner-import.md).

## 2) API render pipeline (automation / backend)

**When:** No browser; host wants a finished file.

1. Mint an owner API key (`fm_…`) in Settings (or use import owner’s key).
2. `POST /v1/projects` → commands (`replace_storyboard`, scene updates) **or**
   trusted import then continue with the API key as that owner.
3. Upload/attach media (`/v1/projects/{id}/media/…`).
4. `POST /v1/projects/{id}/render` `{ "kind": "preview" | "final" }`.
5. Follow SSE `/v1/render-jobs/{id}/events` until `complete`.
6. `GET /v1/render-jobs/{id}/download`.
7. Host publishes (Fotium reel / gallery / stories).

Metering: preview = 1 render unit, final = 2; `402 quota_exceeded` when empty.
BYOK still required for Pexels/FAL.

CLI equivalent: `fmotion projects create` → `command` → `render` → `wait` →
`download` (`packages/fmotion-cli`).

## 3) MCP agent loop (Hermes / Cursor / OpenClaw)

**When:** An agent operates the reel for a user.

1. Configure MCP `@f-engine/fmotion-mcp` with `FMOTION_API_KEY` + origin
   (optional `FMOTION_WEB_ORIGIN` for absolute draft links).
2. Media first **or** chat only, then at most four questions.
3. Tools: `read_media` → `compose_reel` → return the preview and `draft_url`.
   Selective follow-ups use `run_command` / `open_draft` / render wait.
4. The composed project **is** the draft. Do not clone it.

Contract: [`../contracts/agent-compose.md`](../contracts/agent-compose.md).

Do not put the OpenClaw gateway operator token into F-Motion auth.

Details: [`docs/agents/getting-started.md`](./getting-started.md),
[`docs/agents/openclaw/README.md`](./openclaw/README.md).
