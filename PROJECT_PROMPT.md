# Fantazy — Project Briefing Prompt

> Paste everything below into a new AI session to give it full context on this project.

---

## Who you are working with

You are helping build **Fantazy**, a free web application for running season-long NHL fantasy hockey pools among friends. The interface is entirely in **French (Québec)**. The codebase lives at the repository root as a flat multi-page site — there is no `src/` folder and no framework.

Contact address for the project: `fantazyhockey@outlook.com`.

## What the product is

Fantazy lets a group of 2 to 10 people run a full NHL fantasy season together: create or join a pool, draft a roster in a live turn-based draft, trade players, and follow the standings until the season ends.

The **live draft is the product**. It is the one synchronous, everyone-is-watching moment, and a pool that stalls there never becomes a season. When draft-room needs conflict with another surface's needs, the draft room wins.

**Positioning:** a free, real-time live draft room. No paywall, no entry fee, no gambling. Supporting differentiators, but never the lead claim: French-language with Québec pool vocabulary, and per-pool configurable rules.

**Two primary audiences.** Friend groups running a private pool, mostly casual hockey fans rather than fantasy power users. And strangers browsing open pools, since a pool's password is optional and `rejoindre-pool.html` lists joinable pools publicly. No flow may depend on a friend explaining it.

**The phone is the real device.** Every flow, including drafting and trading under turn-timer pressure, must be fully operable one-handed on a phone. Desktop is the wider case, not the design case.

## Technical stack

| Layer | Choice |
| --- | --- |
| Server | Node.js, Express 5 |
| Real time | socket.io 4 |
| Database | PostgreSQL via `pg` |
| Front end | Vanilla JS, hand-written CSS, jQuery on some pages |
| Auth | `bcryptjs` password hashing |
| Uploads | `multer` |
| Scheduling | `node-cron` |
| Hosting | Render, see `DEPLOY_RENDER.md` |

**There is no build step and no bundler.** Every file is served exactly as authored, straight from the repository root. One stylesheet per surface, loaded as separate `<link>` tags, plus shared `navbar.css` and `poolNav.css`. There is no shared design-token layer today. Any proposed change has to live inside those constraints.

`server.js` is a single very large file holding all Express routes and socket handlers. Pure logic has been progressively extracted into `lib/` so it can be unit-tested without booting Express, socket.io, cron, and Postgres.

## Repository layout

- **Pages** at the root: `index.html`, `login.html`, `signup.html`, `creer-pool.html`, `rejoindre-pool.html`, `repechage.html`, `draftActif.html`, `draftFini.html`, `classement.html`, `stats.html`, `trade.html`, `pool.html`, `conditions.html`, `confidentialite.html`.
- **`lib/`** — testable pure modules: `draft.js` (snake order, completion check), `scoring.js` (the scoring table and season aggregates), `h2h.js` (matchups, weekly results, schedule), `roster.js` (NHL roster snapshot diffing, club names), `trades.js` (roster manipulation), `season.js` (current season id, season window), `instantDraft.js` (matchmaking queue), `statsCache.js`.
- **`teams/`** — NHL club logos. **`Icons/`** — the icon set, referenced through `icons.js`. **`uploads/`** — user avatars and pool images.
- **`data/draftkit/`** and `tools/build_draftkit.js` — builds `draftkit.json` from the season's draft-kit spreadsheets and PDF text.
- **`test/unit/`** — Node's built-in test runner. Root-level `test_suite.js`, `test_h2h.js`, `test_teams.js` are integration suites.
- Large JSON files at the root cache NHL data: `current_stats.json`, `nhl_filtered_stats.json`, `current_teams.json`, `draft.json`, `trades.json`, `nhl_transactions.json`, `nhl_roster_snapshot.json`.

## Feature set

**Accounts.** Signup, login, profile, avatar upload, account data export, account deletion. Admin login and admin user-switching exist for support.

**Pools.** Create with a name, an optional photo, and an optional password that is bcrypt-hashed like an account password. Join, leave, delete, rename the pool, rename your team, change teams. Ten team slots are prepared per pool and the participant cap is chosen at creation from 2 to 10.

**Roster shape is configurable per pool.** Counts for attaquants, défenseurs, gardiens, rookies, and équipes NHL. The defaults are 6 forwards, 4 defencemen, 1 goalie, 1 rookie, and 1 NHL club.

**Two scoring modes.**
- *Cumulatif* — the most total points at season end wins.
- *Tête-à-tête* — weekly Monday-to-Sunday duels, requiring an even participant count. Standings track wins, losses, ties, points for, and points against. Weeks finalize automatically, with a manual finalize route as backup.

Trades are a separate per-pool on/off switch.

**Live draft.** Snake order for three or more teams, simple alternation for two. The order can be randomized before the draft starts. Picking is turn-based over socket.io, broadcast to every connected client. The pool creator alone can skip a stalled turn. A draft-complete state and a completion view follow.

**Repêchage instantané.** A one-click queue: no pool name to invent, no code to type. The user lands in the first pool still waiting for players, or a brand-new one. These pools are fixed at four participants so the queue actually fills.

**Trades.** Propose, accept, decline, with pending and completed history. Trades are one-for-one within the same category. A separate trade-listings table lets a member flag players as open to offers; it is a pure visibility signal and does not relax the one-for-one rule.

**Standings and stats.** Pool standings, pool leaderboard, hall of fame, and daily rank-movement. NHL stats leaders, hot players over 7, 10, 14, 30, and 180-day windows, streaks, injuries, transactions, live games, tonight's boxscores, the schedule by date, and per-player career totals and game logs.

**Notifications.** In-app, currently two kinds: `repechage` and `echange`.

## Scoring

Daily fantasy scoring, defined once in `lib/scoring.js` as `FANTASY_SCORING`:

| Event | Points |
| --- | --- |
| Goal | 3 |
| Assist | 2 |
| Shot | 0.5 |
| Power-play goal (bonus) | 1 |
| Power-play point | 0.5 |
| Shorthanded goal (bonus) | 2 |
| Shorthanded point | 1 |
| Game-winning goal | 1 |
| Plus/minus | 0.5 |
| Goalie win | 5 |
| Shutout | 3 |
| Save | 0.2 |
| Goal against | -1 |

Season goalie scoring uses a separate formula in the same file: shutouts times five, wins times two, overtime losses times one. That formula was previously copy-pasted in four places that drifted apart. `lib/scoring.js` is now loaded by the browser as well as the server so both agree by construction, not by maintenance.

## Data and background jobs

All hockey data comes from public NHL endpoints, chiefly `api-web.nhle.com`. The draft kit is the exception: `tools/build_draftkit.js` treats the season's spreadsheets and PDF as authoritative and touches no API.

Three cron jobs run on `America/New_York`:
- **Midnight** — refresh current stats, refresh team standings, snapshot every pool's ranks, then refresh NHL transactions last, since it is the only one that tolerates being skipped.
- **3 AM** — fetch player game logs via `fetch_game_logs.js`.
- **Every 15 minutes from 6 PM to 1:59 AM** — poll for newly finished games, covering overtime and shootouts.

The rank snapshots exist so the homepage can show real movement like "up two places since this morning" instead of inventing a trend with nothing to diff against.

## Database schema

Six tables, created idempotently on boot by `db.js`:

- `users` — id, username, bcrypt password, is_admin, avatar_url, created_at.
- `pools` — pool_name plus the entire pool as a `JSONB` blob. Rosters, draft order, config, and head-to-head data all live inside that document.
- `trades` — pool_name, trade_data JSONB, status, indexed on pool and status.
- `trade_listings` — one active listing per player per team, enforced by a partial unique index.
- `cached_stats` — keyed JSONB cache of NHL API responses.
- `pool_rank_snapshots` — one row per team per day, unique on pool, team, and date.

A seventh table, `player_game_logs`, is created by `migrations/create_player_game_logs.sql`.

## Design system

The north star is **"The Broadcast Desk"**: the studio a hockey broadcast is called from. A dark set, a wall of numbers already organized for the reader, and light used only where something is live. Full details are in `DESIGN.md`.

- **Dark-first, with a full light theme as a peer**, not an afterthought. Applied via `html[data-theme="light"]` and set before first paint by `theme.js`, persisted in `localStorage`. Light is not an inversion; hues are re-picked for contrast on pale ground.
- **Exactly one accent: Editorial Brick `#E8795E`**, deepening to `#B93D28` in light. It marks whatever is interactive, focused, live, or currently yours. It replaced a cyan accent that had been splitting the busiest screens in two.
- **Semantic colors carry meaning, never decoration.** Goal Green `#00E676` for success and the attaquants badge, Bench Amber `#FFB300` for warnings and the gardiens badge, Penalty Red `#FF4757` for destructive actions only, Rookie Orchid `#CE93D8` for the rookies badge.
- **NHL club colors are the only free chroma**, sourced from the static table in `teamColors.js`, entering only through team identity. They are real brands: never invent one, never assign one to a non-team.
- **Type.** Bebas Neue for condensed display, a plain system sans for body, and JetBrains Mono for any figure compared down a column.
- **Density is deliberate and high.** This is a statistics product. Tables are the primary component, not a fallback.

## Hard rules — never break these

1. **Real NHL data only.** Never fabricate a player, a score, or a number. This binds demo cards, placeholders, empty states, and screenshots exactly as strictly as it binds the standings page.
2. **Québec vocabulary is identity, not decoration.** Keep *pool*, *repêchage*, *échanges*, *classement*, *attaquants / défenseurs / gardiens*, *rookies*, *équipes NHL*. Do not translate them into generic fantasy-sports terms.
3. **No build step.** Do not introduce a bundler, a framework, or a compile stage.
4. **Phone-first, always.** A design that only resolves at 1440px has failed its real user.
5. **Both themes ship.** Light and dark are both shipped surface area and must keep working.
6. **The Terms are binding.** The service is free and non-commercial, it neither permits nor facilitates betting, wagering, entry fees, or prizes, and it is independent of and unendorsed by the NHL, its clubs, and the NHLPA. No surface may imply otherwise.
7. **Québec Law 25 privacy posture is ongoing**, not a one-time checkbox: consent, data export, data deletion, the incident register in `REGISTRE_INCIDENTS.md`, and the named privacy contact. Anything touching personal data inherits these.

## Open questions — do not resolve these unilaterally

- **Language.** The interface is entirely French and hardcoded in markup and JS. Bilingual French/English is a planned roadmap item but there is no internationalization layer yet. Avoid baking French into structure that cannot be undone, such as fixed-width labels sized to French strings, text inside images, or concatenated sentence fragments. Do not build translation scaffolding until the plan is decided.
- **Accessibility conformance target.** No WCAG level has been set. One requirement is binding regardless: full phone operability, including the draft room under turn-timer pressure.

## Commands

```
npm start                 # node server.js
npm run dev               # nodemon
npm test                  # unit tests, node --test test/**/*.test.js
npm run test:cov          # with coverage
npm run test:cov:gate     # 95% lines, 90% branches, 100% functions on lib/
npm run test:integration  # test_suite.js, test_h2h.js, test_teams.js
npm run build-draftkit    # rebuild draftkit.json from data/draftkit/
npm run fetch-game-logs   # refresh player game logs
```

## Reference documents in the repository

`PRODUCT.md` for product definition, `DESIGN.md` for the full design system, `DEPLOY_RENDER.md` for deployment, `UNIT_TESTS.md` and `UNIT_TESTS_REVIEW.md` for test coverage, `H2H_TESTING_GUIDE.md` for head-to-head testing, `GAME_LOGS_README.md` for game logs, `PERFORMANCE_OPTIMIZATIONS.md` and `PERFORMANCE_FIX_ROUND_2.md` for performance history, `MIGRATE_TO_EXTERNAL_DB.md` for the database migration, and `REGISTRE_INCIDENTS.md` for the Law 25 incident register.
