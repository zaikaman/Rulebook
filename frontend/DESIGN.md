---
name: Rulebook
description: Clear, precise dark interfaces with atmospheric photography on the landing page.
colors:
  primary: 'oklch(0.789 0.108 248)'
  primary-ink: 'oklch(0.204 0.044 254)'
  primary-hover: 'oklch(0.845 0.085 248)'
  primary-tint: 'oklch(0.279 0.05 249)'
  automation: 'oklch(0.835 0.083 290)'
  automation-tint: 'oklch(0.259 0.047 290)'
  automation-line: 'oklch(0.436 0.069 290)'
  funds: 'oklch(0.817 0.106 175)'
  funds-tint: 'oklch(0.255 0.038 175)'
  funds-line: 'oklch(0.437 0.061 175)'
  status-active: 'oklch(0.812 0.113 151)'
  status-active-line: 'oklch(0.415 0.057 151)'
  status-active-tint: 'oklch(0.231 0.034 151)'
  status-paused: 'oklch(0.831 0.113 79)'
  status-paused-line: 'oklch(0.45 0.069 78)'
  status-paused-tint: 'oklch(0.237 0.036 78)'
  status-cancelled: 'oklch(0.713 0.025 252)'
  status-latched: 'oklch(0.794 0.099 230)'
  danger: 'oklch(0.784 0.115 20)'
  danger-line: 'oklch(0.437 0.072 20)'
  danger-tint: 'oklch(0.221 0.029 20)'
  danger-ink: 'oklch(0.196 0.032 20)'
  canvas: 'oklch(0.152 0.008 252)'
  workspace-frame: '#070707'
  surface: 'oklch(0.174 0.009 252)'
  surface-raised: 'oklch(0.212 0.011 252)'
  surface-inset: 'oklch(0.192 0.01 252)'
  surface-sunken: 'oklch(0.163 0.01 252)'
  control: 'oklch(0.246 0.013 252)'
  border: 'oklch(0.292 0.014 252)'
  border-strong: 'oklch(0.368 0.018 252)'
  control-border: 'oklch(0.368 0.02 252)'
  ink: 'oklch(0.968 0.006 252)'
  ink-muted: 'oklch(0.748 0.016 252)'
  ink-faint: 'oklch(0.608 0.016 252)'
  accent-hover: 'oklch(0.845 0.085 248)'
  accent-line: 'oklch(0.44 0.072 249)'
  accent-soft: 'oklch(0.27 0.05 249 / 34%)'
  accent-active: 'oklch(0.732 0.112 248)'
  highlight: 'oklch(1 0 0 / 24%)'
  highlight-soft: 'oklch(1 0 0 / 5%)'
  rim: 'oklch(0.97 0.009 252 / 18%)'
  scrim: 'oklch(0.075 0.01 252 / 72%)'
  shadow-deep: 'oklch(0.04 0.01 252 / 58%)'
  shadow-inset: 'oklch(0.05 0.01 252 / 40%)'
  shadow-workspace: 'oklch(0.115 0.013 252 / 68%)'
  landing-canvas: '#020202'
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
  preset-chip:
    backgroundColor: '{colors.control}'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.preset}'
    padding: '0.1875rem 0.25rem'
    height: '1.75rem'
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
    backgroundColor: '{colors.primary-tint}'
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
Colors: primary: primary oklch(0.789 0.108 248); secondary: automation oklch(0.835 0.083 290); tertiary: funds oklch(0.817 0.106 175); neutral: surface oklch(0.174 0.009 252) (+27 more in the sidecar)
Fonts: Manrope Variable (display, workspace-headline, panel-title, sentence); Geist Variable (body, landing-lede, label); Geist Mono Variable (transaction-metadata)
Spacing: control-gap 0.5rem, panel-inset 1.125rem, section-gap 1.25rem, panel-inset-wide 1.5rem, workspace-gutter 2rem, landing-section-y 5rem
Radius: tag 0.375rem, preset 0.4375rem, field 0.5625rem, button 0.5625rem, nav-item 0.5625rem, panel 0.875rem, landing-card 1.5rem, shell-compact 28px, shell-wide 40px, network-pill 999px (+1 more in the frontmatter)
North Star: "Clear and precise"
Don't:

- No active green on fired, paused, cancelled, or unfunded rules.
- No landing photo treatments, glass blur, gradients, or glow in workspace panels.
- No raw palette values outside tokens.css (except documented landing files).
- No new `rb-*` classes in feature files; compose `src/ui` and avoid new baseline entries.
  Do:
- Keep network names and status labels beside their colors.
- Show empty, filled, focus, and invalid sentence-slot states.
- Use bordered tonal panels, raised active rail items, and overlay-only shadows.
- Group nav by Automation, Discover, and Manage; one primary action per heading.
- Keep transaction identifiers readable at narrow widths.
  Map: src/ui
  Map: src/ui/FilterGroup.tsx
  Map: src/styles/tokens.css
  Map: src/styles/assistant.css
  Full: .impeccable/design-full.md (read a section when you need its detail)
