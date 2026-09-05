#!/usr/bin/env node
/**
 * Builds draftkit.json — the single source of truth for the draft — from the
 * "Trousse de repêchage 2026-2027" documents in data/draftkit/.
 *
 *   draftkit-fr-p.xlsx  complete skater pool  (last season + 2026-27 projection)
 *   draftkit-fr-g.xlsx  goalie pool           (last season + 2026-27 projection)
 *   draftkit-fr-t.xlsx  team pool             (last season + 2026-27 projection)
 *   draftkit-fr.txt     the 32 team pages of draftkit-fr.pdf, extracted with
 *                       `pdftotext -layout -enc UTF-8 draftkit-fr.pdf draftkit-fr.txt`
 *                       (kept in the repo so the build needs no PDF tooling)
 *
 * Nothing here touches the NHL or ESPN APIs: the documents are authoritative.
 *
 * Usage: node tools/build_draftkit.js
 */
const fs = require('fs');
const path = require('path');
const { readSheet } = require('./xlsx.js');

const SRC = path.join(__dirname, '..', 'data', 'draftkit');
const OUT = path.join(__dirname, '..', 'draftkit.json');
const OUT_WATCHLIST = path.join(__dirname, '..', 'draftkit-watchlist.json');
const SEASON = '2026-2027';

// The kit's own abbreviations are title-case and a few differ from the NHL's
// official three-letter codes, which is what teams/*.png and the rest of the
// app key on.
const KIT_TO_NHL = {
    Ana: 'ANA', Bos: 'BOS', Buf: 'BUF', Car: 'CAR', Cbj: 'CBJ', Cgy: 'CGY',
    Chi: 'CHI', Col: 'COL', Dal: 'DAL', Det: 'DET', Edm: 'EDM', Fla: 'FLA',
    LA: 'LAK', Min: 'MIN', Mtl: 'MTL', NJ: 'NJD', Nsh: 'NSH', Nyi: 'NYI',
    Nyr: 'NYR', Ott: 'OTT', Phi: 'PHI', Pit: 'PIT', SJ: 'SJS', Sea: 'SEA',
    Stl: 'STL', TB: 'TBL', Tor: 'TOR', Uta: 'UTA', Van: 'VAN', Vgk: 'VGK',
    Win: 'WPG', Wsh: 'WSH'
};

// Built from the NHL codes the app already uses for logos and rosters.
const TEAM_NAME_TO_ABBREV = {
    'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
    'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI',
    'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL',
    'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
    'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
    'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI',
    'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI',
    'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
    'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR',
    'Utah Mammoth': 'UTA', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK',
    'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG'
};

// The kit writes every city in English; the app is French-Canadian and has
// always shown "Montréal". The accent matters beyond looks: getTeamAbbreviation()
// keys on it, and drafted teams are stored under this exact string.
const TEAM_DISPLAY_NAME = { MTL: 'Montréal Canadiens' };

// The kit writes positions in French; the app's filters key on NHL codes.
const POS_TO_NHL = { C: 'C', LW: 'L', RW: 'R', D: 'D', G: 'G' };
// …and the team pages use the French abbreviations for the same positions.
const FR_POS = { C: 'C', AG: 'L', AD: 'R', D: 'D', AC: 'C' };

const warnings = [];
const warn = msg => { warnings.push(msg); };

// ── helpers ────────────────────────────────────────────────────────────────
const num = v => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const int = v => { const n = num(v); return n == null ? null : Math.round(n); };
const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

/** Accent-free, punctuation-free lower-case key used for every name match. */
function nameKey(s) {
    return String(s)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Splits the trailing legend markers off a name.
 *   "Brad Marchand °°°" → injury 3   (° Blessure)
 * The "·" flag (dernière année de contrat) sits in its own trailing column.
 */
function splitName(raw) {
    const m = String(raw).match(/^(.*?)\s*(°*)\s*$/);
    return { name: (m ? m[1] : raw).trim(), injury: m && m[2] ? m[2].length : 0 };
}

/**
 * Recrue. La trousse n'a pas de colonne « recrue » : la règle s'appuie sur ce
 * qu'elle donne — les matchs joués la SAISON DERNIÈRE et l'âge. Jamais sur la
 * projection, qui est une saison pleine pour quiconque est censé rester.
 *
 * Une case vide veut dire « aucun match dans la LNH l'an dernier » : c'est la
 * recrue la plus certaine du lot (Gavin McKenna, Ivar Stenberg, Roman
 * Kantserov, Sebastian Cossa), pas un joueur à écarter.
 *
 * L'âge est la seconde moitié du test. Sans lui, le seuil de matchs attrape
 * aussi les vétérans blessés une saison entière — c'est pour cela que
 * l'ancien code portait une exception « Tyler Seguin » en dur — et les
 * dossiers vides des joueurs en fin de carrière.
 */
const ROOKIE_MAX_GAMES = 27;
const ROOKIE_MAX_AGE = 23;
function isRookie(lastSeasonGames, age, who) {
    const fewGames = lastSeasonGames == null || lastSeasonGames <= ROOKIE_MAX_GAMES;
    if (age == null) {
        // A handful of rows leave the age cell blank. Without it the games
        // threshold alone cannot tell a prospect from a fringe veteran, so
        // these are reported rather than guessed at.
        if (fewGames && who) warn(`${who}: no age in the kit, so the rookie flag cannot be decided `
            + `(${lastSeasonGames == null ? 'no' : lastSeasonGames} game(s) last season) — left out`);
        return false;
    }
    return age <= ROOKIE_MAX_AGE && fewGames;
}

/* ── NHL player ids ─────────────────────────────────────────────────────────
 * The kit carries no NHL id, but the app needs one for the headshot CDN and
 * the career modal. Ids are stable, so they are resolved here, once, and
 * written into draftkit.json — auditable in the diff — rather than guessed in
 * the browser on every load.
 *
 * Two sources are read (ids only, never statistics): nhl_filtered_stats.json
 * and current_stats.json.
 */
const ID_SOURCES = [
    path.join(__dirname, '..', 'nhl_filtered_stats.json'),
    path.join(__dirname, '..', 'current_stats.json')
];

/* Rows whose id belongs to a different player than the name on them. Chief
 * offender: 8467408 is the retired Matt Walker, but current_stats.json labels
 * it "Matt Savoie" — attaching it stole the real 22-year-old Oiler's identity.
 * Keep aligned with FZ_IDS_ERRONES in draftkitData.js. */
const BAD_IDS = new Set([8469770, 8470324, 8470724, 8470594, 8470600, 8467408]);

/* The kit and the NHL spell a few players differently. Only entries verified
 * to be the same person belong here — a shared surname is NOT enough
 * (Ryan/Dylan Strome, Miles/Matthew Wood, and Vancouver's two Elias
 * Petterssons are all distinct players). */
const ID_NAME_ALIASES = {
    'matt savoie': 'Matthew Savoie',      // le nom officiel de la LNH
    'yegor chinakhov': 'Egor Chinakhov',  // translittération
    'benjamin kindel': 'Ben Kindel',
    'dmitriy simashev': 'Dmitri Simashev'
};

const TEAM_FIX = { LA: 'LAK', SJ: 'SJS', TB: 'TBL', NJ: 'NJD', WIN: 'WPG' };
const normTeam = t => {
    const a = String(t || '').split(',').pop().trim().toUpperCase();
    return TEAM_FIX[a] || a;
};

function buildIdIndex() {
    const index = new Map();
    const add = (name, id, team) => {
        if (!name || !id || BAD_IDS.has(id)) return;
        const k = nameKey(name);
        if (!index.has(k)) index.set(k, []);
        const list = index.get(k);
        if (!list.some(e => e.id === id)) list.push({ id, team: normTeam(team) });
    };

    for (const file of ID_SOURCES) {
        let data;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { warn(`id source unreadable, skipped: ${path.basename(file)}`); continue; }

        for (const key of ['Top_50_Defenders', 'Top_100_Offensive_Players', 'Top_Rookies', 'Top_50_Goalies']) {
            for (const p of data[key] || []) add(p.skaterFullName || p.goalieFullName, p.playerId, p.teamAbbrevs);
        }
        for (const p of data.players || []) add(p.playerName, p.playerId, p.teamAbbrev);
    }
    return index;
}

/** The id for one kit player, or null when it cannot be settled safely. */
function resolveId(index, fullName, team) {
    const alias = ID_NAME_ALIASES[nameKey(fullName)];
    const candidates = index.get(nameKey(fullName)) || (alias ? index.get(nameKey(alias)) : null) || [];
    if (candidates.length === 1) return candidates[0].id;
    if (!candidates.length) return null;
    // Two real players share the name (there are two Sam Montembeaults): the
    // club settles it, and anything still ambiguous is left unresolved rather
    // than assigned by coin flip.
    const onTeam = candidates.filter(c => c.team === team);
    return onTeam.length === 1 ? onTeam[0].id : null;
}

// ── 1. teams ───────────────────────────────────────────────────────────────
// # | Nom | Ville | last: PJ V D DP Bl. | proj: PJ V D DP Bl.
function buildTeams() {
    const rows = readSheet(path.join(SRC, 'draftkit-fr-t.xlsx'));
    const teams = [];
    for (const r of rows.slice(4)) {
        const rank = int(r[0]);
        if (!rank || !r[1]) continue;
        const nickname = r[1];
        const city = r[2];
        const fullName = `${city} ${nickname}`;
        const abbrev = TEAM_NAME_TO_ABBREV[fullName];
        if (!abbrev) { warn(`team not mapped to an abbreviation: ${fullName}`); continue; }
        const rec = (o) => ({
            gamesPlayed: int(r[o]), wins: int(r[o + 1]), losses: int(r[o + 2]),
            otLosses: int(r[o + 3]), shutouts: int(r[o + 4]),
            points: int(r[o + 1]) * 2 + int(r[o + 3])
        });
        teams.push({
            rank, abbrev, city, nickname,
            fullName: TEAM_DISPLAY_NAME[abbrev] || fullName,
            kitName: fullName,          // tel qu'écrit dans la trousse
            lastSeason: rec(3), projection: rec(8)
        });
    }
    return teams;
}

// ── 2. skaters ─────────────────────────────────────────────────────────────
// # | Prénom | Nom | Âge | Équ. | Pos
//   | last: PJ B P Pts PPP +/- PUN MEE LB TG
//   | proj: PJ B P Pts PPP +/- PUN MEE LB
//   | Sal | CapH | (·)
function buildSkaters(idIndex) {
    const rows = readSheet(path.join(SRC, 'draftkit-fr-p.xlsx'));
    const players = [];
    for (const r of rows.slice(4)) {
        const rank = int(r[0]);
        if (!rank || !r[2]) continue;
        const { name: lastName, injury } = splitName(r[2]);
        const firstName = splitName(r[1]).name;
        const kitTeam = r[4];
        const team = KIT_TO_NHL[kitTeam];
        if (!team) warn(`skater #${rank} ${firstName} ${lastName}: unknown team "${kitTeam}"`);
        const position = POS_TO_NHL[r[5]] || r[5];

        players.push({
            rank,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
            age: int(r[3]),
            team: team || kitTeam,
            position,
            positionLabel: r[5],
            playerId: resolveId(idIndex, `${firstName} ${lastName}`.trim(), team || kitTeam),
            lastSeason: {
                gamesPlayed: int(r[6]), goals: int(r[7]), assists: int(r[8]), points: int(r[9]),
                pointsPerGame: round(num(r[10]), 2), plusMinus: int(r[11]), pim: int(r[12]),
                hits: int(r[13]), blocks: int(r[14]), toi: r[15] || null
            },
            projection: {
                gamesPlayed: int(r[16]), goals: int(r[17]), assists: int(r[18]), points: int(r[19]),
                pointsPerGame: round(num(r[20]), 2), plusMinus: int(r[21]), pim: int(r[22]),
                hits: int(r[23]), blocks: int(r[24])
            },
            salary: num(r[25]),
            capHit: num(r[26]),
            injuryFlag: injury,                 // ° Blessure (1–3 in the legend)
            contractYear: r[27] === '·',   // · Dernière année de contrat
            rookie: isRookie(int(r[6]), int(r[3]), `skater #${rank} ${firstName} ${lastName}`)
        });
    }
    return players;
}

// ── 3. goalies ─────────────────────────────────────────────────────────────
// # | Prénom | Nom | Âge | Équ. | Pos
//   | last: PJ V D DP Bl. MBA %ARR BA Arr. B P PUN
//   | proj: PJ V D DP Bl. MBA %ARR BA Arr.
//   | Sal | CapH | (·)
function buildGoalies(idIndex) {
    const rows = readSheet(path.join(SRC, 'draftkit-fr-g.xlsx'));
    const goalies = [];
    for (const r of rows.slice(4)) {
        const rank = int(r[0]);
        if (!rank || !r[2]) continue;
        const { name: lastName, injury } = splitName(r[2]);
        const firstName = splitName(r[1]).name;
        const kitTeam = r[4];
        const team = KIT_TO_NHL[kitTeam];
        if (!team) warn(`goalie #${rank} ${firstName} ${lastName}: unknown team "${kitTeam}"`);

        goalies.push({
            rank,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
            age: int(r[3]),
            team: team || kitTeam,
            position: 'G',
            playerId: resolveId(idIndex, `${firstName} ${lastName}`.trim(), team || kitTeam),
            lastSeason: {
                gamesPlayed: int(r[6]), wins: int(r[7]), losses: int(r[8]), otLosses: int(r[9]),
                shutouts: int(r[10]), gaa: round(num(r[11]), 2), savePct: round(num(r[12]), 3),
                goalsAgainst: int(r[13]), saves: int(r[14]),
                goals: int(r[15]), assists: int(r[16]), pim: int(r[17])
            },
            projection: {
                gamesPlayed: int(r[18]), wins: int(r[19]), losses: int(r[20]), otLosses: int(r[21]),
                shutouts: int(r[22]), gaa: round(num(r[23]), 2), savePct: round(num(r[24]), 3),
                goalsAgainst: int(r[25]), saves: int(r[26])
            },
            salary: num(r[27]),
            capHit: num(r[28]),
            injuryFlag: injury,
            contractYear: r[29] === '·',
            rookie: isRookie(int(r[6]), int(r[3]), `goalie #${rank} ${firstName} ${lastName}`)
        });
    }
    return goalies;
}

// ── 4. the 32 team pages of draftkit-fr.pdf ────────────────────────────────
const NOTE_SECTIONS = [
    ['Valeurs Sûres', 'valeursSures'],
    ['Joueurs à Surveiller', 'joueursASurveiller'],
    ['Valeur en Baisse', 'valeurEnBaisse'],
    ['Espoirs à Surveiller', 'espoirsASurveiller']
];
const NOTES_HEADER = 'Notes / Blessures / Contrats';
const STRUCTURAL = new Set([
    'ALIGNEMENT PROJETÉ', 'Attaquants', 'Défenseurs', 'Gardiens',
    NOTES_HEADER, 'NOTES',
    'LES MEILLEURS CHOIX (Vérifiez les dernières listes pour mises à jour)'
]);

/** Splits a -layout line into its visual columns (runs of 3+ spaces). */
const columns = line => line.split(/\s{3,}/).map(s => s.trim()).filter(Boolean);

function buildGuides(teams) {
    const raw = fs.readFileSync(path.join(SRC, 'draftkit-fr.txt'), 'utf8').split(/\r?\n/);

    // Pages are delimited by the running footer.
    const pages = [];
    let cur = [];
    for (const line of raw) {
        if (/^GUIDE DE REPÊCHAGE DE LA LNH \d{4}-\d{4}\s+Page \d+\s*$/.test(line)) {
            pages.push(cur);
            cur = [];
        } else cur.push(line);
    }
    if (cur.length) pages.push(cur);

    const byUpperName = new Map(teams.map(t => [nameKey(t.kitName), t]));
    const guides = {};

    for (const page of pages) {
        const first = page.find(l => l.trim());
        const title = first ? first.trim() : '';
        const team = byUpperName.get(nameKey(title));
        if (!team) continue;               // cover + table of contents
        guides[team.abbrev] = parseTeamPage(page, team);
    }

    const missing = teams.filter(t => !guides[t.abbrev]);
    if (missing.length) warn(`no guide page found for: ${missing.map(t => t.abbrev).join(', ')}`);
    return guides;
}

function parseTeamPage(page, team) {
    const alignStart = page.findIndex(l => /ALIGNEMENT PROJETÉ/.test(l));
    const notesStart = page.findIndex(l => l.trim() === 'NOTES');

    const picksLines = page.slice(0, alignStart >= 0 ? alignStart : page.length);
    const alignLines = page.slice(alignStart >= 0 ? alignStart : 0, notesStart >= 0 ? notesStart : page.length);
    const noteLines = notesStart >= 0 ? page.slice(notesStart + 1) : [];

    return {
        team: team.abbrev,
        teamName: team.fullName,
        topPicks: parseTopPicks(picksLines, team),
        lineup: parseLineup(alignLines),
        notes: parseNotes(noteLines, team)
    };
}

// "1. Leo Carlsson (C) - (27B, 36P) 63 pts"   → skater  (projected G, A, pts)
// "1. Lukas Dostal - (27V, 0BL, 4DP) 58 pts"  → goalie  (projected W, SO, OTL)
// The kit prints both B/P (French) and G/A (English) headers; accept either.
const PICK_SKATER = /(\d+)\.\s+([^()]+?)\s*\(([A-Z]{1,2})\)\s*-\s*\((\d+)\s*[BG],\s*(\d+)\s*[PA]\)\s*(\d+)\s*pts/g;
const PICK_GOALIE = /(\d+)\.\s+([^()]+?)\s*-\s*\((\d+)\s*V,\s*(\d+)\s*BL,\s*(\d+)\s*DP\)\s*(\d+)\s*pts/g;

function parseTopPicks(lines, team) {
    const forwards = [], defensemen = [], goalies = [];
    for (const line of lines) {
        let m;
        PICK_SKATER.lastIndex = 0;
        while ((m = PICK_SKATER.exec(line))) {
            const entry = {
                rank: Number(m[1]),
                name: m[2].trim(),
                position: FR_POS[m[3]] || m[3],
                positionLabel: m[3],
                projection: { goals: Number(m[4]), assists: Number(m[5]), points: Number(m[6]) }
            };
            (entry.position === 'D' ? defensemen : forwards).push(entry);
        }
        PICK_GOALIE.lastIndex = 0;
        while ((m = PICK_GOALIE.exec(line))) {
            goalies.push({
                rank: Number(m[1]),
                name: m[2].trim(),
                position: 'G',
                projection: { wins: Number(m[3]), shutouts: Number(m[4]), otLosses: Number(m[5]), points: Number(m[6]) }
            });
        }
    }
    const bySeed = (a, b) => a.rank - b.rank;
    forwards.sort(bySeed); defensemen.sort(bySeed); goalies.sort(bySeed);
    if (!forwards.length) warn(`${team.abbrev}: no forwards parsed in LES MEILLEURS CHOIX`);
    return { forwards, defensemen, goalies };
}


function parseLineup(lines) {
    const forwardLines = [], defensePairs = [], injuries = [];
    let seenNotesHeader = false;
    for (const raw of lines) {
        // The header shares a line with the last forward line on most pages, and
        // on a few it sits close enough that -layout does not open a column gap —
        // so strip it by text rather than expecting it as its own column.
        const notesHere = raw.includes(NOTES_HEADER);
        const line = notesHere ? raw.split(NOTES_HEADER).join('   ') : raw;
        const chunks = columns(line);
        for (const chunk of chunks) {
            if (STRUCTURAL.has(chunk)) continue;
            if (seenNotesHeader) { injuries.push(parseInjury(chunk)); continue; }
            const parts = chunk.split(/\s+-\s+/).map(s => s.trim());
            if (parts.length === 3) forwardLines.push(parts);
            else if (parts.length === 2) defensePairs.push(parts);
        }
        if (notesHere) seenNotesHeader = true;
    }
    return { forwardLines, defensePairs, injuries };
}

// "T. Terry - Hanche - Absent jusqu'en novembre" / "M. Domi - Indéterminé"
function parseInjury(chunk) {
    const parts = chunk.split(/\s+-\s+/).map(s => s.trim());
    if (parts.length >= 3) return { player: parts[0], issue: parts[1], status: parts.slice(2).join(' - ') };
    if (parts.length === 2) return { player: parts[0], issue: null, status: parts[1] };
    return { player: chunk, issue: null, status: null };
}

// A note opens with the player's name in capitals, then " - ", then prose that
// may wrap over several lines.
const NOTE_START = /^([A-ZÀ-ÞŒŠŽ0-9][A-ZÀ-ÞŒŠŽ0-9'’.\-\s]*?)\s+-\s+(.*)$/;

function parseNotes(lines, team) {
    const out = {};
    for (const [, key] of NOTE_SECTIONS) out[key] = [];

    let section = null;
    let entry = null;
    const flush = () => {
        if (entry && section) out[section].push({ ...entry, text: entry.text.replace(/\s+/g, ' ').trim() });
        entry = null;
    };

    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;

        const header = NOTE_SECTIONS.find(([label]) => label === t);
        if (header) { flush(); section = header[1]; continue; }
        if (!section) continue;

        const m = t.match(NOTE_START);
        if (m && m[1] === m[1].toUpperCase() && /[A-ZÀ-Þ]/.test(m[1])) {
            flush();
            entry = { name: titleCase(m[1].trim()), rawName: m[1].trim(), text: m[2] };
        } else if (entry) {
            entry.text += ' ' + t;
        }
    }
    flush();

    if (!out.joueursASurveiller.length) warn(`${team.abbrev}: "Joueurs à Surveiller" section is empty`);
    return out;
}

/** "LEO CARLSSON" → "Leo Carlsson", keeping McQueen-style names readable. */
function titleCase(s) {
    return s.toLowerCase()
        .replace(/(^|[\s'’\-.])([a-zà-þ])/g, (_, sep, c) => sep + c.toUpperCase())
        .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

// ── 5. resolve every guide mention against the player pool ─────────────────
function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return prev[b.length];
}

function linkGuides(guides, skaters, goalies) {
    const index = new Map();
    const add = (p, kind) => {
        const rec = { kind, fullName: p.fullName, team: p.team, position: p.position, rank: p.rank };
        for (const key of [nameKey(p.fullName), nameKey(p.lastName)]) {
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(rec);
        }
    };
    skaters.forEach(p => add(p, 'skater'));
    goalies.forEach(p => add(p, 'goalie'));

    // The team pages spell a few names differently from the pool sheets
    // ("Ben Kindell" / "Benjamin Kindel", "Sandin-Pellika" / "Sandin Pellikka"),
    // so a near-miss surname is accepted — but only against that team's own
    // players, where a one- or two-letter gap cannot pick the wrong man.
    const roster = new Map();
    for (const list of index.values()) {
        for (const rec of list) {
            if (!roster.has(rec.team)) roster.set(rec.team, []);
            if (!roster.get(rec.team).includes(rec)) roster.get(rec.team).push(rec);
        }
    }

    /** Prefers a team-mate when a surname is ambiguous. */
    const lookup = (name, team) => {
        const surname = nameKey(name.split(/\s+/).pop());
        const exact = index.get(nameKey(name)) || [];
        const pool = exact.length ? exact : (index.get(surname) || []);
        if (pool.length) return pool.find(p => p.team === team) || (pool.length === 1 ? pool[0] : null);

        const near = (roster.get(team) || [])
            .map(p => ({ p, d: editDistance(surname, nameKey(p.fullName.split(/\s+/).slice(1).join(' '))) }))
            .filter(({ d }) => d > 0 && d <= 2)
            .sort((a, b) => a.d - b.d);
        return near.length && (near.length === 1 || near[0].d < near[1].d) ? near[0].p : null;
    };

    for (const [abbrev, guide] of Object.entries(guides)) {
        for (const group of ['forwards', 'defensemen', 'goalies']) {
            for (const pick of guide.topPicks[group]) {
                const hit = lookup(pick.name, abbrev);
                if (hit) {
                    pick.fullName = hit.fullName;
                    pick.playerTeam = hit.team;
                    if (hit.team !== abbrev) pick.teamConflict = hit.team;
                } else warn(`${abbrev}: top pick "${pick.name}" not found in the player pool`);
            }
        }
        for (const [, key] of NOTE_SECTIONS) {
            for (const note of guide.notes[key]) {
                const hit = lookup(note.name, abbrev);
                if (hit) {
                    note.fullName = hit.fullName;
                    note.playerTeam = hit.team;
                    note.position = hit.position;
                    note.kind = hit.kind;
                    // The team pages and the pool sheets are separate exports and
                    // can disagree about who plays where — a trade landing between
                    // the two, most likely. Surface it rather than pick a winner:
                    // the pool sheet stays authoritative for the player's record
                    // (it is "the complete list"), the note keeps the page it was
                    // written on, and the discrepancy is reported here so a human
                    // decides.
                    if (hit.team !== abbrev) {
                        note.teamConflict = hit.team;
                        warn(`${abbrev}: the team page lists ${hit.fullName} under ${key}, `
                            + `but the pool sheet has him on ${hit.team}`);
                    }
                } else {
                    note.fullName = note.name;
                    note.playerTeam = abbrev;
                    note.position = null;
                    note.kind = null;
                    warn(`${abbrev}: ${key} note "${note.name}" not found in the player pool`);
                }
            }
        }
    }
}

// ── build ──────────────────────────────────────────────────────────────────
const teams = buildTeams();
const idIndex = buildIdIndex();
const skaters = buildSkaters(idIndex);
const goalies = buildGoalies(idIndex);
const guides = buildGuides(teams);
linkGuides(guides, skaters, goalies);

// The home page's "À surveiller" strip: every team's Joueurs à Surveiller,
// flattened once here so the client does no assembly of its own.
const watchlist = [];
for (const team of teams.slice().sort((a, b) => a.abbrev.localeCompare(b.abbrev))) {
    const guide = guides[team.abbrev];
    if (!guide) continue;
    for (const note of guide.notes.joueursASurveiller) {
        watchlist.push({
            name: note.fullName,
            team: team.abbrev,
            teamName: team.fullName,
            position: note.position,
            kind: note.kind,
            note: note.text
        });
    }
}

const out = {
    source: 'Trousse de repêchage NHL 2026-2027 (PoolExpert.com)',
    season: SEASON,
    generatedAt: new Date().toISOString(),
    counts: {
        teams: teams.length, skaters: skaters.length, goalies: goalies.length,
        watchlist: watchlist.length,
        withPlayerId: [...skaters, ...goalies].filter(p => p.playerId).length
    },
    teams,
    skaters,
    goalies,
    guides,
    watchlist
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

// The home page only needs the watch list. Pulling the whole kit (~1 MB) for a
// 70-line strip would be the most expensive request on that page, so the same
// build also drops a slim copy next to it — written here, never by hand, so
// the two can never drift.
fs.writeFileSync(OUT_WATCHLIST, JSON.stringify({
    source: out.source,
    season: SEASON,
    generatedAt: out.generatedAt,
    watchlist
}, null, 1));

console.log(`✅ ${path.relative(process.cwd(), OUT)} — ${teams.length} teams, ${skaters.length} skaters, ${goalies.length} goalies, ${watchlist.length} watchlist entries`);
console.log(`✅ ${path.relative(process.cwd(), OUT_WATCHLIST)} — ${watchlist.length} entries`);
const withId = [...skaters, ...goalies].filter(p => p.playerId).length;
console.log(`   ${withId}/${skaters.length + goalies.length} players matched to an NHL id (photo + career modal)`);
if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log('   ' + w);
}
