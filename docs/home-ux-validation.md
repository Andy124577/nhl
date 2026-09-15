# Home UX changes — 15 September 2026

## 1. Recent movements

Files: `accueil-carousel.js`, `accueil-dash.js`, `accueil-mobile.js`,
`accueil-draft.js`, `accueil-draft.css`, `accueil-watch.css`, `index.html`.

The existing offseason carousel controls are now shared with the movement
panels. Tracks scroll horizontally at a fixed height, with page dots (at most
five visible), disabled arrows at either end, scroll snapping, keyboard focus
indicators, and reduced-motion support. The draft expansion button and its CSS
are removed. Draft movements remain hidden at 768 px and below as requested.

## 2. Watchlist

Files: `accueil-watch.js`, `accueil-watch.css`, `accueil-draft.js`,
`accueil-draft.css`, `draftkit-watchlist.json`, `draftkitData.js`, `index.html`.

Both home states use a fixed-height card carousel. A header select lists full
team names, filters the cards, resets scrolling, and updates the player count.
All 70 entries have individually written French summaries. Every original
field, including the full note, is preserved. The full note is available in
the card tooltip and immediately inside the career modal, including while
career statistics load.

The home now loads the shared career modal assets, its mount element, and
the required team-colors helper. Cards resolve NHL IDs from existing player
lookups and support click, Enter, and Space. Goalie and skater columns are
selected correctly. Favorites remain independent of card activation.
In the local draft-kit fixture, 67 of 70 players resolved IDs; the other three
correctly remain ordinary cards with working favorite buttons.

## 3. Draft-table badge

Files: `draft-watch.js`, `draft-watch.css`, `draftActif.js`, `draftActif.html`.

Skater and goalie row builders emit empty watchlist anchors next to injury
anchors. Once data loads, an idempotent decorator adds a compact blue
(`#26a6ff`) eye badge and full-note tooltip. Matching requires the team to
agree when one is available. Narrow layouts use the icon with an accessible
label. Badge clicks still reach the player row.

## 4. Compact priority strip

Files: `fzToday.js`, `fzToday.css`, `index.html`.

The urgent lead stays first and prominent. Secondary actions occupy one
horizontal row, preserving their links and urgency/unavailability classes.
The choice is documented in the rendering code. Shared CSS applies to desktop
and mobile containers. The fixture measured the same 204 px strip height with
one and ten items. Existing HTML assertions were not changed.

## 5. In-season home

Files: `accueil-season.js` and the shared carousel/watchlist files above.

The in-season watchlist now uses the same complete list, filter, summaries,
favorites, and career-modal behavior as the draft home. Its movement panel
uses the same carousel controls. No in-season work is deferred.

## Preseason calendar

File: `accueil-dash.js`.

Calendar refreshes preserve existing day buttons instead of replacing them.
This prevents a refresh between pointer press and release from discarding
the click, and preserves keyboard focus. Selecting a date outside the loaded
window also keeps the requested date instead of silently selecting the first
date returned by the schedule response. Day buttons now include full French
accessible labels.

Thursday and Friday were checked with mouse and Enter at every requested
width, including a refresh while the mouse button was held down. The exact
reported failure in the live session was not reproduced against the backend.

## Validation

- Local frontend served over HTTP and exercised in headless Microsoft Edge
  with controlled pool, schedule, movement, and career data.
- Draft and season layouts checked at **1440, 1024, 768, and 390 px**. No page
  horizontal overflow; watchlist track height remains 170 px.
- Browser checks cover filtering, page-dot limits, end controls, favorite
  isolation, keyboard modal activation, goalie/skater columns, modal filters,
  focus restoration, calendar refresh clicks, priority height, badge matching,
  team mismatches, redraw decoration, and row click-through.
- **172 unit tests passed**, including
  `node --test test/unit/today-client.test.js`, plus browser-helper and draft-kit
  build tests. No existing test assertions changed.
- Changed JavaScript passes syntax checks; `git diff --check` passes.
- Live API responses, authentication, physical touch gestures, and the full
  backend application were not exercised. No server routes or APIs changed.

Browser checks are in `tools/check-home-ux.cjs`. They require a local static
server on port 8765, an existing Playwright installation (optionally selected
with `PLAYWRIGHT_MODULE`), and Microsoft Edge. No dependency was added.

No approval or design decision remains pending.
