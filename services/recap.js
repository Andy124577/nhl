/**
 * Génération des récapitulatifs hebdomadaires.
 *
 * Un récap se génère APRÈS une finalisation réussie, à partir des résultats
 * figés — jamais à partir des alignements du jour. C'est la seule façon
 * d'éviter qu'un échange conclu mardi fabrique un exploit de la semaine
 * dernière.
 *
 * Trois propriétés, et chacune correspond à une façon de se tromper :
 *
 *   - **idempotent.** Régénérer le même récap écrase la même ligne au lieu
 *     d'en créer une deuxième. Les travaux de fond se relancent, et un récap
 *     par relance encombrerait l'historique de doublons ;
 *   - **rattrapable.** Un redémarrage entre la finalisation et la génération ne
 *     laisse pas un trou : le rattrapage repère les semaines finalisées sans
 *     récap et les traite ;
 *   - **révisable.** Une correction officielle produit une nouvelle révision de
 *     résultat ; le récap qui en découle porte cette révision et se signale
 *     comme corrigé, au lieu de changer en silence.
 *
 * Le récap n'est jamais publié partiel : une semaine dont les feuilles
 * manquaient n'est pas finalisée, donc n'a pas de récap.
 */

'use strict';

const recap = require('../lib/recap.js');
const scoring = require('../lib/scoring.js');

function creerServiceRecap({ store, db, usePostgres, diffusion, saisonCourante, logger = console }) {

    /** Les semaines finalisées d'un pool, la révision en vigueur pour chacune. */
    async function semainesFinalisees(poolId, saison) {
        if (!usePostgres) return [];
        const lignes = await db.listFinalizedWeeks(poolId, saison);
        return lignes.map(l => ({
            weekNumber: Number(l.week_number),
            revision: Number(l.revision),
            weekStart: l.week_start,
            weekEnd: l.week_end,
            matchups: l.results
        }));
    }

    /**
     * Génère (ou régénère) le récap d'une semaine.
     *
     * Renvoie null quand la semaine n'est pas finalisée : il n'y a alors rien à
     * raconter, et raconter quand même reviendrait à publier un résultat
     * partiel comme définitif.
     */
    async function genererSemaine(nomPool, numero, { saison = null } = {}) {
        if (!usePostgres) return null;

        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) return null;

        const data = enveloppe.data;
        const mode = data.poolMode === 'head-to-head' ? 'head-to-head' : 'cumulative';
        const saisonEffective = saison || (data.h2hData && data.h2hData.season) || saisonCourante();

        if (mode !== 'head-to-head') return null;

        const toutes = await semainesFinalisees(enveloppe.id, saisonEffective);
        const semaine = toutes.find(s => s.weekNumber === Number(numero));
        if (!semaine) return null;

        const charge = recap.construire({
            pool: nomPool,
            saison: saisonEffective,
            semaine,
            mode,
            semainesFinalisees: toutes,
            revision: semaine.revision,
            statut: 'final'
        });
        charge.scoringVersion = scoring.VERSION_BAREME;
        charge.corrige = semaine.revision > 1;

        const ecrit = await db.upsertRecap({
            poolId: enveloppe.id,
            season: saisonEffective,
            weekNumber: Number(numero),
            resultRevision: semaine.revision,
            poolMode: mode,
            payload: charge
        });

        if (diffusion) {
            diffusion.versPool(nomPool, 'recapDisponible', {
                poolName: nomPool, weekNumber: Number(numero), revision: semaine.revision
            });
        }

        logger.log?.(`📝 Récap ${nomPool} semaine ${numero} (révision ${semaine.revision})`);
        return { ...ecrit, payload: charge };
    }

    /**
     * Rattrape les récaps manquants ou périmés d'un pool.
     *
     * « Périmé » veut dire : le récap existe, mais une révision de résultat plus
     * récente est arrivée depuis. Sa régénération est ce qui fait qu'une
     * correction officielle se voit au lieu de rester enfouie.
     */
    async function rattraperPool(nomPool, { maxSemaines = 6, saison = null } = {}) {
        if (!usePostgres) return [];

        const enveloppe = await store.lire(nomPool);
        if (!enveloppe || enveloppe.data.poolMode !== 'head-to-head') return [];

        const saisonEffective = saison || (enveloppe.data.h2hData && enveloppe.data.h2hData.season) || saisonCourante();
        const toutes = await semainesFinalisees(enveloppe.id, saisonEffective);

        const faits = [];
        for (const semaine of toutes.slice(0, maxSemaines)) {
            const existant = await db.getRecap(enveloppe.id, saisonEffective, semaine.weekNumber);
            const aJour = existant && Number(existant.result_revision) === semaine.revision;
            if (aJour) continue;
            try {
                await genererSemaine(nomPool, semaine.weekNumber, { saison: saisonEffective });
                faits.push(semaine.weekNumber);
            } catch (erreur) {
                logger.error?.(`Récap impossible pour ${nomPool} semaine ${semaine.weekNumber} :`, erreur.message);
            }
        }
        return faits;
    }

    /** Rattrape tous les pools tête-à-tête. Borné, comme la finalisation. */
    async function rattraperTout({ maxSemainesParPool = 4 } = {}) {
        if (!usePostgres) return 0;
        const pools = await store.lireTous();
        let total = 0;
        for (const [nom, enveloppe] of Object.entries(pools)) {
            if (enveloppe.data.poolMode !== 'head-to-head' || !enveloppe.data.h2hData) continue;
            try {
                const faits = await rattraperPool(nom, { maxSemaines: maxSemainesParPool });
                total += faits.length;
            } catch (erreur) {
                logger.error?.(`Rattrapage de récap impossible pour ${nom} :`, erreur.message);
            }
        }
        return total;
    }

    async function lire(nomPool, numero, { saison = null } = {}) {
        if (!usePostgres) return null;
        const enveloppe = await store.lire(nomPool);
        if (!enveloppe) return null;
        const saisonEffective = saison || (enveloppe.data.h2hData && enveloppe.data.h2hData.season) || saisonCourante();
        return numero
            ? db.getRecap(enveloppe.id, saisonEffective, Number(numero))
            : db.getLatestRecap(enveloppe.id, saisonEffective);
    }

    return {
        genererSemaine, rattraperPool, rattraperTout, lire, semainesFinalisees,
        // Les recaps derivent de resultats figes, qui vivent dans une table
        // PostgreSQL. En mode fichier l'ensemble n'existe pas, et il vaut
        // mieux le dire que renvoyer « aucune semaine finalisee » — ce serait
        // vrai mais trompeur, puisqu'aucune ne le sera jamais ici.
        disponible: () => !!usePostgres
    };
}

module.exports = { creerServiceRecap };
