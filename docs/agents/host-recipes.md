# Host recipes

Four supported ways to use F-Motion from another product. Prefer these over
inventing a parallel API. F-Motion does not post to social; the host publishes.

## 1) Import-and-open (CMS / gallery admin)

**When:** Host already has media + copy; a human will tweak the reel.

```sh
export FENGINE_IMPORT_TOKEN=replace-with-at-least-32-random-characters
# API also needs FENGINE_IMPORT_OWNER_ID, FENGINE_IMPORT_MEDIA_ORIGINS,
# FENGINE_WEB_ORIGIN. Optional notify: FENGINE_RENDER_NOTIFY_ORIGINS and
# FENGINE_RENDER_NOTIFY_SECRET.

curl -sS -X POST "$FMOTION_API_ORIGIN/v1/integrations/project-imports" \
  -H "Authorization: Bearer $FENGINE_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "cms:gallery:weekend",
    "title": "Weekend portraits",
    "caption": "Quiet frames from the session.",
    "call_to_action": "Open the full gallery.",
    "visual_hint": "editorial portrait photography",
    "architecture": {
      "duration_seconds": 15,
      "goal": "promote",
      "audience": "social",
      "structure": "story_arc",
      "tone": "cinematic",
      "pace": "balanced",
      "media": "own"
    },
    "media_urls": ["https://media.example.com/galleries/weekend/1.jpg"],
    "notify_url": "https://cms.example.com/api/integrations/fmotion/notify"
  }'
```

1. Host POSTs the payload above. Idempotent on `external_id`.
2. Open returned `projectUrl` (new tab).
3. User signs in on f-motion.com if needed. The draft opens.
4. User attaches or adjusts scenes, runs a preview, downloads or continues later.
5. If `notify_url` was accepted, F-Motion POSTs signed `render.complete` when
   that project's render finishes. Verify `X-F-Motion-Signature`, then GET
   `download_path` with the owner API key.

Re-import with new `media_urls` repairs storyboard media when the draft was
text-only.

See [`docs/contracts/partner-import.md`](../contracts/partner-import.md).

## 2) Headless render pipeline (automation / backend)

**When:** No browser; the host wants a finished file.

```sh
curl -sS -X POST "$FMOTION_API_ORIGIN/v1/projects/$PROJECT_ID/render" \
  -H "Authorization: Bearer $FMOTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "preview",
    "notify_url": "https://cms.example.com/api/integrations/fmotion/notify",
    "external_id": "cms:gallery:weekend"
  }'
```

1. Mint an owner API key (`fm_…`) in Settings (or use the import owner's key).
2. `POST /v1/projects` → commands (`replace_storyboard`, scene updates) **or**
   trusted import, then continue with the API key as that owner.
3. Upload or attach media (`/v1/projects/{id}/media/…`).
4. `POST /v1/projects/{id}/render` with `{ "kind": "preview" | "final" }` and
   optional `notify_url`.
5. Wait for the webhook, **or** follow SSE `/v1/render-jobs/{id}/events` until
   `complete`.
6. `GET /v1/render-jobs/{id}/download`.
7. Host publishes (reel / gallery / stories / whatever the product already has).

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

## 4) CMS plugin (WordPress first)

**When:** You ship F-Motion inside WordPress, Drupal, Shopify, or a similar CMS,
and other plugins must subscribe without knowing F-Motion internals.

The plugin is a thin adapter over recipe 1 (and optionally recipe 2). It is not
a fork of the engine. Fotium is a reference custom host that already speaks
import-and-open; it is not the only host.

1. Filter `before_import` so sibling plugins can mutate `media_urls` and the brief.
2. `POST /v1/integrations/project-imports`.
3. Action `after_import`. Open `projectUrl` in a new tab (link-out Edit, not iframe).
4. Receive signed `render.complete` on the plugin `notify_url`.
5. Download, attach to the CMS, then fire `reel_ready` with `post_id`,
   `attachment_id`, `mp4_url`, and `external_id`.

WordPress names: `fmotion_before_import`, `fmotion_after_import`,
`fmotion_reel_ready`, `fmotion_edit_open`. REST:
`POST /wp-json/fmotion/v1/notify`.

Drupal (`hook_fmotion_*`), Shopify (`fmotion/reel_ready`), and a generic HTTPS
webhook use the same canonical events.

Non-goals: no social API tokens in the F-Motion plugin, no Immich or faces
inside the plugin, no studio iframe until session handoff exists.

This pass ships the architecture and a WordPress stub
(`plugins/wordpress/`). A follow-up ships the installable plugin package.

See [`docs/contracts/cms-plugin.md`](../contracts/cms-plugin.md).
