# F-Motion

[![License](https://img.shields.io/badge/license-Apache--2.0-a54d67)](LICENSE)

F-Motion is an open-source vertical-video studio. Write a brief, choose a
story, attach your own media or licensed stock, and download a 720p preview.

```
brief → storyboard → preview
```

## Three ways to use it

| Path | Media | Pexels | FAL |
|---|---|---|---|
| **Self-host** one image on your VPS | Your uploads, free | Optional — your key | Your key (BYOK) |
| **Hosted** at [f-motion.com](https://f-motion.com) | Your uploads, free | Included on the hosted studio | Billed by F-Motion |
| **Source** on [GitHub](https://github.com/ivanillka/f-motion) | — | — | — |

Self-host never requires a maintainer credential. Hosted FAL billing is a
product offer, not a price list in this repository.

## Self-host (one image)

```sh
docker compose up
```

Or:

```sh
docker build -f deploy/Dockerfile -t f-motion .
docker run --rm -p 8080:8080 -v fmotion-data:/data f-motion
```

Open `http://127.0.0.1:8080/` (studio + operator token). The container prints
an operator token on first boot. Details: [docs/runbooks/self-host.md](docs/runbooks/self-host.md).

## Try it locally (no accounts)

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173/studio`. This disposable demo uses an in-memory
API and local FFmpeg. It does not use Supabase, cloud storage, or Pexels.

## Verify

```sh
npm run lint
npm test
npm run build
npm run test:e2e:web
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## What this repo is

- React studio (`apps/web`) with public pages at `/`, `/self-host`, `/hosted`,
  and the editor at `/studio`
- Express API + FFmpeg worker
- `@f-engine/contracts` and `@f-engine/reel-engine` — host-neutral reel math
- Android client under `apps/mobile` (later store listing)

F-Motion does not ship a public integrate/MCP product API, a multitrack NLE,
or 4K/60 output. Privacy and payment policy for the hosted studio still follow
the Gate 0 checklist before paid launch.
