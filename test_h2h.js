// ============================================================
// FANTAZY — H2H Pool Integration Tests
// Covers: initialization, week finalization, multi-week catch-up,
//         standings accuracy, season counting, 4-team pools,
//         current-week-scores endpoint, and edge cases.
// Run: node test_h2h.js  (server must be running on :3000)
// ============================================================
const BASE = 'http://localhost:3000';

let pass = 0, fail = 0;
const results = [];

function ok(label)         { pass++; results.push(`  ✓  ${label}`); }
function ko(label, detail) { fail++; results.push(`  ✗  ${label}${detail ? ` → ${detail}` : ''}`); }
function section(title)    { results.push(`\n── ${title} ──`); }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    let json;
    try { json = await r.json(); } catch { json = {}; }
    return { status: r.status, ok: r.ok, body: json };
  } catch (e) {
    return { status: 0, ok: false, body: {}, error: e.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────
async function getPool(poolName) {
  const r = await api('GET', '/draft');
  return r.body?.[poolName] ?? null;
}

async function getH2H(poolName) {
  const pool = await getPool(poolName);
  return pool?.h2hData ?? null;
}

// Set weekStart / currentWeek directly (test utility)
async function setState(poolName, opts) {
  return api('POST', '/test/h2h-set-state', { poolName, ...opts });
}

// Trigger the auto-finalize pass and return new state
async function triggerCatchup() {
  return api('POST', '/test/h2h-trigger-catchup');
}

// Finalize the current week manually
async function finalizeWeek(poolName) {
  return api('POST', '/h2h/finalize-week', { poolName });
}

// Current week scores endpoint
async function currentWeekScores(poolName) {
  return api('GET', `/h2h/current-week-scores?poolName=${encodeURIComponent(poolName)}`);
}

// ISO date N weeks in the past from now
function weeksAgo(n) {
  return new Date(Date.now() - n * 7 * 24 * 60 * 60 * 1000).toISOString();
}

// ── Test users ────────────────────────────────────────────────
const USERS = ['h2h_alpha', 'h2h_beta', 'h2h_charlie', 'h2h_delta'];
let pool2;  // 2-team pool name
let pool4;  // 4-team pool name

// ============================================================
// SECTION 1: SETUP
// ============================================================
async function setup() {
  section('SETUP — Users & Pools');

  for (const u of USERS) {
    const r = await api('POST', '/signup', { username: u, password: `${u}Pass1!` });
    if (r.ok || /pris|existe|already|taken/i.test(r.body?.message || ''))
      ok(`User ${u} ready`);
    else ko(`User ${u} signup`, JSON.stringify(r.body));
  }

  // 2-team H2H pool — 1 offensive pick per team (minimal config to complete draft quickly)
  pool2 = `H2H2_${Date.now()}`;
  const c2 = await api('POST', '/create-clan', {
    name: pool2, username: 'h2h_alpha', maxPlayers: 2,
    config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
    poolMode: 'head-to-head', allowTrades: false
  });
  c2.ok ? ok(`2-team pool "${pool2}" created`) : ko('Create 2-team pool', JSON.stringify(c2.body));

  // 4-team H2H pool
  pool4 = `H2H4_${Date.now()}`;
  const c4 = await api('POST', '/create-clan', {
    name: pool4, username: 'h2h_alpha', maxPlayers: 4,
    config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
    poolMode: 'head-to-head', allowTrades: false
  });
  c4.ok ? ok(`4-team pool "${pool4}" created`) : ko('Create 4-team pool', JSON.stringify(c4.body));
}

// ============================================================
// SECTION 2: H2H DATA STRUCTURE ON CREATION
// ============================================================
async function testInitialStructure() {
  section('H2H STRUCTURE — Initial state');

  const h2h2 = await getH2H(pool2);
  if (!h2h2) { ko('h2hData exists on 2-team pool'); return; }

  ok('h2hData object present');
  h2h2.currentWeek === 1 ? ok('currentWeek starts at 1') : ko('currentWeek not 1', String(h2h2.currentWeek));
  h2h2.weekStart === null ? ok('weekStart null before draft') : ko('weekStart not null', h2h2.weekStart);
  h2h2.seasonStart === null ? ok('seasonStart null before draft') : ko('seasonStart not null', h2h2.seasonStart);
  Array.isArray(h2h2.matchups) ? ok('matchups is array') : ko('matchups not array');
  h2h2.matchups.length === 0 ? ok('matchups empty before draft') : ko('matchups not empty', String(h2h2.matchups.length));
  typeof h2h2.standings === 'object' ? ok('standings is object') : ko('standings not object');
  Array.isArray(h2h2.matchupHistory) ? ok('matchupHistory is array') : ko('matchupHistory not array');
}

// ============================================================
// SECTION 3: COMPLETE DRAFT → H2H INITIALIZATION
// ============================================================
async function testDraftCompletion() {
  section('DRAFT COMPLETION — H2H initialized on last pick');

  // ── 2-team pool ──────────────────────────────────────────
  // User h2h_beta joins team 2 (h2h_alpha auto-placed on Équipe 1)
  const join = await api('POST', '/join-team', { name: pool2, username: 'h2h_beta', teamName: 'Équipe 2' });
  join.ok ? ok('h2h_beta joined Équipe 2') : ko('h2h_beta join', JSON.stringify(join.body));

  // Start draft
  const start = await api('POST', '/start-draft', { clanName: pool2 });
  start.ok ? ok('Draft started') : ko('Start draft', JSON.stringify(start.body));

  // Pick 1: h2h_alpha (Équipe 1)
  const p1 = await api('POST', '/pick-player', { clanName: pool2, username: 'h2h_alpha', playerName: 'Nikita Kucherov', position: 'offensive' });
  p1.ok ? ok('Pick 1 made (h2h_alpha → Kucherov)') : ko('Pick 1', JSON.stringify(p1.body));

  // Pick 2: h2h_beta (Équipe 2) — this is the last pick → draft complete → H2H init
  const p2 = await api('POST', '/pick-player', { clanName: pool2, username: 'h2h_beta', playerName: 'Nathan MacKinnon', position: 'offensive' });
  p2.ok ? ok('Pick 2 made (h2h_beta → MacKinnon) — draft complete') : ko('Pick 2', JSON.stringify(p2.body));

  // Wait briefly for async save
  await new Promise(r => setTimeout(r, 400));

  const h2h = await getH2H(pool2);
  if (!h2h) { ko('h2hData present after draft'); return; }

  // seasonStart
  h2h.seasonStart ? ok('seasonStart set after draft') : ko('seasonStart not set after draft');
  // weekStart
  h2h.weekStart ? ok('weekStart set after draft') : ko('weekStart not set after draft');
  // weekStart === seasonStart for week 1
  h2h.weekStart === h2h.seasonStart
    ? ok('weekStart equals seasonStart on week 1')
    : ko('weekStart ≠ seasonStart', `ws=${h2h.weekStart} ss=${h2h.seasonStart}`);
  // currentWeek = 1
  h2h.currentWeek === 1 ? ok('currentWeek still 1 after draft complete') : ko('currentWeek wrong', String(h2h.currentWeek));
  // matchups[0] exists and has 1 matchup (2 teams → 1 matchup)
  Array.isArray(h2h.matchups[0]) ? ok('matchups[0] is array') : ko('matchups[0] not array');
  const m1 = h2h.matchups[0];
  m1?.length === 1 ? ok('Week 1 has 1 matchup') : ko('Week 1 matchup count wrong', String(m1?.length));
  // Teams in matchup
  const m = m1?.[0];
  (m?.team1 && m?.team2) ? ok(`Week 1 matchup: ${m.team1} vs ${m.team2}`) : ko('Week 1 matchup teams missing');
  m?.weekNumber === 1 ? ok('weekNumber=1 on matchup') : ko('weekNumber wrong', String(m?.weekNumber));
  // Standings initialized
  const standingKeys = Object.keys(h2h.standings || {});
  standingKeys.length === 2 ? ok('Standings initialized for both teams') : ko('Standings wrong count', String(standingKeys.length));

  // ── 4-team pool: add members and complete draft ──────────
  await api('POST', '/join-team', { name: pool4, username: 'h2h_beta',    teamName: 'Équipe 2' });
  await api('POST', '/join-team', { name: pool4, username: 'h2h_charlie', teamName: 'Équipe 3' });
  await api('POST', '/join-team', { name: pool4, username: 'h2h_delta',   teamName: 'Équipe 4' });
  await api('POST', '/start-draft', { clanName: pool4 });

  const picks4 = [
    { username: 'h2h_alpha',   player: 'Leon Draisaitl',   team: 'Équipe 1' },
    { username: 'h2h_beta',    player: 'David Pastrnak',   team: 'Équipe 2' },
    { username: 'h2h_charlie', player: 'Connor McDavid',   team: 'Équipe 3' },
    { username: 'h2h_delta',   player: 'Mitchell Marner',  team: 'Équipe 4' },
  ];
  let allPicked = true;
  for (const { username, player } of picks4) {
    const r = await api('POST', '/pick-player', { clanName: pool4, username, playerName: player, position: 'offensive' });
    if (!r.ok) { allPicked = false; ko(`4-pool pick ${player}`, JSON.stringify(r.body)); }
  }
  if (allPicked) ok('4-team pool draft completed');

  await new Promise(r => setTimeout(r, 400));
  const h4 = await getH2H(pool4);
  h4?.matchups?.[0]?.length === 2
    ? ok('4-team pool week 1 has 2 matchups')
    : ko('4-team pool week 1 matchup count', String(h4?.matchups?.[0]?.length));
  h4?.seasonStart ? ok('4-team pool seasonStart set') : ko('4-team pool seasonStart missing');
}

// ============================================================
// SECTION 4: SINGLE WEEK FINALIZATION
// ============================================================
async function testSingleWeekFinalization() {
  section('WEEK FINALIZATION — Single week');

  const before = await getH2H(pool2);
  const weekBefore = before?.currentWeek;
  const weekStartBefore = before?.weekStart;

  const r = await api('POST', '/h2h/finalize-week', { poolName: pool2 });
  r.ok ? ok('finalize-week returned 200') : ko('finalize-week failed', JSON.stringify(r.body));

  // Verify response structure
  const rb = r.body;
  rb.previousWeek === weekBefore ? ok('previousWeek correct in response') : ko('previousWeek wrong', JSON.stringify(rb));
  rb.currentWeek === weekBefore + 1 ? ok('currentWeek incremented in response') : ko('response currentWeek wrong', JSON.stringify(rb));
  rb.results?.length === 1 ? ok('results has 1 matchup') : ko('results length wrong', String(rb.results?.length));
  typeof rb.standings === 'object' ? ok('standings in response') : ko('standings missing from response');

  const after = await getH2H(pool2);

  // currentWeek advanced
  after.currentWeek === weekBefore + 1
    ? ok(`currentWeek advanced: ${weekBefore} → ${after.currentWeek}`)
    : ko('currentWeek not advanced', `expected ${weekBefore + 1}, got ${after.currentWeek}`);

  // weekStart advanced by exactly 7 days
  const msBefore = new Date(weekStartBefore).getTime();
  const msAfter  = new Date(after.weekStart).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  Math.abs((msAfter - msBefore) - sevenDays) < 1000
    ? ok('weekStart advanced by exactly 7 days')
    : ko('weekStart gap wrong', `${(msAfter - msBefore) / 86400000} days`);

  // weekStart never equals seasonStart after finalization (season start is immutable)
  after.weekStart !== after.seasonStart
    ? ok('weekStart advanced past seasonStart (seasonStart immutable)')
    : ko('seasonStart moved (should never change)');

  // matchupHistory has 1 entry for week 1
  after.matchupHistory?.length === 1 ? ok('matchupHistory has 1 entry') : ko('matchupHistory length', String(after.matchupHistory?.length));
  const hist = after.matchupHistory?.[0];
  hist?.weekNumber === weekBefore ? ok('history entry weekNumber correct') : ko('history weekNumber wrong', JSON.stringify(hist));
  hist?.weekStart === weekStartBefore ? ok('history weekStart correct') : ko('history weekStart wrong', JSON.stringify(hist));
  hist?.matchups?.length === 1 ? ok('history matchups present') : ko('history matchups missing');
  hist?.completedDate ? ok('history completedDate set') : ko('history completedDate missing');

  // New matchups for week 2 generated
  const w2 = after.matchups?.[1];
  Array.isArray(w2) && w2.length === 1 ? ok('Week 2 matchups generated') : ko('Week 2 matchups missing', JSON.stringify(w2));
  w2?.[0]?.weekNumber === 2 ? ok('Week 2 matchup weekNumber=2') : ko('Week 2 weekNumber wrong', String(w2?.[0]?.weekNumber));

  // Standings updated (someone has a win/loss/tie)
  const standings = after.standings;
  const teams = Object.keys(standings);
  const totalWins   = teams.reduce((s, t) => s + standings[t].wins,   0);
  const totalLosses = teams.reduce((s, t) => s + standings[t].losses, 0);
  const totalTies   = teams.reduce((s, t) => s + standings[t].ties,   0);
  const totalGames  = totalWins + totalLosses + totalTies;
  totalGames === 2 ? ok('Standings total games = 2 (1 matchup × 2 teams)') : ko('Standings total games wrong', String(totalGames));
  (totalWins === totalLosses || (totalTies === 2 && totalWins === 0))
    ? ok('Standings are symmetric (wins=losses or all ties)')
    : ko('Standings asymmetric', `W:${totalWins} L:${totalLosses} T:${totalTies}`);

  // pointsFor and pointsAgainst are cross-correct
  for (const t of teams) {
    const opp = teams.find(x => x !== t);
    if (opp) {
      const pf = standings[t].pointsFor;
      const pa = standings[opp].pointsAgainst;
      Math.abs(pf - pa) < 0.01
        ? ok(`${t}: pointsFor = opponent's pointsAgainst`)
        : ko(`${t}: pointsFor ≠ opponent's pointsAgainst`, `${pf} vs ${pa}`);
    }
  }
}

// ============================================================
// SECTION 5: MULTI-WEEK SEQUENTIAL FINALIZATION
// ============================================================
async function testMultiWeekFinalization() {
  section('MULTI-WEEK — 6 sequential finalizations');

  // Finalize weeks 2 → 7 (we already finalized week 1 in section 4)
  const EXTRA_WEEKS = 6;
  let allOk = true;
  for (let i = 0; i < EXTRA_WEEKS; i++) {
    const r = await api('POST', '/h2h/finalize-week', { poolName: pool2 });
    if (!r.ok) { allOk = false; ko(`Finalize week ${i + 2}`, JSON.stringify(r.body)); }
  }
  if (allOk) ok(`${EXTRA_WEEKS} additional weeks finalized`);

  const h2h = await getH2H(pool2);
  const totalFinalized = 1 + EXTRA_WEEKS; // week 1 from section 4 + 6 more

  // currentWeek
  h2h.currentWeek === totalFinalized + 1
    ? ok(`currentWeek = ${h2h.currentWeek} after ${totalFinalized} finalizations`)
    : ko('currentWeek wrong after multi-week', `expected ${totalFinalized + 1}, got ${h2h.currentWeek}`);

  // matchupHistory length
  h2h.matchupHistory?.length === totalFinalized
    ? ok(`matchupHistory has ${totalFinalized} entries`)
    : ko('matchupHistory length wrong', String(h2h.matchupHistory?.length));

  // History entries sequential: weekNumber 1, 2, 3, ...
  let sequential = true;
  for (let i = 0; i < totalFinalized; i++) {
    if (h2h.matchupHistory[i]?.weekNumber !== i + 1) { sequential = false; break; }
  }
  sequential ? ok('History weekNumbers are sequential (1, 2, 3, ...)') : ko('History weekNumbers not sequential');

  // Each history weekStart is exactly 7 days after the previous
  if (!h2h.matchupHistory || h2h.matchupHistory.length < totalFinalized) {
    ko('matchupHistory too short to check date gaps', `len=${h2h.matchupHistory?.length}`);
  } else {
    let datesOk = true;
    for (let i = 1; i < totalFinalized; i++) {
      const prev = new Date(h2h.matchupHistory[i - 1].weekStart).getTime();
      const curr = new Date(h2h.matchupHistory[i].weekStart).getTime();
      if (Math.abs(curr - prev - 7 * 24 * 60 * 60 * 1000) > 1000) { datesOk = false; break; }
    }
    datesOk ? ok('History weekStart dates are each exactly 7 days apart') : ko('History weekStart dates not 7 days apart');
  }

  // seasonStart never changed
  h2h.seasonStart === h2h.matchupHistory[0]?.weekStart
    ? ok('seasonStart matches first history entry weekStart')
    : ko('seasonStart drifted', `ss=${h2h.seasonStart} hist[0]=${h2h.matchupHistory[0]?.weekStart}`);

  // weekStart is exactly seasonStart + totalFinalized * 7 days
  const expectedWeekStart = new Date(h2h.seasonStart).getTime() + totalFinalized * 7 * 24 * 60 * 60 * 1000;
  const actualWeekStart   = new Date(h2h.weekStart).getTime();
  Math.abs(actualWeekStart - expectedWeekStart) < 1000
    ? ok('weekStart = seasonStart + N weeks (correct offset)')
    : ko('weekStart offset from seasonStart wrong', `expected ${new Date(expectedWeekStart).toISOString()}, got ${h2h.weekStart}`);

  // Standings: total games per team = totalFinalized
  const standings = h2h.standings;
  const teams = Object.keys(standings);
  for (const t of teams) {
    const s = standings[t];
    const total = s.wins + s.losses + s.ties;
    total === totalFinalized
      ? ok(`${t}: W+L+T = ${totalFinalized}`)
      : ko(`${t}: W+L+T wrong`, `${s.wins}+${s.losses}+${s.ties} = ${total}, expected ${totalFinalized}`);
  }

  // Matchups array has entries for each week + current week
  h2h.matchups.length >= totalFinalized + 1
    ? ok(`matchups array has ${h2h.matchups.length} entries (≥ ${totalFinalized + 1})`)
    : ko('matchups array too short', String(h2h.matchups.length));
}

// ============================================================
// SECTION 6: CATCH-UP (the key fix — while loop)
// ============================================================
async function testCatchUp() {
  section('CATCH-UP — Auto-finalize recovers N missed weeks in one pass');

  // Create a fresh pool for this test
  const poolName = `H2H_CATCHUP_${Date.now()}`;
  const cr = await api('POST', '/create-clan', {
    name: poolName, username: 'h2h_alpha', maxPlayers: 2,
    config: { numOffensive: 1, numDefensive: 0, numGoalies: 0, numRookies: 0, numTeams: 0 },
    poolMode: 'head-to-head', allowTrades: false
  });
  cr.ok ? ok('Catch-up test pool created') : ko('Create catch-up pool', JSON.stringify(cr.body));

  await api('POST', '/join-team', { name: poolName, username: 'h2h_beta', teamName: 'Équipe 2' });
  await api('POST', '/start-draft', { clanName: poolName });
  await api('POST', '/pick-player', { clanName: poolName, username: 'h2h_alpha', playerName: 'Nikita Kucherov', position: 'offensive' });
  await api('POST', '/pick-player', { clanName: poolName, username: 'h2h_beta',  playerName: 'Nathan MacKinnon', position: 'offensive' });
  await new Promise(r => setTimeout(r, 400));

  // Verify draft initialized
  const afterDraft = await getH2H(poolName);
  if (!afterDraft?.seasonStart) { ko('Draft did not initialize H2H for catch-up pool'); return; }
  ok('Draft initialized H2H for catch-up pool');

  // Wind back weekStart by 10 weeks (simulate server offline for 10 weeks)
  const MISSED_WEEKS = 10;
  const pastDate = weeksAgo(MISSED_WEEKS);
  const setState = await api('POST', '/test/h2h-set-state', {
    poolName, weekStart: pastDate, seasonStart: pastDate, currentWeek: 1
  });
  setState.ok ? ok(`Wound back weekStart by ${MISSED_WEEKS} weeks`) : ko('setState failed', JSON.stringify(setState.body));

  // Trigger the auto-finalize (used to advance only 1 week; now advances all)
  const catchup = await triggerCatchup();
  catchup.ok ? ok('Catch-up triggered') : ko('Catch-up trigger failed', JSON.stringify(catchup.body));

  await new Promise(r => setTimeout(r, 300));

  const h2h = await getH2H(poolName);

  // Should have caught up to at least week MISSED_WEEKS (= week 11)
  h2h.currentWeek >= MISSED_WEEKS + 1
    ? ok(`currentWeek = ${h2h.currentWeek} ≥ ${MISSED_WEEKS + 1} (all weeks caught up)`)
    : ko('Catch-up incomplete', `currentWeek=${h2h.currentWeek}, expected ≥ ${MISSED_WEEKS + 1}`);

  // History should have MISSED_WEEKS entries
  h2h.matchupHistory?.length >= MISSED_WEEKS
    ? ok(`matchupHistory has ${h2h.matchupHistory.length} entries (≥ ${MISSED_WEEKS})`)
    : ko('Catch-up history incomplete', `${h2h.matchupHistory?.length} < ${MISSED_WEEKS}`);

  // All history entries have sequential weekNumbers
  let sequential = true;
  for (let i = 0; i < (h2h.matchupHistory?.length ?? 0); i++) {
    if (h2h.matchupHistory[i]?.weekNumber !== i + 1) { sequential = false; break; }
  }
  sequential ? ok('Caught-up history weekNumbers are sequential') : ko('Caught-up history weekNumbers not sequential');

  // Standings total games = number of finalized weeks
  const finalized = h2h.matchupHistory?.length ?? 0;
  const teams = Object.keys(h2h.standings || {});
  for (const t of teams) {
    const s = h2h.standings[t];
    const total = s.wins + s.losses + s.ties;
    total === finalized
      ? ok(`${t}: W+L+T = ${finalized} after catch-up`)
      : ko(`${t}: standings mismatch after catch-up`, `${total} ≠ ${finalized}`);
  }

  // weekStart is now at the current/most recent week (not still in the past)
  const weekStartMs = new Date(h2h.weekStart).getTime();
  const nowMs = Date.now();
  weekStartMs > nowMs - 14 * 24 * 60 * 60 * 1000  // within last 2 weeks
    ? ok('weekStart is now near current date after catch-up')
    : ko('weekStart still in the distant past after catch-up', h2h.weekStart);

  // Cleanup
  await api('POST', '/delete-clan', { clanName: poolName });
  ok('Catch-up test pool cleaned up');
}

// ============================================================
// SECTION 7: CURRENT-WEEK-SCORES ENDPOINT
// ============================================================
async function testCurrentWeekScores() {
  section('CURRENT-WEEK-SCORES ENDPOINT');

  const r = await currentWeekScores(pool2);
  r.ok ? ok('GET /h2h/current-week-scores returns 200') : ko('current-week-scores failed', JSON.stringify(r.body));

  const d = r.body;
  typeof d.currentWeek === 'number' ? ok('currentWeek present') : ko('currentWeek missing');
  d.weekStart ? ok('weekStart present') : ko('weekStart missing');
  d.weekEnd   ? ok('weekEnd present')   : ko('weekEnd missing');

  // weekEnd = weekStart + 7 days
  if (d.weekStart && d.weekEnd) {
    const diff = new Date(d.weekEnd).getTime() - new Date(d.weekStart).getTime();
    Math.abs(diff - 7 * 24 * 60 * 60 * 1000) < 1000
      ? ok('weekEnd is exactly weekStart + 7 days')
      : ko('weekEnd - weekStart ≠ 7 days', `${diff / 86400000} days`);
  }

  ['upcoming', 'ongoing', 'completed'].includes(d.weekStatus)
    ? ok(`weekStatus is valid: "${d.weekStatus}"`)
    : ko('weekStatus invalid', d.weekStatus);

  Array.isArray(d.matchups) ? ok('matchups array present') : ko('matchups missing');
  typeof d.standings === 'object' ? ok('standings present') : ko('standings missing');
  Array.isArray(d.matchupHistory) ? ok('matchupHistory present') : ko('matchupHistory missing');

  // Each matchup has required fields
  if (d.matchups?.length > 0) {
    const m = d.matchups[0];
    (m.team1 && m.team2) ? ok('Matchup has team1 and team2') : ko('Matchup teams missing');
    typeof m.team1Points === 'number' ? ok('Matchup has team1Points') : ko('team1Points missing');
    typeof m.team2Points === 'number' ? ok('Matchup has team2Points') : ko('team2Points missing');
  }

  // Non-existent pool → 400
  const bad = await currentWeekScores('DOES_NOT_EXIST_XYZ');
  bad.status >= 400 ? ok('Non-existent pool returns 4xx') : ko('Non-existent pool should fail', String(bad.status));

  // Non-H2H pool → 400 (use one of the cumulative pools from other test files if available)
  // We can't guarantee a cumulative pool exists here, so skip this case.
}

// ============================================================
// SECTION 8: 4-TEAM POOL MECHANICS
// ============================================================
async function testFourTeamPool() {
  section('4-TEAM POOL — Matchup structure and standings');

  const h4 = await getH2H(pool4);
  if (!h4) { ko('h2hData exists for 4-team pool'); return; }

  // Week 1 must have exactly 2 matchups (4 teams → 2 pairs)
  const w1 = h4.matchups?.[0];
  w1?.length === 2 ? ok('Week 1 has 2 matchups for 4 teams') : ko('Week 1 matchup count', String(w1?.length));

  // All 4 teams appear exactly once in week 1
  if (w1?.length === 2) {
    const teamsInW1 = new Set([w1[0].team1, w1[0].team2, w1[1].team1, w1[1].team2]);
    teamsInW1.size === 4 ? ok('All 4 teams appear in week 1') : ko('Team coverage in week 1', String(teamsInW1.size));
    // No team plays twice
    const teamList = [w1[0].team1, w1[0].team2, w1[1].team1, w1[1].team2];
    const unique = new Set(teamList);
    unique.size === 4 ? ok('No team plays twice in week 1') : ko('Duplicate team in week 1');
  }

  // Finalize week 1 for 4-team pool
  const fin = await api('POST', '/h2h/finalize-week', { poolName: pool4 });
  fin.ok ? ok('4-team pool week 1 finalized') : ko('4-team finalize', JSON.stringify(fin.body));

  const h4after = await getH2H(pool4);

  // All 4 teams have standings entries
  const sKeys = Object.keys(h4after?.standings || {});
  sKeys.length === 4 ? ok('Standings initialized for all 4 teams') : ko('Standings count wrong', String(sKeys.length));

  // Total games played across all teams = 4 (each team played 1 game × 2 sides)
  const totalGames = sKeys.reduce((s, t) => {
    const st = h4after.standings[t];
    return s + st.wins + st.losses + st.ties;
  }, 0);
  totalGames === 4 ? ok('Total games across 4 teams = 4') : ko('Total games wrong', String(totalGames));

  // Week 2 matchups generated for all 4 teams
  const w2 = h4after.matchups?.[1];
  w2?.length === 2 ? ok('Week 2 has 2 matchups') : ko('Week 2 matchup count', String(w2?.length));

  // Finalize 5 more weeks, verify standing totals
  for (let i = 0; i < 5; i++) await api('POST', '/h2h/finalize-week', { poolName: pool4 });
  const h4final = await getH2H(pool4);
  const totalWeeks = 6; // 1 + 5
  for (const t of Object.keys(h4final?.standings || {})) {
    const s = h4final.standings[t];
    const total = s.wins + s.losses + s.ties;
    total === totalWeeks
      ? ok(`4-team ${t}: W+L+T = ${totalWeeks}`)
      : ko(`4-team ${t}: W+L+T wrong`, `${total} ≠ ${totalWeeks}`);
  }
}

// ============================================================
// SECTION 9: WEEK NUMBER INTEGRITY
// ============================================================
async function testWeekNumberIntegrity() {
  section('WEEK COUNTING — Integrity over multiple seasons');

  const h2h = await getH2H(pool2);

  // currentWeek is at least the calendar-computed value from seasonStart
  // (In tests we manually finalize weeks faster than wall-clock time, so currentWeek
  //  can legitimately exceed the computed value — it must never be LESS.)
  if (h2h.seasonStart) {
    const diffMs  = Date.now() - new Date(h2h.seasonStart).getTime();
    const computed = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
    h2h.currentWeek >= computed
      ? ok(`currentWeek=${h2h.currentWeek} ≥ computed week=${computed} from seasonStart`)
      : ko('currentWeek is behind computed week (time went backwards?)', `stored=${h2h.currentWeek} computed=${computed}`);
  }

  // weekStart is exactly (currentWeek - 1) * 7 days after seasonStart
  if (h2h.seasonStart && h2h.weekStart) {
    const expectedOffset = (h2h.currentWeek - 1) * 7 * 24 * 60 * 60 * 1000;
    const actualOffset   = new Date(h2h.weekStart).getTime() - new Date(h2h.seasonStart).getTime();
    Math.abs(actualOffset - expectedOffset) < 1000
      ? ok('weekStart offset from seasonStart is exactly (currentWeek-1) * 7 days')
      : ko('weekStart offset wrong', `expected ${expectedOffset / 86400000}d, got ${actualOffset / 86400000}d`);
  }

  // Each history entry weekStart = seasonStart + (weekNumber - 1) * 7 days
  let offsets = true;
  for (const entry of (h2h.matchupHistory || [])) {
    const expected = new Date(h2h.seasonStart).getTime() + (entry.weekNumber - 1) * 7 * 24 * 60 * 60 * 1000;
    const actual   = new Date(entry.weekStart).getTime();
    if (Math.abs(actual - expected) > 1000) { offsets = false; break; }
  }
  offsets
    ? ok('All history weekStart dates align with seasonStart + N*7 days')
    : ko('History weekStart dates misaligned with seasonStart');
}

// ============================================================
// SECTION 10: EDGE CASES
// ============================================================
async function testEdgeCases() {
  section('EDGE CASES');

  // Non-existent pool → 404
  const r1 = await api('POST', '/h2h/finalize-week', { poolName: 'NO_SUCH_POOL_XYZ' });
  r1.status === 404 ? ok('finalize-week: unknown pool → 404') : ko('unknown pool should 404', String(r1.status));

  // Missing poolName → 400
  const r2 = await api('POST', '/h2h/finalize-week', {});
  r2.status === 400 ? ok('finalize-week: missing poolName → 400') : ko('missing poolName should 400', String(r2.status));

  // current-week-scores without poolName param → 400
  const r3 = await api('GET', '/h2h/current-week-scores');
  r3.status === 400 ? ok('current-week-scores: no poolName → 400') : ko('no poolName should 400', String(r3.status));

  // seasonStart never changes across multiple finalizations
  const ss = await getH2H(pool2);
  const originalSeasonStart = ss?.seasonStart;
  await api('POST', '/h2h/finalize-week', { poolName: pool2 });
  const ss2 = await getH2H(pool2);
  ss2?.seasonStart === originalSeasonStart
    ? ok('seasonStart unchanged after another finalization')
    : ko('seasonStart changed after finalization', ss2?.seasonStart);

  // currentWeek response from finalize-week is always 1 more than previousWeek
  const r4 = await api('POST', '/h2h/finalize-week', { poolName: pool2 });
  if (r4.ok) {
    r4.body.currentWeek === r4.body.previousWeek + 1
      ? ok('finalize-week response: currentWeek = previousWeek + 1')
      : ko('finalize-week response week increment', JSON.stringify(r4.body));
  }

  // Triggering catch-up when already current does nothing
  const beforeCatchup = await getH2H(pool2);
  const weekBefore = beforeCatchup?.currentWeek;
  const histBefore = beforeCatchup?.matchupHistory?.length;
  await triggerCatchup();
  await new Promise(r => setTimeout(r, 200));
  const afterCatchup = await getH2H(pool2);
  afterCatchup?.currentWeek === weekBefore
    ? ok('Catch-up with no missed weeks: currentWeek unchanged')
    : ko('Catch-up advanced when it should not', `${weekBefore} → ${afterCatchup?.currentWeek}`);
  afterCatchup?.matchupHistory?.length === histBefore
    ? ok('Catch-up with no missed weeks: history unchanged')
    : ko('Catch-up added history when it should not');
}

// ============================================================
// CLEANUP
// ============================================================
async function cleanup() {
  section('CLEANUP');
  for (const p of [pool2, pool4]) {
    const r = await api('POST', '/delete-clan', { clanName: p });
    r.ok ? ok(`Pool "${p}" deleted`) : ko(`Delete "${p}"`, JSON.stringify(r.body));
  }
}

// ============================================================
// MAIN
// ============================================================
async function run() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     FANTAZY — H2H Pool Integration Tests           ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  await setup();
  await testInitialStructure();
  await testDraftCompletion();
  await testSingleWeekFinalization();
  await testMultiWeekFinalization();
  await testCatchUp();
  await testCurrentWeekScores();
  await testFourTeamPool();
  await testWeekNumberIntegrity();
  await testEdgeCases();
  await cleanup();

  console.log('');
  results.forEach(l => console.log(l));
  console.log('');
  console.log('─'.repeat(51));
  console.log(`  ✓ PASSED: ${pass}   ✗ FAILED: ${fail}   TOTAL: ${pass + fail}`);
  console.log('─'.repeat(51));

  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
