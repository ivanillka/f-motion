# F-Motion skill (Cursor / OpenClaw / any agent)

Turn a short chat — with or without photos — into a preview video plus a draft
the user can keep editing. Full contract: `docs/contracts/agent-compose.md`.

## Auth

- Header: `Authorization: Bearer fm_…`
- Env: `FMOTION_API_KEY`, `FMOTION_API_ORIGIN`, optional `FMOTION_WEB_ORIGIN`
- Never use an OpenClaw gateway operator token as F-Motion auth

## Metering

Host `render_unit` balance: preview costs 1, final costs 2. Exhaustion →
`quota_exceeded` (HTTP 402). FAL/Pexels stay BYOK.

## Default loop (keep this short)

1. If the user attached files or gave paths, call `read_media` first.
2. Ask **at most four** missing questions (intent, audience, length, visuals).
   Skip any answer already obvious from the message or the media.
3. Call `compose_reel` with a purpose string that includes those answers.
4. Return the preview (file or download URL) **and** `draft_url`.
5. Offer: keep the video, edit one thing here, or open the draft in the app.

### Media first

User provides images or clips. `read_media` reports count, still vs video, and
portrait/landscape. Use that to pick length and 9:16 framing. Do not re-ask
“what do you have?”

### Chat only

User provides no files. Ask the same few questions, including where visuals
come from. `compose_reel` without `media_paths` still creates the draft.

- If they want a finished video now and have Pexels connected, set
  `fill_stock: true`.
- If Pexels is not connected or they will upload later, return `draft_url` and
  stop. Do not render an empty storyboard.

## What not to ask up front

Overlay look, Ken Burns/motion, crop, music, voice-over, FAL stills/animation.
Those live in more settings (scrolled below the Create brief, or a later
`run_command` / app edit). Mention them only if the user asks.

## Tools

Prefer compose over hand-assembling commands:

- `read_media` — local sniff (not admission)
- `compose_reel` — create, attach, optional stock fill, optional preview
- `open_draft` — `projectUrl` for the studio
- `usage` / `run_command` / `request_render` / `wait_render` / `download_render`
  for selective follow-ups

See `docs/agents/getting-started.md` and `docs/agents/openclaw/README.md`.
