# Partner host import

F-Motion is the **reel engine**. Any CMS, gallery, or DAM (Fotium is one
example) can embed reel creation. The host owns upload, identity, faces,
publishing, and queue scenarios. Do not rebuild those inside F-Motion.

F-Motion does not post to social networks. The host publishes.

## Easy creator path

1. The user drops media in the host.
2. The host processes in parallel (object storage, optional face labeling, a
   short chat brief). Never block upload on chat.
3. When media URLs are ready, the host enables edit. Face tooling must stay
   optional and lag-free.
4. The host calls F-Motion **trusted import** with selected `media_urls`, brief
   fields, architecture, and a stable `external_id`.
5. The host opens **Edit in F-Motion** using `projectUrl` (or auto-opens).
6. When a preview or final render completes, F-Motion POSTs a signed
   `render.complete` webhook if the host supplied `notify_url`. The host then
   publishes to its own reel, gallery post, or stories.

## Authoritative import API

`POST /v1/integrations/project-imports`

Auth: `Authorization: Bearer <FENGINE_IMPORT_TOKEN>` (not a user JWT or `fm_`
key).

### Environment

Configure these on the F-Motion API (never in browser `VITE_*` vars, never in
source):

| Variable | Required | Purpose |
|---|---|---|
| `FENGINE_IMPORT_TOKEN` | yes, to enable import | Shared Bearer token, at least 32 characters |
| `FENGINE_IMPORT_OWNER_ID` | yes, with import | UUID of the allowlisted owner who receives drafts |
| `FENGINE_IMPORT_MEDIA_ORIGINS` | recommended | Comma-separated HTTPS origins allowed in `media_urls` |
| `FENGINE_WEB_ORIGIN` | yes, with import | Public studio origin used to build `projectUrl` |
| `FENGINE_RENDER_NOTIFY_ORIGINS` | yes, to accept `notify_url` | Comma-separated callback origins |
| `FENGINE_RENDER_NOTIFY_SECRET` | recommended | HMAC secret, at least 32 characters. If unset, import token is used |

### Request

```json
{
  "external_id": "cms:gallery:slug-or-id",
  "title": "Weekend portraits",
  "caption": "Quiet frames from the session.",
  "call_to_action": "Open the full gallery.",
  "visual_hint": "editorial portrait photography",
  "goal": "promote",
  "audience": "Social audience",
  "architecture": {
    "duration_seconds": 15,
    "goal": "promote",
    "audience": "social",
    "structure": "story_arc",
    "tone": "cinematic",
    "pace": "balanced",
    "media": "own"
  },
  "media_urls": [
    "https://media.example.com/galleries/weekend/full/1.jpg"
  ],
  "notify_url": "https://cms.example.com/api/integrations/fmotion/notify"
}
```

Snake_case is canonical. CamelCase aliases (`externalId`, `mediaUrls`,
`callToAction`, `visualHint`, `notifyUrl`, `durationSeconds`) are accepted.

Rules:

- `external_id` is stable and idempotent (retry-safe). The project id is derived
  from the import owner plus this value.
- `media_urls` should be HTTPS on `FENGINE_IMPORT_MEDIA_ORIGINS`. Other URLs are
  skipped; the draft is still created. Items may be strings or `{ "url": "…" }`.
- Import owner is always `FENGINE_IMPORT_OWNER_ID` (invite-only allowlist).
- `notify_url` is optional. When present it must be HTTPS on
  `FENGINE_RENDER_NOTIFY_ORIGINS`. It is stored on the draft so later studio
  renders can notify the same host. Invalid `notify_url` returns `422`.

### Response

```json
{
  "created": true,
  "project_id": "…",
  "project_url": "https://f-motion.com/app/?project=…",
  "projectUrl": "https://f-motion.com/app/?project=…",
  "revision": 1
}
```

Hosts **must** prefer `projectUrl` (camelCase) when opening a browser tab.
`project_url` remains for snake_case clients.

## Edit in F-Motion

Button / deep link: open `projectUrl` (already includes `?project=`).

- F-Motion stashes the id across auth redirects.
- The user must sign in as an allowlisted owner that can read that project
  (today: the import owner).

Do not iframe the editor until auth/session handoff exists. Link-out first.

## Return webhook (`render.complete`)

Pass `notify_url` on import (stored for later studio renders) and/or when
starting a render:

```json
POST /v1/projects/{id}/render
{
  "kind": "preview",
  "notify_url": "https://cms.example.com/api/integrations/fmotion/notify",
  "external_id": "cms:gallery:slug-or-id"
}
```

Render auth is the owner Bearer JWT or `fm_` API key, not the import token.
`notify_url` on this request overrides the value stored at import.

F-Motion POSTs signed JSON when the job reaches `complete`:

```http
POST /api/integrations/fmotion/notify
Content-Type: application/json
X-F-Motion-Signature: t=1710000000,v1=<hex>
```

```json
{
  "event": "render.complete",
  "job_id": "…",
  "project_id": "…",
  "kind": "preview",
  "download_path": "/v1/render-jobs/{job_id}/download",
  "external_id": "cms:gallery:slug-or-id"
}
```

Verify the signature before fetching the file:

1. Parse `t` and `v1` from `X-F-Motion-Signature`.
2. Reject if `|now - t|` is greater than 5 minutes.
3. Compute HMAC-SHA256 of `t + "." + raw_body` with
   `FENGINE_RENDER_NOTIFY_SECRET` (or the import token if you did not set a
   dedicated secret). Compare with `v1` using a constant-time check.

Then `GET` `download_path` with the owner API key and publish from the host.
F-Motion does not post to social.

Failed or cancelled jobs do not send this event. Poll SSE until `complete`,
`failed`, or `cancelled`:

`GET /v1/render-jobs/{job_id}/events`

## Scenario variability (host-owned)

Queue scenarios live in the host. Each import should vary at least:

- caption / CTA wording (F-Motion will not burn queue wrappers or a generic
  "open the gallery" line onto every reel; overlay copy is written from that
  gallery's title and any unique caption)
- `architecture.structure` + `tone` + `pace`
- which media subset (smart / favorites / random / order)
- publish targets: reel and/or gallery post and/or stories

F-Motion only consumes the chosen brief + media; it does not pick the scenario.

Faces, Immich, and people search stay in the host. See
[`fotium-faces-ux.md`](./fotium-faces-ux.md) for one host's UX notes.
