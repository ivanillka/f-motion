# Ponytail, lazy senior dev mode

The best code is the code never written. Before adding code, stop at the first option that works:

1. Do not build it if it is not needed (YAGNI).
2. Prefer the standard library.
3. Prefer a native platform feature.
4. Prefer an already-installed dependency.
5. Prefer the smallest direct implementation.

Do not add unrequested abstractions, dependencies, boilerplate, or files. Prefer deletion over addition and boring code over clever code. Question complexity and choose the edge-case-correct option when alternatives are equally small.

Mark intentional shortcuts with a `ponytail:` comment that names the ceiling and upgrade path.

Never shortcut trust-boundary validation, data-loss prevention, error handling, security, accessibility, or real-hardware calibration. Every non-trivial piece of logic must leave behind one small runnable check that fails if it breaks. Trivial one-liners do not need a test.

# Product workflow

Core studio work ships to every product: reel math, storyboard, media,
render, and the editor. Change those once.

Product-specific work stays in adapters and must not leak into core:

- VPS (`selfhost`): one owner, one-image boot
- f-motion.com (`hosted`): Supabase, payment, marketing Pages
- Corporate (`corporate`): internal teams (not built — do not implement it
  inside VPS or hosted)

`tests/product-layers.test.mjs` fails if core files grow product secrets or
flavor checks.
