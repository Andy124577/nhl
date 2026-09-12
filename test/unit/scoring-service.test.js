'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerServicePointage } = require('../../services/scoring.js');
const scoring = require('../../lib/scoring.js');

/**
 * Base simulée : les feuilles de match vivent dans un tableau, et le service
 * les interroge par la vraie requête. Les deux requêtes qu'il émet sont
 * reconnues à leur forme, pour que le test constate ce qui est demandé — en
 * particulier la borne de fin EXCLUSIVE.
 */
function creerDb(lignes) {
    const requetes = [];
    return {
        requetes,
        async query(sql, params) {
            requetes.push({ sql, params });

            if (sql.includes('COUNT(DISTINCT game_id)')) {
                const [saison, debut, fin] = params;
                const parJour = new Map();
                for (const l of lignes) {
                    if (l.season !== saison) continue;
                    if (l.game_date < debut || l.game_date >= fin) continue;
                    if (!parJour.has(l.game_date)) parJour.set(l.game_date, new Set());
                    parJour.get(l.game_date).add(l.game_id);
                }
                return { rows: [...parJour].map(([game_date, jeux]) => ({ game_date, matchs: jeux.size })) };
            }

            const [saison, debut, fin, noms] = params;
            return {
                rows: lignes.filter(l =>
                    l.season === saison &&
                    l.game_date >= debut &&
                    l.game_date < fin &&
                    noms.includes(l.player_name))
            };
        }
    };
}

const SAISON = '20262027';

function feuille(nom, journee, options = {}) {
    return {
        player_name: nom, player_id: options.playerId || 1, team_abbrev: 'MTL',
        position: options.position || 'C', season: SAISON,
        game_id: options.gameId || (journee + '-' + nom), game_date: journee,
        goals: 0, assists: 0, points: 0, shots: 0, plus_minus: 0,
        power_play_goals: 0, power_play_points: 0,
        shorthanded_goals: 0, shorthanded_points: 0, game_winning_goals: 0,
        decision: null, saves: 0, goals_against: 0, shutouts: 0,
        ...options.stats
    };
}

const equipe = (options = {}) => ({
    members: ['alice'],
    offensive: options.offensive || ['Attaquant A'],
    defensive: options.defensive || [],
    rookie: options.rookie || [],
    goalie: options.goalie || [],
    teams: options.teams || []
});

test('la fin de période est exclusive : un match du lundi suivant ne compte pas', async () => {
    const lignes = [
        feuille('Attaquant A', '2026-11-08', { stats: { goals: 1 } }),
        feuille('Attaquant A', '2026-11-09', { stats: { goals: 5 } })
    ];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 1 });

    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(resultat.points, 3, 'seul le but du 8 novembre appartient à cette semaine');
});

test('les bonus comptent : c est le même barème que partout ailleurs', async () => {
    const lignes = [feuille('Attaquant A', '2026-11-03', {
        stats: { goals: 1, assists: 1, shots: 2, plus_minus: 1,
                 power_play_goals: 1, power_play_points: 1, game_winning_goals: 1 }
    })];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 1 });

    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    // 3 + 2 + 1 + 0,5 + 1 + 0,5 + 1
    assert.equal(resultat.points, 9);
    assert.equal(resultat.points, scoring.pointsFeuilleDeMatch(lignes[0]));
});

test('aucune donnée ne donne pas zéro : la complétude le dit', async () => {
    const pointage = creerServicePointage({ db: creerDb([]), calendrierDuJour: async () => 3 });
    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(resultat.points, 0);
    assert.equal(resultat.completude, scoring.COMPLETUDE.INDISPONIBLE,
        "zéro point et aucune donnée ne sont pas la même chose");
    assert.equal(scoring.finalisable(resultat), false, 'une semaine comme celle-là reste en attente');
});

test('une ingestion partielle est annoncée comme partielle, pas comme complète', async () => {
    // Trois matchs par jour au calendrier, un seul jour ingéré.
    const lignes = [feuille('Attaquant A', '2026-11-03', { gameId: 'g1', stats: { goals: 1 } })];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 3 });

    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(resultat.completude, scoring.COMPLETUDE.PARTIEL);
    assert.equal(scoring.finalisable(resultat), false);
    assert.equal(resultat.matchsAttendus, 21);
    assert.equal(resultat.matchsRecus, 1);
});

test('une ingestion complète est finalisable', async () => {
    const lignes = ['2026-11-02', '2026-11-03'].map((j, i) =>
        feuille('Attaquant A', j, { gameId: 'g' + i, stats: { goals: 1 } }));
    // Un match les deux premiers jours, aucun ensuite.
    const calendrier = async (journee) => (['2026-11-02', '2026-11-03'].includes(journee) ? 1 : 0);
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: calendrier });

    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(resultat.completude, scoring.COMPLETUDE.DISPONIBLE);
    assert.equal(scoring.finalisable(resultat), true);
    assert.equal(resultat.points, 6);
});

test('un calendrier indisponible ne se fait pas passer pour une semaine complète', async () => {
    const lignes = [feuille('Attaquant A', '2026-11-03', { stats: { goals: 1 } })];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => null });

    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(resultat.completude, scoring.COMPLETUDE.PARTIEL);
    assert.equal(resultat.matchsAttendus, null, 'on ne prétend pas connaître le calendrier');
    assert.equal(scoring.finalisable(resultat), false);
});

test('une équipe sans alignement est sans objet, pas incomplète', async () => {
    const pointage = creerServicePointage({ db: creerDb([]), calendrierDuJour: async () => 1 });
    const resultat = await pointage.pointsEquipe(
        { members: ['alice'], offensive: [], defensive: [], goalie: [], rookie: [], teams: [] },
        { debut: '2026-11-02', fin: '2026-11-09', saison: SAISON }
    );

    assert.equal(resultat.points, null);
    assert.equal(resultat.completude, scoring.COMPLETUDE.SANS_OBJET);
    assert.equal(scoring.finalisable(resultat), true, 'rien à attendre : la semaine peut se fermer');
});

test('le club repêché est exclu du tête-à-tête, et le dit', async () => {
    const pointage = creerServicePointage({ db: creerDb([]), calendrierDuJour: async () => 0 });
    const resultat = await pointage.pointsEquipe(
        equipe({ teams: ['Canadiens de Montréal'] }),
        { debut: '2026-11-02', fin: '2026-11-09', saison: SAISON, mode: 'head-to-head' }
    );

    const club = resultat.detail.club;
    assert.equal(club.inclus, false);
    assert.deepEqual(club.clubs, ['Canadiens de Montréal']);
    assert.match(club.raison, /cumulatif/,
        "l'omettre en silence sur une surface et le compter sur une autre produisait deux totaux");
});

test('le club est inclus en mode cumulatif', async () => {
    const pointage = creerServicePointage({ db: creerDb([]), calendrierDuJour: async () => 0 });
    const resultat = await pointage.pointsEquipe(
        equipe({ teams: ['Canadiens de Montréal'] }),
        { debut: '2026-11-02', fin: '2026-11-09', saison: SAISON, mode: 'cumulative' }
    );
    assert.equal(resultat.detail.club.inclus, true);
});

test('le détail par joueur garde tout le monde, avec le compte de matchs', async () => {
    const lignes = [
        feuille('Attaquant A', '2026-11-03', { gameId: 'a1', stats: { goals: 1, assists: 1 } }),
        feuille('Attaquant A', '2026-11-05', { gameId: 'a2', stats: { goals: 1 } })
    ];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 1 });

    const detail = await pointage.detailEquipe(
        equipe({ offensive: ['Attaquant A', 'Attaquant B'], goalie: ['Gardien C'] }),
        { debut: '2026-11-02', fin: '2026-11-09', saison: SAISON }
    );

    assert.equal(detail.length, 3, 'un joueur sans match reste dans la liste');
    const a = detail.find(j => j.name === 'Attaquant A');
    assert.equal(a.matchs, 2);
    assert.equal(a.goals, 2);
    assert.equal(a.fantasyPoints, 8);

    const b = detail.find(j => j.name === 'Attaquant B');
    assert.equal(b.matchs, 0, "« aucun match » se lit sur le compte, pas sur les points");
    assert.equal(b.fantasyPoints, 0);

    const c = detail.find(j => j.name === 'Gardien C');
    assert.equal(c.position, 'G');
    assert.equal(c.categorie, 'goalie');
});

test('un gardien est pointé comme un gardien, même sans champ de position', async () => {
    const lignes = [feuille('Gardien C', '2026-11-03', {
        position: 'G', stats: { decision: 'W', saves: 30, goals_against: 2, shutouts: 0 }
    })];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 1 });

    const resultat = await pointage.pointsEquipe(equipe({ offensive: [], goalie: ['Gardien C'] }), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    // 5 (victoire) + 30 × 0,2 (arrêts) − 2 (buts accordés)
    assert.equal(resultat.points, 9);
});

test('une seule requête de feuilles couvre toute l équipe', async () => {
    const db = creerDb([]);
    const pointage = creerServicePointage({ db, calendrierDuJour: async () => 0 });

    await pointage.detailEquipe(
        equipe({ offensive: ['A', 'B', 'C', 'D', 'E', 'F'], goalie: ['G'] }),
        { debut: '2026-11-02', fin: '2026-11-09', saison: SAISON }
    );

    const requetesFeuilles = db.requetes.filter(r => r.sql.includes('FROM player_game_logs') &&
                                                     !r.sql.includes('COUNT'));
    assert.equal(requetesFeuilles.length, 1,
        'le nombre de requêtes ne doit pas grandir avec la taille de l alignement');
});

test('les deux équipes d un duel sont pointées sur la même période et la même ingestion', async () => {
    const lignes = [
        feuille('Attaquant A', '2026-11-03', { gameId: 'g1', stats: { goals: 2 } }),
        feuille('Attaquant Z', '2026-11-03', { gameId: 'g1', stats: { goals: 1 } })
    ];
    const pointage = creerServicePointage({ db: creerDb(lignes), calendrierDuJour: async () => 1 });

    const teams = {
        'Équipe 1': equipe({ offensive: ['Attaquant A'] }),
        'Équipe 2': equipe({ offensive: ['Attaquant Z'] })
    };
    const duel = await pointage.pointsDuel({ team1: 'Équipe 1', team2: 'Équipe 2' }, teams, {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON
    });

    assert.equal(duel.t1.points, 6);
    assert.equal(duel.t2.points, 3);
    assert.equal(duel.t1.completude, duel.t2.completude,
        'un duel dont les deux moitiés ont deux complétudes différentes serait incomparable');
    assert.deepEqual(duel.t1.periode, duel.t2.periode);
});

test('un résultat porte de quoi être comparé à un autre', async () => {
    const pointage = creerServicePointage({ db: creerDb([]), calendrierDuJour: async () => 0 });
    const resultat = await pointage.pointsEquipe(equipe(), {
        debut: '2026-11-02', fin: '2026-11-09', saison: SAISON, mode: 'head-to-head'
    });

    assert.equal(resultat.saison, SAISON);
    assert.equal(resultat.mode, 'head-to-head');
    assert.equal(resultat.versionBareme, scoring.VERSION_BAREME);
    assert.equal(resultat.baseAlignement, 'current_roster');
    assert.deepEqual(resultat.periode, { debut: '2026-11-02', fin: '2026-11-09' });
});

test('l alignement se lit quel que soit le format des entrées', () => {
    const { alignementDe } = require('../../services/scoring.js');
    const lu = alignementDe({
        offensive: ['Texte', { skaterFullName: 'Objet' }],
        goalie: [{ goalieFullName: 'Gardien' }],
        rookie: [null],
        teams: [{ teamFullName: 'Canadiens de Montréal' }]
    });

    assert.deepEqual(lu.patineurs.map(p => p.nom), ['Texte', 'Objet']);
    assert.deepEqual(lu.gardiens.map(g => g.nom), ['Gardien']);
    assert.deepEqual(lu.clubs, ['Canadiens de Montréal']);
    assert.equal(lu.joueurs.length, 3, 'une entrée vide ne doit pas produire un joueur fantôme');
});
