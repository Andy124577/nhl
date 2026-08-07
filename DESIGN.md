---
name: Fantazy
description: The broadcast desk for a hockey pool — dark set, luminous data, team colors as the only chroma that moves.
colors:
  rink-ice-cyan: "#00D4FF"
  goal-green: "#00E676"
  penalty-red: "#FF4757"
  bench-amber: "#FFB300"
  rookie-orchid: "#CE93D8"
  arena-black: "#0A0A1A"
  deep-ice-navy: "#0D0D1F"
  board-navy: "#161630"
  board-navy-raised: "#1A1A38"
  press-box-black: "#080816"
  rink-line: "#1E1E3C"
  scoreboard-white: "#FFFFFF"
  ice-white: "#E8EAFF"
  broadcast-lavender: "#7B8CC4"
  muted-slate: "#5A6B9A"
  far-slate: "#3D4F70"
  seam-navy: "#1E2048"
  edge-navy: "#2A2D5A"
  shadow-navy: "#141430"
  row-navy: "#131328"
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
    backgroundColor: "{colors.rink-ice-cyan}"
    textColor: "{colors.arena-black}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.rink-ice-cyan}"
    textColor: "{colors.arena-black}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.scoreboard-white}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
    height: "48px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.broadcast-lavender}"
    rounded: "{rounded.lg}"
    padding: "15px 32px"
  input-field:
    backgroundColor: "{colors.shadow-navy}"
    textColor: "{colors.scoreboard-white}"
    rounded: "{rounded.lg}"
    padding: "13px 16px"
    height: "48px"
  card-surface:
    backgroundColor: "{colors.board-navy}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.xxl}"
    padding: "28px 28px 24px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.broadcast-lavender}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.seam-navy}"
    textColor: "{colors.scoreboard-white}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  badge-label:
    backgroundColor: "transparent"
    textColor: "{colors.rink-ice-cyan}"
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
    textColor: "{colors.rink-ice-cyan}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  position-badge-gar:
    backgroundColor: "transparent"
    textColor: "{colors.bench-amber}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
---

# Design System: Fantazy

## Overview

**Creative North Star: "The Broadcast Desk"**

Fantazy looks like the studio a hockey broadcast is called from: a dark set, a wall of numbers that has already been organized for you, and light used sparingly — only where something is live. The desk has authority because it is calm. It does not shout the score; it shows you the score, correctly, faster than you could have assembled it yourself. Every screen is a surface someone reads under time pressure, usually on a phone, sometimes with four friends waiting on their turn.

The system runs dark by default and near-monochrome by construction. Backgrounds sit in a narrow band of blue-blacks (`arena-black` through `board-navy`); text sits in a matching band of blue-whites. Against that, exactly one accent — **Rink Ice Cyan** — carries interactivity and liveness, and a small semantic set (green / amber / orchid / red) carries meaning that is not decoration: a player's position, a warning, a failure. The only chroma allowed to move freely is the NHL club palette, which enters the interface through team logos and the draft pick cards. That restraint is what lets a Colorado burgundy or a Nashville gold read instantly when it appears — it is the only unexpected color on screen.

Density is deliberate and high. This is a statistics product; tables are the primary component, not a fallback. Numbers set in monospace, positions demoted to a secondary line, whole rows made clickable rather than a small link — these are the system's real decisions. Ornament is spent almost nowhere so that the data can be dense without becoming loud.

**Key Characteristics:**
- Dark-first, with a full light theme as a peer, not an afterthought
- One accent hue; semantic color reserved for meaning, never for decoration
- Condensed display type (Bebas Neue) against a plain system sans body
- Monospace numerals wherever figures are compared down a column
- Tables and cards as the primary components; phone-first at every breakpoint
- NHL club colors are the only free chroma, and they belong to real teams only

## Colors

A narrow band of blue-blacks and blue-whites, cut by a single emitted cyan, with a small semantic set that only ever means something.

### Primary
- **Rink Ice Cyan** (`{colors.rink-ice-cyan}`): the one accent. It marks what is interactive, focused, live, or currently yours: primary buttons, the active nav item, focus rings, sortable-header state, the current pick in the draft order. In the light theme it deepens to `#0088AA` to hold contrast on pale surfaces.

### Secondary
- **Goal Green** (`{colors.goal-green}`): success, completed actions, and the **attaquants** position badge.
- **Bench Amber** (`{colors.bench-amber}`): warnings, cautionary states, and the **gardiens** position badge.
- **Penalty Red** (`{colors.penalty-red}`): destructive actions, errors, and irreversible confirmations only. Never a decorative accent, never a brand color.

### Tertiary
- **Rookie Orchid** (`{colors.rookie-orchid}`): the **rookies** category badge. A single, narrow job.
- **NHL club colors**: sourced from the static table in [teamColors.js](teamColors.js), two per club (primary + secondary). They enter only through team identity — logos, and the pick card's `--team-accent` bottom rule. The second color exists to separate clubs that share a navy (Buffalo, Columbus, Florida). These are real brand colors of real organizations: never invent one, never assign one to a non-team.

### Neutral
- **Arena Black** (`{colors.arena-black}`): the deepest ground; app background and the text color that sits *on* cyan buttons.
- **Deep Ice Navy** (`{colors.deep-ice-navy}`): the page canvas — one step up from arena black.
- **Board Navy** (`{colors.board-navy}`) / **Board Navy Raised** (`{colors.board-navy-raised}`): card and panel surfaces, the two rungs of tonal layering.
- **Press Box Black** (`{colors.press-box-black}`): navigation chrome, darker than the page so the bar reads as a fixed frame.
- **Rink Line** (`{colors.rink-line}`) / **Seam Navy** (`{colors.seam-navy}`) / **Edge Navy** (`{colors.edge-navy}`): the border ladder, from barely-there chrome division to an input's visible stroke.
- **Scoreboard White** (`{colors.scoreboard-white}`): primary text, reserved for the sharpest line on screen.
- **Ice White** (`{colors.ice-white}`): default body text — slightly cooled and softened so long tables don't glare.
- **Broadcast Lavender** (`{colors.broadcast-lavender}`): secondary text, labels, and inactive navigation.
- **Muted Slate** (`{colors.muted-slate}`) / **Far Slate** (`{colors.far-slate}`): placeholders and disabled text; the last two rungs before invisible.
- **Shadow Navy** (`{colors.shadow-navy}`) / **Row Navy** (`{colors.row-navy}`): input wells and table row fills.

### Light theme

Light is a full peer theme, applied via `html[data-theme="light"]` and set before first paint by [theme.js](theme.js). It is not an inversion: hues are re-picked for contrast on pale ground. The overrides live in `.impeccable/design.json` under `extensions.themes.light`; the load-bearing ones are page `#E8EBF5`, card `#FFFFFF`, primary `#0088AA`, body text `#1E2440`.

### Named Rules

**The One Live Signal Rule.** Rink Ice Cyan means *live, focused, or actionable*. If an element is none of those three, it does not get cyan. A screen with cyan in six places has six things claiming to be the live one, which means it has none.

**The Real Teams Only Rule.** Chroma outside the semantic set may only come from `NHL_TEAM_COLORS`, and only attached to the club it belongs to. No invented team colors, no club palette borrowed for a UI accent.

**The Semantic Set Is Closed Rule.** Green, amber, orchid, and red carry position and status. They are never chosen for variety. If a new state needs a color, it earns one of the existing four or it uses the neutral ladder.

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

**The Two-Line Player Rule.** A player's name and their position are two facts of different weight and never read as one string. Name at 700; position demoted to a `0.74em` secondary line in lavender ([index.css:1683](index.css#L1683)). Never `Nom, ATT`.

## Layout

**Phone-first, always.** Base rules describe the phone; `min-width` queries enrich upward. [draftActif.css](draftActif.css) is the reference implementation of this and the file to copy when starting a new surface.

**Breakpoints.** Normalize on three: **480px** (small phone), **768/769px** (phone → desktop), **1024px** (wide). The codebase currently also contains 500, 599/600, 640, 700, 760, 900, 1100, and 1300 — that is drift, not a system. New work uses the three.

**Navigation topology changes at 768px.** Above it, a 70px sticky top bar with inline links and the pool selector. At or below it, the top bar compresses to 60px (56px under 480px), the inline links disappear, and a fixed **bottom navigation bar** takes over with 64px-minimum touch targets. `body` carries `padding-bottom: 80px` on phones to clear it. Any new full-page surface must account for that bottom bar.

**Containers.** App content maxes at 1800px in the navbar frame; forms and single-column flows sit far narrower (≈720px) and center. The pool rail is a fixed 268px (`--fz-rail-w`).

**Rhythm.** An 8px base step: 4 / 8 / 12 / 16 / 20 / 24 / 32. Card padding is 28px on desktop and 22px 20px on phones. Form groups stack at 18px; form rows are a two-column grid with a 16px gutter that collapses to one column on phones.

**Tables are the primary layout.** Rows are separated (a 12px-radius pill per row via first/last-cell radii) rather than zebra-striped, the rank column locks to 44px under 700px, and horizontal scroll is contained inside the table's own wrapper — never the page body.

### Named Rules

**The Bottom Bar Reservation Rule.** On phones the bottom 80px belongs to navigation. Nothing sticky, floating, or action-critical may live there.

**The Page Never Scrolls Sideways Rule.** Wide content (tables, pick strips, career logs) scrolls inside its own `overflow-x: auto` container. Decorative glow blobs are clipped by their parent ([index.css:157](index.css#L157)) precisely because they used to break this.

## Elevation & Depth

Depth comes from **tonal layering first, neutral shadow second, and colored glow almost never.** The ground is `arena-black`; the page sits on `deep-ice-navy`; panels rise to `board-navy` and `board-navy-raised`; borders in the navy ladder mark the seams. That stack does most of the work, and on flat surfaces it should do all of it.

Neutral shadow is reserved for genuine z-separation — things that float above the page and could be dismissed: modals, dropdowns, drawers, toasts. Colored cyan glow is **state, not elevation**: it appears on focus and on live/current elements, and it disappears when that state does.

> **Migration note.** The incumbent code does not match this yet: `--glow-primary` is applied at rest in 27 places, including buttons and cards that are not live. That is the documented drift to close. Existing glow-at-rest is legacy; new work uses the ladder below.

### Shadow Vocabulary
- **elevation-1** (`0 1px 2px rgba(0,0,0,.28)`): resting separation for a raised row or chip. Use rarely; a border is usually enough.
- **elevation-2** (`0 2px 8px rgba(0,0,0,.32)`): hovered cards, popovers, the sticky header once the page has scrolled.
- **elevation-3** (`0 8px 32px rgba(0,0,0,.38)`): dropdowns, drawers, the user menu.
- **elevation-4** (`0 20px 50px rgba(0,0,0,.55)`): modals and full overlays only.
- **focus-ring** (`0 0 0 3px rgba(0,212,255,.15)`): every focusable control, paired with a `--primary` border shift. Already the pattern in [pool.css:435](pool.css#L435).
- **glow-live** (`0 0 20px rgba(0,212,255,.25)`): the current pick, an active turn, a live indicator. State only.

### Named Rules

**The Glow Means Live Rule.** Colored glow is never elevation. If the element would look the same when nothing is happening, it must not glow.

**The Border Before Shadow Rule.** Reach for a `seam-navy` border before reaching for a shadow. On a dark ground a 1px seam separates surfaces more cleanly than a shadow can, and it costs nothing to paint.

## Shapes

Rounded, tactile, and consistently soft — this is a touch product and the geometry says so. The radius ladder runs **6px** (micro badges) → **8px** (small chips, table headers) → **10px** (navigation items, selects) → **12px** (the workhorse: buttons, inputs, cards, table rows) → **14px** (full-width primary actions) → **18px** (large form and panel cards), with **999px** for pills and **50%** for avatars and status dots. Twelve is the default; when in doubt, use 12px.

Borders are the primary edge language: 1px `seam-navy` for surface seams, 2px `edge-navy` for form controls that must look grabbable. Inputs are wells — a darker fill than their card — rather than outlined boxes on the same plane.

Two silhouettes recur and are worth protecting: the **row-as-pill** (a table row whose first and last cells carry the 12px radius, so a dense table reads as a stack of separated objects) and the **team-accent card** (a neutral dark card with a 3px bottom rule in the club's secondary color).

### Named Rules

**The Twelve Rule.** 12px is the default radius. Deviating requires a reason that is about size — micro elements go down, full-bleed actions and large panels go up. Never mix three radii inside one card.

## Components

### Buttons
Tactile and confident: real weight, a clear press, and hit areas built for a thumb.

- **Shape:** softly rounded (12px; 14px for full-width primary actions), minimum 44px tall, 48px for primary.
- **Primary:** cyan fill, `arena-black` text, 800 weight, `15px 32px`. The dark-text-on-cyan pairing is deliberate and non-negotiable — white on `#00D4FF` fails contrast.
- **Hover / Focus:** `translateY(-3px)` lift over 0.2s with `cubic-bezier(.4,0,.2,1)`, plus the elevation-2 shadow. Focus-visible additionally draws the focus ring. `:active` returns to `translateY(0)` — the press must be felt.
- **Secondary:** transparent with a 2px light border; on hover the border and label both shift to cyan and the fill lifts to `rgba(255,255,255,.07)`.
- **Tertiary:** text only, lavender, no border; hover shifts to cyan with a 2px lift.
- **Disabled:** `opacity: .5`, `cursor: not-allowed`, and the hover transform suppressed. Never remove the label.

### Cards / Containers
- **Corner Style:** 18px for form and panel cards, 12px for content and player cards.
- **Background:** `board-navy`, or a translucent navy with an 18px backdrop blur where content sits behind it ([pool.css:346](pool.css#L346)).
- **Shadow Strategy:** flat at rest with a 1px `seam-navy` border; elevation-2 appears on hover for interactive cards only.
- **Border:** 1px `seam-navy`, shifting to `rgba(0,212,255,.28)` on hover when the card is actionable.
- **Internal Padding:** 28px desktop / 22px 20px phone; header block separated by 24px.

### Inputs / Fields
- **Style:** a well — `shadow-navy` fill, 2px `edge-navy` border, 12px radius, `13px 16px` padding, 600 weight at 1rem (16px, which is also what stops iOS from zooming on focus).
- **Focus:** border to cyan plus the `focus-ring` shadow. Never remove the outline without replacing it.
- **Selects:** native `appearance: none` with an inline SVG chevron in `broadcast-lavender`, 40px right padding.
- **Numeric inputs:** center-aligned at 1.15rem — they are values, not sentences.
- **Placeholder:** `muted-slate` at weight 400, so it never reads as a filled value.

### Navigation
- **Desktop (≥769px):** 70px sticky bar on `press-box-black` with a bottom `rink-line` border. Links are 600-weight lavender pills at `10px 16px`, 44px minimum; hover tints cyan at 10% and lifts 2px; the active item takes a cyan-tinted fill plus a 3px cyan rule along its bottom edge.
- **Phone (≤768px):** the bar compresses and a fixed bottom nav appears — 5 icon+label items, 64px minimum height, label at 0.75rem/700. The active item is marked by a 3px rule along its *top* edge, mirroring the desktop treatment.
- **Notification badge:** a `penalty-red` pill at the avatar's top-right with a 2px `press-box-black` ring so it separates from whatever is behind it.

### Tables
The workhorse. Rows read as separated objects, not grid lines.

- Header cells are uppercase labels; sortable headers carry `cursor: pointer`, a hover fill, and a caret that shows direction in the data itself.
- `tbody` rows are pills: 12px radius on the first and last cells, `row-navy` fill, 1px `seam-navy` top and bottom. Zebra striping is switched off because separation already exists.
- Actionable rows use a 3px cyan stripe on `::after` that fades in on hover **and** `:focus-visible` — the whole row is the target (Fitts), and keyboard users get the same signal a cursor gives.
- Numeric columns are selected structurally and set in JetBrains Mono; the photo and name columns are excluded by position.

### Pick Card (signature)
The draft room's identity object, and the only place club chroma enters the layout.

- A neutral dark card carrying a 3px bottom rule in `--team-accent`, the club's *secondary* color — chosen so two clubs sharing a navy still separate at a glance.
- **Upcoming / skipped:** no club is known yet, so no club color — the card goes neutral gray at `opacity: .8` (skipped: `.5`), letting completed picks dominate the strip.
- **Current:** `--team-accent` becomes cyan, the border lifts to `rgba(0,212,255,.5)`, and `turnPulse` runs a 2.4s expanding ring. This is the single most important state in the product.
- **Revealing:** a ~1150ms sequence where the card arrives desaturated, color rises, then the name lands — animating only `opacity`, `transform`, and `filter`, with `will-change` set only for the duration and only one card at a time.

## Do's and Don'ts

### Do:
- **Do** define every color as a token in [index.css](index.css) and consume it as `var(--token)`. Both the `:root` default and the `html[data-theme="light"]` override, in the same commit — a token added to only one theme is a bug in the other.
- **Do** write phone-first: base rules for the phone, `min-width` queries to enrich. Copy [draftActif.css](draftActif.css)'s structure for new surfaces.
- **Do** keep to the three breakpoints — 480px, 768/769px, 1024px.
- **Do** use 12px as the default radius and step off it only for size reasons.
- **Do** set column-comparable numbers in JetBrains Mono, selected structurally rather than class-by-class.
- **Do** pair every hover affordance with a `:focus-visible` equivalent. The row stripe already does this; everything new must too.
- **Do** animate with `transform`, `opacity`, and `filter`, on `cubic-bezier(.4,0,.2,1)` at 0.2s (0.3s for larger movements), and honor `prefers-reduced-motion` — six stylesheets already do.
- **Do** give touch targets at least 44px, and 64px in the bottom nav.
- **Do** use real NHL club colors from [teamColors.js](teamColors.js), attached only to the club they belong to.

### Don't:
- **Don't** hardcode a hex outside the token layer, and **don't redeclare `:root` in a page stylesheet.** [trade.css:5](trade.css#L5) and [legal.css:3](legal.css#L3) do this today with *drifting* values (`--danger: #FF5252` vs `#FF4757`; `--bg-page: #050510` vs `#0D0D1F`) and ship no matching light-theme block, so those pages break in light mode. Page stylesheets specialize; they never redefine the palette.
- **Don't** use gradient text. The animated `.gradient-text` treatment ([index.css:134](index.css#L134), [accueil.css:90](accueil.css#L90)) is retired: headlines are solid `scoreboard-white`, with cyan available for a single emphasized span.
- **Don't** animate layout properties — `width`, `height`, `max-height`, `padding`, `margin`. Use `transform`/`opacity`, or `grid-template-rows: 0fr → 1fr` for height. Four instances remain in [pool.css:651](pool.css#L651), [accueil.css:510](accueil.css#L510), and [draftActif.css:165](draftActif.css#L165).
- **Don't** use overshoot or bounce easing (`cubic-bezier(0.68,-0.55,0.265,1.55)` and relatives) on ordinary state transitions. **Exception:** genuine celebration moments — the draft pick reveal — may use `cubic-bezier(.34,1.56,.64,1)`. A dropdown is not a celebration.
- **Don't** apply colored glow to elements at rest. Glow is live/focus state; elevation is neutral shadow.
- **Don't** add a decorative colored border on one side of a card ([accueil.css:293](accueil.css#L293), [pool.css:842](pool.css#L842)). The table row's 3px stripe is exempt: it appears only on hover/focus and signals that the row is actionable — that is an affordance, not ornament.
- **Don't** introduce a second accent hue. If something needs to stand out and cyan is taken, the answer is hierarchy, weight, or space.
- **Don't** put white text on `rink-ice-cyan`. Cyan fills take `arena-black` text.
- **Don't** name a token for what it looks like in one theme. `--card-white` currently resolves to `#1A1A38`, a dark navy; new tokens are named by role.
- **Don't** ship a phone layout that ignores the fixed bottom navigation's 80px reservation.
