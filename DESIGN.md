---
name: Fantazy
description: The broadcast desk for a hockey pool — Apple's black-and-gray set, one signal red for everything you can tap, team colors as the only other chroma.
colors:
  signal-red: "#E62030"
  signal-red-deep: "#C41A28"
  signal-red-text: "#FF5C66"
  on-signal-red: "#FFFFFF"
  goal-green: "#30D158"
  blue-line-cyan: "#64D2FF"
  bench-yellow: "#FFD60A"
  rookie-purple: "#BF5AF2"
  arena-black: "#000000"
  board-gray: "#1C1C1E"
  board-gray-raised: "#2C2C2E"
  press-box-black: "#161617"
  rink-line: "#38383A"
  edge-gray: "#636366"
  scoreboard-white: "#F5F5F7"
  broadcast-gray: "#A1A1A6"
  far-gray: "#6E6E73"
  light-page: "#F5F5F7"
  light-card: "#FFFFFF"
  light-raised: "#FBFBFD"
  light-hover: "#E8E8ED"
  light-rink-line: "#D2D2D7"
  light-edge-gray: "#86868B"
  light-label: "#1D1D1F"
  light-secondary-label: "#6E6E73"
  light-tertiary-label: "#86868B"
  light-signal-red-text: "#D70015"
  light-goal-green: "#1F7A35"
  light-blue-line-cyan: "#0071A4"
  light-bench-yellow: "#B25000"
  light-rookie-purple: "#8944AB"
typography:
  display:
    fontFamily: "'Bebas Neue', 'Segoe UI', sans-serif"
    fontSize: "1.55rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "1.5px"
  headline:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "clamp(2.6rem, 4.5vw, 4.4rem)"
    fontWeight: 900
    lineHeight: 1.08
    letterSpacing: "normal"
  title:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
  numeric:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.78rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  xxl: "18px"
  pill: "999px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.on-signal-red}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.signal-red-deep}"
    textColor: "{colors.on-signal-red}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.signal-red-text}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.signal-red-text}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
  input-field:
    backgroundColor: "{colors.board-gray-raised}"
    textColor: "{colors.scoreboard-white}"
    rounded: "{rounded.lg}"
    padding: "13px 16px"
    height: "48px"
  card-surface:
    backgroundColor: "{colors.board-gray}"
    textColor: "{colors.scoreboard-white}"
    rounded: "{rounded.xxl}"
    padding: "28px 28px 24px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.broadcast-gray}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.board-gray-raised}"
    textColor: "{colors.signal-red-text}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  badge-label:
    backgroundColor: "transparent"
    textColor: "{colors.broadcast-gray}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 18px"
  position-badge-att:
    backgroundColor: "transparent"
    textColor: "{colors.goal-green}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-def:
    backgroundColor: "transparent"
    textColor: "{colors.blue-line-cyan}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-gar:
    backgroundColor: "transparent"
    textColor: "{colors.bench-yellow}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-rookie:
    backgroundColor: "transparent"
    textColor: "{colors.rookie-purple}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
---

# Design System: Fantazy

## Overview

**Creative North Star: "The Broadcast Desk"**

Fantazy looks like the studio a hockey broadcast is called from: a dark set, a wall of numbers that has already been organized for you, and light used sparingly — only where something is live. The desk has authority because it is calm. It does not shout the score; it shows you the score, correctly, faster than you could have assembled it yourself. Every screen is a surface someone reads under time pressure, usually on a phone, sometimes with four friends waiting on their turn.

The colors are Apple's, with one substitution. Surfaces and text use the gray ladder Apple ships across iOS, macOS and apple.com: pure black, `#1C1C1E` and `#2C2C2E` in dark; `#F5F5F7` and white in light. Every color has a dark value and a light value, each tuned to hold contrast on its own ground. Where Apple puts its blue, Fantazy puts **Signal Red** (`#E62030`). It marks what you can tap: links, buttons, the active tab, focus, the current pick. Green, cyan, yellow and purple come from Apple's system set and only ever carry meaning (a player's position, a status). The only chroma allowed to move freely is the NHL club palette, which enters the interface through team logos and the draft pick cards. That restraint is what lets a Colorado burgundy or a Nashville gold read instantly when it appears — it is the only unexpected color on screen.

Density is deliberate and high. This is a statistics product; tables are the primary component, not a fallback. Numbers set in monospace, positions demoted to a secondary line, whole rows made clickable rather than a small link — these are the system's real decisions. Ornament is spent almost nowhere so that the data can be dense without becoming loud.

**Key Characteristics:**
- Dark-first on pure black, with a full light theme as a peer, not an afterthought
- Apple's gray ladder: three surface steps and three text steps per theme, nothing in between
- One tint, Signal Red, for everything tappable; semantic color reserved for meaning
- Every color has a dark and a light value; red has three (fill, dark-theme text, light-theme text)
- Flat fills: a button is one color, never a gradient
- Condensed display type (Bebas Neue) against a plain system sans body
- Monospace numerals wherever figures are compared down a column
- Tables and cards as the primary components; phone-first at every breakpoint
- NHL club colors are the only free chroma, and they belong to real teams only

## Colors

Apple's system palette, with Signal Red in the place of Apple's blue.

### Primary: Signal Red

One hue (355°) in three values, because no single red can do every job in both themes.

| Token | Dark | Light | Job |
| --- | --- | --- | --- |
| `--primary` | `#E62030` | `#E62030` | Fills: primary buttons, the notification badge, the active rule under a tab, focus borders, the current pick. |
| `--primary-deep` | `#C41A28` | `#C41A28` | Hover and pressed fill: `--primary` mixed with about 15% black. |
| `--primary-text` | `#FF5C66` | `#D70015` | Red *as text*: links, the active nav label, sortable-header state, secondary and tertiary buttons, errors. |
| `--on-primary` | `#FFFFFF` | `#FFFFFF` | The label on a red fill. |
| `--primary-rgb` | `230, 32, 48` | `230, 32, 48` | Components of `--primary`, for `rgba()` tints, halos and glows. |

Why three values:
- **The fill is the same in both themes.** White on `#E62030` reads 4.55:1, just over AA. That is also why hover goes darker (`#C41A28`, 5.96:1) and never lighter.
- **The text value changes per theme.** `#E62030` as text reads only 3.74:1 on a dark card and 4.18:1 on the light page, so it fails AA as text in both themes. Apple handles the same problem for its blue with a brighter dark-mode value and a deeper light one, and Fantazy does the same. `#FF5C66` keeps the hue and reads 4.63:1 or better on every dark surface. `#D70015` is Apple's own increased-contrast system red: 4.94:1 on the light page, 5.38:1 on a card.

**History.** Signal Red replaced Editorial Brick (`#E8795E`) on 26 Sept 2026, when the palette moved to Apple's system colors. Brick had itself replaced Rink Ice Cyan (`#00D4FF`), to end two accents on one screen. The same one-tint rule carries over.

**Red and the clubs.** Eight NHL clubs have a red main color: CAR, CGY, CHI, DET, MTL, NJD, OTT, WSH. So wherever Signal Red marks a state on a team surface (the current pick card, the turn banner), it never carries that state alone. A ring, a pulse or a label ("À vous") always goes with it, so a Detroit card reads as "current" and not just as "Detroit".

### Secondary: the semantic set

Apple's system colors. Each role has a dark value (Apple's default dark-mode color) and a light value (Apple's increased-contrast light color, which is what holds AA as text on a pale ground).

| Role | Token | Dark | Light | Meaning |
| --- | --- | --- | --- | --- |
| **Goal Green** | `--success` | `#30D158` | `#1F7A35` | Success, completed actions, the **attaquants** badge. |
| **Blue-Line Cyan** | `--position-def` | `#64D2FF` | `#0071A4` | The **défenseurs** badge. |
| **Bench Yellow** | `--warning` | `#FFD60A` | `#B25000` | Warnings, the **gardiens** badge, the podium's gold, the standings leader wash. |
| **Rookie Purple** | `--rookie` | `#BF5AF2` | `#8944AB` | The **rookies** badge. A single, narrow job. |

- **Contrast.** On a dark card (`#1C1C1E`): green 8.42:1, cyan 9.89:1, yellow 12.05:1, purple 4.83:1. Purple drops to 3.96:1 on the raised step, so rookie badges sit on cards and rows, never on `#2C2C2E`. On the light page: 4.95:1, 4.95:1, 4.77:1, 5.54:1.
- **Green's light value** is Apple's increased-contrast green (`#248A3D`) one step deeper, because Apple's value reads 4.40:1 on white, just under AA.
- **Défenseurs moved off the accent.** The badge used to be brick, the accent of the time. With red as the tint, a red DEF badge would read as a link.
- **As a solid fill** (the draft room's finish button, the turn banner's done state), a semantic color takes a black label in dark (`#000` on `#30D158`: 10.39:1) and a white label in light (`#FFF` on `#1F7A35`: 5.39:1). That label is `--on-success`.

### Errors and destructive actions

Apple's red is its destructive color. Here red is also the tint, so errors and destructive actions share the red tokens and are told apart by *form*, the way iOS does it.

- **Errors:** red text (`--primary-text`) with an icon, placed next to the field or row it concerns. `--danger` is an alias of `--primary-text`. `--danger-deep` is an alias of `--primary`, for small red fills with a white label such as the notification badge.
- **Destructive actions:** red *text* buttons, never a solid red fill. A solid red fill means "go ahead"; "Supprimer" is a plain or outlined red button. Anything irreversible goes through `fzConfirm`, which says in words what will be lost.

### Tertiary: NHL club colors

- **NHL club colors**: sourced from the static table in [teamColors.js](teamColors.js), two per club (primary + secondary). They enter only through team identity — logos, and the pick card's `--team-accent` bottom rule — and that identity is the **pool team's own chosen club** ([repechage.js](repechage.js)'s pre-draft picker, `POST /choose-nhl-club`), not the club of whichever player got drafted. The second color exists to separate clubs that share a navy (Buffalo, Columbus, Florida). These are real brand colors of real organizations: never invent one, never assign one to a non-team.

### Neutral: Apple's gray ladder

Three surface steps, three text steps and two border steps per theme. Nothing in between.

| Role | CSS tokens | Dark | Light |
| --- | --- | --- | --- |
| Ground and page | `--bg`, `--bg-page` | `#000000` | `#F5F5F7` |
| Card, table row | `--card`, `--bg-odd-row` | `#1C1C1E` | `#FFFFFF` |
| Raised panel | `--card-white` | `#2C2C2E` | `#FBFBFD` |
| Input well | `--bg-gray-light` | `#2C2C2E` | `#F5F5F7` |
| Hover | `--bg-hover` | `#2C2C2E` | `#E8E8ED` |
| Sticky bars (top, bottom nav) | `--navbar-glass` | `rgba(22, 22, 23, .8)` + 20px backdrop blur | `rgba(251, 251, 253, .8)` + 20px backdrop blur |
| Opaque chrome (drawers, menus, rail, footer) | `--navbar-bg` | `#161617` | `#FBFBFD` |
| Separator | `--border-light`, `--border-table`, `--navbar-border` | `#38383A` | `#D2D2D7` |
| Control border | `--border-gray` | `#636366` | `#86868B` |
| Label (all reading text) | `--text-main`, `--text-dark` | `#F5F5F7` | `#1D1D1F` |
| Secondary label | `--text-secondary`, `--text-gray` | `#A1A1A6` | `#6E6E73` |
| Tertiary label | `--text-light-gray` | `#6E6E73` | `#86868B` |
| Overlay | `--overlay-dark` | `rgba(0, 0, 0, .6)` | `rgba(0, 0, 0, .4)` |

- **The dark page is pure black**, as on iOS. On a phone's OLED screen it is true black, and cards separate from it without a shadow. The navigation bar is the one surface *lighter* than the page: a frosted bar over black, not a darker frame.
- **Label and body text are one color.** The old split, a sharper white for headings and a softened white for body copy, is gone. Hierarchy comes from size and weight, as on Apple's pages.
- **Secondary label is safe for any text:** 5.42:1 on the raised dark step, 4.66:1 on the light page.
- **Tertiary label is not.** At 4.14:1 on black and 3.33:1 on the light page, it is only for placeholders, disabled labels and hints, never for a value someone has to read.
- **Control border.** `#86868B` is apple.com's input stroke (3.62:1 on white). `#636366` is its dark counterpart (2.84:1 on a card); there, the field's lighter fill finishes the job.

### Light theme

Light is a full peer theme, applied via `html[data-theme="light"]` and set before first paint by [theme.js](theme.js). Every token above has its light value in the same table, and none of them is an inversion of the dark value. `--primary`, `--primary-deep`, `--primary-rgb` and `--on-primary` are the only tokens that are identical in both themes. The `.impeccable/design.json` sidecar still carries the old brick palette and needs a refresh.

### Landing

The visitor landing ([landing.css](landing.css)) keeps its banner dark in both themes ([LANDING.md](LANDING.md) §5).
- **Red:** its two local reds, `--fzl-brick` and `--fzl-red`, both become `--primary`, so the black-and-red banner is the brand red.
- **Surfaces:** its cool blue-black surfaces (`--fzl-body-bg #0D1013`, `--fzl-panel #141920`, `--fzl-panel-2 #1B2128`) move onto the dark ladder above: `#000000`, `#1C1C1E`, `#2C2C2E`.

### Named Rules

**The Tint Means Tappable Rule.** Signal Red marks what you can act on — a link, a button, the active tab, the focused control, the current pick — and nothing else. A heading, an eyebrow, a total or a card border at rest is never red. Only one control per view is a *solid* red fill, the primary action; everything else interactive is red text or a red outline. The landing banner is the one decorative use of red, and it stays on the marketing page.

**The Three Reds Rule.** A red fill uses `--primary`, red text uses `--primary-text`, and a label on red uses `--on-primary`. `color: var(--primary)` is always a bug: it reads 3.74:1 on a dark card.

**The Real Teams Only Rule.** Chroma outside the semantic set may only come from `NHL_TEAM_COLORS`, and only attached to the club it belongs to. No invented team colors, no club palette borrowed for a UI accent.

**The Semantic Set Is Closed Rule.** Green, cyan, yellow and purple carry position and status. They are never chosen for variety. If a new state needs a color, it earns one of these four or it uses the neutral ladder. Red is not in the set: it is the tint.

**The Destructive Is Text Rule.** A destructive action is never a solid red button. The solid fill means "go ahead"; "Supprimer" is red text, and anything irreversible passes through `fzConfirm`.

## Typography

**Display Font:** Bebas Neue (with `'Segoe UI', sans-serif` fallback) — loaded on 10 of 16 pages
**Body Font:** Segoe UI (with `Tahoma, Geneva, Verdana, sans-serif`)
**Numeric Font:** JetBrains Mono (with `ui-monospace, SFMono-Regular, Menlo, monospace`) — weights 500 and 700, currently loaded only on the draft room

**Character:** A tall, tight, all-caps condensed face for headings against a completely unremarkable system sans for everything you actually read. The pairing is deliberate asymmetry: Bebas supplies arena signage, and the body face refuses to compete with it. Figures escape to monospace the moment they need to be compared down a column.

### Hierarchy
- **Display** (Bebas Neue, 400, 1.55rem, 1.5px tracking): card and section titles — "Infos du pool", "Configuration des sélections". Its weight is 400 because Bebas has one weight; never fake-bold it.
- **Headline** (900, `clamp(2.6rem, 4.5vw, 4.4rem)`, 1.08): the marketing hero only. One per page, and only on Persuade surfaces.
- **Title** (800, 1.75rem, 1.25): section headings inside the app — "Mes classements", "Meilleurs joueurs".
- **Body** (400, 1rem, 1.65): prose, descriptions, and legal pages. Cap measure at 65–75ch; the legal pages are the only place long-form measure matters.
- **Label** (700, 0.78rem, 0.1em tracking, uppercase): eyebrows, filter headers, table group headers, position badges. Uppercase plus wide tracking is the label signature — do not use it below 0.68rem.
- **Numeric** (500, 0.78rem, 0.02em): every figure in a column — points, goals, standings, career tables. Applied by column position, not by hand ([draftActif.css:1524](draftActif.css#L1524)).

### Named Rules

**The Column Alignment Rule.** Any number a user will compare against the number below it is set in JetBrains Mono. Numbers that are read alone (a single badge, a count in a sentence) stay in the body face. The test is literal: does it sit in a column?

**The One Bebas Line Rule.** Bebas Neue is a heading face, not a text face. It never sets a sentence, never sets body copy, and never appears at more than one hierarchy level within a single card.

**The Two-Line Player Rule.** A player's name and their position are two facts of different weight and never read as one string. Name at 700 in the label color; position demoted to a `0.74em` secondary line in `--text-secondary`. Never `Nom, ATT`.

### Dense UI (draft room, career modal)

The hierarchy above sizes page composition — headings, prose, one card title. [draftActif.css](draftActif.css) and [career-modal.css](career-modal.css) additionally carry a finer micro-scale for the draft room's tables and stat grids, where a dozen small facts (rank, position, team, points) sit shoulder to shoulder and Label's 0.78rem floor is too coarse. Like the breakpoint list below, this is accepted drift, not a second designed system — new dense-UI work should land on one of these four steps rather than inventing a fifth:

- **Micro** (~0.5–0.58rem): table micro-headers, position abbreviations — the smallest legible tier. Flagged by a live contrast/legibility pass as worth a dedicated look; not yet resolved (see the Don't below).
- **Small body** (0.7–0.75rem): secondary line under a name, card sub-labels, table cell values, filter chips. Was two nominally-different steps (a 0.68rem "Meta" and 0.7–0.75rem "Small body") until a live-rendered scan caught 0.68rem measuring 10.88px — under an 11px legibility floor at every one of its 14+ call sites. Raised to 0.7rem and merged into this one step rather than kept as a separate near-duplicate.
- **Compact body** (~0.8–0.88rem): player names in table rows, dropdown items.
- **Emphasis** (~0.9–0.95rem): empty-state and alert copy that needs to read as a full sentence, not a label.

Stat-grid numerals above ~1.1rem (career modal's big season totals, alert icons) are Numeric or Display use, not a new tier — size them by column/context as those rules already say.

`.player-selection-card` and its table (`draftActif.css` section 19b) are a deliberate exception to the whole page above: built to match an external mockup, they use **Archivo Narrow** (headers, names, row numerals) and **Inter** (body/filter text) instead of Bebas Neue/Segoe UI, loaded via [draftActif.html:24](draftActif.html#L24). Scoped entirely to that card and its table — do not let these fonts leak outside `.player-selection-card`.

## Layout

**Phone-first, always.** Base rules describe the phone; `min-width` queries enrich upward. [draftActif.css](draftActif.css) is the reference implementation of this and the file to copy when starting a new surface.

**Breakpoints.** Normalize on three: **480px** (small phone), **768/769px** (phone → desktop), **1024px** (wide). The codebase currently also contains 500, 599/600, 640, 700, 760, 900, 1100, and 1300 — that is drift, not a system. New work uses the three.

**Navigation topology changes at 768px.** Above it, a 70px sticky top bar with inline links and the pool selector. At or below it, the top bar compresses to 60px (56px under 480px), the inline links disappear, and a fixed **bottom navigation bar** takes over with 64px-minimum touch targets. `body` carries `padding-bottom: 80px` on phones to clear it. Any new full-page surface must account for that bottom bar.

**Containers.** App content maxes at 1800px in the navbar frame; forms and single-column flows sit far narrower (≈720px) and center. The pool rail is a fixed 268px (`--fz-rail-w`).

**Rhythm.** An 8px base step: 4 / 8 / 12 / 16 / 20 / 24 / 32. Card padding is 28px on desktop and 22px 20px on phones. Form groups stack at 18px; form rows are a two-column grid with a 16px gutter that collapses to one column on phones.

**Tables are the primary layout.** Rows are separated (a 12px-radius pill per row via first/last-cell radii) rather than zebra-striped, the rank column locks to 44px under 700px, and horizontal scroll is contained inside the table's own wrapper — never the page body.

**Horizontal snap-scroll rows.** For a list too narrow to ever justify a grid — the draft pick strip, the phone players-grid, the dashboard's roster list (`accueil.css`) — the recurring answer is a single scroll-snapping row (`scroll-snap-type: x mandatory`, `scroll-snap-align: start`, hidden scrollbar) over a wrapped grid. Cards size to `clamp()` rather than a fixed width so the row still shows a peek of the next card at any viewport.

### Named Rules

**The Bottom Bar Reservation Rule.** On phones the bottom 80px belongs to navigation. Nothing sticky, floating, or action-critical may live there.

**The Page Never Scrolls Sideways Rule.** Wide content (tables, pick strips, career logs) scrolls inside its own `overflow-x: auto` container. Decorative glow blobs are clipped by their parent ([index.css:157](index.css#L157)) precisely because they used to break this.

## Elevation & Depth

Depth comes from **tonal layering first, neutral shadow second, and colored glow almost never.**

- **Dark theme:** the ground is pure black, cards rise to `#1C1C1E` and panels to `#2C2C2E`, and that stack does all the work. A shadow cast on `#000` is invisible, so in dark theme elevation *is* the surface ladder, plus the separator on the card's edge.
- **Light theme:** white cards on `#F5F5F7` separate only faintly by tone, and the shadow ladder below carries them.

Neutral shadow is reserved for genuine z-separation — things that float above the page and could be dismissed: modals, dropdowns, drawers, toasts. A red glow is **state, not elevation**: it appears on focus and on live/current elements, and it disappears when that state does.

> **Migration note.** The incumbent code does not match this yet: `--glow-primary` is applied at rest in 27 places, including buttons and cards that are not live. That is the documented drift to close. Existing glow-at-rest is legacy; new work uses the ladder below.

### Shadow Vocabulary
- **elevation-1** (`0 1px 2px rgba(0,0,0,.28)`): resting separation for a raised row or chip. Use rarely; a border is usually enough.
- **elevation-2** (`0 2px 8px rgba(0,0,0,.32)`): hovered cards, popovers, the sticky header once the page has scrolled.
- **elevation-3** (`0 8px 32px rgba(0,0,0,.38)`): dropdowns, drawers, the user menu.
- **elevation-4** (`0 20px 50px rgba(0,0,0,.55)`): modals and full overlays only.
- **focus-ring** (`0 0 0 3px rgba(var(--primary-rgb), .40)`, paired with a 1px `--primary` border): on every focusable control. The border carries the contrast — 3.74:1 on a dark card, 4.18:1 on the light page, both over the 3:1 floor for non-text — and the halo makes it easy to spot. Already the pattern in [pool.css:435](pool.css#L435).
- **glow-live** (`0 0 20px rgba(var(--primary-rgb), .30)`): the current pick, an active turn, a live indicator. State only.

### Named Rules

**The Glow Means Live Rule.** Colored glow is never elevation. If the element would look the same when nothing is happening, it must not glow.

**The Border Before Shadow Rule.** Reach for a separator (`--border-light`) before reaching for a shadow. On a dark ground a 1px separator divides surfaces more cleanly than a shadow can, and it costs nothing to paint.

## Shapes

Rounded, tactile, and consistently soft — this is a touch product and the geometry says so. The radius ladder runs **6px** (micro badges) → **8px** (small chips, table headers) → **10px** (navigation items, selects) → **12px** (the workhorse: buttons, inputs, cards, table rows) → **14px** (full-width primary actions) → **18px** (large form and panel cards), with **999px** for pills and **50%** for avatars and status dots. Twelve is the default; when in doubt, use 12px.

Borders are the primary edge language: 1px separator (`--border-light`) for surface seams, 2px control border (`--border-gray`) for form controls that must look grabbable. Inputs are wells, filled one step off their card: lighter in dark (`#2C2C2E` on `#1C1C1E`), darker in light (`#F5F5F7` on white).

Two silhouettes recur and are worth protecting: the **row-as-pill** (a table row whose first and last cells carry the 12px radius, so a dense table reads as a stack of separated objects) and the **team-accent card** (a neutral dark card with a 3px bottom rule in the club's secondary color).

### Named Rules

**The Twelve Rule.** 12px is the default radius. Deviating requires a reason that is about size — micro elements go down, full-bleed actions and large panels go up. Never mix three radii inside one card.

## Components

### Buttons
Tactile and confident: real weight, a clear press, and hit areas built for a thumb.

- **Shape:** softly rounded (12px; 14px for full-width primary actions), minimum 44px tall, 48px for primary.
- **Primary:** a flat `--primary` fill with an `--on-primary` (white) label, 800 weight, `15px 32px`. One color, no gradient, as on Apple's filled buttons. One per view.
- **Hover / Focus:** the fill moves to `--primary-deep`, and the button lifts with `translateY(-3px)` over 0.2s on `cubic-bezier(.4,0,.2,1)`, plus the elevation-2 shadow (visible in light theme only). Focus-visible additionally draws the focus ring. `:active` returns to `translateY(0)` — the press must be felt. Hover never *lightens* the fill: white on `#E62030` is already at 4.55:1.
- **Secondary:** transparent, with a 2px `--primary-text` border and a `--primary-text` label. On hover the fill takes `rgba(var(--primary-rgb), .10)`.
- **Tertiary:** text only in `--primary-text`, no border (Apple's plain button). On hover it lifts 2px and takes a `rgba(var(--primary-rgb), .08)` fill.
- **Destructive:** secondary or tertiary styling, never primary (The Destructive Is Text Rule).
- **Disabled:** `opacity: .5`, `cursor: not-allowed`, and the hover transform suppressed. Never remove the label.

### Cards / Containers
- **Corner Style:** 18px for form and panel cards, 12px for content and player cards.
- **Background:** `--card`. Where content scrolls behind a card, use Apple's material instead: `rgba(28, 28, 30, .72)` in dark and `rgba(255, 255, 255, .72)` in light, with a 20px backdrop blur ([pool.css:346](pool.css#L346)).
- **Shadow Strategy:** flat at rest with a 1px separator border. Elevation-2 appears on hover for interactive cards only.
- **Border:** a 1px separator, shifting to `rgba(var(--primary-rgb), .40)` on hover when the card is actionable. In dark theme, that border shift is the whole hover signal.
- **Internal Padding:** 28px desktop / 22px 20px phone; header block separated by 24px.

### Inputs / Fields
- **Style:** a well — `--bg-gray-light` fill, 2px `--border-gray` border, 12px radius, `13px 16px` padding, 600 weight at 1rem (16px, which is also what stops iOS from zooming on focus).
- **Focus:** border to `--primary` plus the `focus-ring` shadow. Never remove the outline without replacing it.
- **Selects:** native `appearance: none` with an inline SVG chevron in `--text-secondary`, 40px right padding.
- **Numeric inputs:** center-aligned at 1.15rem — they are values, not sentences.
- **Placeholder:** `--text-light-gray` (tertiary label) at weight 400, so it never reads as a filled value.
- **Error:** the border turns `--primary`, and the message sits under the field in `--primary-text` with an icon.

### Navigation
- **Desktop (≥769px):** a 70px sticky frosted bar (`--navbar-glass` with a 20px backdrop blur) and a bottom separator. Links are 600-weight pills in `--text-secondary` at `10px 16px`, 44px minimum.
  - **Hover:** the label turns to the label color, the pill takes a `--bg-hover` fill, and it lifts 2px.
  - **Active:** a `--primary-text` label plus a 3px `--primary` rule along the bottom edge.
- **Phone (≤768px):** the bar compresses and a fixed bottom nav appears in the same frosted material: 5 icon+label items, 64px minimum height, label at 0.75rem/700. Inactive items are `--text-secondary`. The active item turns red, like Apple's tab bar: `--primary-text` for icon and label, and a 3px `--primary` rule along its *top* edge, mirroring the desktop treatment.
- **Notification badge:** a `--primary` pill with a white label at the avatar's top-right. A 2px ring in `--navbar-bg` (`#161617` / `#FBFBFD`) separates it from whatever is behind it.

### Tables
The workhorse. Rows read as separated objects, not grid lines.

- Header cells are uppercase labels in `--text-secondary`; sortable headers carry `cursor: pointer`, a hover fill, and a caret that shows direction in the data itself. The active sort column's label is `--primary-text`.
- `tbody` rows are pills: 12px radius on the first and last cells, `--bg-odd-row` fill, 1px separator top and bottom. Zebra striping is switched off because separation already exists.
- Actionable rows use a 3px `--primary` stripe on `::after` that fades in on hover **and** `:focus-visible` — the whole row is the target (Fitts), and keyboard users get the same signal a cursor gives.
- Numeric columns are selected structurally and set in JetBrains Mono; the photo and name columns are excluded by position.

**Flat variant (standings).** The pool standings table (`classement.css`) drops the card entirely: no container background, no border, no radius, no zebra striping, no rank badge circle. It has a plain uppercase-label header, hairline rows flush against the page, and the rank number itself carries color: gold (`--warning`), silver and bronze on the podium, `--text-secondary` otherwise. It reads as a leaderboard, not a boxed widget. The leader row is tinted with `color-mix(in srgb, var(--warning) 8%, var(--bg-page))` rather than a card fill, so it stays a wash over the same flat surface instead of becoming its own panel. This is a deliberate second table register, not drift from the workhorse pill-row pattern above. Use it only where a table *is* the page; the workhorse pattern is for a table *inside* one.

### Hall of Fame
Season records (best/worst single day, week, month of pool points) below the standings table, in the same flat register: no cards, just a label, a name, and a number, separated by hairlines rather than boxes. `best` takes `--warning` (gold), echoing how the standings table already marks its leader. `worst` takes `--text-secondary`, a neutral rung, not red: a record low is a fact to note, not an error to flag. It is not `--text-light-gray` either, because the tertiary label does not hold contrast as readable text.

### Turn Banner (signature)
The draft room's status line — sticky, `aria-live="assertive"`, and the single answer to "whose turn is it." Sits above the Pick Card strip and shares its team-identity source, but answers a different question: the strip is history, the banner is *now*.

- **Waiting:** neutral card surface, showing who just picked. `.next` (the team on deck) adds a `--warning` (yellow) ring — a preview, not yet a turn.
- **Your turn:** the state that matters. Background rises to the same muted team-color wash as the Pick Card (`--team-a/-b/-deep`, both driven by `appliquerIdentiteBanniere()` in `draftActif.js` from the same `resolveDrafterClub`/`teamColors.js` source as `draftPickCards.js`), with a dark top vignette and fixed white text, a `--primary` border, and `turnPulse`. Text stays white on purpose: team hues here are pre-muted toward a dark base specifically so a fixed light label always holds contrast, the same reasoning as the Pick Card below. On a red club, the pulse and the wording carry the state, not the red border.
- **Done:** solid `--success` wash with an `--on-success` label (black in dark, white in light), no team color — the repêchage is over, identity no longer matters.
- **Unbranded fallback (`.is-unbranded`):** a repêchage begun before the "choose your club" feature existed can reach *your turn* with no identity resolved. The background falls through to plain site tokens (`--card`/`--bg-gray-light`/`--bg`) rather than a hardcoded color, and `.is-unbranded` pins text to `--text-main` and the border to `--border-light`, so the fallback genuinely follows the theme. Before this, the text stayed the fixed white built for the team-color state and went invisible once those tokens turned pale in light theme. Applied by both `appliquerIdentiteBanniere()` and `buildPickCard()` whenever no club resolves — see the identical fallback on Pick Card below.
- **The header frame (`.draft-header.is-my-turn`):** the sticky shell around the banner, progress bar and pick strip. It stays visible the entire time a visitor is scrolling the player list, since `.draft-header` stays pinned under the navbar.
  - **Held glow:** a full `outline` ring, a top-down red wash (`rgba(var(--primary-rgb), …)`) and a soft shadow cast onto the content scrolling beneath it. These are static properties, not only keyframes, so the frame reads as "live" even under `prefers-reduced-motion`, which strips its animation.
  - **Why `outline`:** it paints without reserving box-model space, so it never needs the "always-present-but-transparent" trick `border-bottom` uses above it.
  - **Arrival flash:** a one-shot `headerPowerOn` marks the instant the turn arrives. Brightness, ring and shadow spike together with a felt `scale(1.012)` pop (transform only, no layout cost).
  - **Breathing loop:** at 0.8s it hands off to `headerTurnGlow`, timed to the same 2s period as the banner's own `turnPulse`. Both classes are set in the same `refreshTurnAlert()` call, so the header and the banner breathe in phase.

### Pick Card (signature)
The draft room's identity object, and the only place club chroma enters the layout.

Every pool team chooses one real NHL club as its identity before the draft opens ([repechage.js](repechage.js)'s pre-draft picker; `POST /choose-nhl-club`; locked once `draftOrder` exists, for the same reason `teamColors.js` itself is static — everyone watching the same strip must see the same thing). That identity, not the club of whichever player gets drafted, is what marks the card — background wash, top-right badge, and (before a pick is made) a large watermark logo in place of the empty slot number. A team's entire run through the strip reads as one identity, pick after pick, not a scatter of the players' own clubs.

- A card carrying a 3px bottom rule in `--team-accent`, the club's *secondary* color — chosen so two clubs sharing a navy still separate at a glance.
- **Upcoming / skipped:** the owning team's identity already colors the card and watermarks its center — known before any player is picked. `opacity: .8` (skipped: `.5`) keeps completed picks dominant in the strip; a repêchage begun before this feature existed falls back to neutral gray, then to the drafted player's own club once a pick lands.
- **Current:** `--team-accent` becomes `--primary` and stays red whatever the team's own identity color (The Tint Means Tappable Rule). The border lifts to `rgba(var(--primary-rgb), .5)` and `turnPulse` runs a 2.4s expanding ring for everyone watching. On the eight red clubs a red rule alone would vanish, so the ring and the pulse are what carry "current". The team whose turn it actually is sees more: `.is-my-turn` scales the card, adds a two-layer glow, and drops an "À vous" badge — the difference between "someone is picking" and "it's me."
- **Revealing:** a ~1150ms sequence where the card arrives desaturated, color rises, then the name lands — animating only `opacity`, `transform`, and `filter`, with `will-change` set only for the duration and only one card at a time.
- **No identity resolved (`.is-unbranded`):** the same legacy-draft fallback as the Turn Banner above. Text pins to `--text-main` and the border to `--border-light` so a card with no team color still reads correctly against whichever theme is active; the always-dark footer bar (`.pick-card-owner`/`.pick-card-meta`) is unaffected either way, since it never depended on the card's own background.

## Do's and Don'ts

### Do:
- **Do** define every color as a token in [index.css](index.css) and consume it as `var(--token)`. Both the `:root` default and the `html[data-theme="light"]` override, in the same commit — a token added to only one theme is a bug in the other.
- **Do** pick the red by its job: `--primary` for a fill, `--primary-text` for text, `--on-primary` for a label on red.
- **Do** keep fills flat. A button is one color; hover changes its value, not its gradient.
- **Do** write phone-first: base rules for the phone, `min-width` queries to enrich. Copy [draftActif.css](draftActif.css)'s structure for new surfaces.
- **Do** keep to the three breakpoints — 480px, 768/769px, 1024px.
- **Do** use 12px as the default radius and step off it only for size reasons.
- **Do** set column-comparable numbers in JetBrains Mono, selected structurally rather than class-by-class.
- **Do** pair every hover affordance with a `:focus-visible` equivalent. The row stripe already does this; everything new must too.
- **Do** animate with `transform`, `opacity`, and `filter`, on `cubic-bezier(.4,0,.2,1)` at 0.2s (0.3s for larger movements), and honor `prefers-reduced-motion` — six stylesheets already do.
- **Do** give touch targets at least 44px, and 64px in the bottom nav.
- **Do** use real NHL club colors from [teamColors.js](teamColors.js), attached only to the club they belong to.
- **Do** tint a state background with `color-mix(in srgb, var(--token) N%, var(--surface))` rather than a hardcoded `rgba()` wash ([classement.css](classement.css)'s leader-row highlight). One rule then covers both themes instead of two, and it can never drift the way a hand-picked dark-theme rgba value does once light theme reuses it verbatim.

### Don't:
- **Don't** hardcode a hex outside the token layer, and **don't redeclare `:root` in a page stylesheet that already loads `index.css`.**
  - `trade.css` used to do exactly this: a stale, incomplete copy of the token set with no matching light-theme block, even though `trade.html` loads `index.css` first. It was fixed by deleting the local `:root`; the page now consumes `index.css`'s themed tokens directly.
  - [legal.css:3](legal.css#L3) is a different case, not drift. `conditions.html`/`confidentialite.html` deliberately skip `index.css` to stay minimal, so a local `:root` is necessary there, and it ships a complete `html[data-theme="light"]` override alongside it.
- **Don't** write `color: var(--primary)`. Red text is `--primary-text`: `#E62030` as text reads 3.74:1 on a dark card and 4.18:1 on the light page.
- **Don't** put dark text on the red fill, and don't lighten the fill on hover. White on `#E62030` is 4.55:1, just over AA; hover goes to `--primary-deep`.
- **Don't** make a destructive action a solid red button. Solid red means "go ahead".
- **Don't** set text someone has to read in `--text-light-gray`. The tertiary label is for placeholders, disabled labels and hints.
- **Don't** use gradient text. `.gradient-text` ([index.css:180](index.css#L180)) is solid `--primary-text`, not a `background-clip` gradient. The rule went unenforced for a while: `accueil.css` shadowed it with an animated three-stop gradient (same class, loaded after index.css, so it silently won), and `trade.css`'s page-header `h1` ran its own gradient-clip. A live-rendered scan caught both; both are now solid color.
- **Don't** animate layout properties — `width`, `height`, `max-height`, `padding`, `margin`. Use `transform`/`opacity`, or `grid-template-rows: 0fr → 1fr` for height. Four instances remain in [pool.css:651](pool.css#L651), [accueil.css:510](accueil.css#L510), and [draftActif.css:165](draftActif.css#L165).
- **Don't** use overshoot or bounce easing (`cubic-bezier(0.68,-0.55,0.265,1.55)` and relatives) on ordinary state transitions. **Exception:** genuine celebration/success moments — the draft pick reveal, the trade-sent success check ([trade.css:272](trade.css#L272)) — may use `cubic-bezier(.34,1.56,.64,1)`. A dropdown is not a celebration, and neither is a confirmation dialog: [trade.css:1594](trade.css#L1594)'s `.trade-confirm-box` used the same bounce on its entrance and was moved to the standard ease.
- **Don't** apply colored glow to elements at rest. Glow is live/focus state; elevation is the surface ladder and neutral shadow.
- **Don't** add a decorative colored border on one side of a card ([accueil.css:293](accueil.css#L293), [pool.css:842](pool.css#L842)). The table row's 3px stripe is exempt: it appears only on hover/focus and signals that the row is actionable — that is an affordance, not ornament.
- **Don't** introduce a second accent hue, and in particular don't bring Apple's blue back for links: 12 of the 32 clubs have a navy or blue main color, and a blue tint would blur into them. If something needs to stand out and red is taken, the answer is hierarchy, weight, or space.
- **Don't** name a token for what it looks like in one theme. `--card-white` resolves to `#2C2C2E`, a dark gray; new tokens are named by role.
- **Don't** ship a phone layout that ignores the fixed bottom navigation's 80px reservation.
- **Don't** treat the Dense UI Micro tier (~0.5–0.58rem) as settled. A live-rendered pass measured position-abbreviation and initials text there at 8.96–10.56px, under the 11px legibility floor that caught and fixed the old Meta step. Unlike Meta, Micro's uses (three-letter position badges, player initials) sit in tight fixed-size containers — raising them needs a per-component check, not a blanket find-replace.

## Applying this palette

This document describes the target. On 26 Sept 2026 the code still ships the brick palette. This checklist brings it in line; delete the section once it is done.

1. **Tokens.** In [index.css](index.css), set `:root` and `html[data-theme="light"]` to the Primary, Secondary and Neutral tables above. Add the new tokens: `--primary-text`, `--on-primary`, `--on-success`, `--position-def`, `--rookie`. Point `--danger` at `--primary-text` and `--danger-deep` at `--primary`.
2. **Red text.** Change the 126 `color: var(--primary)` declarations to `var(--primary-text)`.
3. **Labels on red.** Of the 38 `color: var(--bg)` declarations, the ones that sit on a red fill become `var(--on-primary)`. Check each one: not all 38 are on red.
4. **Flat fills.** Replace the 24 `linear-gradient(… var(--primary) … var(--primary-deep) …)` button fills with a flat `var(--primary)`, with `--primary-deep` on hover.
5. **Literal brick.** Replace the brick hex codes typed outside the token layer with tokens: `#E8795E` (30 uses), `#B93D28` (23), `#8F2E1A` (9), `#F19B85` (6), `#D4614A`. The rookie orchid `#CE93D8` (4 uses) becomes `var(--rookie)`.
6. **Local palettes.** In [landing.css](landing.css), `--fzl-brick` and `--fzl-red` become `--primary`, and the `--fzl-*` surfaces move onto the dark ladder. In [accueil-palette.css](accueil-palette.css), `--fzh-accent` and `--fzh-accent-fill` become the red tokens, and the `--fzh-*` grays move onto the ladder.
7. **Sidecar.** Refresh `.impeccable/design.json`.
8. **Cache.** Bump the `?v=` stamp on every stylesheet that changed.
