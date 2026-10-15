/**
 * Le bilan de la soirée d'une équipe de pool (lib/bilanSoiree.js).
 *
 *   GET /api/pools/:poolName/bilan-soiree?vus=2026-10-14,2026-10-13
 *
 * `vus` : les soirées que la page a déjà montrées. Si la soirée à raconter en
 * fait partie, la réponse s'arrête là (`vu: true`) : aucun pointage n'est
 * relu pour une fenêtre qui ne s'ouvrira pas.
 *
 * Tant qu'aucune soirée n'est finie, `pret: false` et `reessaiMs` disent
 * quand revenir. Au tête-à-tête, il faut en plus que toutes les feuilles de
 * match de la soirée soient en base : son pointage ne lit qu'elles, et un
 * duel compté sur des feuilles manquantes annoncerait un faux écart.
 *
 * Les points sont ceux du pool, par le même service que le classement : les
 * vrais points au cumulatif (direct compris), les points fantasy au
 * tête-à-tête. Le mouvement au classement se calcule comme la pastille
 * ▲ ▼ du classement : même Total, mêmes points de soirée.
 */

'use strict';

const authz = require('../lib/authz.js');
const dates = require('../lib/dates.js');
const scoring = require('../lib/scoring.js');
const bilan = require('../lib/bilanSoiree.js');
const { checkIfDraftComplete } = require('../lib/draft.js');
const { getTeamAbbreviationFromName } = require('../lib/roster.js');
const { buildHeadshotUrl } = require('../headshots.js');
const { teamBannerTokens } = require('../teamColors.js');

const JOURNEE = /^\d{4}-\d{2}-\d{2}$/;

function monter(app, ctx) {
    const { auth, store, pointage, saisonCourante, fenetreSaison, saisonCommencee,
            matchsDuJour, scoresSaison, ficheReleve = () => null,
            usePostgres = true, logger = console } = ctx;

    const nomDe = p => (typeof p === 'string') ? p
        : (p && (p.skaterFullName || p.goalieFullName || p.teamFullName)) || null;

    /**
     * Le logo d'une équipe au classement : son premier club repêché
     * (`logo`, l'abréviation de teams/ABR.png), et l'écusson lisible sur fond
     * sombre (`ecusson`) — le marine d'Edmonton ou de Toronto disparaît sur
     * le gris du thème sombre.
     */
    function logoDe(teamData) {
        const club = nomDe(((teamData && teamData.teams) || [])[0]);
        const logo = club ? (getTeamAbbreviationFromName(club) || null) : null;
        return { logo, ecusson: logo ? teamBannerTokens(logo).crest : null };
    }

    /**
     * Le fond d'une carte : la teinte du club assombrie jusqu'à porter du
     * texte blanc, son filet et l'écusson lisible sur ce fond — les jetons de
     * la fiche du joueur (teamBannerTokens). Un or de Boston ne l'est pas.
     */
    function teinteDe(abbrev) {
        if (!abbrev) return null;
        const { surface, edge, trim, crest } = teamBannerTokens(abbrev);
        return { surface, edge, trim, crest };
    }

    /** Les matchs bruts d'une journée ; [] si la LNH ne répond pas. */
    async function lireMatchs(jour) {
        try { return (await matchsDuJour(jour)) || []; }
        catch (erreur) {
            logger.warn?.(`⚠️ Bilan de la soirée : matchs du ${jour} indisponibles :`, erreur.message);
            return [];
        }
    }

    /** Une carte par joueur qui a joué, au barème du pool. */
    async function cartesDesJoueurs(resultat, contexte) {
        const joueurs = ((resultat && resultat.detail && resultat.detail.joueurs) || [])
            .filter(j => j.matchs > 0 || j.enDirect > 0 || j.points !== 0);

        // La décision d'un gardien (défaite en prolongation comprise) n'est
        // que sur sa feuille de match.
        const gardiens = joueurs.filter(j => j.position === 'G').map(j => j.name);
        const decisions = new Map();
        if (gardiens.length) {
            const lignes = await pointage.feuilles({ noms: gardiens, debut: contexte.debut, fin: contexte.fin, saison: contexte.saison });
            for (const l of lignes || []) {
                if (!decisions.has(l.player_name)) decisions.set(l.player_name, []);
                decisions.get(l.player_name).push(l.decision);
            }
        }

        return joueurs.map(j => {
            // Un match que seul le direct connaît n'a pas encore de feuille :
            // l'identifiant et le club viennent alors du relevé.
            const fiche = (!j.playerId || !j.teamAbbrev) ? (ficheReleve(j.name) || {}) : {};
            const playerId = j.playerId || fiche.playerId || null;
            const club = String(j.teamAbbrev || fiche.teamAbbrev || '').split(',').pop().trim().toUpperCase() || null;
            const gardien = j.position === 'G';
            return {
                type: 'joueur',
                nom: j.name,
                categorie: j.categorie,
                gardien,
                club,
                photo: playerId ? buildHeadshotUrl(playerId, club) : null,
                teinte: teinteDe(club),
                buts: j.goals || 0,
                aides: j.assists || 0,
                tirs: j.shots || 0,
                arrets: j.saves || 0,
                ...(gardien ? {
                    decision: bilan.decisionDuGardien({
                        victoires: j.wins || 0,
                        blanchissages: j.shutouts || 0,
                        decisions: decisions.get(j.name) || []
                    })
                } : {}),
                points: scoring.arrondi(contexte.mode === scoring.MODES.H2H ? j.fantasyPoints : j.points)
            };
        });
    }

    /** Les clubs repêchés qui ont joué : ils comptent au cumulatif seulement. */
    function cartesDesClubs(teamData, matchs, jour, saison) {
        return ((teamData && teamData.teams) || []).map(nomDe).filter(Boolean).map(nom => {
            const abbrev = getTeamAbbreviationFromName(nom);
            const soiree = abbrev ? bilan.soireeDuClub(matchs, abbrev, jour, saison) : null;
            if (!soiree) return null;
            return { type: 'club', nom, club: abbrev, teinte: teinteDe(abbrev), ...soiree };
        }).filter(Boolean);
    }

    app.get('/api/pools/:poolName/bilan-soiree', auth.requireAuth, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const nomPool = req.params.poolName;
            const enveloppe = await store.lire(nomPool);
            if (!enveloppe) return res.status(404).json({ message: 'Pool introuvable.' });
            const poolData = enveloppe.data;
            const monEquipe = authz.equipeDe(poolData, req.auth.username);
            if (!monEquipe) return res.status(404).json({ message: 'Aucune équipe à votre nom dans ce pool.' });

            const fenetre = fenetreSaison ? await fenetreSaison() : null;
            if (saisonCommencee && !saisonCommencee(fenetre)) {
                return res.json({ pret: false, raison: 'saison', reessaiMs: null });
            }
            if (!checkIfDraftComplete(poolData)) {
                return res.json({ pret: false, raison: 'repechage', reessaiMs: null });
            }

            const saison = saisonCourante();
            const aujourdhui = dates.journeeLocale();
            const hier = dates.ajouterJours(aujourdhui, -1);
            const [matchsAuj, matchsHier] = await Promise.all([lireMatchs(aujourdhui), lireMatchs(hier)]);
            const etatAujourdhui = bilan.etatDeLaSoiree(matchsAuj, aujourdhui, saison);
            const etatHier = bilan.etatDeLaSoiree(matchsHier, hier, saison);
            const reessaiMs = bilan.delaiAvantReessai(etatAujourdhui, etatHier);

            const jour = bilan.choisirSoiree({ aujourdhui, hier, etatAujourdhui, etatHier });
            if (!jour) return res.json({ pret: false, raison: 'matchs', reessaiMs });

            const vus = String(req.query.vus || '').split(',').map(v => v.trim()).filter(v => JOURNEE.test(v));
            if (vus.includes(jour)) return res.json({ pret: true, vu: true, jour, reessaiMs });

            const mode = poolData.poolMode === scoring.MODES.H2H ? scoring.MODES.H2H : scoring.MODES.CUMULATIF;
            const enH2H = mode === scoring.MODES.H2H;
            if (enH2H && !usePostgres) return res.json({ pret: false, raison: 'indisponible', reessaiMs: null });

            const lendemain = dates.ajouterJours(jour, 1);
            const contexteJour = { debut: jour, fin: lendemain, saison, mode, baseAlignement: pointage.BASE_ALIGNEMENT.COURANT };
            const ingestion = await pointage.etatIngestion(contexteJour);
            // Le tête-à-tête ne compte que les feuilles en base : elles
            // arrivent dans le quart d'heure qui suit chaque match.
            if (enH2H && ingestion.completude !== scoring.COMPLETUDE.DISPONIBLE) {
                return res.json({ pret: false, raison: 'feuilles', jour, reessaiMs: bilan.REESSAI_EN_JEU_MS });
            }

            const equipes = Object.entries(poolData.teams || {}).filter(([, td]) => (td.members || []).length > 0);
            const teamData = poolData.teams[monEquipe];
            const pointsDuJour = new Map();
            const pointerJour = async (nom) => {
                if (!pointsDuJour.has(nom)) {
                    pointsDuJour.set(nom, pointage.pointsEquipe(poolData.teams[nom], { ...contexteJour, ingestion }));
                }
                return pointsDuJour.get(nom);
            };

            const resultat = await pointerJour(monEquipe);
            const matchsDuSoir = jour === aujourdhui ? matchsAuj : matchsHier;
            const cartes = [
                ...await cartesDesJoueurs(resultat, contexteJour),
                ...(enH2H ? [] : cartesDesClubs(teamData, matchsDuSoir, jour, saison))
            ].sort((a, b) => (b.points - a.points) || a.nom.localeCompare(b.nom, 'fr'));
            const total = scoring.arrondi(cartes.reduce((somme, c) => somme + c.points, 0));

            const corps = {
                pret: true,
                vu: false,
                jour,
                mode,
                reessaiMs,
                equipe: {
                    cle: monEquipe,
                    nom: bilan.nomAffiche(monEquipe, teamData.members),
                    ...logoDe(teamData)
                },
                cartes,
                total
            };

            if (!enH2H) {
                corps.rang = await rangDeLaSoiree({ poolData, equipes, monEquipe, pointerJour, jour, aujourdhui, saison, etatAujourdhui });
            } else {
                corps.duel = await duelDeLaSoiree({ poolData, equipes, monEquipe, pointerJour, jour, saison });
            }
            res.json(corps);
        } catch (erreur) {
            logger.error('Erreur /bilan-soiree :', erreur);
            res.status(500).json({ message: 'Erreur interne du serveur.' });
        }
    });

    /**
     * Le rang avant et après la soirée (cumulatif). Quand on raconte celle
     * d'hier pendant que les matchs du jour jouent, leurs points sont retirés
     * du Total : le rang « après » est celui du soir raconté, pas de maintenant.
     */
    async function rangDeLaSoiree({ poolData, equipes, monEquipe, pointerJour, jour, aujourdhui, saison, etatAujourdhui }) {
        const totaux = await scoresSaison(poolData);
        const suite = jour < aujourdhui && (etatAujourdhui.finis + etatAujourdhui.enJeu) > 0;
        const contexteSuite = suite ? {
            debut: dates.ajouterJours(jour, 1), fin: dates.ajouterJours(aujourdhui, 1), saison,
            mode: scoring.MODES.CUMULATIF, baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
        } : null;
        const ingestionSuite = suite ? await pointage.etatIngestion(contexteSuite) : null;
        const actives = new Set(equipes.map(([nom]) => nom));

        const lignes = await Promise.all(totaux.filter(t => actives.has(t.teamName)).map(async t => {
            const [soiree, apres] = await Promise.all([
                pointerJour(t.teamName),
                suite ? pointage.pointsEquipe(poolData.teams[t.teamName], { ...contexteSuite, ingestion: ingestionSuite }) : null
            ]);
            return { teamName: t.teamName, total: t.score, soiree: soiree.points || 0, apres: apres ? (apres.points || 0) : 0 };
        }));
        const rangs = bilan.rangsDeLaSoiree(lignes);
        return { avant: rangs.avant.get(monEquipe) || null, apres: rangs.apres.get(monEquipe) || null, equipes: lignes.length };
    }

    /**
     * Le duel de la semaine qui contient la soirée (tête-à-tête) : les deux
     * équipes, leur bilan et leur rang, le pointage de la semaine jusqu'à la
     * soirée comprise, et ce que la soirée y a ajouté. Une semaine déjà close
     * se lit dans son résultat figé, comme au centre des duels.
     */
    async function duelDeLaSoiree({ poolData, equipes, monEquipe, pointerJour, jour, saison }) {
        const h2h = poolData.h2hData || {};
        const depart = h2h.seasonStart || h2h.weekStart;
        const numero = depart ? dates.numeroDeSemaine(depart, jour) : null;
        const semaine = numero ? dates.semaineNumero(depart, numero) : null;
        if (!semaine) return null;
        const duel = (((h2h.matchups || [])[numero - 1]) || []).find(d => d.team1 === monEquipe || d.team2 === monEquipe);
        if (!duel) return null;
        const adversaire = duel.team1 === monEquipe ? duel.team2 : duel.team1;
        if (!poolData.teams[adversaire]) return null;

        const archive = (h2h.matchupHistory || []).find(s => Number(s.weekNumber) === numero);
        const fige = archive && (archive.matchups || []).find(m => m.team1 === monEquipe || m.team2 === monEquipe);
        let nousPts, euxPts;
        if (fige) {
            const nousEnPremier = fige.team1 === monEquipe;
            nousPts = nousEnPremier ? fige.team1Points : fige.team2Points;
            euxPts = nousEnPremier ? fige.team2Points : fige.team1Points;
        } else {
            const contexteSemaine = {
                debut: semaine.debut, fin: dates.ajouterJours(jour, 1), saison,
                mode: scoring.MODES.H2H, baseAlignement: pointage.BASE_ALIGNEMENT.COURANT
            };
            const ingestion = await pointage.etatIngestion(contexteSemaine);
            const [a, b] = await Promise.all([monEquipe, adversaire].map(nom =>
                pointage.pointsEquipe(poolData.teams[nom], { ...contexteSemaine, ingestion })));
            nousPts = a.points;
            euxPts = b.points;
        }
        const [nousSoir, euxSoir] = await Promise.all([pointerJour(monEquipe), pointerJour(adversaire)]);

        const rangs = bilan.rangsH2H(equipes.map(([nom]) => nom), h2h.standings);
        const fiche = nom => {
            const td = poolData.teams[nom];
            const s = (h2h.standings && h2h.standings[nom]) || {};
            return {
                cle: nom,
                nom: bilan.nomAffiche(nom, td.members),
                ...logoDe(td),
                bilan: { v: s.wins || 0, d: s.losses || 0, n: s.ties || 0 },
                rang: rangs.get(nom) || null
            };
        };
        const final = Boolean(fige) || jour === semaine.dernierJour;
        nousPts = scoring.arrondi(Number(nousPts) || 0);
        euxPts = scoring.arrondi(Number(euxPts) || 0);
        return {
            semaine: numero,
            jourDeSemaine: dates.nombreDeJours(semaine.debut, jour) + 1,
            final,
            fige: Boolean(fige),
            issue: final ? bilan.issueDuDuel(nousPts, euxPts) : null,
            equipes: rangs.size,
            nous: { ...fiche(monEquipe), points: nousPts, soiree: scoring.arrondi(nousSoir.points || 0) },
            eux: { ...fiche(adversaire), points: euxPts, soiree: scoring.arrondi(euxSoir.points || 0) }
        };
    }
}

module.exports = { monter };
