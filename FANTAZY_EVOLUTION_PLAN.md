# Fantazy — revised product and implementation plan

Review date: September 11, 2026. Status: proposal grounded in the current repository; application changes have not been implemented.

## 1. Objective and scope

Make Fantazy answer “Qu’est-ce qui mérite mon attention maintenant?” while protecting the live draft, the existing pool rules, and users’ data.

Keep Node.js, Express 5, Socket.IO 4, PostgreSQL with `pg`, vanilla JavaScript, existing jQuery, and authored CSS. Keep the static multi-page application and no front-end build step. Preserve French Québec vocabulary, the Broadcast Desk direction in `DESIGN.md`, the brick accent, and both themes. Any small backend dependency needed for authentication must be justified separately; the stack constraint is not a reason to invent security primitives.

This is a sequence of independently reviewable releases. Do not implement ten parallel systems, rewrite every page, or make a complete server reorganization a prerequisite for useful improvements. Accessibility, privacy, mobile behavior, and performance are acceptance criteria for every release.

The audit below covers relevant code paths, schema definitions, tests, and documentation. It is not a production database inspection, a complete security audit, or a browser accessibility audit. During implementation, inspect the callers of each changed operation before editing it.

## 2. What already exists, and what actually needs work

| Area | Repository evidence | Revised scope |
| --- | --- | --- |
| Instant Draft | `lib/instantDraft.js`, `instantDraft.js`, `/join-instant-draft`, `/leave-instant-draft`: four participants, queue selection, automatic start, return to an existing draft, leave behavior, and unit tests | Harden the existing flow. Extend the lobby in `repechage.html` rather than introducing a separate draft engine or mandatory new page. |
| Homepage | `accueil-dash.js`, `accueil-mobile.js`, `activePool.js`: contextual hero, active pool, tonight’s players, rank movement, H2H context, offseason content, and trade activity | Share priority and data logic between layouts; improve hierarchy and coverage across the user’s pools. |
| Notifications | `notifications.js`: deliberate read actions, hidden zero badge, local history, cross-tab updates, draft alerts, and specific trade links | Preserve these behaviors. Add server persistence and a small number of reliable event types. |
| Trade market | `trade_listings`, listing endpoints, `trade.js`: availability, removal, ownership checks based on supplied identity, and offer UI | Improve discovery and valid offer selection; fix authorization and atomic acceptance first. |
| H2H | `lib/h2h.js`, current-week/today/schedule endpoints, matchup history, player breakdowns, manual and background finalization | Consolidate calculation and finalization; extend the existing matchup view in `classement.html`. |
| Records | `/pool-leaderboard/:poolName`, `/pool-hall-of-fame/:poolName` | Audit their scoring and historical attribution before reusing them as rivalry records. |
| Shared scoring | `lib/scoring.js` already supports Node and browser exports | Extend it. Do not introduce a second frontend scoring implementation. |
| Storage | `db.js`: users, pools, trades, listings, cached stats, rank snapshots; game-log migration exists | Keep pool JSONB. Add only the relational data justified below. Reconcile migrations with startup schema creation. |
| Tests | Node’s built-in test runner plus separate integration scripts | Extend existing tests; add real PostgreSQL concurrency coverage. Pure tests alone cannot prove locking. |

### Confirmed issues that change the order of work

1. **Authentication is not a reliable server-side identity boundary.** `/login` verifies a password but returns identity without establishing a session in the inspected code. Many actions trust body usernames or team names; `/trade/accept` takes a trade ID without establishing the recipient’s identity. “Maintain current authentication rules” must mean preserving the account experience while fixing this boundary.
2. **Pool saves can overwrite unrelated changes.** `saveDraftData()` loads/saves all pools. Its PostgreSQL error path writes to JSON instead of propagating failure, and later schedules broadcasts. A failed database write can therefore look successful. This affects more than matchmaking.
3. **The Instant Draft lock is useful but incomplete.** There is already a process queue and PostgreSQL advisory lock. Other pool writers do not share that protection, and failure to acquire the database lock falls back to process-local execution. Do not replace this with another uncoordinated lock.
4. **Trade acceptance spans independent writes.** Rosters, trade status, conflicting proposals, and listing removal are not one transaction. The socket notification currently precedes listing cleanup.
5. **Some routes are duplicated or shadowed.** Examples include `/delete-clan`, `/join-clan`, and `/draft-order/:clanName`. Also inspect `/trades/:draftName` before `/trades/all`. Route order must be understood before extraction.
6. **Pool data is distributed too broadly.** `/draft` returns nearly complete pool state after removing password hashes; the initial Socket.IO connection emits raw draft data without that sanitizer. The repository root is also served statically. Audit exposure of server files and data files, then explicitly serve intended public assets.
7. **H2H results can differ by code path.** Manual finalization substitutes season totals when all game logs are missing; automatic finalization waits. Date-range helpers use different inclusive/exclusive end boundaries. Live skater scoring omits bonuses included in game-log scoring. These are correctness tasks, not presentation tasks.
8. **Historical attribution is incomplete.** Several calculations apply the current roster to historical game logs. Rank snapshots use pool/team names and dates without explicit season/scoring context. A trade or rename can invalidate a naive weekly narrative.

Baseline verification: `npm run test:unit` passed **515 tests in 80 suites**, with zero failures or skips. This does not establish production safety or concurrent database correctness. The integration scripts modify a running server and were not run for this review.

## 3. Changes to the original brief

- Keep “one obvious action,” but give the user’s current draft turn priority over an ordinary pending trade. Select urgency by deadline and relevance, not by the order of feature names.
- Keep the existing matchmaking order: most-filled compatible waiting pool, then oldest. “First compatible pool” is less precise and could unnecessarily split a small queue.
- Describe Instant Draft as **quick entry into a real pool**, not a guaranteed short session. Its existing format is cumulative, four participants, and 13 selections each: 52 picks. No wait-time or draft-duration promise is supported yet.
- Do not treat roster membership as proof that a player will play tonight. Use “joueurs dont l’équipe joue ce soir” unless actual participation is confirmed. Goaltender starts and scratches need separate evidence.
- Make read state and action state separate. Reading a trade notification must not remove the pending trade from the homepage’s attention list.
- Keep different scoring modes different. Consistency means the same mode, period, roster rule, and source version produce the same score; it does not mean H2H fantasy points equal cumulative points.
- Bring accessibility into each phase instead of leaving it until after mobile and desktop work.
- Allow synthetic fixtures in isolated tests. The prohibition on invented NHL information applies to product content and purported real results, not controlled test inputs.
- Defer notification preferences, share images, advanced rivalry records, and extra trade metadata until their underlying workflows are reliable. No push/email infrastructure is required for V1.
- Do not infer an exact draft appointment, game date, injury, transaction type, or historical achievement from approximate or incomplete data.

## 4. Release A — trustworthy identity and pool mutations

### Identity, authorization, and public data

Introduce a server-validated session using the existing accounts. Recommended shape: an opaque session token in an HttpOnly cookie, Secure in production, appropriate SameSite behavior, expiration, logout, and revocation on account deletion. Store only the token hash server-side. Protect cookie-authenticated mutations against cross-site requests and restrict credentialed origins.

REST and Socket.IO must resolve the same authenticated account. Local storage may remember display preferences but cannot establish identity. Derive team membership and creator/admin permissions from persisted state. Verify permissions on every action and on subscriptions to pool rooms. Preserve any intended admin switching only behind actual admin authorization.

Separate public discovery summaries from member-only pool details. Public summaries contain only fields needed to browse/join; joining a password-protected pool still verifies its password. Pool state and activity go to authorized members. Invitations, joins, leaves, account deletion, and permission changes must update socket access. Leave public NHL reference data public.

Serve explicit public assets and pages rather than making the entire repository downloadable. Inventory root-level JSON assets that the browser legitimately needs before changing serving rules. Do not move or expose private files merely to simplify this cleanup.

### A single mutation contract

Use a shared transaction helper and small domain services. For a pool mutation:

1. Acquire one PostgreSQL client and begin a transaction.
2. Lock the pool row, read current state, and validate identity, permissions, state, and input.
3. Apply the domain operation. Update only this pool and its affected relational rows.
4. Persist any associated durable activity/notification rows in the same transaction once those features exist.
5. Commit; only then acknowledge success and notify clients.
6. Roll back on failure, release the client, and return a useful error. Never fall back to a different persistent store after a PostgreSQL failure.

Every query in a transaction must use that client, including helper calls; `db.query` backed by pool-level queries cannot be mixed into it. This is a requirement of [node-postgres transactions](https://node-postgres.com/features/transactions).

Use row locks as the default concurrency mechanism. Add a monotonically increasing pool revision for resynchronization and stale-request detection; it supplements locking rather than creating a second competing write protocol. Define a consistent lock order: matchmaking coordination lock when needed, pool row, then dependent trade/listing rows in stable order. Never hold a transaction open during an NHL network request.

All writers of a migrated pool must follow the contract, including rename, configuration, deletion, membership, draft, trade, account cleanup, and H2H jobs. A legacy full-document writer can still overwrite a correctly locked operation after the latter commits. Retiring full-pool saves from runtime mutations is a release gate, not a later cleanup.

For JSON development mode, either supply an explicitly single-process serialized adapter with atomic file replacement for supported operations, or report that a PostgreSQL-only operation is unavailable. Do not silently claim multi-process or transactional parity. Existing trade paths already depend directly on PostgreSQL.

### Duplicate actions and recovery

- Picks include an operation ID and expected draft turn. A retry of the same operation returns the recorded result; the same ID with a different payload is rejected. This matters at a snake-draft reversal where the same team legitimately picks twice consecutively.
- Trade acceptance validates recipient membership, pending status, both current owners, and category compatibility under lock. Swap both rosters, resolve conflicting proposals, remove obsolete listings, and record the result together. Repeat acceptance cannot execute another swap.
- H2H finalization identifies an explicit season/week. A retry cannot accidentally finalize the following week.
- On stale state, return a structured conflict and resync the affected pool. On uncertain network delivery, look up/retry the same operation rather than creating a fresh one.
- Socket delivery is a refresh hint, not durable truth. Reconnecting clients fetch authorized current state and revision. If commit succeeds but broadcast fails, the operation still succeeded; the next refresh must recover it.

**Acceptance gate:** prove no lost updates across unrelated and same-pool writes; no unauthorized pick/trade/read/subscription; no double advancement on retries; no state or durable event committed after an injected failure; no success-shaped JSON fallback; no sensitive state in initial socket payloads or public file routes.

## 5. Release B — finish the existing Instant Draft experience

Retain one default format: four people, one independent team per person, cumulative scoring, existing 6/4/1/1/1 roster quotas, and existing trade rules. Do not select a shared team as a fallback when no empty team exists. Do not change ordinary pools’ shared-team behavior.

Use the existing queue lock concept, but make matchmaking a database transaction with a transaction-scoped coordination lock. Under that lock, first return the user’s existing waiting/active Instant Draft, otherwise choose the most-filled compatible lobby and lock it, otherwise create one. This covers the “no candidate exists” race that locking a nonexistent pool row cannot solve. Database lock failure must return a retryable error.

Compatibility means the same format version, season eligibility, participant capacity, and waiting state. Normal membership/start/configuration routes must enforce Instant Draft invariants too. Pool creation, join, leave, final-slot assignment, and transition to drafting must agree on the same rules.

### Lobby behavior

- Extend the existing lobby with the participant count, real names, own connection status, server-confirmed presence, and a clear leave action.
- Use semantic states: waiting, starting, drafting, completed. Add persisted state only where existing fields cannot express a required transition reliably.
- Multiple tabs belong to one participant. A brief disconnect is not an immediate departure. Proposed starting point: a 60-second waiting-room reconnect grace, configurable and tested with a controlled clock.
- Proposed start behavior: all four participants have current presence, followed by a 10-second server-owned countdown. Revalidate before starting; a departure cancels the countdown. Document presence behavior under restart and across instances before relying on it.
- Leave/start races resolve under the same transaction contract. After start, leaving the queue cannot remove a draft participant. Show the draft recovery action instead.
- Explicitly transfer any necessary creator role when the first participant leaves the waiting lobby. Today’s first entrant must not remain an unreachable administrator.
- A long wait shows elapsed time and an honest message, with leaving or browsing pools as secondary options. No bots, fake participants, or unsupported wait estimates.
- Signing in should preserve the intended Instant Draft destination, without silently enrolling the user before the join action is confirmed.

**Open product decision before broader promotion:** the existing creator-only skip after three minutes cannot guarantee that a strangers’ draft will finish. A permanently skipped turn also needs a defined way to fill the roster. Recommended next design is a server-owned timeout with automatic selection from an explicit user queue, then a documented deterministic ranking of real eligible players. Confirm timing, fallback order, disclosure, and behavior when player data is unavailable before implementing it. Until then, improve the existing mode without promising unattended completion or running an acquisition campaign around instant play.

**Acceptance gate:** simultaneous users fill one lobby to four and send a fifth to the next; repeated joins use one slot; concurrent leave/final join has one valid outcome; two tabs/restarts/reconnects do not create duplicate membership or start twice; creator departure is recoverable; unavailable locking fails safely. Test across two application processes against a disposable database.

## 6. Release C — canonical scoring and trustworthy H2H

### Define the score before expanding its presentation

Document the current cumulative and H2H rules independently, including skaters, rookies, goalies, and drafted NHL clubs. Preserve intentional formulas; correct accidental divergence. A scoring result needs season, mode/rules version, period, roster basis, source timestamp, and completeness status.

Consolidate game-log scoring into `lib/scoring.js` and orchestration into a scoring service. Current-week totals, player breakdowns, finalization, leaderboards, and recap input must call that service. Reuse existing browser-compatible exports where needed. Live totals with missing bonus fields are provisional, not exact weekly totals.

Use explicit `available`, `partial`, `unavailable`, and `not_applicable` states. Zero is valid only when the relevant data confirms zero; absence of rows alone does not distinguish no games from missing ingestion. Track expected eligible games and successful ingestion. Do not finalize a week merely because every team has at least one game log.

Remove season-total substitution from weekly results. Missing data leaves the week pending. Explicitly address NHL club scoring: the current weekly game-log helpers collect players and goalies but not the drafted club category. Do not silently include it on one surface and omit it on another.

### Dates, ownership, and finalization

- Use `America/Toronto` for user-facing daily/weekly boundaries and store instants in UTC. Use calendar operations across DST, not unconditional seven-times-24-hour additions.
- Represent completed weeks as half-open intervals `[Monday, next Monday)`. Reconcile current helper boundary differences. Live game data uses the NHL game’s assigned date, even when play ends after midnight.
- Preserve existing pool season/week assignments unless a documented migration changes them. Account for partial first/last weeks, postponed games, offseason, and missing season metadata. Approximate fallback season dates cannot drive authoritative finalization or exact-date claims.
- Resolve historical roster ownership before adding player contribution claims. Current-roster season valuation, ownership-at-game-time scoring, and a frozen weekly roster are different rules. **Do not change that product rule silently.** Record a baseline and future roster changes once the chosen rule requires them; do not invent previous ownership intervals.
- Make manual and background finalization invoke one service. Require the exact week, end-of-period validation, complete eligible data, and a unique finalization identity. Write history and standings once in one transaction.
- Persist finalized results so later trades cannot change them. If official statistics are corrected, use an explicit revision/recalculation operation that updates standings by the difference or rebuilds them from finalized results; never add the win twice. Recaps must identify revised results.
- Background jobs catch up after downtime with bounded work. Concurrent workers cannot finalize the same week twice. Add job outcome/source-age logging without dumping pool documents or credentials.

### Matchup Center

Extend the H2H area of `classement.html` with a direct pool/week destination. Start with score, leader/difference or tie, period/status, opponent, and an expandable roster breakdown. Then add scheduled roster-player counts and best contributors when supported by the same scoring result. “Depuis hier” requires comparable stored data; leave it out otherwise.

Cumulative pools retain their cumulative view. Multi-member teams are labelled as teams rather than treating one username as the complete opponent. Preserve negative scores and tied leaders correctly.

**Acceptance gate:** identical inputs yield matching scores across homepage, matchup, standings, and finalization; player contributions reconcile with the total including any explicit club component; no missing-data fallback becomes a weekly result; Monday/DST/late-game boundaries pass; trades after finalization do not rewrite history; manual/background retries advance once; cumulative pools never enter H2H finalization.

## 7. Release D — durable activity and a focused notification system

Use small explicit records, not event sourcing or a new messaging platform. The database remains the source of truth.

### Minimal new records

| Record | Purpose and constraints |
| --- | --- |
| Pool activity | Event ID, stable pool ID, type, optional actor user ID, subject identifiers, minimal versioned metadata, occurrence time, unique deduplication key. Index `(pool_id, occurred_at, id)` for cursor pagination. |
| Notification | ID, recipient user ID, type, pool/subject references, occurrence time, `read_at`, `resolved_at` or expiration where applicable, unique recipient/event key. Index recipient/unread queries. |
| Finalized result / recap snapshot | Reuse trustworthy H2H history where possible. Add persistence only for required reproducible inputs/results; key by pool, season, week, and revision. |

Reuse existing relational `users.id` and `pools.id` for new references. Team names are mutable JSON keys: either add stable team identifiers incrementally with legacy readers, or explicitly migrate every affected reference during renames. Player identity should use NHL IDs where available; name-only matching must not guess through ambiguity. No all-at-once normalization of rosters is required.

Write event and notification records in the transaction that changes their source state. A socket hint can follow commit. If a future dispatcher is introduced, it needs durable pending work and deduplication; do not start with a separate queue service.

### Activity V1

Record successful picks, draft completion, listing activation/removal, completed trades, and finalized H2H outcomes. Show a short preview with paginated history. Group a busy sequence of draft picks in the preview so it does not crowd out everything else.

Do not publish pending offer details to all pool members. Do not backfill detailed events from today’s roster. Older accepted trades or finalized matchups can be imported only with reliable identity and timestamps. Otherwise say activity begins with this release.

### Notifications V1

Keep the current bell, deliberate reads, specific destinations, and hidden zero badge. Initially persist current-turn, draft-start, received-trade, trade-result, and new-week notifications. Add “next pick” only after snake-order and consecutive-turn handling are tested. An exact “starts soon” alert requires a real scheduled start or the server-owned lobby countdown.

The badge counts unread notifications still eligible for display. Reading changes `read_at`; resolving the underlying action changes action state independently. Expired turn alerts stop appearing actionable even if never read. A retained accepted/declined trade notification opens its archived result.

Use a single server-derived destination model shared by the bell, toast, homepage, and feed. Pool switching happens before target focus. Validate membership even for old links, and provide a useful unavailable state for deleted targets.

Migrate local notification history conservatively: stable server identities prevent duplicates, and verified known IDs may import read state. Do not upload arbitrary local notification text as trusted events or replay old alerts as new toasts. Stop generating duplicate local/server streams after transition.

Defer rank/injury alerts until stable baselines, reliable identity matching, and deduplication exist. The current injury endpoint reads ESPN, not an official NHL injury feed; preserve source and update time. A roster difference also must not be presented as a confirmed NHL trade without corroboration.

Extend account export/deletion and pool deletion to the new data. Choose documented retention limits before rollout; avoid unnecessary personal metadata. Deleted users can retain an anonymous competition result if consistent with the existing deletion policy, but not a copied personal profile.

**Acceptance gate:** rollback produces no event; retries produce one event/recipient notification; refresh does not create duplicate alerts; unread state survives another device; reading an offer leaves the action pending; turn alerts expire; outsiders cannot read feeds or subscribe; account and pool cleanup cover new records.

## 8. Release E — Fantazy Aujourd’hui and market improvements

### One priority model for mobile and desktop

Extend the existing homepage rather than adding another dashboard. Use one priority selector and shared response data for `accueil-dash.js` and `accueil-mobile.js`. Keep the active pool concept, but consider urgent actions across all memberships. Every cross-pool item identifies its pool; following it sets the correct context.

Suggested deterministic ordering:

1. Your current draft turn.
2. Your live draft or imminent server-confirmed draft start.
3. A pending trade requiring your response.
4. Your current H2H matchup, prioritizing genuinely live scoring when available.
5. A new finalized result or reliable rank movement.
6. Your roster’s scheduled games and other information.

Within an urgency class: nearest real deadline, active pool, then stable occurrence time/ID. Do not fabricate deadlines. Keep the current primary item stable while the user is interacting unless a higher-urgency action arrives. One dominant item plus up to three secondary rows is the initial layout limit. Do not repeat the same item as a hero and another full card below it.

No pool: Instant Draft and create/join entry points. Waiting draft: lobby status. Offseason: pool preparation and verified upcoming information. Data failure: a source-specific unavailable/stale state while working sections remain usable. Empty and failed are not equivalent.

### Data delivery

Introduce `GET /api/me/today` if the measured request inventory confirms the benefit; the current duplication across layouts makes it a strong candidate. Its authenticated service aggregates existing caches and domain services directly, without making HTTP calls to its own routes.

Return a bounded primary item, secondary items, pool summaries, and source freshness/status. Keep full activity pages, full rosters, and all historical notifications out of this response. Separate schedule-only data from confirmed live participation. Include `generatedAt`, `asOf`, period, and pool revision where relevant.

Do not cache personalized summaries under a shared unscoped key. Use bounded database queries rather than per-pool/per-player fetch loops. Coalesce refreshes after bursts of socket events; pause background refresh when hidden and refresh on return. Remove replaced homepage requests so the aggregate endpoint does not become one extra request on top of all the old ones.

Capture baseline request count, bytes, query count, and response latency in the same environment before setting numeric budgets. Required invariant: no outbound NHL request per roster player during a warm homepage load, and no growth in query count proportional to individual players.

### Marché des échanges

Improve the existing `trade.html` listing surface. Show available player, owning team, pool-relevant actual stats, and “Faire une offre.” Show only configured categories. A listing opens the current composer with the target preselected; offer choices match the same category and actual roster ownership.

Keep one-for-one category restrictions, trade-enabled checks, and draft-completion restrictions. The server revalidates eligibility at submission and acceptance because ownership may change while the screen is open. If no eligible player exists, explain why before opening an empty chooser. Remove stale listings transactionally when ownership changes.

Defer notes, desired returns, trade values, and recommendation engines. A pending trade in Today links to the same specific proposal as its notification; its accepted result produces the same activity event used by the market’s history.

**Acceptance gate:** desktop and mobile choose the same primary action; an urgent turn in another pool is visible; zero/many pools, unavailable data, offseason, and stale trades render honestly; one event does not cause duplicate fetch cascades; changing pool during a request cannot render the previous pool’s result; invalid trade choices are filtered and concurrent invalidation is handled visibly.

## 9. Release F — weekly recap and rivalry, only where data supports them

Start with deterministic templates and finalized data. No generated narrative service is needed. Build an in-app summary with period, pool, scoring mode, status, and source/result revision. Persist reproducible results where underlying roster changes would otherwise rewrite history.

H2H V1: completed matchup results, highest weekly score, closest matchup, and largest margin. Equal leaders are shared winners; tied matches are shown honestly. Streaks require consecutive finalized history and a stated tie rule. Exclude partial/unfinalized weeks from records.

Cumulative V1: opening/closing rank and total changes only when comparable snapshots exist. Snapshot deltas can include roster changes and corrections: label them “variation du total du pool,” not points earned in games. Show only the categories with valid endpoints in the same season, scoring basis, and team identity.

“Joueur de la semaine” requires reliable period contributions under the agreed ownership rule and scoring mode. “Plus grosse remontée” requires comparable rankings with a defined tie policy. Do not derive either from current rosters applied retrospectively. A single complete week can support “meilleur score depuis le début du suivi,” not an unsupported all-time record.

Recap generation follows successful finalization/snapshot readiness and is idempotent. It catches up after restart, never publishes a partial record as final, and marks corrections. Add a homepage secondary item when a new recap becomes available; do not let it outrank an active draft turn or required trade response.

Keep recap data separate from rendering so a future share image can reuse it. No image generation, public share links, comments, reactions, or social profiles in this scope.

**Acceptance gate:** missing or mismatched snapshots omit that category; tie/negative-score cases work; a midweek trade cannot manufacture historical achievements; repeated jobs create one current recap; an official correction updates the associated recap revision; cumulative pools never show H2H wins or opponents.

## 10. Architecture, migrations, and rollout

Extract by changed domain, not by file size. A useful initial structure is `routes/` for HTTP adapters, `services/` for authenticated transactional operations and aggregation, `lib/` for pure calculations, and a socket registration module for authentication/rooms/refresh hints. Existing cache modules and `db.js` remain usable. Avoid wrapper modules that merely rename a function without establishing a boundary.

`server.js` should gradually retain composition, static serving, startup, and job registration. First extraction candidates: pool persistence, identity middleware, draft operations, trade acceptance, and shared H2H finalization. Keep cache lifetimes stable during extraction. Resolve duplicate routes deliberately with behavior tests; do not preserve an insecure shadowed handler for compatibility.

New endpoints are proposals, not a required parallel API: `/api/me/today`, authenticated notification list/read endpoints, pool activity pagination, and recap retrieval. Prefer extending existing H2H and listing routes. Reuse existing socket names temporarily if their payloads can be safely scoped and revisioned. Record each contract change and migrate all callers together.

Use numbered SQL migrations with a migration ledger; align fresh database initialization with the same schema. Specify indexes, constraints, defaults, data backfills, and deletion behavior. Re-running the migration command should be safe, but unexpected schema drift should fail visibly. Constraints on new identifiers cannot silently discard conflicting legacy data.

Roll out additive schemas and compatible readers before switching writers. Prevent old full-document writers and new transactional writers from running together during a rolling deployment; a brief controlled restart may be simpler. Back up before data migrations. Feature switches can hide new summaries/feeds, but must not re-enable unsafe writes. Database rollback must preserve newly recorded history; do not define rollback as dropping tables with user data.

Multi-process database safety does not automatically provide multi-process Socket.IO presence. Verify the actual deployment topology. Before horizontal scaling, implement a shared socket adapter/presence mechanism or explicitly retain one realtime instance. Persisted state and reconnect resync remain mandatory either way.

## 11. Mobile and accessibility acceptance criteria

Test each changed flow at 320, 360, 390, and 430 CSS pixels, plus desktop, in both themes. Test actual iOS Safari and Android Chrome when available; viewport emulation alone does not prove touch behavior. Record unavailable devices rather than claiming coverage.

- Use native buttons, links, labels, and tables. Preserve visible focus, modal focus containment/return, Escape where appropriate, and keyboard alternatives to drag or hover.
- Aim for at least 44 × 44 CSS pixels for important touch controls as the product comfort target. WCAG 2.2 AA’s minimum target criterion is 24 × 24 with defined exceptions; do not conflate the two. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Sticky headers, bottom actions, and toasts must not hide keyboard focus. Account for safe areas and the open software keyboard. [W3C focus-not-obscured guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
- Measure text and control contrast in both themes; retain semantic text/icons rather than color alone. Permit text enlargement and reflow without clipping essential controls. Wide comparison tables may scroll within a clearly labelled region.
- Announce important turn/action changes, not every live point or countdown second. Respect reduced motion. Do not repeatedly replace focused controls during socket refreshes.
- Preserve password-manager/autofill and paste support in login. Review timer accessibility before committing to new timed-draft rules; do not assume that every countdown qualifies for an accessibility exception.

Use automated checks plus manual keyboard, screen-reader, zoom, and touch checks. Report the tested surfaces and remaining defects, not a blanket WCAG certification.

## 12. Verification and release gates

Continue `npm run test:unit`. Use `npm run test:integration` only against a clearly isolated test server/database; inspect and adapt those scripts for authenticated sessions and deterministic cleanup first. Never point mutation tests at shared development or production data.

Add PostgreSQL tests using separate connections and controlled barriers, not timing-based sleeps: last-slot joins, empty-queue creation, duplicate picks at a snake reversal, pick versus skip, join versus leave, accept versus decline, overlapping trades, rename/config versus pick, finalization versus finalization, and failures between dependent writes. Include retries after the server committed but before the client received the response.

Add pure tests for priority ordering, score completeness, calendar boundaries, deduplication, and eligible recap categories. Preserve the existing notification browser tests. Add route/authorization tests for wrong-user actions, private reads, socket subscriptions, and deployment asset exposure. Regression checks must include all existing roster categories and configured scoring modes.

For every release, report changed behavior, files/contracts, migration steps, checks actually run, and remaining risks. Mark unfinished acceptance criteria as incomplete. Do not broaden a release simply to make every original heading appear implemented.

## 13. Decisions to settle before their dependent work

| Decision | Recommended direction | When needed |
| --- | --- | --- |
| Instant Draft timeout and absence policy | Server-owned timeout with disclosed automatic selection; define fallback and unavailable-data behavior. Preserve existing behavior until approved and tested. | Before promoting reliable quick play to strangers. |
| H2H roster ownership and traded-player credit | Explicitly choose current-roster valuation, week-locked roster, or ownership-at-game-time credit. Preserve current rules during consolidation; withhold unsupported historical claims. | Before changing score attribution or shipping player-based historical records. |
| Drafted NHL club points in H2H | Document current intended rules and make all H2H surfaces agree; do not infer them from cumulative rules. | Before canonical H2H totals ship. |
| Notification/activity retention | Bounded history aligned with current export/deletion policy; minimal metadata. | Before new persistent history goes live. |

These decisions block only their dependent behavior. Identity, atomic saves, route cleanup, existing notification regressions, data freshness, and mobile accessibility improvements can proceed independently.

The first implementation milestone is **Release A: authenticated, atomic pool operations**, followed by completion of the existing Instant Draft flow. The daily homepage and historical features then build on state the product can trust.
