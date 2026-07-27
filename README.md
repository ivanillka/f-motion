# F-Motion

F-Motion is a split-client vertical-video editor for **f-motion.com**: React on
the web, Flutter on Android, and one authoritative Express/worker API. It reuses
Fotium's visual language with separate accounts, database, and deployment.

**Status:** Gate 1 feasibility is accepted (Flutter Android + React web). Gate 2
vertical slice is in progress on this branch. Gate 0 launch-policy evidence is
still open before public/paid launch. iOS and Linux remain later decisions.

## Source-of-truth order

1. `docs/architecture/f-motion.drawio`
2. `docs/design/ACCEPTANCE.md`
3. `DESIGN.md`
4. Stitch screenshots
5. Stitch-generated HTML (reference only; never production code)

## Gate 0 — launch-policy evidence

- [ ] Written FAL output ownership, training/data-use, retention, and commercial-use terms
- [ ] Pexels API use, attribution, caching, and media-license requirements
- [ ] Payment processor, tax/VAT, refunds, chargebacks, receipts, and credit-expiry policy
- [ ] Privacy notice, consent, data retention, subprocessors, and deletion/recovery schedule
- [ ] Copyright reporting and takedown workflow
- [ ] Google Play and future Apple App Store rules for digital credits and external payments
- [ ] `f-motion.com` trademark, product-name, and brand clearance
- [ ] Security review for encrypted provider credentials, uploads, sessions, and export URLs

Beatoven and all generated-music functionality are blocked until licensing,
sublicensing, attribution, output-ownership, and data-use terms are verified in
writing.

## Demo today

```sh
npm ci
npm run demo
```

Then open `http://127.0.0.1:4173` and click **Email me a magic link** (local
test identity when Supabase env vars are unset). Flow: brief → three concepts →
storyboard → accurate 720p preview → download. See
`docs/runbooks/local-development.md` for the durable Postgres/MinIO stack.

## Supported toolchain

- Node 24.15.0 and npm 11.12.1
- Flutter 3.44.8, framework revision `058e0af2c2`, Dart 3.12.2
- Android command-line tools 19.0, Android platform/build-tools 36.0.0,
  platform-tools 36.0.2, NDK 28.2.13676358
- FFmpeg 8.1.2

Run Node gates with `npm ci`, `npm run lint`, `npm test`, `npm run build`, and
`npm run test:e2e:web`. Run Android gates from the repository root with:

```sh
FLUTTER_BIN=/absolute/path/to/flutter apps/mobile/tool/flutter_from_root.sh analyze
FLUTTER_BIN=/absolute/path/to/flutter apps/mobile/tool/flutter_from_root.sh test
FLUTTER_BIN=/absolute/path/to/flutter apps/mobile/tool/flutter_from_root.sh build-apk
```

The PWA is online-only. A local draft survives reconnection, but editing,
rendering, and downloads require the API.
