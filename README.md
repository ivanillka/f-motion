# F-Engine

F-Engine is a host-neutral, deterministic vertical-video engine with a small
reference application. It separates reusable reel contracts and render
planning from product identity, accounts, persistence, providers, deployment,
and customer operations.

The repository contains:

- `@f-engine/contracts`: versioned language-neutral JSON/OpenAPI contracts;
- `@f-engine/reel-engine`: deterministic commands, cues, crop math, and render
  planning;
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

## Run the reference

Requires Node 24.15.0, npm 11.12.1, and FFmpeg.

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173`. The reference journey accepts a short brief,
then either user-owned media or licensed Pexels footage, and produces an
accurate vertical preview. AI generation is deliberately not implemented.

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
