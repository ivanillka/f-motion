# Partner host import (Fotium → next CMS)

F-Motion is the **reel engine**. The host (Fotium, another gallery/CMS) owns
upload, identity, Immich/faces, publishing, and queue scenarios. Do not rebuild
those inside F-Motion.

## Easy creator path (Fotium target)

1. **User drops media** (images/video) in Fotium.
2. **Fotium processes in parallel** — R2 object store + Immich (faces, people)
   while a short **chat brief** runs (2–4 questions max: vibe, audience, CTA,
   length). Never block upload on chat.
3. When Immich/R2 are ready, Fotium enables **edit** (gallery + gentle face
   labels). Face tooling must feel optional and lag-free — never a gate.
4. Fotium calls F-Motion **trusted import** with selected media URLs + brief +
   a **scenario seed** from the marketing/queue playbook (variable captions /
   CTAs / structures — not one fixed template).
5. User gets **Edit in F-Motion** (or auto-open). Preview render runs.
6. On preview/final ready, F-Motion notifies the host (**webhook**). Fotium
   publishes to **Reel**, **gallery post**, and **stories** from queue
   scenarios — creative rotation, not copy-paste.

F-Motion does not publish to Fotium. The host publishes.

## Authoritative import API

`POST /v1/integrations/project-imports`  
Auth: `Authorization: Bearer <FENGINE_IMPORT_TOKEN>` (not user JWT / `fm_` keys).

### Request (current)

```json
{
  "external_id": "fotium:gallery:slug-or-id",
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
    "https://media.example.com/galleries/…/full/1.jpg"
  ]
}
```

Rules:

- `external_id` is stable and idempotent (retry-safe).
- `media_urls` should be HTTPS on `FENGINE_IMPORT_MEDIA_ORIGINS`. Other URLs are skipped; the draft is still created.
- Import owner is always `FENGINE_IMPORT_OWNER_ID` (invite-only allowlist).

### Response

```json
{
  "created": true,
  "project_id": "…",
  "project_url": "https://f-motion.com/?project=…",
  "projectUrl": "https://f-motion.com/?project=…",
  "revision": 1
}
```

Hosts **must** prefer `projectUrl` (camelCase) when opening a browser tab.
`project_url` remains for snake_case clients.

## Edit in F-Motion

Button / deep link: open `projectUrl` (already includes `?project=`).

- F-Motion stashes the id across auth redirects.
- User must sign in as an allowlisted owner that can read that project
  (today: the import owner).

Do not iframe the editor until auth/session handoff exists. Link-out first.

## Return webhook (preview ready) — contract

Host passes a notify URL when starting a render (next API slice):

```json
POST /v1/projects/{id}/render
{
  "kind": "preview",
  "notify_url": "https://gallery.example.com/api/integrations/fmotion/notify"
}
```

F-Motion will POST signed JSON when the job reaches a terminal phase:

```json
{
  "event": "render.complete",
  "job_id": "…",
  "project_id": "…",
  "kind": "preview",
  "download_path": "/v1/render-jobs/{job_id}/download",
  "external_id": "fotium:gallery:…"
}
```

Until that field ships, hosts should poll SSE
`GET /v1/render-jobs/{job_id}/events` (see recipes).

## Scenario variability (host-owned)

Queue scenarios live in Fotium. Each import should vary at least:

- caption / CTA wording (F-Motion will not burn queue wrappers or a generic
  "open the gallery" line onto every reel; overlay copy is written from that
  gallery's title and any unique caption)
- `architecture.structure` + `tone` + `pace`
- which media subset (smart / favorites / random / order)
- publish targets: reel and/or gallery post and/or stories

F-Motion only consumes the chosen brief + media; it does not pick the scenario.
