# Unit Tests — Build Guide

How to add unit tests to Fantazy, what is worth testing, and how to read the
coverage percentage. Companion document: `UNIT_TESTS_REVIEW.md` (how to review
the tests once they exist).

---

## 1. Where we stand

| | |
|---|---|
| Unit tests | **none** |
| Integration scripts | `test_suite.js`, `test_h2h.js`, `test_teams.js` — hand-rolled, hit `http://localhost:3000`, need a live server + Postgres |
| Test framework | none installed (only `nodemon` in devDependencies) |
| `npm test` | still the stub: `echo "Error: no test specified" && exit 1` |
| CI | none |
| Coverage | never measured |

The three `test_*.js` files stay. They are end-to-end checks and they cover
things unit tests never will (routes, sockets, SQL). This document is about the
layer underneath them: the pure functions that today are only reachable by
booting the whole app.

---

## 2. Runner: `node --test` (built in, zero dependencies)

Node 24.20.0 is already installed and ships a test runner, an assertion
library, mocking, and a coverage reporter. No jest, no vitest, no babel, no
config file. The project has one devDependency today; this keeps it that way.

Everything below was executed on this machine before being written down.

```
node --test --experimental-test-coverage --test-coverage-include="lib/**" "test/**/*.test.js"
```

produces:

```
ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file        | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ lib         |        |          |         |
ℹ  scoring.js |  85.71 |   100.00 |   50.00 | 6
ℹ ------------------------------------------------------------
ℹ all files   |  85.71 |   100.00 |   50.00 |
ℹ ------------------------------------------------------------
ℹ end of coverage report
```

### Three gotchas — all confirmed on this machine, two of them silent

1. **Use double quotes in `package.json` scripts, never single.** npm runs
   scripts through `cmd.exe`, which does not strip single quotes. The glob is
   passed through literally, matches nothing, **zero tests run, and the report
   prints `all files | 100.00 | 100.00 | 100.00`** — a green wall of nothing.
   Verified: the single-quoted variant reported 100% having loaded 0 test files.
2. **`node --test test/` fails on Windows.** The bare directory is resolved as
   a module: `Error: Cannot find module '...\test'`. Use the glob
   `"test/**/*.test.js"`, or pass no path at all (auto-discovery). Both work.
3. **The lcov reporter does not create its output directory.** Writing to
   `coverage/lcov.info` when `coverage/` does not exist throws `ENOENT` and
   exits 7. `mkdir` first — the script in §3 does.

### Thresholds gate the build

`--test-coverage-lines=90` against 85.71% exits **1** with
`Error: 85.71% line coverage does not meet threshold of 90%.` (verified). Same
for `--test-coverage-branches` and `--test-coverage-functions`. That is what
turns the percentage from a number you glance at into something that fails.

---

## 3. Scripts to add to `package.json`

```json
"scripts": {
  "test": "npm run test:unit",
  "test:unit": "node --test \"test/**/*.test.js\"",
  "test:watch": "node --test --watch \"test/**/*.test.js\"",
  "test:cov": "node --test --experimental-test-coverage --test-coverage-include=\"lib/**\" --test-coverage-include=\"tools/**\" --test-coverage-exclude=\"**/*.test.js\" \"test/**/*.test.js\"",
  "test:cov:gate": "node --test --experimental-test-coverage --test-coverage-include=\"lib/**\" --test-coverage-exclude=\"**/*.test.js\" --test-coverage-lines=80 --test-coverage-branches=70 --test-coverage-functions=85 \"test/**/*.test.js\"",
  "test:cov:lcov": "node -e \"require('fs').mkdirSync('coverage',{recursive:true})\" && node --test --experimental-test-coverage --test-coverage-include=\"lib/**\" --test-reporter=lcov --test-reporter-destination=coverage/lcov.info --test-reporter=spec --test-reporter-destination=stdout \"test/**/*.test.js\"",
  "test:integration": "node test_suite.js && node test_h2h.js && node test_teams.js"
}
```

- `npm run test:cov` — the percentage, per file, in the terminal.
- `npm run test:cov:gate` — same run, non-zero exit under threshold.
- `npm run test:cov:lcov` — writes `coverage/lcov.info`. In VS Code, the
  **Coverage Gutters** extension reads that file and paints covered/uncovered
  lines in the editor margin. `coverage/` is already in [.gitignore](.gitignore).
- `test:integration` still needs a running server; it is deliberately not part
  of `npm test`.

---

## 4. Layout

```
lib/                       ← pure logic extracted from server.js (new)
  scoring.js
  h2h.js
  draft.js
  trades.js
  roster.js
  statsCache.js
  season.js
test/
  unit/
    scoring.test.js
    h2h.test.js
    draft.test.js
    trades.test.js
    roster.test.js
    statsCache.test.js
    season.test.js
    profanity.test.js
    draftkit-build.test.js
    browser-helpers.test.js
  fixtures/
    pool.js                ← factory functions, not JSON blobs
    stats.js
    guide-page.txt         ← a real slice of a draft-kit team page
    helpers.js             ← loadBrowserModule(), see §5.3
```

One test file per source module, named after it. Fixtures are **factories**
(`makePool({ teams: 4 })`), never a shared mutable object — see the review doc
for why.

---

## 5. Making the code testable

Three different problems, three patterns.

### 5.1 `server.js` — extract to `lib/`

[server.js](server.js) is 6,718 lines. Requiring it starts Express, Socket.IO,
cron jobs and a Postgres pool, so a test can never import it. But most of the
logic worth testing is already written as standalone pure functions that happen
to live in that file.

Move them out, `module.exports` them, `require` them back at the top of
server.js. The function bodies do not change — this is a cut-and-paste, and the
integration suite is there to prove nothing shifted.

| New module | Functions moved (current location) |
|---|---|
| `lib/scoring.js` | `FANTASY_SCORING` [:4601](server.js#L4601), `computeTeamSeasonScores` [:538](server.js#L538), `getTeamWeeklyPoints` [:322](server.js#L322), `skaterFantasyPointsTonight` [:3158](server.js#L3158), `goalieFantasyPointsTonight` [:3164](server.js#L3164) |
| `lib/h2h.js` | `generateWeeklyMatchups` [:234](server.js#L234), `calculateWeeklyResults` [:574](server.js#L574), `ensureStandingsEntry` [:567](server.js#L567), `getCurrentWeekNumber` [:645](server.js#L645), `mondayOfWeek` [:5840](server.js#L5840) |
| `lib/draft.js` | `generateSnakeOrder` [:1951](server.js#L1951), `checkIfDraftComplete` [:2012](server.js#L2012) |
| `lib/trades.js` | `teamHasPlayer` [:5083](server.js#L5083), `invalidateConflictingTrades` [:5104](server.js#L5104), `removeFromTeam` [:5151](server.js#L5151), `addToTeam` [:5174](server.js#L5174), `getPositionLabel` [:5497](server.js#L5497) |
| `lib/roster.js` | `diffRosterSnapshots` [:3492](server.js#L3492), `getTeamAbbreviationFromName` [:4942](server.js#L4942), `NHL_CLUB_FULLNAME` |
| `lib/statsCache.js` | `getStatsRefreshStatus` [:2412](server.js#L2412) |
| `lib/season.js` | saison en cours et fenêtre de saison régulière — le numéro `20252026` vivait en dur dans une trentaine d'endroits |

Two functions need a small signature change to become pure:

- `getStatsRefreshStatus(stats)` calls `loadAllPlayers()`, which reads
  `nhl_filtered_stats.json` from disk. Change it to
  `getStatsRefreshStatus(stats, expectedPlayerCount)` and let server.js pass
  `loadAllPlayers().length`. The hardcoded `20252026` season should become a
  second argument or an exported constant the test can import.
- `getCurrentWeekNumber(seasonStart)` reads `new Date()`. Either accept an
  optional `now = new Date()` parameter, or drive it with `mock.timers` (§6).
  Prefer the parameter — it is one word and removes the need for mocking.

**Do not** move `getTeamPointsForDateRange` [:350](server.js#L350),
`getTeamPlayerBreakdownForDateRange` [:431](server.js#L431), or anything that
touches `db.query` or `fetch`. Those stay where they are; the integration
scripts own them.

### 5.2 `tools/build_draftkit.js` — add a main guard

[tools/build_draftkit.js](tools/build_draftkit.js) is a top-level script: it
reads the spreadsheet and calls `fs.writeFileSync` at import time, so
`require()`-ing it from a test would rebuild `draftkit.json`. Wrap the
executing part:

```js
function main() { /* everything from buildTeams() down to the final console.log */ }

if (require.main === module) main();

module.exports = { nameKey, splitName, isRookie, titleCase, editDistance,
                   resolveId, round, parseTopPicks, parseLineup, parseInjury,
                   parseNotes, linkGuides, ROOKIE_MAX_GAMES, ROOKIE_MAX_AGE };
```

The `warn()` calls inside `isRookie` push to a module-level `warnings` array —
export a `resetWarnings()`, or accept the collector as an argument, so tests do
not leak state into each other.

### 5.3 Browser files — the `profanity.js` footer

[profanity.js](profanity.js) already solves this, and is the pattern to copy:

```js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                 // serveur (CommonJS)
} else if (typeof window !== 'undefined') {
    Object.assign(window, api);           // navigateur
}
```

Any browser helper that gets the same footer becomes testable with a plain
`require()` and keeps working unchanged in the page. Add it to
[headshots.js](headshots.js), [teamColors.js](teamColors.js),
[injuries.js](injuries.js) and [draftkitData.js](draftkitData.js).

Where the footer is not wanted, `test/fixtures/helpers.js` can load the source
into a sandbox instead:

```js
const vm = require('node:vm'), fs = require('node:fs');
function loadBrowserModule(file, globals = {}) {
    const ctx = vm.createContext({ window: {}, document: undefined,
                                   localStorage: undefined, console, ...globals });
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    return ctx;
}
```

Use this only for `const`-at-top-level files like `teamColors.js`. Never for
`draftActif.js` or `draftApercuExtra.js` — see §8.

---

## 6. Conventions

```js
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');   // always /strict
const { generateSnakeOrder } = require('../../lib/draft.js');

describe('generateSnakeOrder', () => {
    test('reverses direction every other round', () => {
        assert.deepEqual(
            generateSnakeOrder(['A', 'B', 'C'], 2),
            ['A', 'B', 'C', 'C', 'B', 'A']
        );
    });
});
```

- **`assert/strict`** — `deepEqual` in the loose module passes `1 == '1'`.
- **Test names state the behaviour, not the function.** "returns 1 before the
  season starts", not "test getCurrentWeekNumber".
- **No network, no filesystem, no database, no real clock** in `test/unit/`. A
  unit test needing any of those is an integration test in the wrong folder.
- **Determinism.** `generateWeeklyMatchups` and the draft-order randomiser call
  `Math.random()`. Stub it — `mock.method(Math, 'random', () => 0.42)` — and
  restore with `mock.restoreAll()` in an `afterEach`. Assert the *invariants*
  (every team appears exactly once, nobody faces themselves) rather than one
  specific pairing.
- **Clock.** `mock.timers.enable({ apis: ['Date'], now: new Date('2025-10-15T12:00:00Z') })`
  for anything reading `Date.now()`. Passing the date in is better.
- **Fixtures are factories with overrides**, so a test that cares about one
  field shows only that field:
  ```js
  const pool = makePool({ teams: { Rouge: { members: ['a'], offensive: ['McDavid'] } } });
  ```
- **French/English:** test names and comments are in **French**, like the rest
  of the codebase. A failure line reads as a sentence about the app
  (`✖ un dimanche remonte de six jours, il n'avance pas d'un`), in the same
  language as the source comment it protects. Fixture data keeps the French
  keys the app actually uses (`offensive`, `defensive`, `rookie`, `goalie`,
  `teams`).

---

## 7. The inventory — everything worth testing

Priority: **P0** = money logic, a bug here silently corrupts standings or the
draft. **P1** = data correctness, visible but recoverable. **P2** = cosmetic
formatting. Case counts are estimates, for sizing.

### P0 — Scoring · `lib/scoring.js` → `test/unit/scoring.test.js` (~22 cases)

| Function | Cases |
|---|---|
| `computeTeamSeasonScores` | goalie formula is exactly `SO×5 + W×2 + OTL×1` — assert with a goalie having all three; a skater's score is `points` verbatim; a team with `members: []` is excluded from the rows; rows come back sorted descending with `rank` 1..n; **two teams tied on score get ranks 1 and 2, not 1 and 1** (lock the current behaviour); player entries as a plain string, as `{skaterFullName}`, as `{goalieFullName}`; a rostered player absent from `statsPlayers` scores 0, not `NaN`; `statsPlayers` null/undefined; `poolData.teams` missing; a player on two teams counts for both |
| `getTeamWeeklyPoints` | null `teamData` → 0; `currentStats` null or `{players: undefined}` → 0; sums `offensive` + `defensive` + `rookie` + `goalie`; **NHL `teams` picks are NOT counted** — lock it, it is a real asymmetry with `computeTeamSeasonScores`; **goalies are scored on `points` here, not the W/SO formula** — lock that too; the two functions disagree, and the test is where it gets decided whether that is by design; unknown player → 0; empty arrays |
| `skaterFantasyPointsTonight` | `goal 3 / assist 2 / shot 0.5 / plusMinus 0.5` — one case per weight plus one combined; a negative `plusMinus` subtracts; every field missing → 0; rounds to one decimal (3 shots → 1.5, plus a case that would otherwise produce a float tail) |
| `goalieFantasyPointsTonight` | `decision: 'W'` → +5, `'L'`/`'O'`/null → 0; `shutout` → +3; `saves × 0.2`; `goalsAgainst × −1`; a shutout win with 30 saves = 5 + 3 + 6 = 14; rounding |

### P0 — Head-to-head · `lib/h2h.js` → `test/unit/h2h.test.js` (~26 cases)

| Function | Cases |
|---|---|
| `generateWeeklyMatchups` | an odd number of active teams → `[]`; zero active teams → `[]`; exactly 2 teams → one matchup, always the same pair; 4 and 6 teams → every team appears exactly once, `team1 !== team2`, `length === n/2`; teams with `members: []` are dropped *before* the parity check (4 teams, one empty → odd → `[]`); returned matchups carry `team1Points: 0`, `team2Points: 0`, `winner: null`, `weekNumber: null`; with `previousMatchups` and `Math.random` stubbed, a repeat pairing is avoided when an alternative exists; `previousMatchups` entries that are not arrays are ignored; only the last 3 weeks count (a week-1 pairing is fair game in week 5) |
| `calculateWeeklyResults` | team1 wins → W/L; team2 wins → L/W; equal → `winner === 'tie'` and both get a tie; standings entries created on demand with zeros; `pointsFor`/`pointsAgainst` mirrored on both sides; missing `h2hData` → early return, no throw; a matchup naming a team absent from `poolData.teams` is skipped without touching standings; `matchupHistory` gains one entry carrying `weekNumber` and the matchups; **calling it twice for the same week double-counts the standings** — write the test that documents today's behaviour, then decide whether it is a bug |
| `getCurrentWeekNumber` | `null`/`undefined` → 1; a start date in the future → 1; same day → 1; exactly 7×24h later → 2; 6d 23h 59m → 1; 3 weeks + 1 day → 4 |
| `mondayOfWeek` | a Monday returns itself; Tuesday–Saturday walk back to that Monday; **Sunday walks back 6 days, not forward 1**; crosses a month boundary (`2025-11-01` → `2025-10-27`); crosses a year boundary; the result is `YYYY-MM-DD`; unaffected by the machine timezone — worth one explicit case, since Render runs UTC and you develop in Montreal |
| `ensureStandingsEntry` | creates `{wins:0, losses:0, ties:0, pointsFor:0, pointsAgainst:0}`; does not overwrite an existing entry |

### P0 — Draft engine · `lib/draft.js` → `test/unit/draft.test.js` (~14 cases)

| Function | Cases |
|---|---|
| `generateSnakeOrder` | 2 teams strictly alternate `A,B,A,B…` for `rounds × 2` picks; 3+ teams snake (`A,B,C,C,B,A,A,B,C`); output length is `teams.length × rounds` in both branches; `rounds: 0` → `[]`; a 1-team array; the input array is not mutated (`.reverse()` is called on a copy); the default `rounds = 15` |
| `checkIfDraftComplete` | every active team at quota → `true`; one team one player short in each of the five categories → `false` (five cases, table-driven); no active teams → `false`; teams with `members: []` are ignored even with empty rosters; a missing `clan.config` falls back to `6/4/1/1/1`; a custom config is respected; absent `rookie`/`goalie`/`teams` arrays → `false`, no throw (the optional chaining); a team **over** quota — `===` means over-full returns `false`, lock it |

### P0 — Trades · `lib/trades.js` → `test/unit/trades.test.js` (~20 cases)

| Function | Cases |
|---|---|
| `teamHasPlayer` | each `type` maps to its array, and **`'team'` maps to `teams`** — the one mapping that is not identity; matches `skaterFullName`, `goalieFullName`, `teamFullName`, and a bare string entry; an absent player → `false`; a missing array → `false`; an unknown `type` → `false` |
| `removeFromTeam` | removes exactly one entry and leaves the rest in order; a no-op when the player is absent; a missing array does not throw; removes only from the array named by `type`, even when the same name exists elsewhere |
| `addToTeam` | pushes `item.playerData` when present (the full object, stats preserved); falls back to `item.name` when not; creates the array when the team has none |
| round-trip | `removeFromTeam(a, item)` + `addToTeam(b, item)` conserves the total roster count and moves the object identity |
| `invalidateConflictingTrades` | cancels every pending trade naming a player from the accepted trade, on either side; returns the number cancelled; leaves trades from a different `draftName` alone; empty or absent `pending` → 0; no overlap → nothing removed, returns 0; the accepted trade's own pending record |
| `getPositionLabel` | the five known types map to their French labels; an unknown type passes through unchanged |

### P1 — Roster & transactions · `lib/roster.js` → `test/unit/roster.test.js` (~16 cases)

| Function | Cases |
|---|---|
| `diffRosterSnapshots` | a player only in `next` → `signing` with `fromTeam: null`; a changed `team` → **one `trade` move, never a departure plus a signing** (the invariant stated in the source comment); a player only in `previous` → `departure`, but only when `allowDepartures` is true — with `false` the move disappears entirely; unchanged players produce nothing; `id` is exactly `${dateISO}-${playerId}-${type}` and is stable across two runs on the same day; `playerId` comes back a `Number` even though snapshot keys are strings; `fromTeamName`/`toTeamName` resolve through `NHL_CLUB_FULLNAME`, and an unknown code falls back to the code itself; both snapshots empty → `[]`; a first-ever snapshot (empty `previous`) makes every player a signing |
| `getTeamAbbreviationFromName` | the accented `"Montréal Canadiens" → MTL`; the punctuated `"St. Louis Blues" → STL`; `"Utah Hockey Club" → UTA`; the fallback rule for a name not in the table; legacy `"Arizona Coyotes" → ARI` still resolves; empty string / null |

### P1 — Stats cache · `lib/statsCache.js` → `test/unit/statsCache.test.js` (~8 cases)

`getStatsRefreshStatus` is a decision function with a four-way `reason`
precedence — worth locking, because the wrong branch means either a stale
scoreboard or hammering the NHL API.

- no `lastUpdated` → `needsRefresh: true`, `reason: 'no local cache yet'`, `ageHours: Infinity`
- fewer than `min(expected × 0.5, 200)` players → `cacheIsIncomplete: true`, and the incomplete reason wins over the age reason
- `season !== 20252026` → the wrong-season reason
- fresh, complete, right season, 2h old → `needsRefresh: false`
- exactly 24h old → `false`; 24.1h → `true` (boundary)
- the `Math.min(expected × 0.5, 200)` boundary at a small and a large `expectedPlayerCount`

### P1 — Draft-kit build · `tools/build_draftkit.js` → `test/unit/draftkit-build.test.js` (~34 cases)

The build turns a spreadsheet into `draftkit.json`. Nothing else in the repo has
this density of string parsing, and a silent mis-parse ships bad player data to
every user.

| Function | Cases |
|---|---|
| `nameKey` | strips accents (`Sébastien` → `sebastien`); lower-cases; collapses punctuation and hyphens to single spaces (`Sandin-Pellikka` → `sandin pellikka`); trims; a non-string input does not throw |
| `splitName` | `"Brad Marchand °°°"` → `{name: 'Brad Marchand', injury: 3}`; no marker → `injury: 0`; one and two markers; trailing whitespace before the markers; a `°` inside the name is not counted |
| `isRookie` | `lastSeasonGames: null` + age 19 → `true` (an empty cell is the *most* certain rookie); **27 games → `true`, 28 → `false`** (`ROOKIE_MAX_GAMES`); **age 23 → `true`, 24 → `false`** (`ROOKIE_MAX_AGE`); age null → `false` and a warning recorded; a 30-year-old with 5 games (a season-long injury) → `false` — the case the old hardcoded exception existed for |
| `titleCase` | `MCDAVID` → `McDavid` (the `Mc` rule); hyphenated `jean-gabriel` → `Jean-Gabriel`; the typographic apostrophe `o’reilly` → `O’Reilly` and the straight `o'reilly`; a dot separator; an accented first letter |
| `editDistance` | identical → 0; either side empty → the other's length; one substitution / insertion / deletion → 1; `editDistance(a,b) === editDistance(b,a)` over a handful of pairs |
| `resolveId` | an exact name hit; the same surname on two teams resolved by `team`; no match → `null`; an accented name matching an unaccented index entry |
| `round` | `null` passes through as `null` (not `0`); rounds to the requested decimals; `0` stays `0` |
| `parseTopPicks` / `parseLineup` / `parseInjury` / `parseNotes` | drive each from `test/fixtures/guide-page.txt`, a real slice of one team page: a full page parses to the expected shape; a page missing the injury block; a lineup with an incomplete fourth line; a notes section with a blank line in the middle; a malformed row is skipped rather than throwing |
| `linkGuides` | an exact full-name mention resolves; a surname-only mention resolves when unique; **a near-miss surname resolves only against that team's own roster** (`Sandin-Pellika` → `Sandin Pellikka` on the same team, while the same near-miss on another team does not); an ambiguous surname across two teams stays unresolved; an unknown name stays unresolved |

### P1 — Profanity filter · `profanity.js` → `test/unit/profanity.test.js` (~12 cases)

Already dual-exports — **testable today, no refactor**. Start here.

- `normaliser`: accents removed, lower-cased, punctuation and spacing collapsed, `null`/empty → falsy
- `contientGrossierete`: a whole-word hit from `ENTIERS`; a compacted partial hit (`c o n a r d`, and `conard` for `connard`); a clean team name → `false`; empty string / null / undefined → `false`; a legitimate name that *contains* a listed substring across a word boundary — pick two plausible French-Canadian team names and lock that they pass
- `verifierNom`: `{ok: true}` and no message for a clean name; `{ok: false}` with a message containing the `quoi` label for a dirty one; the default label when `quoi` is omitted

### P2 — Browser helpers · `test/unit/browser-helpers.test.js` (~24 cases)

After the §5.3 footer. Small, pure, user-visible.

| Source | Function | Cases |
|---|---|---|
| [headshots.js:12](headshots.js#L12) | `buildHeadshotUrl` | the URL shape for a known id + team; a missing `playerId` → null; a missing `teamAbbrev` |
| [headshots.js:28](headshots.js#L28) | `resolveHeadshotByName` | resolves a known name; an id listed in `FZ_IDS_ERRONES` is refused; an unknown name → null |
| [teamColors.js](teamColors.js) | `hexLuminance` | `#ffffff` → 1, `#000000` → 0; the 3-digit form `#fff` expands; a malformed value → 0; the sRGB knee (a mid grey lands where the piecewise formula says, not on the naive ratio) |
| [teamColors.js](teamColors.js) | `NHL_TEAM_COLORS` | every entry is a 2-element array of `#rrggbb`; all 32 current clubs present |
| [injuries.js:174](injuries.js#L174) | `getPlayerInjury` | not ready → null; an exact normalised name hit; **the loose key requires a matching team — the "Jake Martin / Josh Martin" case in the source comment is exactly the test**; a loose hit with no team code → null |
| [classement.js:298](classement.js#L298) | `rankByPeriodPoints` | descending ranks 1..n; a team with `undefined` points sorts last; ties get sequential ranks; empty input |
| [classement.js](classement.js) | `fmtPeriodPts` | `null`/`undefined` → `'—'`; an integer prints bare; a float prints one decimal |
| [classement.js](classement.js) | `initialsFromName` | two words → two initials, upper-cased; a single word → its first two letters; accents preserved; symbols stripped; empty → `''` |
| [classement.js:603](classement.js#L603) | `formatHofDate` / `formatHofMonth` | a known ISO date formats as expected; a month boundary |
| [statsLeaders.js:94](statsLeaders.js#L94) | `escapeHTML` | a `<script>` payload neutralised; `&`, `"`, `'`; a clean string unchanged |
| [statsTopPlayers.js:18](statsTopPlayers.js#L18) | `topPlayersRangeText` | each supported day count; the singular/plural boundary |
| [draftkitData.js:59](draftkitData.js#L59) | `pointsGardien` / `pointsEquipe` | the documented formula per position; zeros |
| [draftkitData.js:239](draftkitData.js#L239) | `cleNom` / `nomCanonique` | an accented variant maps to the canonical spelling; an unknown name returns unchanged |
| [trade.js:1125](trade.js#L1125) | `getCategory` / `getCategoryLabel` / `getCategoryType` | the five categories round-trip `type → category → type` |
| [navbar.js:2](navbar.js#L2) | `getCurrentPage` | each page path; an unknown path; a path carrying a query string |

---

## 8. Explicitly out of scope

Do not write unit tests for these. Saying so here keeps the coverage percentage
from being gamed against code that cannot be meaningfully unit tested.

| | Why | Covered by |
|---|---|---|
| Express route handlers in [server.js](server.js) | need HTTP + Postgres | `test_suite.js`, `test_h2h.js`, `test_teams.js` |
| [db.js](db.js) | thin `pg` wrappers; a mock would only test the mock | integration scripts |
| `fetch_game_logs.js`, `update_rookie_ids.js`, `find_rookie_ids_v2.js`, `prune_retired_players.js`, `api.py` | network I/O against nhle.com | manual runs |
| [draftActif.js](draftActif.js), [draftApercuExtra.js](draftApercuExtra.js), [draftPickCards.js](draftPickCards.js) | minified, jQuery + DOM + socket throughout | manual / integration |
| [careerTotals.js](careerTotals.js), [careerTeamLogo.js](careerTeamLogo.js), [lazy-load.js](lazy-load.js) | pure DOM and `getComputedStyle` work, no logic to assert | manual |
| `migrations/`, `.css`, `.html` | not JavaScript logic | — |
| `create-test-users.js` | a seeding script, not a test despite the name | — |

Keep `--test-coverage-include` pointed at `lib/**` and `tools/**` so this code
never enters the denominator.

---

## 9. Coverage — targets and what is actually measured

Measured only over what §8 leaves in scope. **Measured values below are from a
real run** (`npm run test:cov`), not aspirations.

| Scope | Line | Branch | Function |
|---|---|---|---|
| `lib/draft.js` | 100% | 100% | 100% |
| `lib/trades.js` | 100% | 100% | 100% |
| `lib/roster.js` | 100% | 100% | 100% |
| `lib/statsCache.js` | 100% | 100% | 100% |
| `lib/h2h.js` | 100% | 98.18% | 100% |
| `lib/scoring.js` | 100% | 98.28% | 100% |
| **`lib/**` overall** | **100%** | **99.01%** | **100%** |
| `profanity.js` | 98.45% | 90% | 100% |
| `tools/build_draftkit.js` | 66.67% | 93.29% | 84.44% |
| **Gate in `test:cov:gate`** | **95** | **90** | **100** |

The gate covers `lib/**` only, and sits just under the measured value so an
unrelated change cannot quietly erode it. It passes today.

Three numbers are below 100 for reasons that are not gaps:

- **`h2h.js` 98.18%** — `return bestMatchups || [];` The `|| []` half is
  unreachable: `bestMatchups` is always assigned on the first of the ten
  shuffle attempts. Defensive code, no test possible.
- **`scoring.js` 98.28%** — one branch of the goalie/skater ternary in
  `computeTeamSeasonScores` combined with an absent stat field; the remaining
  combination cannot occur with a well-formed stats row.
- **`profanity.js` 98.45%** (lines 127-128) — the `else if (typeof window …)`
  half of the export footer. It only runs in a browser, by construction.
- **`build_draftkit.js` 66.67% lines** — the uncovered ranges are exactly
  `buildIdIndex`, `buildTeams`, `buildSkaters`, `buildGoalies`, `buildGuides`
  and `main()`: every one of them opens an `.xlsx` or the `.txt` off disk, and
  §8 puts file I/O out of scope. The *parsing* half of the file — the part
  where a silent mis-parse ships bad data — is at **93.29% branch**.

Branch coverage is the number that matters here. This codebase is full of `||`
defaults, `?.` chains and `a || b || c` name fallbacks; line coverage looks
excellent while half of those branches have never executed. Getting `lib/**`
from 93.82% to 99.01% branch took five extra cases, and each one was a real
edge case (a stats row with no `points`, a team whose arrays do not exist yet,
an unknown *from*-club code, an absent `standings`).

---

## 10. Order of work

| Phase | Work | Files | Cases | Refactor | État |
|---|---|---|---|---|---|
| 1 | `profanity.js`, plus the npm scripts and folder layout | `test/unit/profanity.test.js` | 18 | none | ✅ fait |
| 2 | Extract `lib/scoring.js`, `lib/h2h.js`, `lib/draft.js`, `lib/trades.js`, then test them | 4 test files | 105 | cut-and-paste out of server.js | ✅ fait |
| 3 | `lib/roster.js`, `lib/statsCache.js` | 2 test files | 39 | two signature changes (§5.1) | ✅ fait |
| 4 | `tools/build_draftkit.js` | 1 test file + fixture | 77 | main guard | ✅ fait |
| 5 | Browser helpers | 1 test file | 75 | export footer on 4 files | ✅ fait |
| 6 | Raise the gate to the §9 values | — | — | — | ✅ fait (95/90/100) |
| 7 | Run the three integration scripts against a live server | — | 209 | fix below | ✅ fait |
| 8 | GitHub Action running `npm run test:cov:gate` | — | — | — | ⬜ à faire |

### Phase 7 — the integration run, and the fix it needed

```
npm run test:integration        # serveur en marche requis
  test_suite.js   ✓ 42   ✗ 0   ○ 9    (51)
  test_h2h.js     ✓ 106  ✗ 0          (106)
  test_teams.js   ✓ 61   ✗ 0          (61)
```

**209 checks, 0 failures**, against a server running the extracted `lib/` code.
That is the evidence phase 2 was a move and not a rewrite.

Getting there needed a one-line-per-script fix that has nothing to do with the
extraction. The first run came back `✗ Start draft → "En attente du choix
d'équipe LNH"`, and in `test_h2h.js` that single failure cascaded into 56 — no
draft order, so no picks, so the draft never completes, so H2H never
initialises. The cause: commit `687f17f` ("feat: implement NHL club selection")
made `/choose-nhl-club` a **precondition of `/start-draft`**, and all three
scripts predate it — they call `/choose-nhl-club` exactly zero times.

Each script now carries a `chooseClubs(poolName)` helper that assigns a
distinct club to every active team before starting a draft. Nothing else in
them changed. The counts went **26✓/2✗ → 42✓/0✗** and **32✓/56✗ → 106✓/0✗**;
the totals rose too (37 → 51, 88 → 106) because the draft sections were
previously unreachable and never ran at all.

Two things worth knowing about that baseline: the "before" numbers were also
measured against the post-extraction server, so they are not a true
pre-extraction baseline — but every failure was fully explained by the club
gate, and the suites are now green against the extracted code. And 9 checks in
`test_suite.js` still report `[SKIP: No PostgreSQL DB in local dev]`; trades
and game-log endpoints need a database this environment does not have.

Everything checkable without a server was verified too: `node --check` on every
touched file, all 21 extracted names confirmed re-imported at the top of
server.js, `npm run build-draftkit` run end to end (exit 0, output restored),
and the mutation spot-check in `UNIT_TESTS_REVIEW.md` §6 — 11 of 11 caught.

---

## 11. What the tests found — and what was done about it

Writing the suite turned up a series of defects in the existing code. None were
introduced by the extraction; all predate it. **All are now fixed**, each with a
test that fails if it comes back.

Two of the original findings turned out to be wrong on closer inspection, and
are recorded here because the corrections are more instructive than the
findings were:

- **"The two scoring functions disagree about goalies."** They don't. The stats
  cache pre-computes the pool formula into `points` at
  [server.js](server.js) (`calculatedPoints`), so reading `points` and
  recomputing from W/SO/OTL give the same number — verified across all 58
  goalies in the cache. The test that "proved" the divergence had forced
  `points: 2` onto a goalie with 30 wins, a row that cannot exist. It now locks
  the *agreement* instead.
- **"Conflicting pending trades are never cancelled."** They are — the
  `/trade/accept` route does it inline in SQL. `invalidateConflictingTrades`
  wasn't a missing feature, it was a superseded duplicate.

### Fixed

| # | Defect | Fix |
|---|---|---|
| 1 | **Accented players never got an injury badge.** `injNormalizeName` turned NFD's combining accent into a *space*: `Connor Bédard` → `connor be dard` vs the ESPN feed's `connor bedard`. Neither the exact key nor the loose key (`dard\|c` vs `bedard\|c`) matched. | Combining marks are now stripped, as `nameKey()` and `profanity.js` already did. Both spellings resolve, in both directions. |
| 2 | **The weekly H2H fallback mixed units.** When game logs were missing, the score fell back to season-to-date totals — a different unit from the date-range fantasy scoring. The two guards were independent, so a team whose logs were missing got a season total (hundreds) against an opponent's one-week score (tens): a guaranteed win. | Fallback is now **all-or-nothing**. No logs at all → every team falls back, so the comparison stays fair. Some teams only → the week is not finalized (503 on the manual route, `break` in the catch-up loop, which retries). |
| 3 | **The season standings ignored drafted NHL clubs** while `classement.js` counted them (2×W + OTL) in the total displayed on the same row. The server's number drives `pool_rank_snapshots` and the evolution arrows, so the arrow could report a move that never happened. | `computeTeamSeasonScores` takes `teamStandings` and counts clubs. `accueil.js` counts them too, so all three agree. |
| 4 | **The goalie formula existed in six places**, the club formula in four. They agreed by maintenance, not construction — changing a weight in one spot silently diverged the displayed total from the recorded rank. | One `goaliePoolPoints()` and one `clubPoolPoints()` in `lib/scoring.js`, which now carries the dual-export footer and is loaded by `classement.html`, `index.html` and `draftFini.html`. Zero copies remain. |
| 5 | **`getTeamWeeklyPoints` threw on a `null` roster entry** while tolerating `''` — an accident of access order that took down a whole week's calculation. | `?.` guard; holes score 0. |
| 6 | **Three dead functions**, two of which duplicated live logic: `calculateWeeklyResults` (duplicate of the inline finalization in `checkAndFinalizeCompletedWeeks`, and it double-counted on a second call), `invalidateConflictingTrades` (duplicate of the SQL in `/trade/accept`), `getCurrentWeekNumber` (no callers, no replacement). | Deleted, with their tests. A standings fix can no longer land in the copy that never runs. |
| 7 | `test_h2h.js` leaked its catch-up pool into `draft.json` on interrupted runs; `current_teams.json` was tracked despite being server-written. | Cleanup safety net that tolerates already-deleted pools; `current_teams.json` gitignored and removed from the index. |

### Still open, by choice

- **NHL-team picks score 0 in the weekly H2H standings.** There is no
  game-by-game log of club wins, so a week cannot be scored for them — the
  source comment says as much. Season standings now count them; weekly cannot.
  Locked by a test so the asymmetry is deliberate.
- **`computeTeamSeasonScores` ranks ties sequentially** (1 and 2, not 1 and 1).
  Unchanged, locked by a test.
- Four test pools from May runs sit in `draft.json`. They are committed data,
  not artefacts of this work.

## 12. Definition of done, per test file

- [ ] Every exported function of the module has at least one test.
- [ ] Every boundary named in the §7 table has its own case.
- [ ] No test touches network, disk, database, or the real clock.
- [ ] Tests pass in any order and when run individually (`--test-name-pattern`).
- [ ] Running the file twice in a row gives the same result.
- [ ] `mock.restoreAll()` in an `afterEach` wherever `mock` is used.
- [ ] Branch coverage for the module meets its §9 target.
- [ ] Reviewed against `UNIT_TESTS_REVIEW.md`.
