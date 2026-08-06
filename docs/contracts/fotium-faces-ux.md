# Fotium faces / Immich — gentle UX (host-owned)

This work lives in **Fotium**, not the F-Motion repo. Spec only until the
Fotium codebase is available in-agent.

## Problems to fix

- Face / Immich path feels like a “broken salad”: too many toggles, blocking
  checklist items, and a weak **text “Find yourself by name…”** field.
- Face labeling must never stall gallery edit after R2/Immich upload.
- Public search should not lead with a cold text box.

## Principles

1. **Gentle, optional** — faces enhance discovery; galleries work without them.
2. **Non-blocking** — upload → R2 + Immich in parallel; editor unlocks as soon
   as object URLs exist; face labels arrive when ready.
3. **Selfie-first public search** — replace the name text field as the primary
   control.
4. **Admin labels stay visual** — pick faces from Immich thumbnails, not typing
   Immich IDs into a search box.

## Public gallery: remake face search

**Remove as primary:** single-line `Find yourself by name…` input.

**Replace with:**

1. Primary: **“Find your photos”** control → opens a calm sheet:
   - Large **Use selfie** action (camera / upload). One clear face, then match.
   - Secondary: **Browse people** — horizontal chips/avatars of
     photographer-labeled people in *this* gallery only (tap chip → results).
2. Name filter becomes a **small “Filter people”** inside the chip row only
   when there are many labels — never the hero field.
3. Keep the existing consent / disclaimer copy near results, not in the hero.

Empty / error states stay plain language (no face detected, no match, try
another selfie).

## Admin / Immich: gentle apply

- Default **Face search** off until consent + at least one labeled person.
- “Apply labels” is one explicit action with undo; no silent mass-write.
- Sync from Immich is background with a quiet status line (“Faces updating…”)
  — never a modal wall.
- Checklist item “Face search reviewed” only if the gallery has detections;
  otherwise omit (don’t block publish).

## Handoff to F-Motion

Face data does **not** need to enter F-Motion. Import sends chosen `media_urls`
(+ brief). Publishing reels/stories stays in Fotium after webhook/SSE.
