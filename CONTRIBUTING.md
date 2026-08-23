# Contributing

F-Motion is Apache-2.0. Focused bug reports and small pull requests are welcome
when they include no credentials, customer media, or private deployment data.

## Toolchain

- Node 24.15.0 and npm 11.12.1
- Flutter 3.44.8 and Dart 3.12.2 for Android changes
- FFmpeg 8.1.x for worker / render changes

## Verify

```sh
npm ci
npm run lint
npm test
npm run build
npm run test:e2e:web
```

Android gates from the repository root:

```sh
FLUTTER_BIN=/absolute/path/to/flutter apps/mobile/tool/flutter_from_root.sh analyze
FLUTTER_BIN=/absolute/path/to/flutter apps/mobile/tool/flutter_from_root.sh test
```

## Product workflow

Core implementations update all three products at once. Product-specific
behavior stays in adapters.

| Layer | Lives in | Examples |
|---|---|---|
| **Core** | `packages/contracts`, `packages/reel-engine`, `apps/api/src/domain.ts`, media/render/mixkit, `apps/worker/src`, `apps/web/src/api.ts`, the editor path in `apps/web/src/main.tsx` | Brief, storyboard, uploads, stock attach, 720p preview |
| **VPS adapter** | `apps/api/src/selfhost-auth.ts`, `deploy/`, `VITE_SELFHOST_AUTH` | First-open owner, one-image boot |
| **Hosted adapter** | `apps/api/src/auth.ts` JWKS, `apps/web/src/auth.ts` Supabase, marketing Pages | Magic link, invite list, payment later |
| **Corporate adapter** | reserved (`FENGINE_ENV=corporate`) | Teams — not built |

If a change is the editor or render path, do not wrap it in `selfhost` /
`hosted` / `corporate` branches. If a change is auth, money, or membership,
do not put it in reel-engine, contracts, or domain.

`tests/product-layers.test.mjs` enforces the core side of this split.

## Rules

- Keep changes narrow. Match existing naming, error handling, and tests.
- Every non-trivial behavior needs one small runnable check that fails if it
  breaks.
- Do not add shared provider keys. Pexels and FAL stay owner-scoped or optional.
- Do not invent prices, credit packs, MCP product APIs, or NLE/multitrack UI.
- Hosted (`FENGINE_ENV=hosted`) must keep `FENGINE_LOCAL_AUTH` unset.
- VPS (`FENGINE_ENV=selfhost`) uses a single owner account created on first
  open. No Supabase, Stripe, invite lists, or bootstrap tokens.

By contributing, you agree your work is licensed under Apache-2.0. See
`CODE_OF_CONDUCT.md`.
