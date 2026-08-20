# F-Engine

F-Engine is a host-neutral, deterministic vertical-video engine with a small
reference application. It separates reusable reel contracts and render
planning from product identity, accounts, persistence, providers, deployment,
and customer operations.

## Start here

Choose one path:

1. **Try it locally with no accounts or personal credentials**

   ```sh
   npm ci
   npm run demo
   ```

   Open `http://127.0.0.1:4173`. This disposable demo uses an in-memory API,
   a session-only test identity, local fixture media, and local FFmpeg. It does
   not use Supabase, cloud storage, Pexels, or a hosted database.

2. **Self-host with your own services**

   - **One-box VPS (Docker Compose):** [VPS self-host](docs/runbooks/vps-self-host.md) —
     Postgres, MinIO, API, worker, and web on one machine. No Fly.io. No Fotium.
     Users bring Supabase Auth plus their own Pexels/FAL keys.
   - **Manual durable stack:** [Self-host onboarding](docs/getting-started.md).

   You create and control the Supabase, PostgreSQL, S3-compatible storage, and
   Pexels accounts. No maintainer credential, customer data, deployment
   identifier, or private API endpoint is included. Every signed-in user
   connects their own Pexels API key for stock search. If FAL credential
   support is enabled, they also connect their own API-scope FAL key. One
   storyboard scene can quote and confirm a Flux Schnell still, or animate one
   approved portrait still into a six-second video, charged directly to that
   FAL account. The host never supplies a shared provider key.

Never paste database, storage, or service-role credentials into the browser.
The provider credentials accepted by the reference web client are a user's own
Pexels and FAL keys in authenticated Settings. They are sent over HTTPS,
encrypted by the API, and never returned to the browser.

## What is included

The repository contains:

- `@f-engine/contracts`: versioned language-neutral JSON/OpenAPI contracts;
- `@f-engine/reel-engine`: deterministic commands, cues, crop math, and render
  planning;
- `@f-engine/fal-host`: a private reference-host adapter for encrypted,
  owner-scoped provider credentials;
- `@f-engine/fmotion-cli` / `@f-engine/fmotion-mcp`: thin `/v1` CLI and stdio
  MCP for agents (see [Agent getting started](docs/agents/getting-started.md));
- a reference API, worker, and React client that exercise the boundary;
- private release tooling that produces sanitized snapshots.

All npm workspaces remain `"private": true`. The package names are for local
boundaries and tarball verification; no registry package or hosted customer
service is implied.

## Host boundary

A host supplies authentication, databases, object storage, provider
credentials/adapters, UI and branding, operational policy, and a validated
render profile. The engine does not read environment variables, call provider
SDKs, persist data, or choose presentation identity.

Private hosts pin reviewed F-Engine releases and adapt at the package/API
boundary. They do not edit a vendored fork.

The reference journey accepts a short brief, then either user-owned media or
licensed Pexels footage from the user's account, and produces an accurate
vertical preview. AI generation is deliberately not implemented. Settings
connects and validates user-owned Pexels and optional FAL credentials; it never
returns their values to the browser.

## Verify

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
npm run test:e2e:web
```

Stored project and command payloads remain wire schema version 1. Clients
consume the HTTP/SSE and JSON/OpenAPI boundary; they do not import the
TypeScript engine directly.
