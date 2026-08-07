---
target: draftActif.html
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-07T22-07-11Z
slug: draftactif-html
---
Method: dual-agent (A: a3de260cab0fc9f62 · B: a58592962e8e47e00)

Surface mode: **Operate** — the visitor's success is completing a pick under time and social pressure.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No connection state (no `disconnect`/`connect_error` handler), no clock, `#dop-fill` progress bar has CSS but no element, `loadDraftData` catch is `console.error` only — a dead network shows a stale board forever. |
| 2 | Match System / Real World | 2 | JS rewrites table headers into English on a French product ("Player", "Goalie", "Wins"); `document.title = "Draft Actif"` abandons *repêchage*; raw DB enums (`offensive`, `teams`) and undefined position codes (`*`) surface to users. |
| 3 | User Control and Freedom | 2 | Enter while focused on **Annuler** drafts the player (draftPickFlow.js:172). Career modal has no Escape and a non-focusable `<span>` close. |
| 4 | Consistency and Standards | 2 | Two conflicting table implementations (§17 vs §18) leaving ~150 lines of dead CSS; two icon systems (inline SVG + raster PNG); `role="tablist"` with no `aria-controls`, no tabpanel, no arrow keys. |
| 5 | Error Prevention | 3 | The strongest area: confirm dialog names the player and states "Ce choix est définitif et occupera votre ronde N, choix M", with a double-submit lock and exhausted-category auto-switch. Docked because search silently no-ops on 2 of 6 categories. |
| 6 | Recognition Rather Than Recall | 2 | Your own team is never named on screen; pool name absent below 1100px; the current picker's name is the *smallest* text on the current card while its label "AU TOUR DE" is larger. |
| 7 | Flexibility and Efficiency | 2 | Carousel arrow keys, drag, snap-to-center and render reconciliation are real craft — but there is no keyboard path into a player row, no queue/watchlist, no "best available for the slot I still need". |
| 8 | Aesthetic and Minimalist Design | 2 | The pick card is excellent; around it, eight elements compete for cyan and the sticky header + bottom nav consume ~43% of a 390×844 phone before content starts. |
| 9 | Error Recovery | 1 | Every error is a generic modal carrying a raw server string with an OK button and no recovery path. Nothing is announced to assistive tech. Network failures never surface at all. |
| 10 | Help and Documentation | 1 | Zero. No orientation, no snake-draft explanation, no legend for done/current/upcoming/skipped (conveyed by opacity alone), no definition of `*`. The only help is `title` attributes, invisible on touch. |
| **Total** | | **19/40** | **Poor — core experience has broken pieces** |

## Design Specificity Verdict

**LLM assessment.** This is the rare case where the *signature object* is deeply specific and the *screen it lives on* is not. `draftPickCards.js` is genuinely about live hockey drafting: `buildPickSlots` reconciles the snake order against pick history with a cursor so a server-side skip doesn't desynchronize the strip; `reconcilePickCards` keys each card on `etat|numero|ronde|equipePool|player|position` and touches only what changed, which is what lets an animation survive the three refreshes a single pick triggers; `playPickReveal` waits on the real NHL CDN image before starting so the grayscale phase doesn't play over an empty frame; `pickCardMuteRatio` scales desaturation by luminance so a Nashville gold gets pulled down harder than a Boston black, while `--team-accent` keeps the *secondary* club color vivid on a 3px rule specifically so Buffalo and Columbus separate. None of that reasoning could be transplanted into a generic list app.

Everything below the sticky header could be. Strip the pick strip out and what remains is a search field, a sort dropdown, six category pills, and a table of ~150 rows each ending in an icon button — the composition of any "pick an item from a table" product. The information architecture is category-first (filter → sort → scan), not moment-first. Nothing in the layout knows this is a turn-based event: the turn state is a 22px pill wedged between "Choix 12 / 60" and "Ronde 2 / 6", competing with a cyan table header, a cyan PTS column on every visible row, six cyan category pills at rest, a cyan refresh icon, and five cyan progress bars. DESIGN.md's own One Live Signal Rule names the failure exactly — "a screen with cyan in six places has six things claiming to be the live one, which means it has none" — and this page has eight.

The bigger tell is what the composition omits. There is no clock anywhere in a product positioned as "a free, real-time live draft room" — and `server.js`'s `/pick-player` has no deadline and no auto-skip either, so that is a product stance, not just a UI gap. There is no presence. Your own team name is never displayed. The pool name appears nowhere below 1100px. And the ending — the moment everyone remembers — is a blank rectangle. The page never composes around the two facts that make this product what it is: *it is your turn*, and *nine people are watching*.

**Deterministic scan.** Markup run clean (exit 0, 0 findings — expected, all styles are external). Stylesheet run across the 6 sheets this page loads: **exit 2, 269 findings** — 265 `design-system-*` advisories (166 font-size, 61 color, 36 radius off the documented ramps), plus 4 slop warnings and 2 layout-transition warnings. Distribution: index.css 85, draftActif.css 80, navbar.css 49, poolNav.css 30, career-modal.css 24, skeleton-loader.css 1.

Confirmed genuine: `.dop-fill { transition: width .45s }` (draftActif.css:165) and `.progress-mini-fill { transition: width .4s }` (draftActif.css:266) — ordinary recurring UI transitions on layout properties, and notably the two things `prefers-reduced-motion` does *not* neutralize. Also `#00A8CC` appears as an undocumented literal 6 times across index.css and draftActif.css, always paired with `var(--primary)` in a gradient: a repeated brand-cyan variant that never became a token.

**Detector false positives, confirmed by reading the code:** both `side-tab` hits are wrong. `index.css:1700` and `navbar.css:553` are 3px bars at `opacity: 0` that appear only on `:hover`/`:focus-visible`, with comments citing Fitts's Law and explaining they replace a padding shift. Those are affordances, not ornament. The detector also correctly did *not* flag the pick-reveal keyframes — verified that they animate only `opacity`, `transform`, `filter`, and `border-color`.

**Where the detector beat the review:** contrast. Assessment A flagged `--text-secondary` #7B8CC4 as a risk; computed, it is **5.36:1 on `--card` — it passes**. What actually fails is different and worse: `--text-light-gray` #3D4F70 on `--bg-gray-light` is **2.18:1**, failing even the 3:1 non-text threshold, and it is in live use on the roster-progress avatar placeholder and the empty-state icon. And in light theme, the primary button gradient (`linear-gradient(135deg, var(--primary) 0%, #00A8CC 100%)` — used by `.select-button`, `.custom-alert-button`, `.pick-confirm-btn.is-primary`) puts `--bg` #F0F2FA label text at **3.68:1 at the gradient's start and 2.51:1 at its end**. The primary action button of a phone-first product fails contrast in light mode.

**Visual overlays:** not available. No browser automation tool is exposed in this session, so no server was started, no injection was attempted, and no user-visible overlay exists. Everything above is read from source and computed statically.

## Overall Impression

There is exceptional craft here sitting inside a screen that doesn't yet know what it's for. The pick-card system is the best-engineered thing in this repo — genuinely authored, genuinely specific, written by someone who watched a real draft run and fixed what they saw. Then the surface around it is organized like a stats table with a draft bolted on top: the one state the room exists to communicate is the least prominent thing on the phone, and the two moments that decide whether a pool survives — *your turn just started* and *the draft just ended* — are the two moments most broken.

The single biggest opportunity: **compose the screen around the turn.** Not more features. Take cyan away from the seven things that aren't live, give the turn banner real size and a real announcement across four channels, and build the ending that the reveal animation has already earned.

## What's Working

**1. The pick card system** (`draftPickCards.js` entire, plus draftActif.css:534-766). It works because it's built from the mechanics of the actual event rather than from a card component. Reconciliation keyed on real state, a reveal gated on `img.load` with a 1200ms ceiling, `loading="lazy"` flipped to `eager` because the reveal fires before the recenter scroll brings the card into view. Every one of those exists because someone watched this run.

**2. The club-color mixing** (draftPickCards.js:92-124 + teamColors.js). `pickCardMuteRatio = 0.45 + min(0.30, luminance × 0.55)` mutes bright clubs harder than dark ones so a 20-card strip doesn't read as a paint chart, then keeps the club's *secondary* color at full saturation on the bottom rule to separate two navy clubs. That is an articulated, defensible reason for a color decision.

**3. The three-section flex row** (draftActif.css:1926-2075). Converting table rows to `display: flex` with `--col-rank / --col-stat / --col-action` yields aligned numeric columns, a 66-92px action target instead of a squeezed cell, and no horizontal scroll at 390px. The math closes: the goalie view at ≤480px is 44 + 3×32 + 66 = 206px, leaving ~160px for the name. And the comment explains *why*, not *what*.

## Priority Issues

### [P0] "It's your turn" reaches the user through four channels, and all four fail on a phone

**Why it matters.** This is the one synchronous moment in the product. On a phone the tab is backgrounded or the screen is off half the time. Because there's no turn timer and no auto-skip server-side, a missed turn doesn't cost *you* a pick — it freezes the whole room indefinitely for everyone. PRODUCT.md: "a pool that stalls or breaks there never becomes a season."

Verified: `#turn-banner` has no `aria-live` or `role="status"` (zero `aria-live` across the page and all five scripts). `playTurnSound` constructs an `AudioContext` with no preceding user gesture and calls `resume()` **zero times** — Chrome and Safari leave it suspended, so the beep is silent. `startTitleFlash` only runs when `document.hidden`, and iOS doesn't surface tab titles for a home-screen app. No vibration, no Notification, no clock.

**Fix.** `role="status" aria-live="assertive"` on `#turn-banner`. Hoist the `AudioContext` to module scope, create it on the first `pointerdown` anywhere on the page, and `await ctx.resume()` before playing. Add `navigator.vibrate?.([120, 60, 120])`. Request Notification permission once when the room opens, fire when `document.hidden && isUserTurn()`. Treat the beep as one channel of four, not the channel.

**Suggested command:** `/impeccable harden draftActif.html`

### [P0] The draft ends on an empty rectangle, and the completion copy is written to elements that don't exist

**Why it matters.** Peak-end rule applied to the product's defining event. The last thing ten people see together is a blank table and a floating green button labelled "Terminer le draft" — which sounds destructive and is actually a redirect to `classement.html`. You never see your finished roster.

Verified: `updateTable()` and `populateTable()` write the celebration into `$("#draft-status")`; that ID appears **zero times** in `draftActif.html`, along with `#draft-title`, `#current-pick-number`, `#current-pick-team`, `#draft-clan-name`, `#dop-fill`, `#teamsContainer`, `#selectedPlayersContainer`. `refreshTableEmptyState` explicitly returns when complete, so the emptied table gets no copy either. And `isDraftComplete()` is literally `return 0===draftData.draftOrder.length||checkIfAllTeamsAreDone()` — pools initialize with `draftOrder: []`, so opening the room before the order exists fires confetti, shows "Terminer le draft" over an empty table, *and* burns the once-per-pool `confettiFired_<pool>` flag so the real ending gets none.

**Fix.** Build a real completion panel into the markup occupying the space the table vacates: your finished roster grouped by position, the final pick's card enlarged, the pool name, a primary "Voir le classement". Gate completion on `draftOrder.length > 0 && checkIfAllTeamsAreDone()` and give the unstarted case its own state. Then either ship the `.dop-fill` bar (its CSS at draftActif.css:160 is already written) or delete it.

**Suggested command:** `/impeccable onboard draftActif.html` (empty, unstarted, and completed states)

### [P1] No connection state and no turn clock: one phone losing signal freezes the room silently

**Why it matters.** Ten people on phones; one walks into a parking garage; the other nine watch a cyan card pulse while the banner still reads "⏳ 3 choix avant votre tour". They cannot tell whether the app broke, the socket dropped, or the person left. This is the specific failure mode that kills pools.

`socket.on` is registered only for `draftUpdated` and `forceRefresh`. No `disconnect`, `connect_error`, or `reconnect` handler; no `navigator.onLine` listener; `loadDraftData`'s catch is `console.error`. The 7-second poll is the only fallback and it also fails silently.

**Fix.** A persistent connection chip in the sticky header (`disconnect` → amber "Reconnexion…", `connect` → clear), with pick buttons disabled while down. Show elapsed time on the current pick card ("Choisit depuis 2 min") so lag reads differently from stalling. Server-side: a per-turn deadline with auto-skip, or at minimum a "Sauter ce tour" action for the pool creator after N minutes.

**Suggested command:** `/impeccable harden draftActif.html`

### [P1] The keyboard and screen-reader path is broken exactly at the irreversible decision

**Why it matters.** The dialog's own copy says "Ce choix est définitif." The cancel gesture performs the irreversible action.

Verified at draftPickFlow.js:169-173: a `document`-level keydown handler where `Enter` calls `e.preventDefault(); confirmerPickConfirm();`. A keyboard user focused on **Annuler** who presses Enter drafts the player, because `preventDefault()` suppresses the button's own activation. There's no focus trap and the page behind isn't `inert`, so Tab walks out into the live table. Compounding it: `showCustomAlert` has no `role="alertdialog"` and never moves focus, so "Ce n'est pas votre tour", "Ce joueur a déjà été sélectionné" and "Tour sauté" are silent to AT. `tr.clickable-player-row` has a `:focus-visible` rule but no `tabindex` and no `role`, so career stats are keyboard-unreachable. The 150 select buttons all have the identical accessible name "Sélectionner" with no player name. `role="tablist"`/`role="tab"` are set with no `aria-controls`, no tabpanel and no arrow-key handler — the ARIA promises a keyboard model that doesn't exist. And there is **no `<h1>` in the document**; heading order is five `<h3>`s followed by one `<h2>`.

**Fix.** Scope the Enter handler to the overlay and skip it when `document.activeElement` is a button inside the dialog. Add a two-element focus trap; `aria-hidden="true"` on the page behind. `role="alertdialog"` + focus move on `showCustomAlert`. `tabindex="0"` + `role="button"` on player rows. Give each select button `aria-label="Sélectionner ${playerName}"`. Either complete the tab pattern (`aria-controls`, roving tabindex, arrow keys) or drop the roles and use plain buttons.

**Suggested command:** `/impeccable audit draftActif.html`

### [P1] The phone-first primary action fails this project's own touch and contrast floors

**Why it matters.** PRODUCT.md makes phone operability a functional requirement, and DESIGN.md sets a 44px floor. The buttons that perform the product's core action miss it at every breakpoint, and in light theme their labels fail contrast.

Cascade-resolved measurements: `#playerTable td.action-column button.select-button` = **40px above 480px, 38px at ≤480px**. `.draft-header .carousel-btn` = **30px at all widths**. Plain `button.select-button` and `.category-tab` both resolve to **34px**, because a later same-specificity rule (draftActif.css:1774, 1904) silently overrides the 40px rules at 946 and 1607. Meanwhile `.search-input` at draftActif.css:781 correctly sets 44px with the comment "cible tactile confortable" — the floor is understood, just not applied to the buttons that matter. Contrast: light-theme primary button label is **3.68:1 → 2.51:1 across the gradient**; `--text-light-gray` on `--bg-gray-light` is **2.18:1** and in live use.

**Fix.** Delete the duplicate 34px rules, set 44px on every `.select-button`, `.category-tab`, and `.panel-tab`, and take `.carousel-btn` to 44px. Replace the light-theme button gradient with a flat `--primary` fill and re-check the label, or darken the gradient end. Retire `--text-light-gray` from anything that must be perceived.

**Suggested command:** `/impeccable adapt draftActif.html`

## Also significant

- **[P2] Eight things claim to be live at once, and the turn state loses.** Cyan on: `#dop-round`, all six category pills at rest, the active pill, the whole `thead`, the PTS header, `td.points-column` on every row, the refresh icon, and five progress emoji/bars. Reclaim cyan for three things — the current pick card, the turn banner, and focus rings — and let the banner grow to full width and 44px.
- **[P2] Search silently does nothing on Gardiens and Équipes.** The filter runs `skaterFullName.toLowerCase().includes(t)`; the goalies and teams branches return before it. Typing "Hellebuyck" with Gardiens active changes nothing and produces no message. Two of six categories ship a search field that lies.

## Persona Red Flags

**Casey (distracted mobile, one thumb, gets interrupted, slow connection).** Screen budget: 56px navbar + ~230px sticky draft header + 80px bottom-nav reservation = **~366px of an 844px viewport gone before content**. After six wrapping category pills, the search row and the sort row, she sees roughly **five player rows**, and picks from ~150 through a ~270px window. Carousel buttons are 30×30px in that header. She backgrounds the app; the beep is silent (suspended `AudioContext`) and the title flash is invisible on iOS — she returns to find the draft frozen on her with nine people waiting. `setInterval(loadDraftData, 7000)` refetches `/draft` with `cache: "no-store"` for the entire session on top of the socket, and every search keystroke rebuilds 150 rows plus ten avatar rows. The sticky header carries `backdrop-filter: blur(10px)` over an opaque background — it composites every scroll frame and shows nothing.

**Sam (screen reader + keyboard only).** He is never told it is his turn: zero `aria-live` on the page. He is never told about errors: `showCustomAlert` has no role and never moves focus. Enter on Annuler drafts the player, and Tab escapes the dialog into the live table. If he also runs `prefers-reduced-motion`, the reveal is skipped **and** `notifyPickResult` suppresses the success message on the theory that the reveal is the confirmation — **his pick is confirmed by nothing at all.** Player rows have a `:focus-visible` style but no `tabindex`. 150 buttons share the accessible name "Sélectionner". The career modal's close is a non-focusable `<span>` with no Escape. `--text-light-gray` at 2.18:1 fails even the non-text threshold; the light-theme active pill and PTS header sit at ~3.7:1 at roughly 10px. Disabled categories are explained only by a `title` tooltip, invisible on touch.

**Jordan (first-timer, joined a stranger's open pool, nobody to ask).** "Which team am I?" — unanswerable; `getUserTeam()` exists in JS and is never rendered, and the server auto-names teams `Équipe 1…10`. "Which pool is this?" — unanswerable below 1100px. "What am I supposed to pick?" — the quotas live behind the *second* panel tab while the default is the first. "What is `*`?" — the table renders `${name}, ${positionCode}` producing "Connor Bedard, \*" with nothing defining it, which also violates DESIGN.md's Two-Line Player Rule verbatim. "Why did the list change?" — `appliquerDisponibilite` silently switches his active tab when a quota fills. "What is a snake draft?" — he picks 3rd in round 1 and 8th in round 2 with no explanation. "Why are there no buttons?" — when it isn't his turn every Action cell renders empty under a header still labelled "Action", with nothing saying why.

## Minor Observations

- ~150 lines of dead CSS from a §17/§18 conflict: `#playerTable { min-width: 560px }`, the sticky last-column rule, `.table-wrapper { overflow-x: auto }`, and the 420px header shrinks are all overridden by later same-specificity rules.
- Two sections both numbered **15**, and section **19** sits before section **18**.
- **"St. Louis Blues" renders with a fabricated abbreviation.** `getTeamAbbreviation` reads `a[0]` = `"St."`, misses the map's `Louis` key, falls through to 3-word initials → `SLB` → `teams/SLB.png` 404s and `getTeamColors('SLB')` returns the neutral fallback. One club shown with an invented code and a non-real color — against both PRODUCT.md's real-data rule and DESIGN.md's Real Teams Only Rule.
- Ungrammatical French from `showProgressDetails`: "Aucun **attaquants** sélectionné", "Aucun **équipe** sélectionné".
- Sort options render in English ("Games played", "Goals", "Assists", "Wins", "SV%") and *replace* correct French markup on first render.
- `#sortBy` and `#searchInput` have no `<label>` and no `aria-label`; only 2 label/for pairs exist in the whole file, both inside the career modal.
- `showCustomAlert` attaches a document keydown listener removed only on Enter/Escape — dismissing by click leaks one listener per alert. `window.onclick = ...` clobbers any other global click handler.
- `.pick-confirm-box` mixes three radii in one card (18px / 12px / 11px) against the Twelve Rule. `.pick-card-pos`, `.pick-card-abbr`, `.pick-card-meta` render at ~9px, below the 0.68rem label floor.
- `.draft-header { top: 60px }` vs the 56px navbar at ≤480px — a 4px slit of content scrolling under the bar.
- `prefers-reduced-motion` covers 11 keyframes but not the two `transition: width` progress fills.
- 20 script tags (3 CDN) + 8 stylesheets, ~369 KB of unminified local CSS+JS, and **no `<link rel="preconnect">`** for the three CDNs or two font hosts — first paint on draft night on cellular.
- `populateMyPicksTable` is dead code and contains a hardcoded `#ff2e2e` badge outside the token layer — a red used as a position badge, against the Semantic Set Is Closed Rule.

## Questions to Consider

1. **The pick strip already contains the entire draft order, every completed pick, the current turn, and every skip. Why does the page also carry an "Ordre du draft" panel and a "Ma progression" panel?** What if the strip *were* the left rail — your own picks marked inside it — and the phone had exactly two surfaces: the strip and the list?
2. **There is no clock anywhere in a product positioned as "a free, real-time live draft room."** Is that a deliberate stance — "you're friends, take your time" — that the UI should say out loud ("Aucune limite · 6 personnes attendent")? Or is it the omission quietly costing you the drafts that stall and never resume?
3. **What if the list were five rows instead of 150?** The system already knows your remaining quota, the current round, and everything taken. A "Meilleur disponible" card showing the top three for the slot you still need — full list one tap behind — converts scan-and-hunt into a one-thumb decision, which is the only interaction a phone under social pressure actually supports.
4. **The reveal is the best thing on this page, and it plays for 1150ms inside a 118px strip behind a blur.** What would the room feel like if a completed pick took over the whole screen for two seconds, the way a broadcast cuts to the pick? What is the small treatment protecting?
