// ============================================================
// FANTAZY — Team Operations Integration Tests
// Covers: join, switch, change-team, rename, leave
//         both BEFORE and AFTER the draft starts
// Run: node test_teams.js  (server must be running on :3000)
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

// ── Identité LNH avant le repêchage ─────────────────────────
// Depuis « feat: implement NHL club selection » (687f17f), /start-draft
// refuse de tirer l'ordre tant que chaque équipe active n'a pas choisi son
// club. Ce préalable n'existait pas quand ce script a été écrit : sans lui,
// le repêchage ne démarre pas et tous les tests qui en dépendent tombent.
// Un club distinct par équipe — deux équipes d'un même pool ne peuvent pas
// porter les mêmes couleurs.
const CLUBS_TEST = ['MTL', 'TOR', 'BOS', 'EDM', 'CGY', 'VAN', 'NYR', 'PIT', 'COL', 'TBL'];

async function chooseClubs(poolName) {
  const r = await api('GET', '/draft');
  const teams = r.body?.[poolName]?.teams || {};
  let i = 0;
  for (const [, team] of Object.entries(teams)) {
    const membre = (team.members || [])[0];
    if (!membre) continue;                       // équipe vide : pas concernée
    await api('POST', '/choose-nhl-club', {
      clanName: poolName, username: membre, club: CLUBS_TEST[i++ % CLUBS_TEST.length]
    });
  }
}


// Get current pool state and return the teams object
async function getPoolTeams(poolName) {
  const r = await api('GET', '/draft');
  return r.body?.[poolName]?.teams || null;
}

// Return true if username is a member of teamName in pool
async function isOnTeam(poolName, teamName, username) {
  const teams = await getPoolTeams(poolName);
  return teams?.[teamName]?.members?.includes(username) ?? false;
}

// Return the team name that username is currently on, or null
async function currentTeamOf(poolName, username) {
  const teams = await getPoolTeams(poolName);
  if (!teams) return null;
  for (const [name, data] of Object.entries(teams)) {
    if (data.members.includes(username)) return name;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// SETUP
// ────────────────────────────────────────────────────────────
let teamPool;

async function setup() {
  section('SETUP — Users & Pool');

  // Ensure test users exist (idempotent — OK if already taken)
  for (const u of ['fza', 'fzb', 'fzc', 'fzd']) {
    const r = await api('POST', '/signup', { username: u, password: `${u}Pass1` });
    if (r.ok || /pris|existe|already|taken/i.test(r.body?.message || '')) ok(`User ${u} ready`);
    else ko(`User ${u} signup`, JSON.stringify(r.body));
  }

  teamPool = `TeamTest_${Date.now()}`;
  const create = await api('POST', '/create-clan', {
    name: teamPool,
    username: 'fza',
    maxPlayers: 3,
    config: { numOffensive: 1, numDefensive: 1, numGoalies: 1, numRookies: 0, numTeams: 0 },
    poolMode: 'cumulative',
    allowTrades: false,
  });
  create.ok ? ok(`Pool "${teamPool}" created`) : ko('Create pool', JSON.stringify(create.body));

  // Verify fza was auto-placed on Équipe 1
  const onTeam1 = await isOnTeam(teamPool, 'Équipe 1', 'fza');
  onTeam1 ? ok('Creator auto-placed on Équipe 1') : ko('Creator auto-place failed');
}

// ────────────────────────────────────────────────────────────
// PRE-DRAFT: JOIN
// ────────────────────────────────────────────────────────────
async function testPreDraftJoin() {
  section('PRE-DRAFT — Join Team');

  // Basic successful joins
  const joinB = await api('POST', '/join-team', { name: teamPool, username: 'fzb', teamName: 'Équipe 2' });
  joinB.ok ? ok('fzb joins Équipe 2') : ko('fzb join', JSON.stringify(joinB.body));

  const joinC = await api('POST', '/join-team', { name: teamPool, username: 'fzc', teamName: 'Équipe 3' });
  joinC.ok ? ok('fzc joins Équipe 3') : ko('fzc join', JSON.stringify(joinC.body));

  // Confirm membership via GET /draft
  const bOn2 = await isOnTeam(teamPool, 'Équipe 2', 'fzb');
  const cOn3 = await isOnTeam(teamPool, 'Équipe 3', 'fzc');
  bOn2 ? ok('Verify fzb on Équipe 2') : ko('Verify fzb on Équipe 2');
  cOn3 ? ok('Verify fzc on Équipe 3') : ko('Verify fzc on Équipe 3');

  // ── Rejection cases ──

  // Duplicate: fzb already on Équipe 2, re-join same team
  const dupSame = await api('POST', '/join-team', { name: teamPool, username: 'fzb', teamName: 'Équipe 2' });
  !dupSame.ok
    ? ok('Reject: duplicate same-team join')
    : ko('Reject: duplicate same-team join', 'Should have failed');

  // Non-existent pool
  const noPool = await api('POST', '/join-team', { name: 'GHOST_POOL_X999', username: 'fzb', teamName: 'Équipe 1' });
  !noPool.ok
    ? ok('Reject: join unknown pool')
    : ko('Reject: join unknown pool', 'Should have failed');

  // Non-existent team in valid pool
  const noTeam = await api('POST', '/join-team', { name: teamPool, username: 'fzd', teamName: 'Équipe 99' });
  !noTeam.ok
    ? ok('Reject: join non-existent team')
    : ko('Reject: join non-existent team', 'Should have failed');

  // Missing required fields
  const missingTeam = await api('POST', '/join-team', { name: teamPool, username: 'fzb' });
  !missingTeam.ok
    ? ok('Reject: missing teamName')
    : ko('Reject: missing teamName', 'Should have failed');
}

// ────────────────────────────────────────────────────────────
// PRE-DRAFT: SWITCH TEAMS
// ────────────────────────────────────────────────────────────
async function testPreDraftSwitch() {
  section('PRE-DRAFT — Switch Teams');

  // join-team: fzb switches from Équipe 2 → Équipe 3 (auto-removes from old)
  const switchB = await api('POST', '/join-team', { name: teamPool, username: 'fzb', teamName: 'Équipe 3' });
  switchB.ok ? ok('join-team switch: fzb Équipe 2 → Équipe 3') : ko('join-team switch', JSON.stringify(switchB.body));

  // Verify fzb is NOW on Équipe 3
  const bOn3 = await isOnTeam(teamPool, 'Équipe 3', 'fzb');
  bOn3 ? ok('Verify fzb arrived on Équipe 3') : ko('Verify fzb on Équipe 3');

  // Verify fzb is NO LONGER on Équipe 2
  const bGone2 = !(await isOnTeam(teamPool, 'Équipe 2', 'fzb'));
  bGone2 ? ok('Verify fzb left Équipe 2') : ko('Verify fzb left Équipe 2');

  // Switch back: fzb → Équipe 2
  const switchBack = await api('POST', '/join-team', { name: teamPool, username: 'fzb', teamName: 'Équipe 2' });
  switchBack.ok ? ok('join-team switch back: fzb → Équipe 2') : ko('join-team switch back', JSON.stringify(switchBack.body));

  // change-team: fzc switches from Équipe 3 → Équipe 1
  const changeC = await api('POST', '/change-team', { name: teamPool, username: 'fzc', newTeamNumber: 'Équipe 1' });
  changeC.ok ? ok('change-team: fzc Équipe 3 → Équipe 1') : ko('change-team', JSON.stringify(changeC.body));

  // Verify fzc is on Équipe 1
  const cOn1 = await isOnTeam(teamPool, 'Équipe 1', 'fzc');
  cOn1 ? ok('Verify fzc on Équipe 1') : ko('Verify fzc on Équipe 1');

  // Verify fzc left Équipe 3
  const cGone3 = !(await isOnTeam(teamPool, 'Équipe 3', 'fzc'));
  cGone3 ? ok('Verify fzc left Équipe 3') : ko('Verify fzc left Équipe 3');

  // Switch back: fzc → Équipe 3 (restore for remaining tests)
  const restoreC = await api('POST', '/change-team', { name: teamPool, username: 'fzc', newTeamNumber: 'Équipe 3' });
  restoreC.ok ? ok('change-team restore: fzc → Équipe 3') : ko('change-team restore', JSON.stringify(restoreC.body));

  // ── Rejection cases ──

  // change-team to non-existent team
  const noTeam = await api('POST', '/change-team', { name: teamPool, username: 'fzc', newTeamNumber: 'Équipe 99' });
  !noTeam.ok
    ? ok('Reject: change-team to unknown team')
    : ko('Reject: change-team to unknown team', 'Should have failed');

  // change-team: user not in pool at all (fzd never joined)
  const notMember = await api('POST', '/change-team', { name: teamPool, username: 'fzd', newTeamNumber: 'Équipe 1' });
  !notMember.ok
    ? ok('Reject: change-team user not in pool')
    : ko('Reject: change-team user not in pool', 'Should have failed');

  // change-team: user not in this pool (different user on different pool)
  const wrongPool = await api('POST', '/change-team', { name: 'GHOST_POOL_X999', username: 'fza', newTeamNumber: 'Équipe 1' });
  !wrongPool.ok
    ? ok('Reject: change-team unknown pool')
    : ko('Reject: change-team unknown pool', 'Should have failed');
}

// ────────────────────────────────────────────────────────────
// PRE-DRAFT: RENAME TEAM
// ────────────────────────────────────────────────────────────
let fzaTeamName = 'Équipe 1'; // will be updated after rename

async function testPreDraftRename() {
  section('PRE-DRAFT — Rename Team');

  // Successful rename (member renames own team)
  const rename = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Équipe 1',
    newTeamName: 'Les Géants',
    username: 'fza',
  });
  if (rename.ok) {
    ok('Rename: fza "Équipe 1" → "Les Géants"');
    fzaTeamName = 'Les Géants';
  } else {
    ko('Rename own team', JSON.stringify(rename.body));
  }

  // Verify new name appears in GET /draft
  const teams = await getPoolTeams(teamPool);
  const hasNew = !!(teams?.['Les Géants']);
  const hasOld = !!(teams?.['Équipe 1']);
  hasNew ? ok('Verify "Les Géants" exists in pool') : ko('Verify "Les Géants" exists');
  !hasOld ? ok('Verify "Équipe 1" key removed') : ko('Verify "Équipe 1" key removed');

  // Verify fza is still on the renamed team
  const fzaOnNew = await isOnTeam(teamPool, 'Les Géants', 'fza');
  fzaOnNew ? ok('Verify fza still member of "Les Géants"') : ko('Verify fza membership after rename');

  // ── Rejection cases ──

  // Non-member tries to rename fza's team
  const nonMember = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Les Voleurs',
    username: 'fzb',
  });
  !nonMember.ok
    ? ok('Reject: rename by non-member')
    : ko('Reject: rename by non-member', 'Should have failed');

  // Same name as current
  const sameName = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Les Géants',
    username: 'fza',
  });
  !sameName.ok
    ? ok('Reject: rename to same name')
    : ko('Reject: rename to same name', 'Should have failed');

  // Name already taken by another team
  const takenName = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Équipe 2',
    username: 'fza',
  });
  !takenName.ok
    ? ok('Reject: rename to existing team name')
    : ko('Reject: rename to existing team name', 'Should have failed');

  // Invalid characters
  const badChars = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Team@#$%',
    username: 'fza',
  });
  !badChars.ok
    ? ok('Reject: rename with invalid chars')
    : ko('Reject: rename with invalid chars', 'Should have failed');

  // Too long (21 chars)
  const tooLong = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'A'.repeat(21),
    username: 'fza',
  });
  !tooLong.ok
    ? ok('Reject: rename too long (21 chars)')
    : ko('Reject: rename too long', 'Should have failed');

  // Empty string
  const empty = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: '',
    username: 'fza',
  });
  !empty.ok
    ? ok('Reject: rename to empty string')
    : ko('Reject: rename to empty string', 'Should have failed');

  // Missing clanName param
  const missingClan = await api('POST', '/rename-team', {
    oldTeamName: 'Les Géants',
    newTeamName: 'Valide',
    username: 'fza',
  });
  !missingClan.ok
    ? ok('Reject: rename missing clanName')
    : ko('Reject: rename missing clanName', 'Should have failed');

  // Missing username param
  const missingUser = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Valide',
  });
  !missingUser.ok
    ? ok('Reject: rename missing username')
    : ko('Reject: rename missing username', 'Should have failed');

  // Unknown pool
  const unknownPool = await api('POST', '/rename-team', {
    clanName: 'GHOST_POOL_X999',
    oldTeamName: 'Équipe 1',
    newTeamName: 'Valide',
    username: 'fza',
  });
  !unknownPool.ok
    ? ok('Reject: rename in unknown pool')
    : ko('Reject: rename in unknown pool', 'Should have failed');

  // Unknown team name
  const unknownTeam = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Équipe 99',
    newTeamName: 'Valide',
    username: 'fza',
  });
  !unknownTeam.ok
    ? ok('Reject: rename non-existent team')
    : ko('Reject: rename non-existent team', 'Should have failed');
}

// ────────────────────────────────────────────────────────────
// PRE-DRAFT: LEAVE TEAM
// ────────────────────────────────────────────────────────────
async function testPreDraftLeave() {
  section('PRE-DRAFT — Leave Team');

  // Successful leave
  const leave = await api('POST', '/leave-team', { name: teamPool, username: 'fzc' });
  leave.ok ? ok('fzc leaves Équipe 3') : ko('fzc leave', JSON.stringify(leave.body));

  // Verify fzc is in no team
  const team = await currentTeamOf(teamPool, 'fzc');
  team === null
    ? ok('Verify fzc not in any team')
    : ko('Verify fzc left', `Still on ${team}`);

  // Reject: leave when not in any team
  const leaveAgain = await api('POST', '/leave-team', { name: teamPool, username: 'fzc' });
  !leaveAgain.ok
    ? ok('Reject: leave when not in any team')
    : ko('Reject: leave when not in any team', 'Should have failed');

  // Reject: leave from unknown pool
  const noPool = await api('POST', '/leave-team', { name: 'GHOST_POOL_X999', username: 'fza' });
  !noPool.ok
    ? ok('Reject: leave unknown pool')
    : ko('Reject: leave unknown pool', 'Should have failed');

  // fzc rejoins for draft (need 3 teams with members to start draft)
  const rejoin = await api('POST', '/join-team', { name: teamPool, username: 'fzc', teamName: 'Équipe 3' });
  rejoin.ok ? ok('fzc rejoins Équipe 3') : ko('fzc rejoin', JSON.stringify(rejoin.body));
}

// ────────────────────────────────────────────────────────────
// POST-DRAFT: All Operations After Draft Started
// ────────────────────────────────────────────────────────────
async function testPostDraft() {
  section('POST-DRAFT — Start Draft');

  // Pool state: fza on Les Géants, fzb on Équipe 2, fzc on Équipe 3
  await chooseClubs(teamPool);
  const start = await api('POST', '/start-draft', { clanName: teamPool });
  start.ok
    ? ok('Draft started')
    : ko('Start draft', JSON.stringify(start.body));

  // Verify draftOrder is populated
  const r = await api('GET', `/draft-order/${encodeURIComponent(teamPool)}`);
  const hasOrder = Array.isArray(r.body?.draftOrder) && r.body.draftOrder.length > 0;
  hasOrder
    ? ok(`Draft order generated (${r.body.draftOrder.length} picks)`)
    : ko('Draft order generated');

  section('POST-DRAFT — Join/Switch Blocked');

  // join-team blocked after draft start
  const joinAfter = await api('POST', '/join-team', { name: teamPool, username: 'fzd', teamName: 'Équipe 4' });
  !joinAfter.ok
    ? ok('Reject: join-team after draft started')
    : ko('Reject: join-team after draft started', 'Should have failed');

  // join-team switch (existing member) also blocked
  const switchAfter = await api('POST', '/join-team', { name: teamPool, username: 'fzb', teamName: 'Équipe 3' });
  !switchAfter.ok
    ? ok('Reject: join-team switch after draft started')
    : ko('Reject: join-team switch after draft started', 'Should have failed');

  // change-team blocked after draft start
  const changeAfter = await api('POST', '/change-team', { name: teamPool, username: 'fzc', newTeamNumber: 'Équipe 4' });
  !changeAfter.ok
    ? ok('Reject: change-team after draft started')
    : ko('Reject: change-team after draft started', 'Should have failed');

  // Verify nobody moved (fzb still on Équipe 2, fzc still on Équipe 3)
  const bStill2 = await isOnTeam(teamPool, 'Équipe 2', 'fzb');
  const cStill3 = await isOnTeam(teamPool, 'Équipe 3', 'fzc');
  bStill2 ? ok('Verify fzb unmoved after blocked switch') : ko('Verify fzb unmoved');
  cStill3 ? ok('Verify fzc unmoved after blocked change') : ko('Verify fzc unmoved');

  section('POST-DRAFT — Rename Still Allowed');

  // Rename works after draft starts
  const renamePost = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Équipe 2',
    newTeamName: 'Les Pingouins',
    username: 'fzb',
  });
  renamePost.ok
    ? ok('Rename post-draft: fzb "Équipe 2" → "Les Pingouins"')
    : ko('Rename post-draft', JSON.stringify(renamePost.body));

  // Verify pool reflects the rename
  const teams = await getPoolTeams(teamPool);
  !!(teams?.['Les Pingouins'])
    ? ok('Verify "Les Pingouins" in pool after draft rename')
    : ko('Verify "Les Pingouins" after draft rename');
  !(teams?.['Équipe 2'])
    ? ok('Verify "Équipe 2" key removed after draft rename')
    : ko('Verify "Équipe 2" key removed');

  // Verify draftOrder was updated with new name
  const orderRes = await api('GET', `/draft-order/${encodeURIComponent(teamPool)}`);
  const orderHasPingouins = orderRes.body?.draftOrder?.includes('Les Pingouins');
  const orderLacksEquipe2 = !orderRes.body?.draftOrder?.includes('Équipe 2');
  orderHasPingouins
    ? ok('Verify draftOrder updated: contains "Les Pingouins"')
    : ko('Verify draftOrder contains "Les Pingouins"');
  orderLacksEquipe2
    ? ok('Verify draftOrder updated: "Équipe 2" removed')
    : ko('Verify draftOrder: "Équipe 2" removed');

  // Non-member rename still rejected post-draft
  const nonMemberPost = await api('POST', '/rename-team', {
    clanName: teamPool,
    oldTeamName: 'Les Géants',
    newTeamName: 'Faux Nom',
    username: 'fzb',
  });
  !nonMemberPost.ok
    ? ok('Reject: post-draft rename by non-member')
    : ko('Reject: post-draft rename by non-member', 'Should have failed');

  section('POST-DRAFT — Leave Team (No Restriction)');

  // leave-team has no draft-started check — still works
  const leavePost = await api('POST', '/leave-team', { name: teamPool, username: 'fzc' });
  leavePost.ok
    ? ok('Leave team after draft started (no restriction)')
    : ko('Leave team post-draft', JSON.stringify(leavePost.body));

  // Verify fzc is gone
  const cGone = await currentTeamOf(teamPool, 'fzc');
  cGone === null
    ? ok('Verify fzc not in any team post-draft leave')
    : ko('Verify fzc left post-draft', `Still on ${cGone}`);
}

// ────────────────────────────────────────────────────────────
// CLEANUP
// ────────────────────────────────────────────────────────────
async function cleanup() {
  section('CLEANUP');
  const del = await api('POST', '/delete-clan', { clanName: teamPool });
  del.ok
    ? ok(`Pool "${teamPool}" deleted`)
    : ko('Delete pool', JSON.stringify(del.body));

  // Verify gone
  const r = await api('GET', '/draft');
  !(teamPool in (r.body || {}))
    ? ok('Verify pool removed from /draft')
    : ko('Verify pool removed');
}

// ────────────────────────────────────────────────────────────
// RUN
// ────────────────────────────────────────────────────────────
(async () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   FANTAZY — Team Operations Tests        ║');
  console.log('╚══════════════════════════════════════════╝');

  const ping = await api('GET', '/draft');
  if (ping.status === 0) {
    console.log('\n✗ Server not reachable at ' + BASE);
    process.exit(1);
  }

  await setup();
  await testPreDraftJoin();
  await testPreDraftSwitch();
  await testPreDraftRename();
  await testPreDraftLeave();
  await testPostDraft();
  await cleanup();

  console.log('\n' + results.join('\n'));
  console.log(`\n${'═'.repeat(42)}`);
  console.log(`  ✓ PASSED: ${pass}   ✗ FAILED: ${fail}   TOTAL: ${pass + fail}`);
  console.log('═'.repeat(42));

  process.exit(fail > 0 ? 1 : 0);
})();
