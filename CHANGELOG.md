# Changelog

All notable changes to F-Motion are listed here. The same notes appear in the
studio under **Settings → What’s new**. Product version lives in root
`package.json` and `apps/web/src/release.ts`.

## Unreleased

- Hosted f-motion.com runs on a Hetzner VPS (`deploy/hetzner`, `npm run hetzner:up`). Fly.io configs are removed.

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
