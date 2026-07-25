# F-Motion

F-Motion is a standalone, private video-creation product for **f-motion.com**. It reuses Fotium's visual language but has separate customer accounts, database, deployment, and operational boundaries.

This repository currently contains only the architecture and frozen design contract. No application scaffold or production code may be added until Gate 0 and the web/Android Gate 1 feasibility proof are accepted. iOS and Linux remain later platform decisions.

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

Beatoven and all generated-music functionality are blocked until licensing, sublicensing, attribution, output-ownership, and data-use terms are verified in writing.

## Gate 1 — platform feasibility

Prove the smallest representative workflow on web and Android before production development: media selection/upload, durable draft save, storyboard playback, one FFmpeg-equivalent render, download, background/resume behavior, and measured device/browser limits.

