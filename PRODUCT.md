# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: friend groups running a private hockey pool.** Friends, family, and coworkers who want a season-long NHL pool together. They are not fantasy-sports power users; most are casual hockey fans who joined because someone in the group set it up.

**Also primary: newcomers browsing open pools.** Pools are not exclusively invite-only — `rejoindre-pool.html` lists available pools and a pool's password is optional. Strangers discover and join pools they have no social connection to, so public-facing surfaces must also work for someone with no context and no one to explain the product to them.

**The usage scene is the phone, throughout.** Confirmed: assume a phone for everything, including draft night in the live draft room and trade negotiation. Desktop is a bonus, not the baseline. A design that only resolves at 1440px has failed its actual user.

## Product Purpose

Fantazy lets a group of friends run a full NHL fantasy hockey season together: create or join a pool, draft a roster in a live turn-based draft, trade players, and follow the standings until the season ends.

Success is a pool that gets all the way through: created, filled, drafted, and still being checked in April. The draft is the moment the product is judged on — it is the one synchronous event where everyone is present at once, and a pool that stalls or breaks there never becomes a season.

## Positioning

**A free, real-time live draft room.** The turn-based draft with live presence, plus trades and head-to-head matchups, with no paywall, no entry fee, and no gambling. Competitors either gate the equivalent experience, monetize it, or don't offer a genuine synchronous draft at all.

Supporting differentiators that are factually true of the product but are not the lead claim: it is French-language and built around Québec pool vocabulary (repêchage, échanges, classement, attaquants/défenseurs/gardiens), and pool rules are configurable per pool rather than fixed.

## Operating Context

The product runs on the rhythm of an NHL season, and its surfaces belong to distinct moments:

- **Setup** — one person creates the pool (roster shape, participant cap, mode, options) and recruits; others join, by link or by browsing open pools.
- **Draft night** — the synchronous event. Everyone is present at the same time, turns pass in order, and the room is live over websockets. Time pressure and social pressure are both real. This happens on phones.
- **The season** — asynchronous and habitual. Daily or near-daily checks of scores and standings; head-to-head pools run weekly matchups Monday through Sunday; trades are proposed and accepted between participants over the course of the season.
- **Reference** — stats browsing, hot players, streaks, and individual player career/game-log lookups, used to inform draft and trade decisions.

## Capabilities and Constraints

**Confirmed functionality**

- Accounts: signup, login, profile, avatar upload, account data export, account deletion; admin login and admin user-switching.
- Pools: create (name, optional photo, optional password), join, leave, delete, rename team, change team; 2–10 participants.
- Configurable roster shape per pool: counts for attaquants, défenseurs, gardiens, rookies, and équipes NHL.
- Two scoring modes: **cumulatif** (most total points at season end) and **head-to-head** (weekly Mon–Sun duels; requires an even participant count). Trades are a per-pool on/off option.
- Live draft: draft order (including randomization), turn-based picking over socket.io, draft state and completion views.
- Trades: propose, accept, decline; pending and completed history.
- Standings, stats, hot players over multiple windows, streaks, player career totals and game logs.
- In-app notifications.
- Light and dark theme, dark by default, persisted in `localStorage`. Both themes are shipped surface area and must keep working.

**Technical constraints**

- Express 5 + socket.io + PostgreSQL (`pg`), serving static multi-page HTML from the repo root. Vanilla JS and hand-written CSS, no framework, no bundler, **no build step** — files are served as authored. Any design work has to live within that.
- One stylesheet per surface plus shared `navbar.css` / `poolNav.css`, loaded as separate `<link>` tags. There is no shared token layer today.
- Deployed on Render; see `DEPLOY_RENDER.md`.

**Fixed — never break or invent**

- **Real NHL data only.** Stats, standings, players, and game logs come from public NHL sources. Never fabricate a player, a score, or a number — including in demo cards, placeholders, empty states, and screenshots. The homepage hero currently shows real player names in a demo card; that bar applies there too.
- **Québec Law 25 privacy posture.** Ongoing obligations, not a one-time checkbox: consent, data export and deletion, the incident register (`REGISTRE_INCIDENTS.md`), and the named privacy contact. Anything that collects, displays, or exports personal data inherits these.

**Committed in the Terms** (documented in `conditions.html`, not re-opened during init): the service is free and non-commercial; it neither permits nor facilitates betting, wagering, entry fees, or prizes; it is independent and not affiliated with or endorsed by the NHL/LNH, its clubs, or the NHLPA/AJLNH. No surface may imply otherwise.

**Open decisions — do not resolve unilaterally**

- **Language.** The interface is entirely French today, and **bilingual FR/EN is a planned roadmap item.** There is no i18n layer yet and copy is hardcoded in markup and JS. Future work should avoid baking French into structure that can't be undone (fixed-width labels sized to French strings, text in images, concatenated sentence fragments), but should not build translation scaffolding until the plan is decided.

## Brand Commitments

- **Name:** Fantazy. Contact and privacy address: `fantazyhockey@outlook.com`.
- **Vocabulary is part of the identity.** Québec pool terminology is domain language, not decoration: *pool*, *repêchage*, *échanges*, *classement*, *attaquants / défenseurs / gardiens*, *rookies*, *équipes NHL*. Don't translate these to generic fantasy-sports terms.
- **Existing assets:** `Icons/` (icon set, referenced through `icons.js`), `teams/` (NHL club logos), player headshots pulled from public NHL URLs, user avatars and pool images under `uploads/`.
- No aesthetic direction, palette, or typographic commitment was declared during init. The incumbent implementation is design evidence, not an approved brand system — see `/impeccable document` to record it or new-work to change it.

## Evidence on Hand

**Real:** NHL statistical data (`current_stats.json`, `nhl_filtered_stats.json`, `current_teams.json`), club logos in `teams/`, the icon set in `Icons/`, live game logs and career data fetched from public NHL endpoints, the Terms (`conditions.html`), the Privacy Policy (`confidentialite.html`), and the Law 25 incident register (`REGISTRE_INCIDENTS.md`).

**Absent — must not be fabricated:** there are no testimonials, no named customers, no user or pool counts, no press coverage, no awards, no benchmarks, no pricing (the product is free), and no uptime or performance claims. Marketing surfaces must persuade without any of these.

## Product Principles

1. **The draft is the product.** It is the one synchronous, high-stakes, everyone-is-watching moment. When draft-room needs conflict with another surface's, the draft room wins.
2. **A phone is the real device.** Every flow, including drafting and trading under time pressure, has to be fully operable one-handed on a phone. Desktop is the wider case, not the design case.
3. **A newcomer with no one to ask must still get in.** Because open pools are joinable by strangers, no flow may depend on a friend explaining it.
4. **Never invent a number.** Real NHL data or an honest empty state. This governs demos and placeholders as strictly as it governs the standings page.
5. **Free, clean, and unaffiliated — visibly.** No paywall theater, no wagering framing, no borrowed league authority. The product's credibility comes from working well, not from implied endorsement.

## Accessibility & Inclusion

No formal conformance target (e.g. a WCAG level) was established during init — that remains open. One requirement is confirmed and binding: the entire product, including the live draft room under turn-timer pressure, must be fully operable on a phone. Touch targets, one-handed reach, and legibility at phone sizes are functional requirements here, not refinements.
