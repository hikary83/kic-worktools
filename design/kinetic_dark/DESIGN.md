---
name: Kinetic Dark
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#aec6ff'
  primary: '#aec6ff'
  on-primary: '#002e6a'
  primary-container: '#2170e4'
  on-primary-container: '#fdfbff'
  inverse-primary: '#005ac3'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#bdc2ff'
  on-tertiary: '#121f8b'
  tertiary-container: '#5f6bd3'
  on-tertiary-container: '#fffcff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#aec6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004396'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#dfe0ff'
  tertiary-fixed-dim: '#bdc2ff'
  on-tertiary-fixed: '#000965'
  on-tertiary-fixed-variant: '#2e3aa2'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
  surface-main: '#0F172A'
  surface-elevated: '#1E293B'
  text-high-contrast: '#F8FAFC'
  text-muted: '#94A3B8'
  status-emerald: '#10B981'
  status-amber: '#F59E0B'
  status-blue: '#3B82F6'
  border-subtle: '#334155'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  sidebar-width: 240px
---

## Brand & Style

This design system is a high-performance, dark-mode evolution of a professional SaaS framework. It is engineered for "Deep Work" environments—developers, analysts, and system architects—who require a UI that reduces eye strain while maintaining the precision of a high-end instrument.

The aesthetic is **Modern Industrial Minimalism** with a **Glassmorphic** finish. It moves away from the starkness of pure black, instead utilizing a "Midnight" palette of deep navies and slates. The style prioritizes technical clarity, using subtle glows and translucent overlays to create a sense of digital depth. The emotional response is one of authority, stability, and high-velocity performance.

## Colors

The color strategy transitions from light-mode slates to a layered dark-mode architecture.

- **Surface Layering:** The foundational background is `Deep Navy (#0F172A)`. Interactive containers and cards use `Slate-800 (#1E293B)`, creating a natural elevation without the need for heavy shadows.
- **Typography Contrast:** Primary content utilizes `Slate-50 (#F8FAFC)` for maximum readability against dark backgrounds. Secondary information uses `Slate-400 (#94A3B8)`.
- **Luminous Semantics:** Status colors (Emerald, Amber, Blue) are shifted to higher-vibrancy hexes. On dark surfaces, these should be paired with a 10-15% opacity background tint and a subtle outer glow (0px 0px 8px) of the same hue to simulate light-emitting diodes.
- **Accents:** Indigo is used as a "functional highlight" for active states and focus rings, providing a sophisticated bridge between the blue primary and the navy background.

## Typography

This system maintains the high-legibility **Inter** family for all core UI elements, ensuring clarity in low-light environments. 

**JetBrains Mono** is reserved for technical metadata, labels, and status tags to reinforce the "instrumental" aesthetic. In dark mode, font weights should be monitored closely; use "Medium" (500) where "Regular" (400) was used in light mode to prevent the text from appearing too thin against the dark background. 

Headlines utilize aggressive negative tracking to maintain a compact, "engraved" look. Label styles should be rendered in uppercase when used for categorization to create a clear visual distinction from narrative body text.

## Layout & Spacing

The layout follows a strict **8px rhythmic grid** with 4px alignment for micro-components.

- **Grid Model:** A 12-column fluid grid defines the workspace. Sidebars and utility panels are fixed-width (`240px` and `320px` respectively) to mimic a physical workstation layout.
- **Rhythm:** Information density is high. Use `8px` or `12px` gaps for related items in a list, but maintain `24px` padding within cards to allow the dark surfaces "room to breathe."
- **Responsiveness:** On mobile, the sidebar transitions to a bottom navigation bar or a full-screen overlay. Margins compress to `16px` to maximize screen real estate for data tables and charts.

## Elevation & Depth

In this dark-mode system, elevation is conveyed through **chromatic luminosity** and **backlight effects** rather than traditional drop shadows.

- **Base Layer (Level 0):** Pure `#0F172A`. This is the digital "void" where the UI begins.
- **Content Layer (Level 1):** `#1E293B`. Cards and panels sit here, defined by a 1px `Slate-700` border.
- **Interactive Overlay (Level 2):** Uses Glassmorphism. A background blur of `12px` combined with a `20%` white-tinted transparent fill. Borders on these elements should be slightly brighter (`Slate-600`) to simulate light catching the edge of a glass pane.
- **Glow States:** Instead of shadows, focused or active elements emit a subtle outer glow using their primary or semantic color (e.g., a Blue-500 glow at 20% opacity).

## Shapes

The geometry follows the "ROUND_EIGHT" philosophy, balancing corporate rigidity with modern friendliness.

- **Standard Elements:** Buttons, tags, and inputs use a consistent `0.5rem (8px)` radius.
- **Structural Containers:** Content cards use `1rem (16px)` to provide clear grouping of data.
- **Dynamic Overlays:** Modals and large popovers use `1.5rem (24px)` to appear as distinct, floating objects. 
- **Indicator Shapes:** Status dots and avatar containers should remain perfectly circular (`9999px`) to stand out against the predominantly rectangular grid.

## Components

- **Buttons:** Primary buttons use a high-vibrancy `Blue-600` fill. Secondary buttons are "Ghost" style—transparent with a 1px `Slate-700` border, shifting to a `Slate-800` fill on hover.
- **Input Fields:** Dark surfaces with a 1px `Slate-700` border. On focus, the border glows with the `Primary Blue` and the text caret matches this color.
- **Status Chips:** Use a subtle background (10% opacity of the status color) with a solid 2px side-accent bar and white Mono-font text.
- **Cards:** Defined by a 1px `Slate-700` border. When a card is "Selected," the border changes to `Primary Blue` with a 4px inner glow.
- **Side Navigation:** The sidebar uses a slightly darker shade than the main background to anchor the UI. Active links are indicated by a `Primary Blue` vertical pill on the left edge and a subtle text color shift to White.
- **Data Tables:** Zebra-striping is discouraged. Use horizontal `Slate-800` dividers (1px) and ensure row hover states apply a `Slate-700/50` tint for clear feedback.