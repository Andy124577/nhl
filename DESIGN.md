---
name: Fantazy
description: The broadcast desk for a hockey pool — warm anthracite greys, one red for the brand and the main action, muted status and position hues, team colors as the only other chroma.
colors:
  red: "#E5372B"
  red-fill: "#D9372B"
  red-deep: "#BC2F25"
  red-ink: "#FF8A80"
  on-red: "#FFFFFF"
  green: "#7FD49B"
  gold: "#E8B26A"
  info: "#8FBEFA"
  pos-att: "#7FD49B"
  pos-def: "#80C7F8"
  pos-gar: "#D8C569"
  pos-rec: "#C8A4F3"
  page: "#0F1316"
  card: "#1C201F"
  raise: "#242827"
  line: "#2A2E2D"
  btn-line: "#767B7A"
  ink: "#F3F1EE"
  ink2: "#C9C7C4"
  mute: "#A8A6A3"
  dim: "#5A5A60"
  on-ink: "#0B0B0C"
  light-page: "#F3F2EF"
  light-card: "#FFFFFF"
  light-raise: "#F6F5F2"
  light-line: "#E8E6E2"
  light-btn-line: "#85827D"
  light-ink: "#141416"
  light-ink2: "#34343A"
  light-mute: "#5E5C59"
  light-dim: "#A29F9A"
  light-red: "#D52B1E"
  light-red-ink: "#B3241A"
  light-green: "#1A7A43"
  light-gold: "#976111"
  light-info: "#286CAB"
  light-pos-att: "#1A7A43"
  light-pos-def: "#286CAB"
  light-pos-gar: "#7C6705"
  light-pos-rec: "#7A54A2"
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
    backgroundColor: "{colors.red-fill}"
    textColor: "{colors.on-red}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.red-deep}"
    textColor: "{colors.on-red}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
  input-field:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "13px 16px"
    height: "48px"
  card-surface:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xxl}"
    padding: "28px 28px 24px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.mute}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  badge-label:
    backgroundColor: "transparent"
    textColor: "{colors.mute}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 18px"
  position-badge-att:
    backgroundColor: "transparent"
    textColor: "{colors.pos-att}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-def:
    backgroundColor: "transparent"
    textColor: "{colors.pos-def}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-gar:
    backgroundColor: "transparent"
    textColor: "{colors.pos-gar}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-rookie:
    backgroundColor: "transparent"
    textColor: "{colors.pos-rec}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
---

# Design System: Fantazy

## Overview

**Creative North Star: "The Broadcast Desk"**

Fantazy looks like the studio a hockey broadcast is called from: a dark set, a wall of numbers that has already been organized for you, and light used sparingly — only where something is live. The desk has authority because it is calm. It does not shout the score; it shows you the score, correctly, faster than you could have assembled it yourself. Every screen is a surface someone reads under time pressure, usually on a phone, sometimes with four friends waiting on their turn.

Surfaces and text use five warm anthracite greys: `#0F1316`, `#1C201F` and `#242827` in dark; a warm `#F3F2EF` and white in light. Every color has a dark value and a light value, each tuned to hold contrast on its own ground. One red (`#E5372B`) marks the brand, the main action and live play; its text value (`#FF8A80` / `#B3241A`) marks links, the active tab and focus. Green, gold, blue, yellow and purple share one lightness and only ever carry meaning (a player's position, a status). The only chroma allowed to move freely is the NHL club palette, which enters the interface through team logos and the draft pick cards. That restraint is what lets a Colorado burgundy or a Nashville gold read instantly when it appears — it is the only unexpected color on screen.

Density is deliberate and high. This is a statistics product; tables are the primary component, not a fallback. Numbers set in monospace, positions demoted to a secondary line, whole rows made clickable rather than a small link — these are the system's real decisions. Ornament is spent almost nowhere so that the data can be dense without becoming loud.

**Key Characteristics:**
- Dark-first on warm anthracite, with a full light theme as a peer, not an afterthought
- Five greys per theme (page, card, raised, separator, control outline) and three reading-text steps, nothing in between
- One red for the brand, the main action and live play; semantic color reserved for meaning; "you" is neutral
- Every color has a dark and a light value; red has two jobs (fill and text), each with its own value per theme
- Flat fills: a button is one color, never a gradient
- Condensed display type (Bebas Neue) against a plain system sans body
- Monospace numerals wherever figures are compared down a column
- Tables and cards as the primary components; phone-first at every breakpoint
- NHL club colors are the only free chroma, and they belong to real teams only

## Colors

Warm anthracite greys, one red, and a few muted hues that all share one lightness. The whole palette lives in [couleurs.css](couleurs.css), loaded by every page before its own stylesheets. The method behind it is the guide "Choosing colours for Fantazy" (16 Nov 2026).

**How the tokens fit together.**
- Reskinned pages read the `--s-*` tokens directly.
- Older pages read the `index.css` tokens (`--primary`, `--success`, `--text-main`…), which now point at the same `--s-*` values.
- A page stylesheet only defines what is truly its own, such as a page-specific shadow or a tint mixed from a palette color. It never sets its own grey, red or position color.

**Picking a color.** Ask what the color's job is, then use the token for that job. A color has one job, and a job has one color. If nothing below fits, the answer is a neutral grey, not a new hue.

### Surfaces and text

| Job | Token | Dark | Light |
| --- | --- | --- | --- |
| Page | `--s-bg` | `#0F1316` | `#F3F2EF` |
| Card, sheet, dialog | `--s-card` | `#1C201F` | `#FFFFFF` |
| Raised: hover, neutral filled button | `--s-raise` | `#242827` | `#F6F5F2` |
| Separator (decorative) | `--s-line` | `#2A2E2D` | `#E8E6E2` |
| Control outline: fields, switches, outlined buttons | `--s-btn-line` | `#767B7A` | `#85827D` |
| Main text and numbers | `--s-ink` | `#F3F1EE` | `#141416` |
| Secondary: club, position, time | `--s-ink2` | `#C9C7C4` | `#34343A` |
| Quiet: column headers, hints, section icons | `--s-mute` | `#A8A6A3` | `#5E5C59` |
| Decorative or disabled, never read | `--s-dim` | `#5A5A60` | `#A29F9A` |
| Text on an ink pill | `--s-on-ink` | `#0B0B0C` | `#FFFFFF` |

- **Five greys, no more.** Chips, avatars, table heads and "your row" reuse these through aliases (`--s-chip`, `--s-face`, `--s-head`, `--s-me`), so they never introduce a sixth grey. In light, chips, avatars and your row take the separator grey, because the raised grey is too close to the page to be seen.
- **Every reading text passes AA.** Ink, ink2 and mute are at 6:1 or better on every surface in both themes. Dim is 2.2–2.7:1 and is only for disabled controls and decoration.
- **Control outlines pass 3:1** (WCAG 1.4.11) on page and card in both themes (3.4–4.3:1). Separators do not need to and do not.
- **Warm, not cool.** The light page is a warm off-white (`#F3F2EF`), not Apple's blue-grey `#F5F5F7`, so it sits with the warm anthracite of the dark theme.
- The navigation bar stays its own surface: `--navbar-bg` `#000000` / `#FBFAF8`, with `--navbar-glass` and a 20px backdrop blur for the sticky bars.

### Red: brand, main action, live

| Job | Token | Dark | Light |
| --- | --- | --- | --- |
| Brand mark, live dot, badges | `--s-red` | `#E5372B` | `#D52B1E` |
| Main button fill (white label) | `--s-red-fill` | `#D9372B` | `#D52B1E` |
| Red as text: links, active tab line, sort arrow, focus ring, errors | `--s-red-ink` | `#FF8A80` | `#B3241A` |
| Tint behind a red element | `--s-red-soft` | 16% | 10% |

- White on the fill is 4.63:1 in dark and 5.01:1 in light. Hover goes darker (`--primary-deep`, `#BC2F25` / `#B3241A`), never lighter.
- Red as text is 6.5:1 or better on every surface in both themes. `--s-red` as text on a dark card is only 3.85:1, so text never uses it.
- The old `index.css` names still work: `--primary` is the fill, `--primary-text` is the red-ink, `--danger` is an alias of `--primary-text`.

**Red and the clubs.** Eight NHL clubs have a red main color: CAR, CGY, CHI, DET, MTL, NJD, OTT, WSH. So wherever red marks a state on a team surface (the current pick card, the turn banner), it never carries that state alone. A ring, a pulse or a label ("À vous") always goes with it.

### Status and positions

All of these share one lightness and one intensity (OKLCH about 79 / 0.11 in dark, about 52 / 0.12 in light). Only the hue changes, so none of them shouts louder than the others.

| Job | Token | Dark | Light |
| --- | --- | --- | --- |
| Good: points gained, trade done, switch on | `--s-green` | `#7FD49B` | `#1A7A43` |
| Waiting: for sale, deadline | `--s-gold` | `#E8B26A` | `#976111` |
| Neutral news: NHL transaction | `--s-info` | `#8FBEFA` | `#286CAB` |
| Attaquants (C, AG, AD) | `--s-pos-att` | `#7FD49B` | `#1A7A43` |
| Défenseurs | `--s-pos-def` | `#80C7F8` | `#286CAB` |
| Gardiens | `--s-pos-gar` | `#D8C569` | `#7C6705` |
| Recrue | `--s-pos-rec` | `#C8A4F3` | `#7A54A2` |
| Équipe (no hue) | `--s-pos-eq` | `#C9C7C4` | `#34343A` |

- Each status color has a `-soft` version (16% dark, 10% light) for the tint behind it.
- Positions are RGB triplets, so a page can write `rgb(var(--s-pos-att))` for the text and `rgba(var(--s-pos-att), .16)` for the tint behind it. `index.css` exposes them as `--position-att`, `--position-def`, `--position-gar` and `--rookie`.
- **One position scheme everywhere.** The draft room no longer gives C, AG and AD three different colors. All forwards are green, as on every other page.
- **Contrast.** Every status and position color is 7:1 or better on dark surfaces and 4.6:1 or better on the light page and card. On the light separator grey (your row, chips) green, gold and blue drop to about 4.2–4.4:1, so a position tag never sits directly on it.
- **As a solid fill** (the switch, the draft room's finish button), green takes a black label in dark and a white one in light (`--on-success`).

### "You" and selection are neutral

- **Your row** is the raised grey (`--s-me`), with a thin ink bar where a marker is needed. It is never red.
- **The "Toi" tag** is an ink pill: `--s-ink` background, `--s-on-ink` text.
- **A selected filter chip** is the same ink pill. A switch that is on turns green.
- **Section icons** are quiet (`--s-mute`), not red.

### Errors and destructive actions

Red is both the brand and the error color, so errors and destructive actions are told apart by *form*, the way iOS does it.

- **Errors:** red text (`--s-red-ink`) with an icon, next to the field or row it concerns.
- **Destructive actions:** red *text* buttons, never a solid red fill. A solid red fill means "go ahead"; "Supprimer" is a plain or outlined red button. Anything irreversible goes through `fzConfirm`, which says in words what will be lost.

### NHL club colors

Sourced from the static table in [teamColors.js](teamColors.js), two per club (primary + secondary). They enter only through team identity — logos, and the pick card's `--team-accent` bottom rule — and that identity is the **pool team's own chosen club** ([repechage.js](repechage.js)'s pre-draft picker, `POST /choose-nhl-club`), not the club of whichever player got drafted. The second color exists to separate clubs that share a navy (Buffalo, Columbus, Florida). These are real brand colors of real organizations: never invent one, never assign one to a non-team.

### Kept on purpose

- The red star next to your players in the Zone de match (andy's choice).
- The glowing red line of the bottom navigation (andy's choice, "1b Ligne lumineuse").
- The rank medals (gold, silver, bronze) and the dark "Ma position" card, in both themes.
- The landing banner and its headline red: the landing stays dark in both themes ([LANDING.md](LANDING.md) §5).

### Light theme

Light is a full peer theme, applied via `html[data-theme="light"]` and set before first paint by [theme.js](theme.js). Every token above has its light value in the same tables, and none of them is an inversion of the dark value. The `.impeccable/design.json` sidecar still carries the old brick palette and needs a refresh.

### History

- 26 Sept 2026: Signal Red (`#E62030`) and Apple's system palette replaced Editorial Brick (`#E8795E`), which had itself replaced Rink Ice Cyan (`#00D4FF`).
- 31 Oct 2026: the dark theme moved from Apple's black to the warm anthracite of today (`#0F1316` / `#1C201F`).
- 16 Nov 2026: one palette file ([couleurs.css](couleurs.css)). Three reds became one red with a fill and a text value; ten dark greys became five; two families of intensity (soft and Apple-vivid) became one; three position schemes became one; "you" became neutral.

### Named Rules

**The One Job Rule.** A color has one job and a job has one color. Before adding a color, find the job in the tables above. If the job is not there, use a neutral grey.

**The Red Is For Action Rule.** Red marks the brand, the main action, live play and errors. Red text (`--s-red-ink`) marks links, the active tab, the sort arrow and the focus ring. A heading, a section icon, a total, "you" or a card border at rest is never red. Only one control per view is a *solid* red fill.

**The Two Reds Rule.** A red fill uses `--s-red-fill` (or `--primary`), red text uses `--s-red-ink` (or `--primary-text`). `color: var(--s-red)` or `color: var(--primary)` on text is a bug: it reads 3.85:1 on a dark card.

**The Real Teams Only Rule.** Chroma outside the status and position set may only come from `NHL_TEAM_COLORS`, and only attached to the club it belongs to.

**The Set Is Closed Rule.** Green, gold, blue, yellow and purple carry status and position. They are never chosen for variety. A new state earns one of them or uses the neutral greys.

**The Destructive Is Text Rule.** A destructive action is never a solid red button.

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

- **Dark theme:** the page is `#0F1316`, cards rise to `#1C201F` and raised elements to `#242827`, and that stack does all the work. A shadow on a near-black page barely shows, so in dark theme elevation *is* the surface ladder, plus the separator on the card's edge.
- **Light theme:** white cards on `#F3F2EF` separate only faintly by tone, and the shadow ladder below carries them.

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

Borders are the primary edge language: 1px separator (`--border-light`) for surface seams, 2px control border (`--border-gray`) for form controls that must look grabbable. Inputs are wells, filled one step off their card, with a `--s-btn-line` outline that holds 3:1.

Two silhouettes recur and are worth protecting: the **row-as-pill** (a table row whose first and last cells carry the 12px radius, so a dense table reads as a stack of separated objects) and the **team-accent card** (a neutral dark card with a 3px bottom rule in the club's secondary color).

### Named Rules

**The Twelve Rule.** 12px is the default radius. Deviating requires a reason that is about size — micro elements go down, full-bleed actions and large panels go up. Never mix three radii inside one card.

## Components

### Buttons
Tactile and confident: real weight, a clear press, and hit areas built for a thumb.

- **Shape:** softly rounded (12px; 14px for full-width primary actions), minimum 44px tall, 48px for primary.
- **Primary:** a flat `--primary` fill with an `--on-primary` (white) label, 800 weight, `15px 32px`. One color, no gradient, as on Apple's filled buttons. One per view.
- **Hover / Focus:** the fill moves to `--primary-deep`, and the button lifts with `translateY(-3px)` over 0.2s on `cubic-bezier(.4,0,.2,1)`, plus the elevation-2 shadow (visible in light theme only). Focus-visible additionally draws the focus ring. `:active` returns to `translateY(0)` — the press must be felt. Hover never *lightens* the fill: white on `#D9372B` is 4.63:1.
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
- **Phone (≤768px):** the bar compresses and a fixed bottom nav appears in the same frosted material: up to 6 icon+label items, 56px minimum height, 11px labels. Inactive items are a muted grey (`--bn-ink`). The active item turns red, like Apple's tab bar: `--primary-text` for icon and label, a heavier stroke, an icon at 1.08×, and a 56 × 32 tinted pill (`rgba(var(--primary-rgb), .16)` with a 1px inner edge) under the icon.
  - **Touch feedback** (navbar.js, `jouerGeste`): on contact, before release, the icon presses to 0.84, the item tints red and a wave spreads from the finger. On release: a haptic tick, the icon springs back past full size, the pill glides to the new tab stretched along its path (more for longer trips) and drops a fading ring as it lands. The arriving page resumes the gesture where the old one left off. Under `prefers-reduced-motion`, only the color, the tick and a non-expanding flash remain.
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
- **Do** define every color as a token in [couleurs.css](couleurs.css) and consume it as `var(--token)`. Both the `:root` default and the `html[data-theme="light"]` override, in the same commit — a token added to only one theme is a bug in the other.
- **Do** pick the red by its job: `--s-red-fill` (`--primary`) for a fill, `--s-red-ink` (`--primary-text`) for text, `--s-on-red` for a label on red.
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
  - [legal.css:3](legal.css#L3) is a different case, not drift. `conditions.html`/`confidentialite.html` deliberately skip `index.css` to stay minimal, so a local `:root` maps the few `index.css` names that navbar.css and fzDialog.css read onto the `--s-*` palette.
- **Don't** write `color: var(--primary)` or `color: var(--s-red)`. Red text is `--s-red-ink`: the brand red as text reads 3.85:1 on a dark card.
- **Don't** put dark text on the red fill, and don't lighten the fill on hover. White on `#D9372B` is 4.63:1, just over AA; hover goes to `--primary-deep`.
- **Don't** make a destructive action a solid red button. Solid red means "go ahead".
- **Don't** set text someone has to read in `--s-dim`. It is for disabled controls and decoration.
- **Don't** use gradient text. `.gradient-text` ([index.css:180](index.css#L180)) is solid `--primary-text`, not a `background-clip` gradient. The rule went unenforced for a while: `accueil.css` shadowed it with an animated three-stop gradient (same class, loaded after index.css, so it silently won), and `trade.css`'s page-header `h1` ran its own gradient-clip. A live-rendered scan caught both; both are now solid color.
- **Don't** animate layout properties — `width`, `height`, `max-height`, `padding`, `margin`. Use `transform`/`opacity`, or `grid-template-rows: 0fr → 1fr` for height. Four instances remain in [pool.css:651](pool.css#L651), [accueil.css:510](accueil.css#L510), and [draftActif.css:165](draftActif.css#L165).
- **Don't** use overshoot or bounce easing (`cubic-bezier(0.68,-0.55,0.265,1.55)` and relatives) on ordinary state transitions. **Exception:** genuine celebration/success moments — the draft pick reveal, the trade-sent success check ([trade.css:272](trade.css#L272)) — may use `cubic-bezier(.34,1.56,.64,1)`. A dropdown is not a celebration, and neither is a confirmation dialog: [trade.css:1594](trade.css#L1594)'s `.trade-confirm-box` used the same bounce on its entrance and was moved to the standard ease.
- **Don't** apply colored glow to elements at rest. Glow is live/focus state; elevation is the surface ladder and neutral shadow.
- **Don't** add a decorative colored border on one side of a card ([accueil.css:293](accueil.css#L293), [pool.css:842](pool.css#L842)). The table row's 3px stripe is exempt: it appears only on hover/focus and signals that the row is actionable — that is an affordance, not ornament.
- **Don't** introduce a second accent hue, and in particular don't bring Apple's blue back for links: 12 of the 32 clubs have a navy or blue main color, and a blue tint would blur into them. If something needs to stand out and red is taken, the answer is hierarchy, weight, or space.
- **Don't** name a token for what it looks like in one theme. `--card-white` resolves to `#242827`, a dark gray; new tokens are named by role.
- **Don't** ship a phone layout that ignores the fixed bottom navigation's 80px reservation.
- **Don't** treat the Dense UI Micro tier (~0.5–0.58rem) as settled. A live-rendered pass measured position-abbreviation and initials text there at 8.96–10.56px, under the 11px legibility floor that caught and fixed the old Meta step. Unlike Meta, Micro's uses (three-letter position badges, player initials) sit in tight fixed-size containers — raising them needs a per-component check, not a blanket find-replace.
