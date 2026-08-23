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

## Rules

- Keep changes narrow. Match existing naming, error handling, and tests.
- Every non-trivial behavior needs one small runnable check that fails if it
  breaks.
- Do not add shared provider keys. Pexels and FAL stay owner-scoped or optional.
- Do not invent prices, credit packs, MCP product APIs, or NLE/multitrack UI.
- Hosted (`FENGINE_ENV=hosted`) must keep `FENGINE_LOCAL_AUTH` unset.
- Self-host (`FENGINE_ENV=selfhost`) uses a single owner account created on
  first open, not local demo auth and not a bootstrap token.

By contributing, you agree your work is licensed under Apache-2.0. See
`CODE_OF_CONDUCT.md`.
