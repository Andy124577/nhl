/**
 * Removes retired / inactive / bogus entries from nhl_filtered_stats.json.
 *
 * Why this exists
 * ---------------
 * The draft pool file is periodically rebuilt from a player-id list, and a
 * few ids belong to players who no longer play in the NHL (Dennis Wideman,
 * Josh Gorges, …) or are plain wrong (a phantom "Matt Savoie" defenceman).
 * The server's stats refresh only *updates* existing rows, so once a bad row
 * is in the file it never leaves on its own — this script takes it out.
 *
 * It also cross-checks every skater/goalie against the NHL API's
 * <season>/skater|goalie summary (the authoritative "who actually played"
 * list) and PRINTS — without removing — anyone in the pool who didn't dress
 * this season, so the REMOVE_IDS list below can be extended by hand. We do
 * not auto-drop that broader set because it sweeps up injured stars
 * (Aleksander Barkov missed 2025-26) and rows with mismatched ids.
 *
 * ADD_PLAYERS re-inserts real players the regeneration dropped or mangled
 * (e.g. Matt Savoie was in the file under Matt Walker's id, as a PHI
 * defenceman). Each is added once, with live current-season stats.
 *
 * Top_Rookies is left untouched — a rookie pool is meant to hold players
 * who have not debuted yet.
 *
 * Usage:  node prune_retired_players.js          (writes the file)
 *         node prune_retired_players.js --dry    (report only)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATS_FILE = path.join(__dirname, 'nhl_filtered_stats.json');
const { currentSeasonId } = require('./lib/season.js');
const SEASON = currentSeasonId();
const DRY = process.argv.includes('--dry');

/* Hand-verified: retired, or a bogus id. Keyed by playerId so a name
 * collision can never remove the wrong person. */
const REMOVE_IDS = new Map([
  [8469770, 'Dennis Wideman — retired 2017'],
  [8470324, 'Josh Gorges — retired 2018'],
  [8470724, 'Kyle Quincey — retired 2018'],
  [8470594, 'Marc-André Fleury — retired after 2024-25'],
  [8470600, 'Ryan Suter — unsigned/retired after 2024-25'],
  [8467408, "Matt Walker (id 8467408) — was mislabeled 'Matt Savoie', a retired defenceman; real Savoie re-added below as 8483512"],
]);

/* Real players the regeneration dropped or corrupted. Section is where the
 * entry belongs; stats are pulled live so a stale line can't creep back. */
const ADD_PLAYERS = [
  { section: 'Top_100_Offensive_Players', playerId: 8483512, skaterFullName: 'Matt Savoie', teamAbbrevs: 'EDM', positionCode: 'C' },
];

const SKATER_SECTIONS = ['Top_50_Defenders', 'Top_100_Offensive_Players'];
const GOALIE_SECTIONS = ['Top_50_Goalies'];

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let s = '';
      r.on('data', d => (s += d));
      r.on('end', () => {
        try { resolve(JSON.parse(s)); }
        catch (e) { reject(new Error('bad JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

async function fetchSummary(kind) {
  const base = `https://api.nhle.com/stats/rest/en/${kind}/summary`;
  const exp = encodeURIComponent(`seasonId=${SEASON} and gameTypeId=2`);
  const out = [];
  for (let start = 0; ; start += 100) {
    const j = await getJSON(`${base}?limit=100&start=${start}&cayenneExp=${exp}`);
    out.push(...j.data);
    if (out.length >= j.total) break;
  }
  return out;
}

/* One player's current-season line straight from the summary endpoint. */
async function fetchOneSkater(playerId) {
  const exp = encodeURIComponent(`seasonId=${SEASON} and gameTypeId=2 and playerId=${playerId}`);
  const j = await getJSON(`https://api.nhle.com/stats/rest/en/skater/summary?limit=5&cayenneExp=${exp}`);
  return (j.data || [])[0] || null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));

  // --- 1. Remove the hand-verified list -----------------------------------
  let removed = 0;
  for (const section of [...SKATER_SECTIONS, ...GOALIE_SECTIONS]) {
    const before = data[section] ? data[section].length : 0;
    data[section] = (data[section] || []).filter(p => {
      if (REMOVE_IDS.has(p.playerId)) {
        console.log(`  ✂  ${section}: ${p.skaterFullName || p.goalieFullName}  — ${REMOVE_IDS.get(p.playerId)}`);
        removed++;
        return false;
      }
      return true;
    });
    if (data[section].length !== before) {
      console.log(`     ${section}: ${before} → ${data[section].length}`);
    }
  }
  console.log(`\nRemoved ${removed} verified entr${removed === 1 ? 'y' : 'ies'}.`);

  // --- 1b. Re-add real players that were dropped/corrupted --------------
  let added = 0;
  for (const spec of ADD_PLAYERS) {
    const present = (data[spec.section] || []).some(p => p.playerId === spec.playerId);
    if (present) { console.log(`  =  ${spec.skaterFullName} already in ${spec.section}`); continue; }
    let stats = null;
    try { stats = await fetchOneSkater(spec.playerId); } catch (e) { /* offline: fall back to zeros */ }
    const row = {
      playerId: spec.playerId,
      skaterFullName: stats?.skaterFullName || spec.skaterFullName,
      teamAbbrevs: stats?.teamAbbrevs || spec.teamAbbrevs,
      positionCode: stats?.positionCode || spec.positionCode,
      gamesPlayed: stats?.gamesPlayed || 0,
      goals: stats?.goals || 0,
      assists: stats?.assists || 0,
      points: stats?.points || 0,
    };
    (data[spec.section] = data[spec.section] || []).push(row);
    added++;
    console.log(`  ➕ ${spec.section}: ${row.skaterFullName} (${row.teamAbbrevs}, ${row.positionCode}) — ${row.gamesPlayed}GP ${row.points}pts`);
  }
  if (added) console.log(`Added ${added} player(s).`);

  // --- 2. Advisory: who else didn't play this season ---------------------
  try {
    const [skaters, goalies] = await Promise.all([fetchSummary('skater'), fetchSummary('goalie')]);
    const played = new Set([...skaters, ...goalies].map(p => p.playerId));
    console.log(`\nNHL API ${SEASON}: ${skaters.length} skaters + ${goalies.length} goalies dressed.`);
    const suspects = [];
    for (const section of [...SKATER_SECTIONS, ...GOALIE_SECTIONS]) {
      for (const p of data[section] || []) {
        if (!played.has(p.playerId)) {
          suspects.push(`  ${section}: ${(p.skaterFullName || p.goalieFullName).padEnd(24)} id ${p.playerId}  (${p.points ?? '?'} pts listed)`);
        }
      }
    }
    if (suspects.length) {
      console.log(`\n⚠  Still in the pool but did NOT play ${SEASON} — review by hand, add ids to REMOVE_IDS if retired:`);
      suspects.forEach(s => console.log(s));
    } else {
      console.log('\n✓ Every remaining skater/goalie played this season.');
    }
  } catch (e) {
    console.log(`\n(Skipped the API cross-check: ${e.message})`);
  }

  // --- 3. Write --------------------------------------------------------------
  if (DRY) {
    console.log('\n--dry: file not written.');
    return;
  }
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 4));
  console.log(`\n✅ ${path.basename(STATS_FILE)} written.`);
})();
