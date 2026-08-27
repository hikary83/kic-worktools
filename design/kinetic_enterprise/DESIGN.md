---
name: Kinetic Enterprise
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#424754'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#727785'
  outline-variant: '#c2c6d6'
  surface-tint: '#005ac2'
  primary: '#0058be'
  on-primary: '#ffffff'
  primary-container: '#2170e4'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#924700'
  on-tertiary: '#ffffff'
  tertiary-container: '#b75b00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  success-emerald: '#10B981'
  warning-amber: '#F59E0B'
  border-subtle: '#E2E8F0'
  sidebar-dark: '#0F172A'
  linear-indigo: '#5E6AD2'
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

The design system is engineered for high-velocity B2B SaaS environments where focus, precision, and performance are paramount. It targets sophisticated professional users who demand a tool that feels like a high-performance instrument rather than a casual application.

The aesthetic follows a **Modern Industrial** movement—a fusion of **Minimalism** and **Glassmorphism**. It leverages expansive white space, razor-sharp micro-typography, and subtle translucent layers to create a sense of depth without visual clutter. The interface remains quiet and unobtrusive, allowing the user's data to take center stage, while utilizing vibrant accent colors to guide attention to critical actions and system statuses.

## Colors

This design system utilizes a sophisticated layering of slates and navies to establish hierarchy.

- **Primary Blue:** Used exclusively for high-priority actions, focus states, and progress indicators.
- **Surface Strategy:** The main application background uses `light slate (#F8FAFC)`, providing a soft contrast against pure white cards. The sidebar utilizes `Deep Navy (#0F172A)` to anchor the navigation and separate global controls from the workspace.
- **Semantic Colors:** Emerald and Amber are used sparingly for feedback loops, ensuring they retain their communicative power.
- **Accents:** Borrowing from high-performance heritage, a subtle indigo tint is used for hover states and secondary interactive elements to provide a rich, premium feel.

## Typography

The typography system relies on **Inter** for all UI and prose elements to ensure maximum legibility and a modern, neutral tone. **JetBrains Mono** is introduced for labels, metadata, and technical strings to evoke an "industrial-tech" aesthetic.

- **Tracking:** Headlines use tight negative tracking (-2% to -4%) to create a cohesive, editorial look. Body text remains at 0 tracking for readability.
- **Hierarchy:** Contrast is achieved through weight (SemiBold for headers) and color (Slate-900 for headings vs. Slate-500 for secondary text) rather than drastic size changes.
- **Micro-Typography:** Use uppercase Mono fonts for small labels and tags to differentiate functional metadata from narrative content.

## Layout & Spacing

The system uses an **8px grid** (with a 4px sub-grid for icons and small components). 

- **Grid Model:** A 12-column fluid grid is used for main content areas, while sidebars and inspectors remain fixed-width to preserve the "instrumental" feel of the UI.
- **Rhythm:** Generous internal padding within cards (24px) creates a spacious, premium feel, while tight spacing between related list items (4px) maintains high information density for power users.
- **Breakpoints:**
  - **Mobile:** Single column, 16px margins.
  - **Tablet:** 8-column grid, collapsed sidebar.
  - **Desktop:** 12-column grid, permanent sidebar, 32px margins.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Glassmorphism** rather than traditional heavy shadows.

- **Surface 0 (Background):** Slate-50 (#F8FAFC).
- **Surface 1 (Cards/Content):** Pure White (#FFFFFF) with a 1px Slate-200 border. No shadow or extremely subtle 2px blur.
- **Surface 2 (Floating/Modals):** Pure White with a 15% opacity backdrop blur (Glassmorphism). These elements feature a dual border: a 1px solid Slate-200 inner border and a soft 12px ambient shadow with 4% opacity.
- **Interactions:** Hover states on interactive elements should trigger a slight "lift" effect using a more pronounced, tinted shadow (using the primary blue at 5% opacity).

## Shapes

The shape language balances modern softness with professional rigidity.

- **Standard Components:** Buttons, input fields, and tags use `rounded-lg` (0.5rem) to maintain a crisp, clean appearance.
- **Containers:** Content cards and sections use `rounded-lg` (1rem) to define clear boundaries.
- **Overlays:** Modals, popovers, and large dialogs use `rounded-2xl` (1.5rem) to feel distinct from the underlying grid and more approachable.
- **Interactive States:** Clickable list items and menu options should use a subtle 4px radius on hover to indicate selection without feeling "bubbly."

## Components

- **Buttons:** Primary buttons use solid Blue-600 with white text. Secondary buttons use a transparent background with a 1px Slate-200 border. Use 12px horizontal padding for a sleek, wide look.
- **Inputs:** Minimalist design with 1px Slate-200 borders that transition to a 2px Blue-600 border on focus. Include subtle inner-shadows to provide a slight "inset" tactile feel.
- **Chips/Tags:** Use the Mono font in semi-bold. Backgrounds should be low-saturation (e.g., Slate-100) with high-contrast text.
- **Cards:** White background, 1px Slate-200 border. For "Active" cards, use a subtle 2px left-accent border in Primary Blue.
- **Glass Modals:** Apply `backdrop-filter: blur(12px)` and a white background at 80% opacity. This creates the "Vercel-style" sophisticated layering.
- **Lists:** High-density rows (40px height) with subtle dividers. Hovering a row should apply a Slate-50 background and reveal hidden "quick-action" icons.
- **Icons:** Use 20px stroke-based icons with a consistent 1.5px weight. Avoid filled icons unless indicating an active toggle state.