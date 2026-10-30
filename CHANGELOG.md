# Changelog

All notable changes to F-Motion are listed here. The same notes appear in the
studio under **Settings → What’s new**. Product version lives in root
`package.json` and `apps/web/src/release.ts`.

## [Unreleased]

### Studio

- **Create** shows attached photos as one compact strip: a **6 photos added** count and a row of thumbnails, each with its own remove button, instead of one full row per file. The chat keeps a readable height with five to eight photos attached, and on short screens the card scrolls so the photos and the composer stay in view together. Ship together with Pages, the API, and the VPS in one release.
- **Create new video** always opens a clean intake instead of reopening the last chat: the conversation that made a storyboard is cleared once the storyboard exists, a **Start over** button with a confirm clears the chat on demand, and a chat that reached its ready line always shows a **Make my storyboard** button, so it is never a dead end. **Start a different description** in the editor opens that same clean intake, while a chat that was only typed and never sent still comes back with the line you left. Ship together with Pages, the API, and the VPS in one release.
- **Record voice-over** works in the browser again: the shipped `Permissions-Policy` allows the microphone for the studio only (`microphone=(self)`) in `apps/web/public/_headers`, `deploy/hetzner/nginx.conf`, and `deploy/vps/nginx.conf`, and a blocked, missing, or unsupported microphone now says what to do. Camera, location, and payment stay off. Ship together with Pages, the API, and the VPS in one release.
- Fallback storyboards now write plain sentence captions such as **My summer trip.** instead of splitting the brief into fragments, and user-facing studio copy no longer uses em dashes. Ship together with Pages, the API, and the VPS in one release.
- Create speaks plain language end to end: no reel, stock, footage, or package jargon; captions read as short plain sentences; and **Make my storyboard now** is the first action after an upload, so nobody has to answer every question first. Scene cards show the caption, or a short **Add a short caption** hint, instead of the internal image prompt. The export button reads **Export video**, and messages point at Sources, not a strip. Ship together with Pages, the API, and the VPS in one release.
- Scene editor is split into four tabs: Style, Timing, Text, and Media, showing at most four controls at once while keeping full keyboard and screen reader access. Edits persist across tab switches. Ship together with Pages, the API, and the VPS in one release.
- Drafts list has a per-item **Delete** control with a confirm step. It calls the existing hard-purge `DELETE /projects/{id}` (project row, cascaded children, outbox rows, and best-effort object-storage blobs).
- Phone widths (≤899px) keep the Create composer's **Send** button, the Storyboard actions, and every studio footer above the bottom dock, and the dock reserves the iOS home-indicator inset.
- Create leads with its task: media sources sit in the header as slim chips (Own, Pexels, FAL, More, and the Animate stills toggle with its reason) instead of a full-width sources row, and Drafts no longer repeats that row in prose.
- Create asks where the pictures come from based on the sources the studio really has: **Pexels videos**, **Civitai images**, and **AI images with FAL (paid, asks first)** appear only while that source is connected, one **Mix my photos and Pexels** answer appears as soon as a connected source can share the storyboard, and locked or unavailable sources stay in one hint line that points at **Settings**. Picking mix before the photos are added asks for them instead of filling the storyboard from stock alone, and a studio with only its own photos is not asked at all. The answer decides what the storyboard fills with, and the last picked source leads the next Create chat. Ship together with Pages, the API, and the VPS in one release.
- Photos to reel shows how many photos are picked, such as **23 photos picked** or **No photos picked yet**, in a live region beside the file input. The input still clears after every pick, so the count is the place to confirm that a second drop of the same file took.

### Site

- Public `/` is the soft-launch landing (English, Czech at `/cs/`). Studio stays labeled Soon / Brzy. GitHub is the primary link.
- Hosted Login and `/studio` are open again on f-motion.com. Uninvited accounts still get 403. How it works stays coming soon. Set `VITE_STUDIO_COMING_SOON=1` to re-gate the studio.
- Splash feature buttons are Studio, How it works, GitHub, and Self-host. GitHub opens the agent skill (`skills/fmotion`). Hosted was the same CTA as Studio and is gone; `/hosted` still opens home.
- Cursor `frontend-design` skill lives in `.cursor/skills/` and follows `DESIGN.md`. The splash is a glass cube in space holding the wordmark on every public page. Stars speed up while the site is loading or swapping pages, then ease back to slow. Fog stays faint and out at the edges. Reduced motion freezes the sky and the cube.
- `/app/manifest.webmanifest` now returns the real manifest instead of the studio HTML shell, so an installed copy reads **F-Motion**, opens at `/app/`, and keeps its icon. Ship together with Pages, the API, and the VPS in one release.

### Hosted deploy

- Hosted f-motion.com runs on a Hetzner VPS (`deploy/hetzner`, `npm run hetzner:up`). Fly.io configs are removed.
- Hosted photo and clip uploads are no longer blocked by the web app policy: `connect-src` allows `https://*.r2.cloudflarestorage.com` in `apps/web/public/_headers`, `deploy/hetzner/nginx.conf`, and `deploy/vps/nginx.conf`. Apply `deploy/r2-cors.json` to the bucket, which allows the app origins, `PUT`, `GET`, `HEAD`, `Content-Type`, and exposes `ETag` for the upload response. Details in `docs/runbooks/hosted-deploy.md` §2.

### Ephemeral bulk (agent / CLI)

- `DELETE /projects/{id}` purges a draft and its stored blobs after the file is downloaded.
- `POST /compose` is the singular `composeOne` path (create, storyboard, optional stock, optional render).
- `POST /batches` runs that same function once per item, then hard-deletes the project. Serial, result-only.
- `fmotion batch` calls `POST /v1/batches` for brief/stock items. Local files still use `composeReel` because the bytes live on the client.
- MCP `delete_project` and result-only bulk docs. Bulk AI generation stays rejected.

## [0.3.1] — 2026-09-01

### Reliability & site

- Self-host and LAN HTTP studios create storyboards again. Command IDs no longer require a secure browser context.
- Create chat keeps your first topic line for the brief and opens the storyboard when the chat finishes.
- Brief questions use a shorter subject instead of repeating your whole opening line.
- f-motion.com marketing routes: **Login** and **How it works** show coming soon; hosted studio sign-in stays gated until reopen.
- GitHub repository is public; VPS IPs, Tailscale URLs, and partner-specific deploy defaults removed from the tree.

## [0.3.0] — 2026-09-01

### Context-aware media

- Licensed stock search ranks candidates with a fit score from your brief, scene, and optional media glance.
- Video architecture and media glance persist when the storyboard is created, not only after concept selection.
- YouTube-style delivery searches landscape Pexels; Reels and Stories stay portrait.
- FAL image and motion dialogs open prefilled from scene intent; stock picks log feedback for tuning.

## [0.2.0] — 2026-08-28

### Create is the chat

- Create asks only what is still missing, then opens the storyboard, with no concept picker and no extra Continue step.
- Dropped photos get a local glance before follow-up questions; Pexels-only chats do not wait on a drop.
- Play keeps running when a scene still needs media; Pause freezes the preview.
- Voice-over has start offset, level, and mute; spoken words highlight on the full caption.

## [0.1.0] — 2026-08-25

### Live alpha

- Vertical storyboard drafts with licensed stock (BYOK Pexels) and optional FAL stills (BYOK).
- Preview and final export through host metering.
