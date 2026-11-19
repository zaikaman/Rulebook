---
name: Rulebook
description: Clear, precise dark interfaces with atmospheric photography on the landing page.
colors:
  primary: 'oklch(0.789 0.108 248)'
  primary-ink: 'oklch(0.204 0.044 254)'
  primary-hover: 'oklch(0.841 0.086 248)'
  primary-tint: 'oklch(0.286 0.054 249)'
  automation: 'oklch(0.835 0.083 290)'
  automation-tint: 'oklch(0.259 0.047 290)'
  automation-line: 'oklch(0.436 0.069 290)'
  funds: 'oklch(0.817 0.106 175)'
  funds-tint: 'oklch(0.255 0.038 175)'
  funds-line: 'oklch(0.437 0.061 175)'
  status-active: 'oklch(0.812 0.113 151)'
  status-paused: 'oklch(0.831 0.113 79)'
  status-cancelled: 'oklch(0.713 0.025 252)'
  status-latched: 'oklch(0.794 0.099 230)'
  danger: 'oklch(0.784 0.115 20)'
  surface: 'oklch(0.135 0.006 252)'
  surface-raised: 'oklch(0.189 0.01 252)'
  surface-inset: 'oklch(0.218 0.016 252)'
  control: 'oklch(0.242 0.015 252)'
  border: 'oklch(0.31 0.017 252)'
  control-border: 'oklch(0.42 0.028 252)'
  ink: 'oklch(0.957 0.009 252)'
  ink-muted: 'oklch(0.739 0.021 252)'
  slot-open: 'oklch(0.255 0.028 249)'
  slot-open-line: 'oklch(0.494 0.065 249)'
  landing-canvas: '#020202'
  workspace-frame: '#070707'
  landing-ink: '#ffffff'
  landing-copy: '#d4d4d4'
  landing-action-hover: '#e5e5e5'
  landing-action-ink: '#000000'
  landing-blue: '#3b82f6'
  landing-violet: '#7c5cff'
typography:
  display:
    fontFamily: '"Manrope Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '3.5rem'
    fontWeight: 500
    lineHeight: 1
    letterSpacing: '-0.025em'
  workspace-headline:
    fontFamily: '"Manrope Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '2.625rem'
    fontWeight: 730
    lineHeight: 1.1
    letterSpacing: '-0.052em'
  panel-title:
    fontFamily: '"Manrope Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '-0.022em'
  sentence:
    fontFamily: '"Manrope Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.5625rem'
    fontWeight: 600
    lineHeight: 2.2
    letterSpacing: '-0.028em'
  body:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.55
  landing-lede:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 300
    lineHeight: '1.75rem'
    letterSpacing: '-0.025em'
  label:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: '0.075em'
  transaction-metadata:
    fontFamily: '"Geist Mono Variable", ui-monospace, SFMono-Regular, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: '1rem'
rounded:
  tag: '0.375rem'
  preset: '0.4375rem'
  field: '0.5rem'
  button: '0.625rem'
  nav-item: '0.75rem'
  panel: '1rem'
  landing-card: '1.5rem'
  shell-compact: '28px'
  shell-wide: '40px'
  network-pill: '999px'
  landing-pill: '9999px'
spacing:
  control-gap: '0.5rem'
  panel-inset: '1.125rem'
  section-gap: '1.25rem'
  panel-inset-wide: '1.5rem'
  workspace-gutter: '2rem'
  landing-section-y: '5rem'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-ink}'
    rounded: '{rounded.button}'
    padding: '0.4375rem 0.875rem'
    height: '2.75rem'
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-secondary:
    backgroundColor: '{colors.control}'
    textColor: '{colors.ink}'
    rounded: '{rounded.button}'
    padding: '0.4375rem 0.875rem'
    height: '2.5rem'
  button-danger:
    backgroundColor: '{colors.control}'
    textColor: '{colors.danger}'
    rounded: '{rounded.button}'
    padding: '0.4375rem 0.875rem'
    height: '2.5rem'
  landing-cta:
    backgroundColor: '{colors.landing-ink}'
    textColor: '{colors.landing-action-ink}'
    rounded: '{rounded.landing-pill}'
    padding: '0.75rem 2rem'
  input:
    backgroundColor: '{colors.control}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: '0.5rem 0.75rem'
    height: '2.625rem'
  panel:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '{spacing.panel-inset}'
  workspace-nav-active:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.nav-item}'
    padding: '0.5rem 0.75rem'
  network-badge-automation:
    backgroundColor: '{colors.automation-tint}'
    textColor: '{colors.automation}'
    rounded: '{rounded.network-pill}'
    padding: '0.125rem 0.5rem'
  network-badge-funds:
    backgroundColor: '{colors.funds-tint}'
    textColor: '{colors.funds}'
    rounded: '{rounded.network-pill}'
    padding: '0.125rem 0.5rem'
  status-active:
    textColor: '{colors.status-active}'
    rounded: '{rounded.tag}'
    padding: '0.15rem 0.5rem'
  sentence-slot-empty:
    backgroundColor: '{colors.slot-open}'
    textColor: '{colors.primary}'
    rounded: '{rounded.field}'
    padding: '0.4375rem 1.875rem 0.4375rem 0.6875rem'
    height: '2.5rem'
  sentence-slot-filled:
    backgroundColor: '{colors.primary-tint}'
    textColor: '{colors.ink}'
---

# Design System: Rulebook

## Overview

**Creative North Star: "Clear and precise"**

The workspace uses layered panels, compact controls, and lift for overlays. Clear labels, subdued dividers, and distinct network colors help users scan a rule, confirm the network, and follow a transaction.

The landing page uses the same type families and dark ground, with atmospheric photography, a fine grid, and blue-violet light behind the content. Product imagery shows the rule sentence and execution details in context.

**Key Characteristics:**

- Near-black framing, cool charcoal panels, and crisp light text.
- Compact, bordered controls with clear focus and selection states.
- Automation lavender and funds mint, always paired with network names.
- Low-light device photography and light action pills on the landing page.

## Colors

- **Primary blue** marks workspace actions, links, keyboard focus, and progress. Raised controls use the primary tint on hover or selection. The solid primary pairs with dark ink.
- **Automation lavender** identifies Reactive Lasna in network badges, wallet indicators, and proof rows. **Funds mint** identifies Unichain Sepolia in the same patterns. Each badge pairs its foreground with a matching tint and border.
- **Rule states** use green for active, amber for paused, grey for cancelled, light blue for fired and awaiting reset, and coral for silence caused by missing execution credit. Coral also marks invalid inputs and destructive action text.
- **Neutrals** progress from the near-black outer canvas and workspace frame to raised panels, inset regions, and controls. Standard dividers use the panel border. Form boundaries use the stronger control border.
- **Landing colors** use white for headlines and primary action pills, neutral grey for supporting copy, and blue and violet for the wordmark and background effects. The landing CTA uses black text on white.

The workspace colors, landing theme, and background effects are defined in the frontend. [Workspace tokens](../src/styles/tokens.css), [landing theme](../src/styles/theme.css), [background effects](../src/components/landing/background-effects.tsx)

## Typography

- **Manrope Variable** carries headings and the editable sentence. The landing hero is medium weight (500) and steps from 36px to 48px and 56px. Workspace page titles use weight 730 at 34px and 42px. Panel headings are 17px at weight 700.
- **Geist Variable** carries body copy, labels, buttons, and navigation. Workspace explanatory copy generally uses 14px at 1.55 line height. The landing lede reaches 18px at weight 300 on desktop. Small 12px tracked uppercase labels mark sections such as the editable sentence.
- **Geist Mono Variable** marks addresses, receipt hashes, timestamps, blocks, calldata, and balance amounts. Use tabular numerals in numeric table columns. Let long identifiers wrap on narrow screens.

## Layout

- The landing page uses a centered content rail (72rem) with 24px horizontal gutters and 80px vertical spacing in its recurring sections. Headings and supporting copy sit side by side at large widths and stack on smaller screens. Step cards form two columns from 48rem. The fixed header keeps the wordmark and workspace action visible at narrow widths and shows section links from 48rem.
- The workspace frame caps at 1500px. From 1024px, it uses a 288px sidebar and an independently scrolling main column with 32px side gutters. Below that, a sticky mobile header places the wallet next to the wordmark, with a horizontally scrollable route strip beneath. Main content caps at 70rem and uses 20px side gutters on mobile.
- Panels commonly use 18px padding and a 20px page gap. Wide workspace panels reach 24px padding at 70rem. The composer stacks the editor above the review at narrow widths and gives the editor the wider column from 70rem. Proof rows stay in a single vertical sequence and wrap their transaction hashes.

## Elevation & Depth

Tonal fills and one-pixel rules provide most of the workspace hierarchy. The sentence editor uses an inset strip within its panel, tables use a tinted header, and proof steps share one panel with a thin vertical connector. Wallet overlays carry structural lift. The workspace frame and the translucent landing navigation use broader, softer depth.

The wallet popover uses a shadow of `0 0.875rem 2.5rem oklch(0.115 0.013 252 / 68%)`. The review dialog adds a dark backdrop. On the landing page, masked photographs and blue-violet radial effects fade into the near-black background.

## Shapes

Workspace panels use a 16px radius. Buttons use 10px, fields 8px, and small status tags 6px. Network badges use a full pill so they remain distinguishable from status tags at a glance. The workspace frame rounds to 28px on smaller screens and 40px from the desktop sidebar breakpoint. Landing navigation and primary actions use full pills, while photo cards use 24px corners.

## Components

### Actions and fields

Use the blue primary for the principal workspace action and the bordered charcoal secondary for adjacent utility actions. Destructive actions retain the secondary shape and use coral text. Workspace buttons have a 40px secondary or 44px primary minimum height. Inputs are 42px tall with clear borders, visible labels, and a coral border when invalid.

Workspace actions and the wallet trigger transition fill and border over 160ms with ease-out, and keyboard focus uses a 2px blue outline with a 2px offset. Primary, secondary, and disabled states stay distinct. Landing action pills use white fill with a neutral-grey hover and a small arrow movement. The landing entrance and workspace control transitions respect reduced motion.

### Navigation and wallet

Desktop links combine a 16px line icon with a 14px label. The current section gets a raised fill, a thin border, and a blue icon. The active mobile route uses the blue selection tint and scrolls into view. The wallet trigger keeps its connection state visible and opens a compact menu with network labels. The review dialog puts the network badge and action above the target and amount.

### Sentence composer

The sentence remains readable while a user fills its slots. An empty slot has a dashed blue-grey border and blue text. A filled slot uses a solid border, a blue tint, and light text. A drop target gains a blue outline, and invalid slots have coral borders and nearby error copy. Draggable preset buttons wrap below the sentence. Each slot offers the same values in a native select. The review panel uses a segmented progress bar and a collapsible monospace calldata block.

### Execution proof and status

Each proof step combines a line icon, role label, named network badge, small monospace metadata, and a wrapping explorer link. A summary panel shows the proof source and, when available, the elapsed time. Status tags use a leading dot and a plain text label such as “Paused” or “Silent — no execution credit.”

## Do's and Don'ts

- Do keep network names and status labels beside their colors.
- Do show the empty, filled, focus, and invalid states of sentence slots.
- Do use bordered, tonal workspace panels and reserve pronounced content shadows for wallet overlays.
- Do keep transaction identifiers readable at narrow widths.
- Don't reuse the active green for fired, paused, cancelled, or unfunded rules.
- Don't carry landing-page photo treatments into transaction and account panels.
