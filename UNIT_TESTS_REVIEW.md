# Unit Tests — Review Guide

How to review a batch of unit tests before it lands. Companion to
`UNIT_TESTS.md` (which says what to build and how to run it).

A test suite is code that nobody debugs and everybody trusts. A bad one is
worse than none: it burns minutes on every run, fails for the wrong reasons,
and prints a percentage that makes the codebase look protected when it is not.
This document is the checklist that stops that.

---

## 1. Run it before you read it

Do these five in order. Anything that fails here ends the review — send it back
without reading the diff line by line.

```bash
npm run test:unit                   # 1. does it pass, clean, no console noise?
npm run test:cov                    # 2. what is the real percentage?
npm run test:unit                   # 3. same result twice in a row?
node --test "test/unit/h2h.test.js" # 4. does one file pass alone?
npm run test:integration            # 5. after a lib/ extraction only — server must be running
```

| Check | Pass condition |
|---|---|
| 1. Suite is green | 0 failures, 0 `todo`, no stray `console.log` in the output |
| 2. Coverage | meets the target in `UNIT_TESTS.md` §9 for the modules touched — and the file table is **not empty** (see §2) |
| 3. Repeatable | identical pass/fail counts; no ordering or shared-state dependency |
| 4. Isolated | each new file passes on its own — proves it does not lean on another file's setup |
| 5. Integration | unchanged results vs. before the extraction; this is the only proof a `lib/` move did not change behaviour |

Add a sixth for any run that took more than ~5 seconds: something in
`test/unit/` is doing I/O. Find it.

---

## 2. Read the coverage report correctly

```
ℹ file        | line % | branch % | funcs % | uncovered lines
ℹ  h2h.js     |  94.20 |    78.30 |  100.00 | 251-254, 302
```

- **Line %** — the least interesting number. Easy to inflate, easy to hit 100
  with zero assertions.
- **Branch %** — the number to actually read. This codebase runs on `||`
  defaults, `?.` chains and `a || b || c` name fallbacks. A 95/60 split means
  every line ran, but the fallback halves never did — which is precisely where
  the bugs live.
- **Funcs %** — below 100 on a `lib/` module means an exported function has no
  test at all. Name it in the review.
- **Uncovered lines** — open each one. The question is not "why is this
  uncovered" but "**is this the error path that matters most**". Uncovered
  `catch` blocks and early-return guards are the usual finding.

### Three ways the percentage lies

1. **Zero tests, 100%.** If a glob matched nothing, the report prints
   `all files | 100.00 | 100.00 | 100.00` over an empty file table. Confirm the
   run says `ℹ pass <n>` with a plausible `n`, and that files are listed. On
   Windows this happens for real — single quotes in an npm script (see
   `UNIT_TESTS.md` §2).
2. **Assertion-free coverage.** A test that calls the function and asserts
   nothing covers every line. Grep the batch: every `test(` block needs at
   least one `assert`.
3. **Wrong denominator.** Coverage that includes `server.js` or the `.js` page
   scripts drags the average toward zero and invites someone to "fix" it with
   junk tests; coverage that excludes half of `lib/` inflates it. Verify the
   `--test-coverage-include` flags still say `lib/**` and `tools/**`.

---

## 3. Hard gates — must be fixed before merge

Each is a one-line reason to reject.

- [ ] **A test with no assertion.** Covers lines, proves nothing.
- [ ] **A test that cannot fail.** `assert.ok(result)` on a function returning
      an object. `assert.equal(x, x)`. Assertions on a value the test itself
      computed with the same expression as the code under test.
- [ ] **Expected values computed, not written.** `assert.equal(score, goals*3 + assists*2)`
      re-implements the formula and will agree with the code even when both are
      wrong. Write **`assert.equal(score, 14)`** and let the reader check the
      arithmetic once.
- [ ] **Network, disk, DB or real clock inside `test/unit/`.** Any `fetch`,
      `require('./db')`, or `Date.now()` without `mock.timers` or an injected
      date. **Carve-out for `fs`:** reading a *static local fixture* at module
      load is fine — `guide-page.txt` in `draftkit-build.test.js`, and the
      source slicing in `test/fixtures/helpers.js`. Both are deterministic,
      committed, and offline. What the rule forbids is I/O *in the path under
      test*: a function that reads a file, hits a socket, or opens a pool. If
      you cannot tell which kind you are looking at, ask whether the test would
      behave differently on a machine with no network and a cold database — if
      not, it is a fixture.
- [ ] **`Math.random` unstubbed** in a `generateWeeklyMatchups` or draft-order
      test. It will pass 9 runs out of 10 and fail on the deploy.
- [ ] **Shared mutable fixture.** A module-level `const pool = {...}` that tests
      mutate. Passes in file order, fails when run alone, and the failure lands
      on whichever test happens to run second. Fixtures must be factory calls.
- [ ] **`mock` used with no `mock.restoreAll()`** in an `afterEach` — leaks into
      every later file in the same process.
- [ ] **A whole-object `deepEqual` against a 20-field snapshot.** It fails on
      every unrelated field addition and tells you nothing about which
      behaviour broke. Assert the fields the test is about.
- [ ] **A test named after the function instead of the behaviour.** `test('getCurrentWeekNumber')`
      × 6 in one file means the failure output identifies nothing.
- [ ] **Tests for code that §8 of the build guide puts out of scope** — route
      handlers, `db.js`, DOM helpers, minified files. Delete them; they are
      maintenance cost bought with no safety.
- [ ] **A skipped or `todo` test with no linked reason.**
- [ ] **A behaviour change smuggled into a "test-only" PR.** During the `lib/`
      extraction the function bodies must be byte-identical apart from the
      documented signature changes. Diff them.

---

## 4. Soft findings — raise, do not block

- Duplicate cases that assert the same branch twice with different data.
- A test file over ~300 lines, or one `describe` with more than ~15 cases —
  usually two modules' worth of concern in one file.
- Setup repeated in six tests that belongs in a factory default.
- Comments explaining *what* the assertion does rather than *why* the expected
  value is that value. The "why" is the useful comment: `// 5 (win) + 3 (SO) + 30×0.2`.
- Mixed languages in test names within one file.
- Overly clever table-driven loops where the failure message no longer says
  which row failed. If a loop is used, put the case label in the test name:
  `test(\`isRookie: ${label}\`, ...)`.

---

## 5. Does it test the right things?

Coverage says lines ran. This section says whether the tests are about anything.
For each module in the batch, check the specific claim below is actually
asserted somewhere. These are the behaviours where a silent break costs real
money to a pool.

### `lib/scoring.js`
- [ ] The goalie season formula `SO×5 + W×2 + OTL×1` is asserted with a literal
      expected total, not recomputed.
- [ ] The asymmetry is locked: `getTeamWeeklyPoints` scores goalies on `points`
      and **ignores NHL `teams` picks entirely**, while `computeTeamSeasonScores`
      uses the W/SO formula. Both behaviours have a test naming them explicitly.
      If neither is locked, the next refactor silently picks one.
- [ ] A rostered player missing from `statsPlayers` gives 0, not `NaN` — a
      `NaN` anywhere in a total poisons the whole standings sort.
- [ ] The `FANTASY_SCORING` weights are asserted one at a time, so a changed
      constant fails one obvious test rather than twenty.

### `lib/h2h.js`
- [ ] Ties: `winner === 'tie'` **and** both teams get `ties++`, not a win each.
- [ ] `pointsFor` / `pointsAgainst` are mirrored — team1's PF equals team2's PA.
- [ ] The double-finalization behaviour is documented by a test (calling
      `calculateWeeklyResults` twice for the same week). Whichever way it
      behaves, the test states it. This is the single most expensive bug class
      in an H2H pool.
- [ ] `mondayOfWeek` has the Sunday case. Sunday is the only day the arithmetic
      is not `1 - day`, and the only day a naive implementation gets wrong.
- [ ] Matchup generation asserts invariants (each team once, no self-match), not
      a specific pairing produced by a stubbed random.

### `lib/draft.js`
- [ ] The 2-team branch and the 3+-team branch are both covered — they are
      genuinely different code paths, and the 2-team one is the common case in
      this app.
- [ ] `checkIfDraftComplete` is tested with a missing `config`, since the
      `6/4/1/1/1` fallback is what runs for older pools.
- [ ] Input arrays are asserted un-mutated. `generateSnakeOrder` calling
      `.reverse()` on the caller's array would scramble a live draft order.

### `lib/trades.js`
- [ ] The `'team' → teams` mapping is tested. Every other type is identity;
      this is the one that breaks.
- [ ] `addToTeam` preserves `playerData` (the full object with stats) rather
      than degrading a player to a bare name string.
- [ ] `invalidateConflictingTrades` is tested across two pools, proving the
      `draftName` guard works. Without it, one pool's trade cancels another's.

### `lib/roster.js`
- [ ] A team change produces **one** `trade` move — not a `departure` plus a
      `signing`. The source comment calls this out; the test must too.
- [ ] The `id` format is asserted literally, because it is the dedupe key. If
      it changes shape, the transactions feed doubles up.

### `tools/build_draftkit.js`
- [ ] Both rookie boundaries are asserted on the exact numbers (27/28, 23/24),
      not "a young player" and "an old player".
- [ ] `linkGuides`'s near-miss rule is tested in both directions: accepted
      within a team, rejected across teams. A test that only covers the
      accepting half is worse than none — it green-lights the dangerous case.
- [ ] Parser tests run off a real fixture slice, not a hand-idealised string
      that never occurs in the actual kit.

### `profanity.js`
- [ ] There is a false-positive test: a legitimate name that contains a listed
      substring passes. A filter is judged on what it lets through, and users
      hit this before they hit the true positives.

---

## 6. The mutation spot-check

The fastest way to find out whether a suite is real: **break the code on
purpose and confirm the suite goes red.** Do three of these per review, revert
each immediately. If the suite stays green, the tests for that module are
decorative.

The table below was **run against the current suite** — the last column is the
measured result, not a prediction. 11 of 11 caught.

| File | Mutation | Result |
|---|---|---|
| `lib/scoring.js` | goalie `wins` weight `2` → `3` | ✔ 3 tests fail |
| `lib/scoring.js` | shots stop counting (`× FANTASY_SCORING.shot` → `× 0`) | ✔ 3 tests fail |
| `lib/h2h.js` | `>` → `>=` in the winner comparison | ✔ 1 test fails (the tie) |
| `lib/h2h.js` | `day === 0 ? -6 : 1 - day` → `1 - day` | ✔ 2 tests fail (Sunday) |
| `lib/draft.js` | drop the spread in `[...teams].reverse()` | ✔ 1 test fails |
| `lib/draft.js` | `===` → `>=` in the quota check | ✔ 1 test fails (over-quota) |
| `lib/trades.js` | `'team': 'teams'` → `'team': 'team'` | ✔ 2 tests fail |
| `lib/roster.js` | remove the `allowDepartures` guard | ✔ 2 tests fail |
| `lib/statsCache.js` | staleness threshold `24h` → `48h` | ✔ 2 tests fail |
| `tools/build_draftkit.js` | `ROOKIE_MAX_GAMES` `27` → `30` | ✔ 1 test fails |
| `tools/build_draftkit.js` | `ROOKIE_MAX_AGE` `23` → `26` | ✔ 1 test fails |

Re-run these after any substantial change to the suite. The script that does it
lives nowhere permanent on purpose — it is nine lines: for each row, apply the
edit, run `npm run test:unit`, restore the file, record whether it went red.

A mutation nothing catches is a gap in the inventory, not just in the tests —
add the missing case to `UNIT_TESTS.md` §7 in the same PR.

---

## 7. Reviewing the extraction itself

`lib/` extraction PRs need one extra pass, because a cut-and-paste that quietly
edits a line is invisible next to hundreds of lines of new tests.

- [ ] Function bodies moved to `lib/` are **identical** to what was in
      `server.js`, apart from the two signature changes documented in
      `UNIT_TESTS.md` §5.1. Diff them side by side; do not skim.
- [ ] `server.js` requires them back and no longer declares its own copy — grep
      for the function name in `server.js` and confirm exactly one reference.
- [ ] Nothing with `db.query`, `fetch`, or `fs` moved into `lib/`.
- [ ] Module-level state (`warnings`, caches) did not become shared across
      callers in a way it was not before.
- [ ] `npm run test:integration` was run against a live server, and the pass /
      fail / skip counts match the pre-extraction run. Paste both counts in the
      PR description — this is the evidence, and it does not exist anywhere else.
- [ ] **The server was restarted after the edit.** Under `npm run dev`, nodemon
      does this for you; a plain `node server.js` does not, and an integration
      run against a stale process proves nothing about the change. Check the
      process start time against the file mtime before trusting the result.
- [ ] **An integration failure was traced, not assumed.** A red integration run
      during an extraction PR looks damning and usually is not. Before blaming
      the diff, check whether the failing route appears in it at all
      (`git diff HEAD -- server.js | grep <route>`) and whether the same guard
      exists in `git show HEAD:server.js`. The scripts rot against features
      shipped after them — that is what happened here (see `UNIT_TESTS.md` §10,
      phase 7), and 56 of 58 failures were one missing precondition repeated
      down a cascade.

---

## 8. Verdict

Close every review with these four lines, filled in:

```
Suite:      <n> tests, <n> pass, <n> fail, <duration>
Coverage:   lines <x>% | branches <x>% | funcs <x>%   (target: <y>/<y>/<y>)
Mutations:  <n> tried, <n> caught
Verdict:    merge | merge after fixes | rework
```

- **merge** — hard gates all clear, coverage at target, every mutation caught.
- **merge after fixes** — only §4 soft findings, or one hard gate with an
  obvious one-line fix.
- **rework** — any unfixed hard gate, coverage below target, or a mutation that
  slipped through.

Record the coverage numbers in the PR even when they are fine. The trend over
time is the point: `UNIT_TESTS.md` §9 says the gate should only ever go up, and
this line is where the evidence for raising it comes from.
