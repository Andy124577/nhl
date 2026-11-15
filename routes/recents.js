/**
 * « Récents » : ce qui vient d'arriver dans un pool, en une réponse.
 *
 *   GET /api/pools/:poolName/recents
 *
 * Une seule lecture en base : le fil d'activité du pool (pool_activity),
 * gardé tant que rien n'a été écrit (lib/memoireLectures.js). Tout le reste
 * est déjà en mémoire dans ce processus : le rapport des blessés, le journal
 * des mouvements LNH, la soirée de chaque joueur (points en direct) et les
 * matchs du jour. Ouvrir Récents ne réveille donc pas Neon plus qu'ouvrir
 * l'accueil, et ne coûte aucun appel de plus à la LNH.
 *
 * Les offres d'échange reçues n'y sont pas : la barre les lit déjà
 * (/trades/pending) et la page les reprend de cette lecture.
 */

'use strict';

const authz = require('../lib/authz.js');
const dates = require('../lib/dates.js');
const recents = require('../lib/recents.js');
const { nomAffiche } = require('../lib/bilanSoiree.js');
const { getTeamAbbreviationFromName, NHL_CLUB_FULLNAME } = require('../lib/roster.js');

/** Ville et surnom des cartes de match ; Utah a changé de surnom. */
const NOMS_CLUBS = { ...NHL_CLUB_FULLNAME, UTA: 'Utah Mammoth' };
const { buildHeadshotUrl } = require('../headshots.js');
const { creerMemoireLectures } = require('../lib/memoireLectures.js');
// La nature d'une blessure en français : la même table que les pastilles
// des tableaux (injuries.js se charge sans navigateur).
const { injNatureFr } = require('../injuries.js');

/** Entrées du fil d'activité lues en base. */
const ACTIVITE_MAX = 40;

function monter(app, ctx) {
    const {
        auth, store, db, usePostgres, confianceMs = 0, logger = console,
        decrireActivite = null,
        blessesLNH = async () => [],
        journalLNH = async () => ({ transactions: [] }),
        soireesEnDirect = async () => ({ joueurs: {}, clubs: {} }),
        matchsDuJour = async () => [],
        ficheReleve = () => null,
        butDe = () => null
    } = ctx;

    const lectures = creerMemoireLectures({
        generation: typeof db?.generationDonnees === 'function' ? () => db.generationDonnees() : () => null,
        dureeMs: confianceMs,
        max: 300
    });

    async function activiteDuPool(poolId) {
        if (!usePostgres || !db || typeof db.getPoolActivity !== 'function' || !decrireActivite) return null;
        return lectures.obtenir(`activite|${poolId}`, async () => {
            const lignes = await db.getPoolActivity(poolId, { limite: ACTIVITE_MAX });
            return lignes.map(decrireActivite);
        });
    }

    /** Une source en panne ne vide pas les autres : elle rend son repli. */
    async function prudemment(promesse, repli, nom) {
        try { return (await promesse) ?? repli; }
        catch (erreur) {
            logger.warn?.(`⚠️ Récents : ${nom} indisponible :`, erreur.message);
            return repli;
        }
    }

    app.get('/api/pools/:poolName/recents', auth.requireAuth, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await store.lire(nomPool);
            if (!enveloppe) return res.status(404).json({ message: 'Pool introuvable.' });
            const poolData = enveloppe.data;
            if (!req.auth.isAdmin && !authz.estMembre(poolData, req.auth.username)) {
                return res.status(403).json({ message: "Vous n'êtes pas membre de ce pool." });
            }

            const monEquipe = authz.equipeDe(poolData, req.auth.username);
            const aujourdhui = dates.journeeLocale();
            // Avant midi, les matchs d'hier comptent encore : ceux qui
            // finissent après minuit et le bilan de la veille (comme l'accueil).
            const hier = dates.composantes(new Date()).hour < 12 ? dates.ajouterJours(aujourdhui, -1) : null;
            const nomEquipe = cle => nomAffiche(cle, ((poolData.teams || {})[cle] || {}).members);
            const index = recents.indexerJoueursDuPool(poolData, monEquipe);

            const [blesses, journal, soirees, matchs, activite] = await Promise.all([
                prudemment(blessesLNH(), [], 'blessés'),
                prudemment(journalLNH(), { transactions: [] }, 'mouvements LNH'),
                prudemment(soireesEnDirect(), { joueurs: {}, clubs: {} }, 'points en direct'),
                Promise.all([
                    prudemment(matchsDuJour(aujourdhui), [], 'matchs du jour'),
                    hier ? prudemment(matchsDuJour(hier), [], 'matchs d’hier') : []
                ]).then(([a, h]) => [...h, ...a]),
                prudemment(activiteDuPool(enveloppe.id), null, 'activité du pool')
            ]);

            // Mes joueurs, rattachés à leur club par le relevé : le club
            // n'est pas dans l'alignement du pool, et on ne le devine pas.
            const equipe = monEquipe ? poolData.teams[monEquipe] : null;
            const mesJoueurs = [];
            for (const entree of index.values()) {
                if (!entree.mien) continue;
                const fiche = ficheReleve(entree.nom) || {};
                if (fiche.playerId) mesJoueurs.push({ nom: entree.nom, playerId: fiche.playerId, club: fiche.teamAbbrev });
            }
            const mesClubs = ((equipe && equipe.teams) || [])
                .map(t => (typeof t === 'string' ? t : t && (t.teamFullName || t.nom || t.name)))
                .map(n => (n ? getTeamAbbreviationFromName(n) : null))
                .filter(Boolean);

            // La photo d'un joueur dont la source n'en donne pas : celle du
            // relevé, comme partout ailleurs sur le site.
            const avecPhoto = e => {
                if (e.photo) return e;
                const fiche = ficheReleve(e.joueur) || {};
                return { ...e, photo: fiche.playerId ? buildHeadshotUrl(fiche.playerId, fiche.teamAbbrev) : null };
            };

            res.json({
                poolName: nomPool,
                monEquipe: monEquipe ? nomEquipe(monEquipe) : null,
                aujourdhui,
                matchs: recents.rapportsDeMatch(matchs, { mesJoueurs, mesClubs, soirees, aujourdhui, jours: [aujourdhui, hier].filter(Boolean), butDe, nomsClubs: NOMS_CLUBS }),
                blessures: recents.blessuresDuPool(blesses, index, { aujourdhui, nomEquipe }).map(b => avecPhoto({
                    ...b,
                    natureFr: injNatureFr({ injuryType: b.nature, injuryDetail: b.detail, injurySide: b.cote, status: b.statut }) || null
                })),
                lnh: recents.mouvementsDuPool(journal, index, { aujourdhui, nomEquipe }).map(avecPhoto),
                pool: activite ? recents.activiteUtile(activite).map(e => {
                    const sujet = e.sujet || {};
                    const joueur = (sujet.offering || [])[0] || sujet.playerName || null;
                    return joueur ? avecPhoto({ ...e, joueur }) : e;
                }) : [],
                activiteDisponible: activite !== null,
                genereLe: new Date().toISOString()
            });
        } catch (erreur) {
            logger.error('Erreur /recents :', erreur);
            res.status(500).json({ message: 'Erreur interne du serveur.' });
        }
    });
}

module.exports = { monter };
