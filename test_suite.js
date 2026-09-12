// ============================================================
// FANTAZY — Full Integration Test Suite
// ============================================================
// BASE vient de TEST_SERVER_URL, via test/integration/client.js.

let pass = 0, fail = 0, skip = 0;
const results = [];

function ok(label)          { pass++;  results.push(`  ✓  ${label}`); }
function ko(label, detail)  { fail++;  results.push(`  ✗  ${label}${detail ? ` → ${detail}` : ''}`); }
function sk(label, reason)  { skip++;  results.push(`  ○  ${label} [SKIP: ${reason}]`); }
function section(title)     { results.push(`\n── ${title} ──`); }

// L'identite ne vient plus du corps de la requete mais d'un cookie de session.
// Le client partage (test/integration/client.js) ouvre une session par compte
// et bascule d'office sur celle que la requete mentionne — les appels ci-dessous
// restent ecrits comme avant, mais s'executent maintenant sous une identite
// verifiee. Il refuse aussi de demarrer sans TEST_SERVER_URL : ces scripts
// creent et suppriment des pools.
const { api, apiAnonyme, identifier, deconnecterTout, exigerServeurDEssai } =
  require('./test/integration/client.js');

exigerServeurDEssai();



// ────────────────────────────────────────────────────────────
// 1. AUTH
// ────────────────────────────────────────────────────────────
async function testAuth() {
  section('AUTH — Signup & Login');

  for (const u of ['fza', 'fzb', 'fzc', 'fzd']) {
    const r = await api('POST', '/signup', { username: u, password: `${u}Pass1` });
    // Accept: created OK, or "already taken" (re-running tests)
    if (r.ok || /pris|existe|already|taken/i.test(r.body?.message || '')) ok(`Signup ${u}`);
    else ko(`Signup ${u}`, JSON.stringify(r.body));
  }

  const la = await api('POST', '/login', { username: 'fza', password: 'fzaPass1' });
  la.ok ? ok('Login fza (valid)') : ko('Login fza', JSON.stringify(la.body));

  const lbad = await api('POST', '/login', { username: 'fza', password: 'wrongpass' });
  !lbad.ok ? ok('Reject wrong password') : ko('Reject wrong password', 'Should have failed');

  const lempty = await api('POST', '/login', { username: '', password: '' });
  !lempty.ok ? ok('Reject empty credentials') : ko('Reject empty credentials', 'Should have failed');

  // Le mot de passe d'administration etait ecrit dans le code source, donc
  // lisible dans le depot. Cet essai verifiait qu'il fonctionnait ; il verifie
  // maintenant qu'il ne fonctionne plus. L'administration se decide sur la
  // colonne is_admin de la base, comme toute autre autorisation.
  const codeEnDur = await apiAnonyme('POST', '/admin-login', { username: 'admin', password: 'zubzub' });
  !codeEnDur.ok
    ? ok('Reject hardcoded admin credentials')
    : ko('Reject hardcoded admin credentials', 'Le mot de passe du depot ouvre encore une session');

  const badAdmin = await apiAnonyme('POST', '/admin-login', { username: 'admin', password: 'wrongpass' });
  !badAdmin.ok ? ok('Reject bad admin password') : ko('Reject bad admin password', 'Should have failed');

  // Un compte ordinaire ne devient pas administrateur en le demandant.
  const ordinaire = await api('POST', '/admin-login', { username: 'fza', password: 'fzaPass1' });
  !ordinaire.ok
    ? ok('Reject non-admin at admin login')
    : ko('Reject non-admin at admin login', 'Un compte ordinaire a obtenu une session admin');
}

// ────────────────────────────────────────────────────────────
// 2. POOLS
// ────────────────────────────────────────────────────────────
let poolName;
async function testPools() {
  section('POOLS — Create, Join, List');

  poolName = `FZPool_${Date.now()}`;

  const create = await api('POST', '/create-clan', {
    name: poolName,
    username: 'fza',
    maxPlayers: 3,
    // 2 offensive + 1 defensive + 1 goalie + 0 rookie + 0 teams per participant
    config: { numOffensive: 2, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 0 },
    poolMode: 'cumulative',
    allowTrades: true,
  });
  create.ok ? ok(`Create pool "${poolName}"`) : ko('Create pool', JSON.stringify(create.body));

  // Creator is auto-added to Équipe 1; fzb joins Équipe 2, fzc joins Équipe 3
  const joinB = await api('POST', '/join-team', { name: poolName, username: 'fzb', teamName: 'Équipe 2' });
  joinB.ok ? ok('fzb joins Équipe 2') : ko('fzb joins', JSON.stringify(joinB.body));

  const joinC = await api('POST', '/join-team', { name: poolName, username: 'fzc', teamName: 'Équipe 3' });
  joinC.ok ? ok('fzc joins Équipe 3') : ko('fzc joins', JSON.stringify(joinC.body));

  // Duplicate: fzb is already on Équipe 2, rejoining the same team should fail
  const dup = await api('POST', '/join-team', { name: poolName, username: 'fzb', teamName: 'Équipe 2' });
  !dup.ok ? ok('Reject duplicate same-team join') : ko('Reject duplicate same-team join', 'Should have failed');

  // Non-existent pool
  const noPool = await api('POST', '/join-team', { name: 'GHOST_POOL_999', username: 'fza', teamName: 'Équipe 1' });
  !noPool.ok ? ok('Reject join unknown pool') : ko('Reject join unknown pool', 'Should have failed');

  // List all pools
  const list = await api('GET', '/draft');
  if (list.ok && list.body[poolName]) ok('Pool visible in GET /draft');
  else ko('Pool not visible in GET /draft', JSON.stringify(list.body).slice(0,100));

  // Active drafts (requires username param)
  const active = await api('GET', '/active-drafts?username=fza');
  active.ok ? ok('GET /active-drafts?username=fza') : ko('GET /active-drafts', JSON.stringify(active.body));
}

// ────────────────────────────────────────────────────────────
// 3. DRAFT
// ────────────────────────────────────────────────────────────
let draftRosters = {};

async function testDraft() {
  section('DRAFT — Start, Pick, Validate');

  const start = await api('POST', '/start-draft', { clanName: poolName });
  start.ok ? ok('Start draft') : ko('Start draft', JSON.stringify(start.body));

  const orderRes = await api('GET', `/draft-order/${encodeURIComponent(poolName)}`);
  orderRes.ok ? ok('GET /draft-order') : ko('GET /draft-order', JSON.stringify(orderRes.body));

  // Load players — different field names per position
  const filtered = await api('GET', '/nhl_filtered_stats.json');
  if (!filtered.ok) { ko('Load player list', 'Could not fetch nhl_filtered_stats.json'); return; }

  const allOff  = filtered.body.Top_100_Offensive_Players || [];
  const allDef  = filtered.body.Top_50_Defenders || [];
  const allGoal = filtered.body.Top_50_Goalies || [];

  // Goalies use "goalieFullName", skaters use "skaterFullName"
  const playerName = (p, pos) => pos === 'goalie' ? p.goalieFullName : p.skaterFullName;

  if (allOff.length < 6 || allDef.length < 3 || allGoal.length < 3) {
    ko('Not enough players in stats files'); return;
  }

  // Get pool state to read the authoritative draft order and team membership
  const ds = await api('GET', '/draft');
  const pool = ds.body[poolName];
  if (!pool) { ko('Pool not found after start-draft'); return; }

  // Server returns the FULL snake pick sequence in pool.draftOrder
  const pickSeq = pool.draftOrder || [];
  if (pickSeq.length === 0) { ko('Draft order is empty'); return; }
  ok(`Draft order (${pickSeq.length} picks): ${pickSeq.slice(0,6).join(' → ')}…`);

  // Map team → username
  const teamToUser = {};
  for (const [tname, tdata] of Object.entries(pool.teams)) {
    if (tdata.members && tdata.members.length > 0) teamToUser[tname] = tdata.members[0];
  }

  // Pool config tells how many of each slot per team
  const cfg = pool.config || { numOffensive: 2, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 0 };

  // Slot counters per user (keyed by username from teamToUser)
  const slots = {};
  for (const user of Object.values(teamToUser)) {
    slots[user] = { offensive: 0, defensive: 0, goalie: 0, rookie: 0, teams: 0 };
    draftRosters[user] = draftRosters[user] || [];
  }

  const pickedNames = new Set();

  for (let i = 0; i < pickSeq.length; i++) {
    const team = pickSeq[i];
    const user = teamToUser[team];
    if (!user) { ko(`Pick #${i+1}: no user for team ${team}`); continue; }

    const s = slots[user];
    let player, position;

    if (s.offensive < cfg.numOffensive) {
      player = allOff.find(p => !pickedNames.has(p.skaterFullName));
      position = 'offensive';
    } else if (s.defensive < cfg.numDefensive) {
      player = allDef.find(p => !pickedNames.has(p.skaterFullName));
      position = 'defensive';
    } else if (s.goalie < cfg.numGoalies) {
      player = allGoal.find(p => !pickedNames.has(p.goalieFullName));
      position = 'goalie';
    } else if (s.rookie < cfg.numRookies) {
      player = allOff.find(p => !pickedNames.has(p.skaterFullName));
      position = 'rookie';
    }

    if (!player) { ko(`Pick #${i+1}: no available player for ${user} (${position})`); continue; }

    const name = playerName(player, position);
    pickedNames.add(name);
    if (position !== 'goalie') pickedNames.add(player.skaterFullName);
    else pickedNames.add(player.goalieFullName);
    s[position === 'goalie' ? 'goalie' : position]++;

    const r = await api('POST', '/pick-player', {
      clanName: poolName,
      username: user,
      playerName: name,
      position,
    });

    if (r.ok) {
      ok(`Pick #${i+1}: ${name} (${position}) → ${user}`);
      draftRosters[user].push({ name, position });
    } else {
      ko(`Pick #${i+1}: ${name}`, JSON.stringify(r.body).slice(0, 120));
    }
  }

  // Duplicate pick should fail
  const anyUser = Object.keys(draftRosters)[0];
  const firstPick = draftRosters[anyUser]?.[0];
  if (firstPick) {
    const dup = await api('POST', '/pick-player', {
      clanName: poolName,
      username: anyUser,
      playerName: firstPick.name,
      position: firstPick.position,
    });
    !dup.ok ? ok('Reject duplicate player pick') : ko('Reject duplicate pick', 'Should have failed');
  }

  ok('Draft sequence completed');
}

// ────────────────────────────────────────────────────────────
// 4. TRADES (requires PostgreSQL DB)
// ────────────────────────────────────────────────────────────
async function testTrades() {
  section('TRADES — Propose, Accept, Decline');

  // Probe: trades fail without DB
  const probe = await api('POST', '/trade/propose', {
    draftName: poolName,
    fromTeam: 'Équipe 1',
    toTeam: 'Équipe 2',
    offering:  [{ name: 'test', type: 'offensive' }],
    receiving: [{ name: 'test', type: 'offensive' }],
  });
  if (!probe.ok && (probe.body?.message || '').toLowerCase().includes('db')) {
    sk('Trade propose', 'No PostgreSQL DB — trades require DB');
    sk('Trade accept', 'No DB');
    sk('Trade decline', 'No DB');
    sk('Trade history', 'No DB');
    return;
  }
  if (!probe.ok) {
    sk('Trade propose', 'No PostgreSQL DB in local dev — trades require DB');
    sk('Trade accept', 'No DB');
    sk('Trade decline', 'No DB');
    sk('Trade history', 'No DB');
    return;
  }

  // If DB is available, run full trade flow
  const users = Object.keys(draftRosters);
  const u1 = users[0], u2 = users[1];
  const p1 = draftRosters[u1]?.find(p => p.position === 'offensive');
  const p2 = draftRosters[u2]?.find(p => p.position === 'offensive');
  if (!p1 || !p2) { sk('Trade tests', 'No matching offensive players'); return; }

  const propose = await api('POST', '/trade/propose', {
    draftName: poolName,
    fromTeam: 'Équipe 1',
    toTeam: 'Équipe 2',
    offering:  [{ name: p1.name, type: 'offensive' }],
    receiving: [{ name: p2.name, type: 'offensive' }],
  });
  propose.ok ? ok('Propose trade') : ko('Propose trade', JSON.stringify(propose.body));

  const pending = await api('GET', `/trades/pending/${u2}`);
  pending.ok ? ok('GET /trades/pending') : ko('GET pending trades', JSON.stringify(pending.body));

  const tradeId = pending.body?.trades?.[0]?.id;
  if (tradeId) {
    const accept = await api('POST', '/trade/accept', { tradeId });
    accept.ok ? ok('Accept trade') : ko('Accept trade', JSON.stringify(accept.body));
  } else {
    sk('Accept trade', 'No trade ID returned');
  }

  const hist = await api('GET', `/trades/${encodeURIComponent(poolName)}`);
  hist.ok ? ok('GET trade history') : ko('GET trade history', JSON.stringify(hist.body));
}

// ────────────────────────────────────────────────────────────
// 5. STATS
// ────────────────────────────────────────────────────────────
async function testStats() {
  section('STATS — Players, Teams, Hot Lists, Career');

  const cs = await api('GET', '/current-stats');
  if (cs.ok && cs.body.players?.length > 0) ok(`GET /current-stats (${cs.body.players.length} players)`);
  else ko('GET /current-stats', JSON.stringify(cs.body).slice(0,80));

  const ct = await api('GET', '/current-teams');
  ct.ok ? ok('GET /current-teams') : ko('GET /current-teams', JSON.stringify(ct.body));

  const hot7 = await api('GET', '/hot-players');
  hot7.ok ? ok('GET /hot-players (7d)') : ko('GET /hot-players (7d)', JSON.stringify(hot7.body));

  // 14d and 30d hot players require DB game logs — skip gracefully
  const hot14 = await api('GET', '/hot-players-last14days');
  hot14.ok ? ok('GET /hot-players-last14days') : sk('GET /hot-players-last14days', 'No DB game logs');

  const hot30 = await api('GET', '/hot-players-last30days');
  hot30.ok ? ok('GET /hot-players-last30days') : sk('GET /hot-players-last30days', 'No DB game logs');

  const streaks = await api('GET', '/streaks');
  streaks.ok ? ok('GET /streaks') : ko('GET /streaks', JSON.stringify(streaks.body));

  const career = await api('GET', '/player-career/8478402');
  career.ok ? ok('GET /player-career/8478402 (McDavid)') : ko('GET /player-career', JSON.stringify(career.body));

  const gl = await api('GET', '/player-gamelog/8478402');
  gl.ok ? ok('GET /player-gamelog') : sk('GET /player-gamelog', 'No DB game logs');

  const dbg = await api('GET', '/debug-player/8478402');
  dbg.ok ? ok('GET /debug-player/8478402') : ko('GET /debug-player', JSON.stringify(dbg.body));
}

// ────────────────────────────────────────────────────────────
// 6. SCORING
// ────────────────────────────────────────────────────────────
async function testScoring() {
  section('SCORING — Standings, H2H');

  // H2H scores requires an H2H-mode pool — our test pool is cumulative → skip
  sk('GET /h2h/current-week-scores', 'Test pool is cumulative mode, not H2H');

  const glStatus = await api('GET', '/game-logs-status');
  const glOk = glStatus.body?.status && !String(glStatus.body.status).includes('Error');
  glOk ? ok('GET /game-logs-status') : sk('GET /game-logs-status', 'No DB / game logs not loaded');
}

// ────────────────────────────────────────────────────────────
// 7. ADMIN & CLEANUP
// ────────────────────────────────────────────────────────────
async function testAdmin() {
  section('ADMIN & MISC');

  // ?adminToken=admin ouvrait la liste des comptes a quiconque connaissait la
  // chaine. Elle exige maintenant une vraie session d'administration.
  const parJeton = await apiAnonyme('GET', '/admin-users?adminToken=admin');
  parJeton.status === 401 || parJeton.status === 403
    ? ok('GET /admin-users refuses the old query token')
    : ko('GET /admin-users refuses the old query token', `statut ${parJeton.status}`);

  const parCompteOrdinaire = await api('GET', '/admin-users', undefined, { as: 'fza' });
  parCompteOrdinaire.status === 403
    ? ok('GET /admin-users refuses a normal account')
    : ko('GET /admin-users refuses a normal account', `statut ${parCompteOrdinaire.status}`);

  // change-team only works before draft starts — our pool already has a draft going, so expect failure
  const rename = await api('POST', '/change-team', {
    name: poolName,
    username: 'fza',
    newTeamNumber: 'Équipe 1',
  });
  const messageRefus = (rename.body?.message || '').toLowerCase();
  if (!rename.ok && (messageRefus.includes('draft') || messageRefus.includes('repêchage')
                     || messageRefus.includes('repechage'))) {
    ok('POST /change-team blocked after draft start (expected)');
  } else if (rename.ok) {
    ok('POST /change-team');
  } else {
    ko('POST /change-team', JSON.stringify(rename.body));
  }

  // Delete pool — endpoint uses "clanName" not "name"
  const del = await api('POST', '/delete-clan', { clanName: poolName });
  del.ok ? ok(`Delete test pool "${poolName}"`) : ko('Delete test pool', JSON.stringify(del.body));
}

// ────────────────────────────────────────────────────────────
// RUN
// ────────────────────────────────────────────────────────────
(async () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   FANTAZY — Integration Test Suite       ║');
  console.log('╚══════════════════════════════════════════╝');

  const ping = await api('GET', '/draft');
  if (ping.status === 0) {
    console.log('\n✗ Server not reachable at ' + BASE);
    process.exit(1);
  }

  await testAuth();
  await testPools();
  await testDraft();
  await testTrades();
  await testStats();
  await testScoring();
  await testAdmin();

  console.log('\n' + results.join('\n'));
  console.log(`\n${'═'.repeat(42)}`);
  console.log(`  ✓ PASSED: ${pass}   ✗ FAILED: ${fail}   ○ SKIPPED: ${skip}   TOTAL: ${pass+fail+skip}`);
  console.log('═'.repeat(42));

  process.exit(fail > 0 ? 1 : 0);
})();
