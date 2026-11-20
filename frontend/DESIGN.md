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
  canvas: 'oklch(0.152 0.008 252)'
  surface: 'oklch(0.174 0.009 252)'
  surface-raised: 'oklch(0.212 0.011 252)'
  surface-inset: 'oklch(0.192 0.01 252)'
  control: 'oklch(0.246 0.013 252)'
  border: 'oklch(0.292 0.014 252)'
  border-strong: 'oklch(0.368 0.018 252)'
  control-border: 'oklch(0.368 0.02 252)'
  ink: 'oklch(0.968 0.006 252)'
  ink-muted: 'oklch(0.748 0.016 252)'
  ink-faint: 'oklch(0.608 0.016 252)'
  accent-hover: 'oklch(0.845 0.085 248)'
  accent-line: 'oklch(0.44 0.072 249)'
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
  field: '0.5625rem'
  button: '0.5625rem'
  nav-item: '0.5625rem'
  panel: '0.875rem'
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

<!-- impeccable:design-map -->

Name: Rulebook
Colors: primary: primary oklch(0.789 0.108 248); secondary: automation oklch(0.835 0.083 290); tertiary: funds oklch(0.817 0.106 175); neutral: surface oklch(0.135 0.006 252) (+29 more in the sidecar)
Fonts: Manrope Variable (display, workspace-headline, panel-title, sentence); Geist Variable (body, landing-lede, label); Geist Mono Variable (transaction-metadata)
Spacing: control-gap 0.5rem, panel-inset 1.125rem, section-gap 1.25rem, panel-inset-wide 1.5rem, workspace-gutter 2rem, landing-section-y 5rem
Radius: tag 0.375rem, preset 0.4375rem, field 0.5rem, button 0.625rem, nav-item 0.75rem, panel 1rem, landing-card 1.5rem, shell-compact 28px, shell-wide 40px, network-pill 999px, landing-pill 9999px
North Star: "Clear and precise"
Don't:

- Don't reuse the active green for fired, paused, cancelled, or unfunded rules.
- Don't carry landing-page photo treatments into transaction and account panels.
  Do:
- Do keep network names and status labels beside their colors.
- Do show the empty, filled, focus, and invalid states of sentence slots.
- Do use bordered, tonal workspace panels and reserve pronounced content shadows for wallet overlays.
- Do group rail navigation by Automation, Discover, and Manage; keep the active item on a raised surface with an accent edge.
- Do give every page a single clear primary action in its heading.
- Do keep transaction identifiers readable at narrow widths.
  Map: src/styles/tokens.css
  Map: src/styles/theme.css
  Map: src/components/landing/background-effects.tsx
  Full: .impeccable/design-full.md (read a section when you need its detail)
