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
Colors: primary: primary oklch(0.789 0.108 248); secondary: automation oklch(0.835 0.083 290); tertiary: funds oklch(0.817 0.106 175); neutral: surface oklch(0.174 0.009 252) (+48 more in the sidecar)
Fonts: Manrope Variable (display, workspace-headline, panel-title, sentence); Geist Variable (body, landing-lede, label); Geist Mono Variable (transaction-metadata)
Spacing: control-gap 0.5rem, panel-inset 1.125rem, section-gap 1.25rem, panel-inset-wide 1.5rem, workspace-gutter 2rem, landing-section-y 5rem
Radius: tag 0.375rem, preset 0.4375rem, field 0.5625rem, button 0.5625rem, nav-item 0.5625rem, panel 0.875rem, landing-card 1.5rem, shell-compact 28px, shell-wide 40px, network-pill 999px, landing-pill 9999px
North Star: "Clear and precise"
Don't:

- Don't reuse the active green for fired, paused, cancelled, or unfunded rules.
- Don't carry landing-page photo treatments into transaction and account panels.
- Don't write raw palette values in TSX or shared CSS.
- Don't add a one-off `rb-*` recipe in a feature file.
  Do:
- Do keep network names and status labels beside their colors.
- Do show the empty, filled, focus, and invalid states of sentence slots.
- Do use bordered, tonal workspace panels and reserve pronounced content shadows for wallet overlays.
- Do group rail navigation by Automation, Discover, and Manage; keep the active item on a raised surface with an accent edge.
- Do give every page a single clear primary action in its heading.
- Do keep transaction identifiers readable at narrow widths.
- Do compose new surfaces from `src/ui`.
  Map: src/styles/tokens.css
  Map: src/styles/app.css
  Map: src/styles/workspace.css
  Map: src/styles/onboarding.css
  Map: src/ui/index.ts
  Map: src/ui/Select.tsx
  Map: src/ui/ErrorState.tsx
  Map: src/assistant/AssistantPanel.tsx
  Map: src/assistant/AssistantContext.tsx
  Map: src/styles/assistant.css
  Map: src/ui/SyncState.tsx
  Map: src/ui/Dialog.tsx
  Map: src/ui/EmptyState.tsx
  Map: src/ui/FactList.tsx
  Map: src/ui/Callout.tsx
  Full: .impeccable/design-full.md (read a section when you need its detail)

## Overview

Rulebook is an Operate surface: users build, fund, publish, and inspect on-chain automations. The visual system is a dark, precise workspace with a cool neutral ladder, one blue action color, and separate network colors for Reactive Lasna and Unichain Sepolia. Brand expression lives in craft details, not decoration. The landing page is the only Persuade surface and keeps its own photographic world; workspace rules stop at its boundary.

The system is enforced, not advisory. `src/styles/tokens.css` owns values, `src/ui` owns markup recipes, and `npm run check:design` fails CI when either is bypassed. `AGENTS.md` points every agent at this file before UI work.

## Colors

The surface ladder is canvas, surface, raised, inset, control. Use the lowest surface that carries the content, then raise only the active or overlay layer. Borders are one step above their surface; never use pure black or pure white in workspace UI.

- Primary blue is the single action color. It marks the primary button, focus ring, active rail edge, and current step. Do not use it for status.
- Automation violet belongs to Reactive Lasna. Funds teal belongs to Unichain Sepolia. Every network badge reads these tokens and keeps the network name visible.
- Status colors are semantic and cannot be reassigned. Active, paused, cancelled, latched, and silent are distinct. A silent or waiting rule never borrows active green.
- Danger red is reserved for failures, destructive actions, and invalid fields. Use `btn-danger` for a destructive button and `rb-error` for a failed read.
- Depth colors (`highlight`, `rim`, `scrim`, `shadow-*`) are tokens because overlays repeat them. A new shadow is a token change, not a local literal.
- The landing page keeps its own hex palette (`landing-*`). Do not import landing colors into workspace components.

## Typography

Manrope Variable carries display, workspace headlines, panel titles, and sentence text. Geist Variable carries body copy, labels, inputs, and buttons. Geist Mono Variable carries addresses, transaction hashes, amounts, and technical identifiers.

- One page has one `h1` in the heading area. Panels use `h2`; nested sections use `h3`.
- Labels are short, sentence case, and never all-caps except the existing metric and eyebrow labels.
- Numeric values use tabular mono only when they are identifiers or balances. Do not set prose in mono.
- Body copy stays at 0.8125rem to 0.875rem in the workspace. Do not scale body text up to fill space.

## Layout

- The shell is a 17rem rail plus a fluid main column. The workspace gutter is 2rem at desktop and 1rem at narrow widths.
- Page headings put one primary action in the aside. Secondary actions are quiet buttons or links in the content.
- Panels use an 0.875rem radius, a 1px border, and the raised surface. Panel headers and bodies use the shared padding rhythm; do not invent a second panel anatomy.
- Split views become one column below 64rem. Any horizontal scroller must have a visible edge or trailing padding so the last item is not clipped.
- Onboarding uses a five-step rail and a two-column stage above 64rem. The setup summary is hidden for funding-only screens.
- Touch targets are at least 2.375rem tall. The mobile tab bar centers the active tab and leaves trailing room for the last tab.

## Elevation & Depth

Workspace depth is tonal first, bordered second, shadowed last. Panels do not float. Reserve pronounced shadows for modal dialogs and wallet overlays.

- Wallet dialogs use the scrim, deep shadow, and a 0.875rem panel radius.
- Inset surfaces use the inset shadow token, never a hand-written black alpha.
- Focus is a 2px accent outline with 2px offset. Hover raises a border one step; it does not move or scale the element.
- Do not add glass blur, gradients, or glow to workspace cards. Those belong to the landing page.

## Shapes

The workspace uses restrained rounded rectangles: 0.375rem tags, 0.5625rem fields and buttons, 0.875rem panels, and pills only for network or filter chips. Icons are line icons from Hugeicons at 15 to 22px with 1.7 to 1.8 stroke.

- Buttons and inputs share the field radius. Do not mix pill buttons into forms.
- Status and network chips are pills. Tags for categories are rounded rectangles.
- Progress rails use 2px lines and small filled dots. Do not use large illustration-style steppers.

## Components

New feature code imports from `frontend/src/ui`. A feature file may keep layout-only classes and its own domain classes, but it must not recreate a primitive recipe.

| Primitive                                           | Use                                        | Replaces                          |
| --------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| `Button`                                            | All actions and dialog footers             | `button.app-button` markup        |
| `Panel`, `PanelHeader`, `PanelBody`, `PanelHeading` | Every bordered content panel               | `div.app-panel` plus `rb-panel-*` |
| `Badge`                                             | Status, visibility, and index chips        | `rb-chip` with a raw `data-tone`  |
| `FactList`                                          | Addresses, IDs, networks, and spec facts   | `dl.rb-spec-facts`                |
| `ErrorState`                                        | Failed reads, chain errors, copy failures  | `rb-error`                        |
| `SyncState`                                         | Indexing and not-yet-visible records       | `rb-sync`                         |
| `EmptyState`                                        | Empty collections and first-run guidance   | `rb-empty`                        |
| `Callout`                                           | One explanation plus one action            | `rb-callout`                      |
| `Dialog`                                            | Modal surfaces with focus trap and restore | `dialog.app-dialog`               |
| `Field`                                             | Labelled inputs with hint or error         | `label.app-field`                 |
| `Select`                                            | Grouped single-choice pickers              | native `select` option popups     |
| `PageHeading`                                       | Page title, description, breadcrumb, aside | `header.app-heading`              |
| `Toolbar`                                           | Search and filter rows                     | `div.rb-toolbar`                  |

Rules that apply across components:

- Errors preserve the underlying chain detail in a `code` element and keep `role="alert"`.
- A syncing title must sit inside `role="status"`; the visual pulse is not the only signal.
- Destructive actions use `Button variant="danger"` or `danger-solid`; they never use accent blue.
- Wallet dialogs own the focus trap and restore focus to the trigger. While busy, Tab is contained and the waiting status is announced.
- A fact list keeps a visible label for every value. Never render a bare address with no term.
- `Field` renders its hint and error outside the label so a control's accessible name stays the field name; controls receive the hint and error ids to set `aria-describedby`.
- `Select` keeps a grouped choice inside the workspace: a `role="combobox"` trigger, an absolutely positioned `listbox`, arrow/Home/End/Enter/Escape/Tab handling, and `aria-activedescendant` on the trigger. Use it instead of a native `select` wherever the operating system's option window would escape the design system or clip at the viewport.
- If a new pattern is genuinely missing, add it to `src/ui`, document it here, then use it.

### Adding a UI surface

1. Read this file and inspect the closest existing surface.
2. Compose the page from `src/ui`; keep feature-specific classes only for layout or domain visuals.
3. Use `var(--rb-*)` for every color, radius, and shadow. Add a token if the value is genuinely new.
4. Run `npm run check:design`. A failure means the surface bypassed the system, not that the gate is wrong.
5. Check the rendered page at 390px and 1440px before finishing.

### Bookkeeper assistant

Bookkeeper is the wallet-verified account assistant. It opens from the workspace topbar, the mobile bar, and a launcher in focused layouts. Above 64rem it is a bottom-right dialog; below 64rem it becomes a full-height sheet.

- Compose the header, actions, verification card, and failure states from `Button`, `Callout`, `Dialog`, and `ErrorState`. The thread, tool trace, suggestion list, reference chips, and composer are assistant layout classes in `styles/assistant.css`.
- Every account fact comes from a read-only tool call. Show the call as a trace row above the answer; never render a balance or run from the model's memory.
- Keep the verification card explicit: off-chain signature, no gas, no session timeout, read-only access. The session token is held in memory, not localStorage, so a reload asks for a new signature.
- Answer links are chips below the bubble. Do not put bare addresses or fabricated URLs in chat copy.
- The composer stays available while a response streams; Enter sends, Shift+Enter breaks the line, and Escape closes through `Dialog`.

## Do's and Don'ts

- Do use the raised surface for the active rail item and the card surface, with an accent edge.
- Do keep the network name beside its color and the status label beside its dot.
- Do use one primary action per heading and quiet buttons for everything else.
- Do preserve `data-testid`, roles, and focus behavior when replacing markup with a primitive.
- Do update this file and the primitive together when the system changes.
- Don't add raw hex, `oklch()`, `rgb()`, or `hsl()` outside `tokens.css`, except the documented landing files.
- Don't add a new `rb-*` class in a page or feature component. Move the recipe into `src/ui`.
- Don't use active green for fired, paused, cancelled, or unfunded states.
- Don't use landing photo treatments, glass, or atmospheric gradients in workspace panels.
- Don't add a new legacy entry to `scripts/design-system-baseline.json` without a reason recorded in review.
