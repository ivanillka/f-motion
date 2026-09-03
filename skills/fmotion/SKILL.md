---
name: fmotion
description: >
  Turn photos or a short chat into an F-Motion preview video plus a draft the
  user can keep editing. Use when the user wants a reel, short, story, or
  vertical video from images, clips, or questions only.
version: 1.0.0
metadata:
  openclaw:
    emoji: "🎬"
    homepage: https://f-motion.com
    primaryEnv: FMOTION_API_KEY
    requires:
      env:
        - FMOTION_API_KEY
    envVars:
      - name: FMOTION_API_KEY
        required: true
        description: Owner API key from F-Motion Settings → Machine API keys (fm_…).
      - name: FMOTION_API_ORIGIN
        required: false
        description: API origin (https://…). Defaults to the hosted API if unset.
      - name: FMOTION_WEB_ORIGIN
        required: false
        description: Studio origin used to build /app/?project= draft links.
---

# F-Motion

Turn a short chat — with or without photos — into a preview video plus a draft
the user can keep editing.

## Auth

- Header: `Authorization: Bearer fm_…`
- Env: `FMOTION_API_KEY`, optional `FMOTION_API_ORIGIN`, optional `FMOTION_WEB_ORIGIN`
- Never use an OpenClaw gateway operator token as F-Motion auth

## Privacy

Do not share the user's personal data. That includes name, email, phone,
address, account identifiers, photos of people used as identity, API keys, and
tokens.

- Do not write those values into chat, logs, commits, issues, PRs, listings, or video copy.
- Do not repeat them back “to confirm.”
- If media includes people, describe the video task, not who they are.

## Metering

Host `render_unit` balance: preview costs 1, final costs 2. Exhaustion →
`quota_exceeded` (HTTP 402). FAL/Pexels stay BYOK.

## Default loop

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

Prefer `fmotion-mcp` or `fmotion` CLI when the host can attach them. Otherwise
wrap `/v1` with the owner API key.

- `read_media` — local sniff (not admission)
- `compose_reel` — create, attach, optional stock fill, optional preview/final.
  This is the only compose path. Bulk is this call in a loop.
- `open_draft` — `projectUrl` for the studio
- `delete_project` — purge a project after a result-only download
- `usage` / `run_command` / `request_render` / `wait_render` / `download_render`
  for selective follow-ups

### Result-only bulk

When the user wants many files and no drafts: for each item call
`compose_reel` (`render: "final"`), save the file, then `delete_project`.
Or run `fmotion batch manifest.json` — it only loops `composeReel`. Never
open a draft in this mode. One item at a time.

Install MCP:

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

## Example

User drops four portrait stills and says “make a reel.”

1. `read_media` → 4 JPEG portraits.
2. Ask only: social vs customers, and about 15 or 30 seconds.
3. `compose_reel` with those answers and the file paths.
4. Return the preview download and `https://…/app/?project=…`.
5. If they want a different caption on scene 2, `run_command` or open the draft.

Chat-only example: “Explain our weekend workshop for the team.” Ask length and
whether they have footage or want stock. Compose the draft. Render only after
media or `fill_stock: true` succeeds.

## Sources

Tracked listings live in `sources.json`. Update that file when a registry URL
or version changes. Publish runbook: `docs/agents/skill-sources.md`.
