# Changelog

All notable changes to F-Motion are listed here. The same notes appear in the
studio under **Settings → What’s new**. Product version lives in root
`package.json` and `apps/web/src/release.ts`.

## [Unreleased]

### Site

- Splash feature buttons are Studio, How it works, GitHub, and Self-host. GitHub opens the agent skill (`skills/fmotion`). Hosted was the same CTA as Studio and is gone; `/hosted` still opens home.
- Cursor `frontend-design` skill lives in `.cursor/skills/` and follows `DESIGN.md`. The splash is the wordmark: no card, Studio as a rose text link, hyphen as a cyan hairline.

### Ephemeral bulk (agent / CLI)

- `DELETE /projects/{id}` purges a draft and its stored blobs after the file is downloaded.
- `POST /compose` is the singular `composeOne` path (create, storyboard, optional stock, optional render).
- `POST /batches` runs that same function once per item, then hard-deletes the project. Serial, result-only.
- `fmotion batch` calls `POST /v1/batches` for brief/stock items. Local files still use `composeReel` because the bytes live on the client.
- MCP `delete_project` and result-only bulk docs. Bulk AI generation stays rejected.

## [0.3.1] — 2026-09-01

### Reliability & site

- Self-host and LAN HTTP studios create storyboards again — command IDs no longer require a secure browser context.
- Create chat keeps your first topic line for the brief and opens the storyboard when the chat finishes.
- Brief questions use a shorter subject instead of repeating your whole opening line.
- f-motion.com marketing routes: **Login** and **How it works** show coming soon; hosted studio sign-in stays gated until reopen.
- GitHub repository is public; VPS IPs, Tailscale URLs, and partner-specific deploy defaults removed from the tree.

## [0.3.0] — 2026-09-01

### Context-aware media

- Licensed stock search ranks candidates with a fit score from your brief, scene, and optional media glance.
- Video architecture and media glance persist when the storyboard is created — not only after concept selection.
- YouTube-style delivery searches landscape Pexels; Reels and Stories stay portrait.
- FAL image and motion dialogs open prefilled from scene intent; stock picks log feedback for tuning.

## [0.2.0] — 2026-08-28

### Create is the chat

- Create asks only what is still missing, then opens the storyboard — no concept picker and no extra Continue step.
- Dropped photos get a local glance before follow-up questions; Pexels-only chats do not wait on a drop.
- Play keeps running when a scene still needs media; Pause freezes the preview.
- Voice-over has start offset, level, and mute; spoken words highlight on the full caption.

## [0.1.0] — 2026-08-25

### Live alpha

- Vertical storyboard drafts with licensed stock (BYOK Pexels) and optional FAL stills (BYOK).
- Preview and final export through host metering.
