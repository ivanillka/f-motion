# F-Motion Design System

## Product relationship

F-Motion is a focused, standalone creation product that reuses
Fotium's visual identity. It should feel unmistakably related to Fotium without
copying the content site's navigation or turning the workspace into a
photography feed.

The official customer-facing product name is **F-Motion** and its canonical
public domain is **f-motion.com**. Use “F-Motion” in navigation, authentication,
emails, legal copy, downloads, and store-facing artwork. Do not expand it to
“Fotium Motion” or “Fotium Reel Studio.”

The product personality is cinematic, calm, precise, private, and creative.
Prefer a restrained professional interface with occasional colorful optical
accents. Do not make it look like a generic blue SaaS dashboard, a children's
AI tool, or an Instagram clone.

## Source of truth

Use the supplied Fotium screenshots, logo, icons, and this document as the
visual source of truth.

Reference assets from the Fotium repository:

- `public/screenshot-wide.png`
- `public/screenshot-mobile.png`
- `public/favicon.svg`
- `public/icon-512.png`
- `public/reel-studio/fotium-watermark.png`
- `public/symbol-language/*.svg`

## Theme

Fotium is dark-first. Design the MVP in dark mode only.

Use this base palette:

| Role | Value | Usage |
|---|---:|---|
| Background | `#111213` | Application background |
| Surface | `#17191b` | Main panels and cards |
| Raised surface | `#202326` | Selected cards, menus, secondary panels |
| Soft surface | `#2a2d31` | Media placeholders and stronger separation |
| Border | `#35383d` | Standard dividers and input borders |
| Primary text | `#f1f2f3` | Headings and important labels |
| Muted text | `#a6adb5` | Supporting copy and metadata |
| Primary accent | `#a54d67` | Primary actions and important active states |
| Accent highlight | `#d989a0` | Eyebrows, links, and softer emphasis |
| Warning | `#ffd36b` | Warnings and unsaved states |
| Error | `#ee6f92` | Errors and destructive emphasis |
| Success | `#68d8c1` | Ready, connected, and completed states |

Fotium also has four optical accent colors:

- Cyan: `#00e5ff`
- Magenta: `#ff00cc`
- Yellow: `#ffe000`
- Green: `#00ff88`

Use these neon colors sparingly for the logo treatment, subtle active-state
edges, media-category cues, progress moments, and restrained optical effects.
Never use all four as large background fills. The muted rose remains the main
product accent.

## Background and glass

Use an almost-black background with a subtle cinematic gradient:

```css
background:
  radial-gradient(ellipse 80% 40% at 50% 0%,
    rgba(180, 40, 70, 0.18) 0%, transparent 70%),
  linear-gradient(180deg, #111213 0%, #131518 100%);
```

Floating navigation, menus, and contextual panels may use dark glass:

- Background: `rgba(25, 27, 30, 0.65)`
- Border: `rgba(255, 255, 255, 0.08)`
- Backdrop blur: `14px` to `24px`
- Shadow: `0 8px 32px rgba(0, 0, 0, 0.30)`

Glass is an accent, not the default for every card. Content-heavy panels should
use opaque surfaces for readability.

## Typography

Use a native sans-serif stack:

```css
ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Do not require a downloadable font for the MVP.

Typography character:

- Large headings are clean, light-to-regular weight, and editorial.
- Interface headings use semibold weight.
- Body copy is compact but never cramped.
- Small uppercase eyebrow labels use the rose highlight.
- Avoid excessive bold text and all-uppercase body copy.

Suggested scale:

| Style | Desktop | Mobile | Weight |
|---|---:|---:|---:|
| Display | 48–64px | 36–44px | 400–500 |
| Page title | 30–36px | 26–32px | 500–600 |
| Section title | 20–24px | 18–22px | 600 |
| Card title | 16–18px | 16–18px | 600 |
| Body | 15–16px | 15–16px | 400 |
| Supporting | 13–14px | 13–14px | 400 |
| Eyebrow/status | 12–13px | 12–13px | 600 |

Use body line-height around `1.5`; long explanatory text may use `1.6`.

## Spacing and layout

Use a 4px base grid with these common increments:

`4, 8, 12, 16, 24, 32, 48, 64`

Rules:

- Default control gaps: 8–12px
- Card padding: 16–24px
- Section spacing: 32–48px
- Desktop outer padding: 24–32px
- Mobile outer padding: 16px
- Keep readable text blocks near 60–72 characters wide
- Prefer alignment and whitespace over extra borders

## Shape, borders, and elevation

Radii:

- Small controls: `6px`
- Inputs and standard cards: `8px`
- Large cards and dialogs: `16px`
- Pills and avatars: fully rounded

Do not make every container excessively rounded. Fotium is sharper and more
editorial than typical consumer SaaS.

Use one-pixel borders. Default shadows should be subtle:

- Small: `0 1px 3px rgba(0, 0, 0, 0.18)`
- Medium: `0 4px 20px rgba(0, 0, 0, 0.28)`

## Product shell

Create a focused Motion Studio shell rather than reusing Fotium's content-site
header unchanged.

Desktop:

- Compact left navigation
- Central working area
- Contextual right panel only where needed
- Primary sections: Home, Create, Drafts, Settings
- Persistent project title and save status during creation/editing
- Do not place three permanent columns on onboarding or simple settings pages

Android:

- Bottom navigation for Home, Create, Drafts, Settings
- Full-screen working area
- Contextual controls appear in sheets or focused subpages
- Respect system status/navigation safe areas
- Avoid desktop sidebars squeezed into a narrow viewport

The Create action is visually primary and opens directly into the chat-style
brief.

## Components

### Buttons

Primary:

- Rose fill `#a54d67`
- Near-white label
- 6–8px radius
- Clear hover, pressed, focus, loading, and disabled states

Secondary:

- Dark surface
- `#35383d` border
- Primary text

Tertiary:

- Transparent background
- Muted label, becoming primary text on hover/focus

Destructive actions are never styled like the primary creation action. Label
them explicitly.

Every button needs a text label unless the icon is universally understood and
has an accessible name.

### Inputs

- Surface background `#17191b`
- Border `#35383d`
- Primary text and muted placeholder
- Label above the field
- Visible help/error text below
- Focus outline uses rose; cyan may be used only as a subtle secondary glow
- Secure fields need show/hide controls
- Never reveal an already saved provider key

### Cards and selectable options

- Standard cards use `#17191b`
- Selected cards use `#202326`
- Selected state needs more than color: border plus check/radio indicator
- Media cards may use 16:9, 9:16, or 4:3 previews as their content requires
- Avoid decorative imagery that could be mistaken for generated user content

### Status badges

Use short labels with an icon:

- Ready/Connected: success
- Action needed: warning
- Unavailable/Error: error
- Optional/Not configured: neutral

Never communicate status through color alone.

### Dialogs

- Darkened backdrop with light blur
- Maximum width around 460px for standard confirmations
- 16px radius
- Clear title, consequence, primary action, and cancel
- Destructive confirmations name the object or service affected

### Progress and save status

- Show progress as named steps when possible
- Indeterminate animation must not imply a false percentage
- Autosave status uses: Saving, Saved, Offline, or Save failed
- Never silently discard edits

## Imagery and motion

Media is the visual hero. Use dark neutral framing so photos and video remain
prominent.

Motion should be short and functional:

- Fast feedback: about `120ms`
- Normal transitions: about `200ms`
- Use gentle ease-out or spring easing
- Avoid constant neon animation
- Respect reduced-motion preferences
- Loading and generation animations must not block access to cancel or leave

## Responsive rules

Primary design targets:

- Desktop web: 1440px reference width
- Android: approximately 390×844px

Design fluidly down to 320px.

At approximately 980px:

- Collapse multi-column workspaces into one main column
- Replace persistent contextual panels with sheets/subpages
- Keep media previews within the viewport
- Move navigation to the mobile pattern

Do not merely scale desktop screens down. Reorder content by task importance.

## Accessibility

- Meet WCAG AA contrast for text and controls
- Minimum touch target: 44×44px
- Provide visible keyboard focus
- Support keyboard navigation on web
- Do not depend on hover
- Pair icons and colors with labels
- Provide alt text or descriptive labels for meaningful media
- Preserve logical heading and reading order
- Keep errors next to the affected field and summarize blocking errors
- Respect reduced motion and text scaling

## Content and tone

Write concise, direct, reassuring copy.

- Explain credentials, costs, and provider limitations plainly
- Use sentence case
- Prefer “Create video” over vague labels such as “Continue” when the action
  starts generation or incurs cost
- Never present skipped services as connected
- Never hide paid actions or automatic consequences
- Avoid exaggerated AI language, urgency, fake scarcity, and dark patterns

## F-Motion boundaries

The visual system must support these product truths:

- One selected output format at a time: YouTube, Reel/Short, or Story
- Creation begins as media drop or a guided chat; styles and plan controls stay visible below the fold
- Users choose one of three generated concepts
- The first output is a preview, not an automatically published video
- Users may edit or download after preview
- Drafts autosave and remain available for later editing
- Pexels is BYOK-only: each user connects a personal API key for stock search;
  F-Motion never supplies a platform key or silently falls back to another account.
- FAL is BYOK-only: each user connects an API-scope key, their FAL account is
  charged directly, and a missing key makes generation unavailable. F-Motion
  never supplies a platform key or silently falls back to another account.
- AI stills are an explicit per-scene fallback after own media and Pexels;
  results are reviewed and attached by the user, never auto-filled.
- AI video animates one already-approved still for one scene after quote and
  confirmation; it never replaces text-to-video or auto-fills scenes.
- Estimated cost and explicit confirmation appear before paid generation
- Music generation is unavailable until its licensing gate passes
- No direct social publishing in the MVP

These are behavior constraints, not instructions to place every capability on
every screen.

## Avoid

- Light-mode screens mixed into the dark MVP
- Bright gradients covering large surfaces
- Glass effects behind long text
- Excessive pills and oversized rounded cards
- Generic blue primary actions
- Tiny gray text
- Hover-only controls
- Dense professional multitrack-editor UI
- Fake generated media presented as a user's saved project
- Instagram visual imitation
- Provider secrets shown in full
- Fixed prices or quotas presented as permanent promises
