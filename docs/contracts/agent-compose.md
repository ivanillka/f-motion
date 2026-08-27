# Agent compose (Cursor / OpenClaw / any host)

F-Motion’s machine surface stays `/v1`. This contract is the **simple creator
loop** an agent or the studio Create page should run. Do not invent a parallel
product API.

Partner import (Fotium already has media + copy) stays
[`partner-import.md`](./partner-import.md). This document is for a person
talking to an agent or starting in the app.

## Outcome

Every successful compose returns:

1. A **preview video** when every scene has ready media (upload or licensed
   stock). Preview costs 1 host `render_unit`. The first file is never a
   published post.
2. A **draft URL** (`/app/?project={id}`) — the same project, not a clone.
   “Copy to draft” means: keep this project so the user can edit selectively
   in the agent skill **or** open the studio and edit there.

If media is not ready, return the draft only. Do not invent pixels, auto-fill
FAL stills, or render an incomplete storyboard.

## Two entries

The user may start either way. Same question budget and same exit.

### A — Media first

1. User drops images or short clips (host chat attachments or local paths).
2. Agent calls `read_media` (or uses host vision **plus** `read_media` for
   type, count, and orientation). The studio Create chat glances locally
   (dimensions + 64px color) before its remaining questions — no VLM.
3. Agent asks at most **four** questions (see below).
4. `compose_reel` uploads, builds a storyboard, preview-renders when ready.
5. Agent returns the file (or download URL) **and** the draft URL.

### B — Chat only

1. User has no files yet. Agent does **not** stall on an upload.
2. Same four-question budget, including where visuals come from.
3. `compose_reel` creates the draft. Ready video only if the user then
   provides files **or** asks for licensed stock **and** Pexels is connected
   (BYOK). Otherwise hand back the draft URL and say they can drop media next
   or finish in the app.

Never block chat on media inspection. Never require both a brief *and* files.

## Question budget

Ask only what the media (or lack of it) does not already answer. Cap at four.
Prefer this order:

1. **Intent** — story, explain, promote, or teach? Skip if the message is clear.
2. **Audience / placement** — general, social/Reels, customers, internal.
3. **Length** — about 15, 30, or 45 seconds.
4. **Visuals** — use the attached files, mix with Pexels, or Pexels only.

Do not interview for overlay look, motion preset, crop, music, voice-over, or
FAL. Those stay in the storyboard editor, not on Create.

Suggested plan fields (existing architecture, not a new schema):

| Field | Values |
|---|---|
| `goal` | `story` `explain` `promote` `educate` |
| `audience` | `general` `social` `customers` `internal` |
| `structure` | `story_arc` `mystery` `problem_solution` `chronological` |
| `tone` | `cinematic` `documentary` `energetic` `calm` |
| `pace` | `slow` `balanced` `fast` |
| `duration_seconds` | `15` `30` `45` |
| `media` | `own` `stock` `mixed` |

## Create is the chat

The studio Create page is the chat: opening line, answers, chips, composer.
Plan fields are inferred from that conversation. Overlay, motion, crop, music,
and voice-over stay in the storyboard. Agents mention those exist in the draft.
They do not dump the architecture grid unless the user asks to change one.

## Tools

Host-agnostic. Cursor MCP, OpenClaw HTTP wrappers, or `fmotion` CLI.

| Tool | Role |
|---|---|
| `read_media` | Local inspect: kind, bytes, mime, width/height, orientation. No upload. |
| `compose_reel` | Create → select concept → attach uploads and/or Pexels storyboard → optional preview. Returns `draft_url` and render download when complete. |
| `open_draft` | Resolve `project_url` / `projectUrl` for selective edit. |
| Existing `/v1` tools | `run_command`, `request_render`, `wait_render`, `download_render`, `usage` for later selective edits. |

`read_media` is advisory. The worker still quarantines and inspects bytes
after upload. Agents must not treat local sniff as admission.

Auth remains an owner API key (`Authorization: Bearer fm_…`). Never use an
OpenClaw gateway operator token as F-Motion auth. Never put the user's name,
email, phone, account identifiers, or keys in chat, logs, commits, listings,
or video copy.

## Selective edit

After compose, the user may:

- Keep the preview and stop.
- Ask the agent to change one scene, caption, motion, or overlay (`run_command`).
- Open `draft_url` and edit in the app.

Do not clone the project unless a save-as-copy conflict requires it (existing
studio recovery). The composed project **is** the draft.

## Non-goals

- A second public HTTP resource besides `/v1` orchestration
- Auto-publishing to social
- Managed FAL or Pexels keys
- Auto-attaching AI stills or Hailuo clips
- Replacing the storyboard editor
- Server-side project clone as the “copy to draft” action
