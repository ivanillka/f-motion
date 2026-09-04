---
name: frontend-design
description: >
  Distinctive F-Motion UI. Use when building or restyling web, marketing,
  splash, or studio surfaces, or when the user asks to improve visuals.
  Follow DESIGN.md. Do not invent a second look.
---

# Frontend design (F-Motion)

This is not a second product. `DESIGN.md` is the brief. Read it before changing
layout, type, color, motion, or copy. Public marketing must say **F-Motion**
and **f-motion.com** — never a partner brand name.

## Job

F-Motion makes vertical reels. The characteristic object is a **9:16 frame**.
The personality is cinematic, calm, precise, private. Dark-first. The
memorable marketing object is a **glass cube in space** holding the
wordmark — reuse that cube on every public splash page. Rose `#a54d67`
is the only action color. Cyan is a hairline on the cube and the hyphen,
never a fill.

## Do

- One memorable thing. Everything else stays quiet.
- Tokens and type from `DESIGN.md` (palette, 4px grid, 8px control radius,
  16px large radius, 44px targets, WCAG AA, reduced motion).
- Real product copy. Buttons name the action (`Studio`, `GitHub`).
- Verify the changed surface in a browser (desktop and a phone width).

## Do not

- Generic AI chrome: cream+serif, acid-green-on-black, identical rounded
  cards, tracked ALL-CAPS eyebrows on every heading, `01 / 02 / 03` that
  is not a sequence, gradient washes as decoration.
- A second design system, extra font families, or a marketing rewrite of
  `apps/web/public/web/` unless asked.
- Pills on every control. Pills are for chips/avatars. Primary actions are
  6–8px radius.
- Motion on every card. One short transition (~200ms). Respect
  `prefers-reduced-motion`.

## Splash

Keep the contract: the word lives in a glass cube in the sky. Same cube on
every splash page. Text links under it (Studio in rose). Stars and fog sit
in the empty left and right. Sky speed rises while the page is loading or
swapping, then eases back to slow. Freeze all of it when reduced-motion is
set. Do not add a hero essay.

## After a visual pass

Leave one small check that fails if the skill file or `DESIGN.md` pointer
disappears.
