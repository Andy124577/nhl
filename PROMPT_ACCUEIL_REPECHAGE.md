# Fantazy — The home page, signed in, with a draft in progress

> Paste everything below into a new AI session to give it full context on this
> one screen. It assumes `PROJECT_PROMPT.md` has already been read, or that the
> reader needs no product background beyond what is here.

---

## What this document covers

`index.html` as rendered for a **signed-in member whose active pool has a draft
in progress** — `FZPool.draftState(poolData).etat === 'encours'`, meaning
`draftOrder` exists and not every roster slot is filled yet.

This is one of six mutually exclusive home-page states. Naming them all matters,
because most of the page's conditional logic is written against this list:

| Hero mode | When |
| --- | --- |
| `draft` | **the state described here** — a draft is running in the active pool |
| `preseason` | no draft running, and today is before the regular-season opener |
| `live` | at least one of your players is on the ice right now |
| `h2hduel` | head-to-head pool, draft finished, a matchup is upcoming |
| `draftdone` | draft finished, nothing more pressing to show |
| `regular` | none of the above — the banner is hidden entirely |

The single source of truth for which mode applies is `fzdHeroState(tonight)` in
`accueil-dash.js`. **Desktop and phone both call it.** They render different
layouts, but they can never disagree about what state the user is in.

## The one structural rule to understand first

The page is not "a dashboard with a draft banner on top". During a draft, the
desktop dashboard body is usually **gone**, and what replaces it is deliberate.

`fzdApplyPreseasonLayout()` (`accueil-dash.js`) decides this, and it keys off
**whether the NHL regular season has started** — not off the draft:

```js
const started = fzdSeasonStarted();          // true / false / null (calendar not loaded)
body.style.display  = (hasPool && started === true)  ? '' : 'none';
chips.style.display = (hasPool && started === false) ? '' : 'none';
```

So there are two sub-cases of "draft in progress", and they look different:

- **Draft before the season opens** (the normal case). `#fzDashBody` is hidden —
  no tonight's-game panel, no "Vos joueurs ce soir", no "Mes pools" list, no
  quick-action tiles, no "Activité de la ligue". `#fzDashPoolChips` takes its
  place. There genuinely are no games and no points yet; the body would be four
  empty panels.
- **Draft after the season has opened** (a late-forming pool). `#fzDashBody` is
  shown in full, and `#fzDashPoolChips` is hidden.

A third case exists and must not be forgotten: `fzdSeasonStarted()` returns
`null` while the NHL calendar has not loaded yet. Both the body and the chips
stay hidden. This is the first paint of every visit.

## Top to bottom, desktop (≥769px)

**1. Navbar** (`navbar.js`, injected into `<nav class="navbar">`).
Three things change because a draft is running:

- The **Repêchage** tab carries a badge that is an empty string, not a count —
  CSS renders `.notif-badge:empty` as a plain dot. A running draft has nothing
  to count, unlike pending trades.
- The **Classement** tab is **removed** from both the desktop bar and the bottom
  bar. `updateClassementLinkVisibility()` keeps it only when the active pool's
  draft is `termine`. Ranking half-built rosters measures nothing but pick
  order.
- The avatar dropdown behaves normally. For an admin it also carries the
  account-switch list.

`activePool.js` closes the matching door: typing `classement.html` directly, or
following an old bookmark, redirects to `index.html` while the draft runs.

**2. Stories strip** (`#storiesSection`, `accueil.js`).
Real NHL live scores and real signing/trade news, auto-advancing with a progress
bar. Gated on being a member **with an active pool** — which is satisfied here.
Hidden entirely when there is nothing real to show; it never renders a
placeholder. Loaded once per visit (`storiesLoaded` guard).

**3. Marketing hero** (`.fz-arena-hero`). **Hidden.** This is the logged-out
pitch — headline "Votre ligue. Votre équipe. Votre saison.", the arena mockup,
the signup buttons. A signed-in member never sees it.

**4. "À faire maintenant" priority band** (`#fzTodayDash`, `fzToday.js`).
Fed by a single server call, `GET /api/me/today`, ranked by `lib/priority.js`.

This is the most important element on the page during a draft, and the reason is
structural: **the state banner below it only looks at the active pool.** The
band looks at *all* of the member's pools. A draft turn waiting in a different
pool is invisible everywhere else on the site.

The urgency ladder, highest first:

1. `VOTRE_TOUR` — your draft turn; someone is waiting, right now
2. `REPECHAGE` — a draft running, or a start confirmed by the server
3. `ECHANGE` — a trade offer awaiting your answer
4. `DUEL` — your weekly head-to-head matchup
5. `RESULTAT` — a result just recorded, or a reliable rank movement
6. `INFORMATION` — your players' games, and everything else

One headline item, at most three secondary lines. Ties break on real deadline,
then the active pool, then a stable order — stable so the button never swaps
under the user's thumb between two renders. The module never invents a deadline
for an item that has none.

Three behaviours worth knowing: bursts of socket events are coalesced into one
request (400 ms); nothing polls while the tab is hidden; and a reply that
arrives after the active pool changed is discarded rather than shown.

**5. State banner** (`#fzDashHero`, `fzdHeroHTML()`).
Full-width. In `draft` mode it renders:

- A shield mark, then an **eyebrow** computed from the distance to your next
  pick in `draftOrder`: `"C'est votre tour"` at zero, `"Votre tour dans N
  choix"` ahead of you, `"Repêchage en cours"` when you have no pick left.
- Headline: **"Repêchage en cours"**.
- Two stats: **Ronde** `round / totalRounds`, and **Attente** — time elapsed on
  the current pick, from `poolData.turnStartedAt`, formatted `"N min"` above a
  minute and `"N s"` below.
- CTA: **"Aller au repêchage"** → `draftActif.html?pool=…`.

The banner turns brand red when it is your turn: `renderHero()` toggles
`.is-myturn` from `state.myTurn`, with a **forced layout read**
(`void container.offsetWidth`) between the two class changes. Without it the
browser coalesces both states into one style calculation and the red sweep
never plays. It looks like a stray statement; it is load-bearing.

The elapsed clock ticks every second, but the interval only patches the text of
`.fzd-hero-elapsed` in place. A full re-render happens only when the *signature*
`pick|myTurn` changes, or the mode does. Rebuilding the whole banner each second
used to wipe the red sweep mid-animation.

**6. Calendar** (`#fzDashCalendarWrap`). Always present with an active pool.
A week strip with a per-day game count, the selected day as a heading, then
match cards — two columns on desktop. Each card carries a carousel of *your*
players: live stats during a game, season totals before puck drop. During a
pre-season draft your roster is still being filled, so these carousels are
mostly empty — the calendar is here for the NHL schedule itself.
"Calendrier complet →" expands a month grid.

**7. Pool chips** (`#fzDashPoolChips`) — **only when the season has not
started**, which is the normal draft case. Four chips: **Mon équipe** (opens the
team settings panel), **Créer un pool**, **Rejoindre un pool**, and **Repêchage
instantané**. The last is a button, not a link: it starts matchmaking in place
via `instantDraft.js` and drops you straight into a room.

**8. Off-season panel** (`#fzDashOffseason`). Shown while the regular season has
not started, so it is normally present during a draft. It holds: a countdown to
camp or opening night; "Ma position" (overall rank); "Mouvements récents" — a
filterable carousel of real NHL transactions derived from official roster
snapshots (`GET /nhl-transactions`); and a watchlist alongside injuries
(`GET /nhl-injuries`).

**9. Dashboard body** (`#fzDashBody`) — **hidden in the normal draft case**, per
the structural rule above. When the season has already started it contains, in
order: the live/pre-game panel, **"Vos joueurs ce soir"**, **"Mes pools"** with
a count and a "see all" drawer, the quick-action tiles, **"Activité de la
ligue"**, and a create/join CTA pair.

The **Repêchage quick-action tile** is the part that reacts to a running draft.
`draftActionFor()` (`accueil.js`) supplies its label:

- your turn → `"C'est votre tour"`, and the tile gains `.is-attention`
- otherwise → `"En direct — choix N/M"`

Its sub-line is `"<pool> · choix N+1/M"`, and it links to `draftActif.html`.

Note the "Mes pools" drawer deliberately lists **every** pool including ones
still drafting — it is the only surface that does, since the standings page
refuses to open during a draft.

**10. "Comment ça marche"** and the footer. Static, unchanged by draft state.
The onboarding card `#fzoHowCard` expands this same section rather than
duplicating it, so all viewports show identical demos.

## Phone (≤768px)

The phone does **not** render a narrower version of the desktop dashboard. It
renders a different screen, `#fzMobileHome`, built by `renderMobileHome()` in
`accueil-mobile.js`. Everything from the calendar down is replaced.

Order during `draft` mode:

1. **`#fzTodayMobile`** — the priority band, first, above the banner. Same
   reason as on desktop: it is the only thing that can outrank the pool being
   displayed.
2. **Hero slot** (`#fzmHeroSlot`) — filled by the *same* `renderHero()` call as
   desktop, but with phone markup from `fzmDraftHeroHTML()`: a player portrait,
   a **"Repêchage en cours"** badge, the same headline logic, then **Ronde**
   `round / rounds`, **Choix global** `pick + 1`, a **Temps écoulé** clock, and
   the **"Aller au repêchage →"** CTA.
3. **Pool chips** — Mes pools / Créer un pool / Rejoindre un pool.
4. **Calendar**, moved here. `#fzDashCalendarWrap` is a *shared DOM node*:
   `fzdPlaceCalendar()` physically relocates it into `#fzmCalSlot`, and
   `fzdRestoreCalendar()` must pull it back out before any `root.innerHTML`
   rewrite or it would be destroyed. This is the phone's only access to the
   calendar.
5. **League section** — during a draft its heading reads **"Activité de la
   ligue"** rather than "Dans la LNH", with tabbed NHL movements. NHL news is
   omitted while drafting.
6. **Players row** — your players' games.

Not rendered during a draft: the rank strip (`fzmRankStrip`), and the separate
"Activité de la ligue" block — both are reserved for `regular` and `live`.

## Live updates

`activePool.js` opens the socket, listens for `draftUpdated`, and refreshes
`FZPool` on every pick anywhere. Subscribers re-render. There is also a polling
fallback for the case where the socket never connected, an event was dropped, or
the tab was suspended — so a missed pick cannot leave the page stale forever.

Because a pick redraws the whole screen, anything expensive is cached rather
than refetched: the NHL news journal loads once per visit
(`offseasonNewsLoaded`, `fzmLeagueData`), and the priority band re-renders from
its last known reply without a new request.

## How the active pool gets chosen

Worth knowing, because it decides which pool this whole screen is about. When
nothing has been picked yet, `poolParDefaut()` in `activePool.js` sorts the
member's pools by draft state — `encours` first, then `pret`, then `termine`,
then `attente` — and takes the first. A running draft therefore selects itself.
Nobody should land on a sleeping pool while a draft waits elsewhere.

## Constraints any change must respect

- **No build step, no bundler, no framework.** Every file is served exactly as
  authored from the repository root. Vanilla JS, hand-written CSS, jQuery on
  some pages.
- **The phone is the design case**, not the wider case.
- **The live draft is the product.** When draft-room needs conflict with another
  surface's needs, the draft room wins.
- **One state calculation.** Desktop and phone must keep calling
  `fzdHeroState()`. Two detectors would eventually give two answers.
- **Never a placeholder.** A section with nothing real to show is hidden, not
  filled with sample content. This is why the dashboard body disappears during a
  pre-season draft instead of rendering four empty panels.
- The interface is **French (Québec)** throughout. Every user-visible string
  quoted above is verbatim.
