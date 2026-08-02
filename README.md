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

   Follow [Self-host onboarding](docs/getting-started.md). You create and
   control the Supabase, PostgreSQL, S3-compatible storage, and Pexels
   accounts. No maintainer credential, customer data, deployment identifier,
   or private API endpoint is included. If FAL credential support is enabled,
   every signed-in user connects their own API-scope FAL key and their FAL
   account is charged directly; the host never supplies a shared FAL key.

Never paste database, storage, Pexels, or service-role credentials into the
browser. They belong only in protected API/worker environment configuration.
The one provider credential accepted by the reference web client is a user's
own FAL key in authenticated Settings; it is sent over HTTPS, encrypted by the
API, and never returned to the browser.

## What is included

The repository contains:

- `@f-engine/contracts`: versioned language-neutral JSON/OpenAPI contracts;
- `@f-engine/reel-engine`: deterministic commands, cues, crop math, and render
  planning;
- `@f-engine/fal-host`: a private reference-host adapter for encrypted,
  owner-scoped FAL credentials;
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
licensed Pexels footage, and produces an accurate vertical preview. AI
generation is deliberately not implemented. The optional FAL Settings card
only connects and validates a user-owned credential without generating media.

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
