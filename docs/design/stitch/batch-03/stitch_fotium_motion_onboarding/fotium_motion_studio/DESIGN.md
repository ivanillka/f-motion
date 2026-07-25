---
name: Fotium Motion Studio
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#dcb8ff'
  on-secondary: '#480081'
  secondary-container: '#7701d0'
  on-secondary-container: '#dcb7ff'
  tertiary: '#fff3f4'
  on-tertiary: '#66002c'
  tertiary-container: '#ffccd6'
  on-tertiary-container: '#bb0058'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#efdbff'
  secondary-fixed-dim: '#dcb8ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6700b5'
  tertiary-fixed: '#ffd9e0'
  tertiary-fixed-dim: '#ffb1c3'
  on-tertiary-fixed: '#3f0019'
  on-tertiary-fixed-variant: '#8f0041'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
  headline-md-mobile:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-desktop: 24px
  margin-mobile: 16px
  panel-padding: 12px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system is engineered for **Fotium Motion**, a high-performance AI video creation environment. The brand personality is "The Invisible Assistant"—powerful, precise, and unobtrusive, allowing the user's creative content to remain the focal point.

The aesthetic follows a **Modern Corporate/Studio** direction with a heavy emphasis on **Dark-First Minimalism**. It prioritizes workspace utility over decorative flair. The interface utilizes deep charcoal surfaces to reduce eye strain during long editing sessions, accented by high-contrast functional elements that guide the user through the AI-assisted workflow. The goal is to evoke a sense of professional mastery and technological sophistication.

## Colors

The palette is rooted in a "Deep Space" dark mode. 
- **Primary (#00F0FF):** A "Electric Cyan" used exclusively for active states, primary actions, and AI-processing indicators.
- **Secondary/Tertiary:** Subdued violets and pinks are reserved for timeline categorization (e.g., audio tracks vs. visual effects).
- **Neutrals:** The core of the UI. `#0A0A0A` serves as the canvas, while `#1E1E1E` and `#2A2A2A` define the structural panels of the studio.
- **Functional Colors:** Success, Warning, and Error states follow standard conventions but are desaturated to maintain the studio's professional atmosphere.

## Typography

This design system employs a tri-font strategy to balance character with utility:
1.  **Geist (Headlines):** Used for structural headers and primary navigation. Its technical, minimal nature reinforces the "Studio" aesthetic.
2.  **Inter (Body):** The workhorse for all instructional text, tooltips, and property panels. It ensures maximum legibility at small sizes.
3.  **JetBrains Mono (Labels/Metadata):** Used for timecodes, frame rates, file sizes, and AI prompt inputs. The monospaced nature emphasizes precision and the "data-driven" aspect of AI video creation.

**Scale:** Desktop uses a tighter scale to maximize screen real estate for the timeline. Mobile variants reduce headline sizes and increase line heights for touch targets.

## Layout & Spacing

The layout utilizes a **Fixed Sidebar/Fluid Canvas** model. 
- **Desktop:** A 12-column grid is used only for the initial dashboard. The Studio view itself is modular, with a left-hand "Asset Library" (280px), a right-hand "Properties Panel" (320px), and a bottom "Timeline" (variable height). 
- **Mobile (Android):** Shifts to a vertical stack. The Timeline is pinned to the bottom 30% of the screen, while assets are managed via bottom-sheet overlays to preserve the preview window.
- **Rhythm:** An 8px base unit (4px for micro-adjustments) ensures all panels and controls align perfectly, creating a dense but organized "pro tool" feel.

## Elevation & Depth

In a dark-first environment, depth is communicated through **Tonal Layering** rather than traditional shadows.
- **Level 0 (Canvas):** `#0A0A0A` - The base layer for the video preview and background.
- **Level 1 (Panels):** `#1E1E1E` - The containers for the timeline, library, and settings.
- **Level 2 (Modals/Popovers):** `#2A2A2A` - Used for AI prompt windows or context menus. These use a **1px Low-Contrast Outline** (`#FFFFFF10`) to separate them from the background.
- **Active State:** Elements being dragged or high-priority AI alerts use a subtle **Cyan Glow** (Primary color at 10% opacity) instead of a black shadow.

## Shapes

The design system utilizes a **Soft (0.25rem)** roundedness approach. 
- **Standard Controls:** Buttons, inputs, and track segments use 4px (`rounded`) corners to maintain a professional, architectural feel.
- **Large Containers:** Cards in the onboarding flow or video project thumbnails use 8px (`rounded-lg`) to feel slightly more approachable.
- **Icons:** Should be encased in square or slightly rounded frames, never circles, to align with the technical grid.

## Components

### Buttons
- **Primary:** Solid Cyan (`#00F0FF`) with Black text. Used for "Export" or "Generate."
- **Secondary:** Ghost style with a 1px Grey border (`#FFFFFF20`). White text.
- **Ghost:** No border, Cyan text. Used for secondary actions in the timeline.

### AI Input Fields
- Darker than the surface (`#121212`) with a focus state that adds a Cyan bottom-border. Labels use **JetBrains Mono** to signal "Instructional" input.

### Timeline Segments
- Rectangular blocks with subtle gradients. Each block type (Video, Audio, AI Effect) is color-coded using the secondary and tertiary palettes at low saturation.

### Chips/Tags
- Used for AI metadata (e.g., "4K", "Upscaled", "Motion-Synced"). These are small, uppercase JetBrains Mono text inside a `#2A2A2A` background with a 2px radius.

### Cards (Project Selection)
- Minimalist. 16:9 aspect ratio thumbnails with a progress bar overlay for rendering states. Text is bottom-aligned with a subtle scrim for legibility.

### Android Specifics
- Bottom navigation for Mobile follows Material 3 logic but uses the design system's dark-first tokens. Use "Squircle" shapes for floating action buttons (FABs) to trigger AI generation.