/**
 * Vérification des images téléversées — photos de profil et vignettes de pool.
 *
 * Deux contrôles, dans cet ordre :
 *
 *   1. Le fichier est-il vraiment une image ? multer ne lit que le type
 *      annoncé par le navigateur ; on vérifie ici la signature du fichier
 *      (JPEG, PNG, WebP). Un faux « .png » est refusé, avec ou sans clé.
 *
 *   2. Le contenu est-il acceptable ? Claude regarde l'image et répond par un
 *      verdict structuré (sortie JSON contrainte par schéma). Nudité, contenu
 *      sexuel, violence graphique, symboles haineux, drogue : refusé. Une
 *      photo, un logo, un dessin, un mème sans contenu choquant : accepté.
 *
 * Sans ANTHROPIC_API_KEY, ou si l'API est indisponible, le téléversement est
 * ACCEPTÉ et un avertissement est journalisé : c'est le choix retenu pour que
 * le développement local et une panne passagère ne bloquent pas les photos de
 * profil. Le contrôle 1 reste appliqué dans tous les cas.
 *
 * Seule l'image part chez le fournisseur — ni nom d'utilisateur, ni nom de
 * pool (voir la politique de confidentialité, section « Fournisseurs »).
 */

'use strict';

const fs = require('fs');

/** Modèle par défaut. Remplaçable par la variable d'environnement. */
const MODELE_PAR_DEFAUT = 'claude-opus-5';

/** Réponse attendue : un verdict, une catégorie, une raison courte. */
const SCHEMA_VERDICT = {
    type: 'object',
    properties: {
        verdict: { type: 'string', enum: ['accepter', 'refuser'] },
        categorie: {
            type: 'string',
            enum: ['aucune', 'nudite', 'sexuel', 'violence', 'haine', 'drogue', 'donnees_personnelles', 'autre']
        },
        raison: { type: 'string' }
    },
    required: ['verdict', 'categorie', 'raison'],
    additionalProperties: false
};

const CONSIGNE = `Tu vérifies une image téléversée sur Fantazy, un site gratuit de pools de hockey entre amis, fréquenté par des adolescents comme par des adultes. L'image sert de photo de profil ou de vignette de pool, visible par les autres membres.

Refuse l'image si elle contient :
- de la nudité ou du contenu sexuel, même suggéré ou dessiné ;
- de la violence graphique, du sang, des blessures, des armes pointées sur quelqu'un ;
- des symboles ou messages haineux, racistes, homophobes ou d'extrémisme ;
- de la drogue ou sa consommation ;
- des données personnelles lisibles d'un tiers (pièce d'identité, carte bancaire, adresse, numéro de téléphone).

Accepte tout le reste : photos de personnes habillées, selfies, animaux, logos d'équipe, dessins, mèmes et images humoristiques sans contenu choquant, paysages, captures d'écran de sport.

Réponds uniquement avec le JSON demandé. « raison » tient en une courte phrase en français.`;

/** Type réel d'après les premiers octets, ou null. */
function typeReel(tampon) {
    if (!tampon || tampon.length < 12) return null;
    if (tampon[0] === 0xFF && tampon[1] === 0xD8 && tampon[2] === 0xFF) return 'image/jpeg';
    if (tampon[0] === 0x89 && tampon[1] === 0x50 && tampon[2] === 0x4E && tampon[3] === 0x47 &&
        tampon[4] === 0x0D && tampon[5] === 0x0A && tampon[6] === 0x1A && tampon[7] === 0x0A) return 'image/png';
    if (tampon.toString('ascii', 0, 4) === 'RIFF' && tampon.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

const REFUS_CATEGORIE = {
    nudite: 'Cette image contient de la nudité.',
    sexuel: 'Cette image a un caractère sexuel.',
    violence: 'Cette image est violente.',
    haine: 'Cette image contient un symbole ou un message haineux.',
    drogue: 'Cette image montre de la drogue.',
    donnees_personnelles: 'Cette image montre des renseignements personnels.',
    autre: 'Cette image ne respecte pas les règles du site.'
};

function creerModerateur({
    apiKey = process.env.ANTHROPIC_API_KEY,
    modele = process.env.FANTAZY_MODERATION_MODEL || MODELE_PAR_DEFAUT,
    client = null,
    logger = console
} = {}) {
    let anthropic = client;
    if (!anthropic && apiKey) {
        const Anthropic = require('@anthropic-ai/sdk');
        const Client = Anthropic.default || Anthropic;
        // Une vérification ne doit pas faire attendre un téléversement une
        // minute : 30 s, une seule nouvelle tentative.
        anthropic = new Client({ apiKey, timeout: 30000, maxRetries: 1 });
    }

    let averti = false;
    function avertirUneFois(message) {
        if (averti) return;
        averti = true;
        logger.warn(`⚠️ Vérification des images : ${message}`);
    }

    /**
     * Vérifie une image. Ne lève jamais : renvoie
     *   { ok: true, verifiee: boolean }                     — acceptée
     *   { ok: false, code, message, categorie? }            — refusée
     */
    async function verifier({ tampon, chemin, mimetype } = {}) {
        let donnees = tampon;
        try {
            if (!donnees && chemin) donnees = await fs.promises.readFile(chemin);
        } catch (erreur) {
            return { ok: false, code: 400, message: "Impossible de lire l'image reçue." };
        }

        const type = typeReel(donnees);
        if (!type) {
            return { ok: false, code: 400, message: "Ce fichier n'est pas une image JPEG, PNG ou WebP valide." };
        }
        if (mimetype && mimetype !== type) {
            // Le navigateur a annoncé autre chose que ce que contient le fichier :
            // on se fie au contenu, c'est lui qui part à l'analyse.
            logger.warn?.(`ℹ️ Image annoncée ${mimetype}, contenu ${type}.`);
        }

        if (!anthropic) {
            avertirUneFois("ANTHROPIC_API_KEY absente — les images sont acceptées sans analyse du contenu.");
            return { ok: true, verifiee: false };
        }

        try {
            const reponse = await anthropic.beta.messages.create({
                model: modele,
                max_tokens: 4096,
                // Un refus de politique du modèle principal est rejoué côté
                // serveur sur le modèle recommandé pour cette catégorie.
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                output_config: {
                    effort: 'low',
                    format: { type: 'json_schema', schema: SCHEMA_VERDICT }
                },
                system: CONSIGNE,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: type, data: donnees.toString('base64') } },
                        { type: 'text', text: 'Voici l’image à vérifier.' }
                    ]
                }]
            });

            // Toute la chaîne a refusé de regarder l'image : on ne la publie pas.
            if (reponse.stop_reason === 'refusal') {
                logger.warn?.(`🚫 Image refusée (refus du modèle, catégorie ${reponse.stop_details?.category ?? 'inconnue'}).`);
                return { ok: false, code: 422, message: REFUS_CATEGORIE.autre, categorie: 'refus_modele' };
            }

            const texte = (reponse.content || []).find(b => b.type === 'text');
            if (reponse.stop_reason === 'max_tokens' || !texte) {
                logger.warn?.('⚠️ Vérification des images : réponse incomplète, image acceptée sans verdict.');
                return { ok: true, verifiee: false };
            }

            let verdict;
            try { verdict = JSON.parse(texte.text); }
            catch (e) {
                logger.warn?.('⚠️ Vérification des images : verdict illisible, image acceptée sans verdict.');
                return { ok: true, verifiee: false };
            }

            if (verdict.verdict === 'refuser') {
                logger.log?.(`🚫 Image refusée (${verdict.categorie}) : ${verdict.raison}`);
                return {
                    ok: false,
                    code: 422,
                    message: `${REFUS_CATEGORIE[verdict.categorie] || REFUS_CATEGORIE.autre} Choisissez-en une autre.`,
                    categorie: verdict.categorie
                };
            }
            return { ok: true, verifiee: true };
        } catch (erreur) {
            // Clé invalide, quota, réseau, panne : l'image passe, et on le dit
            // dans le journal — c'est le repli choisi pour ce service.
            const statut = erreur && erreur.status ? ` (HTTP ${erreur.status})` : '';
            logger.warn?.(`⚠️ Vérification des images indisponible${statut} : ${erreur && erreur.message}. Image acceptée sans analyse.`);
            return { ok: true, verifiee: false };
        }
    }

    return { verifier, actif: !!anthropic, modele };
}

module.exports = { creerModerateur, typeReel, SCHEMA_VERDICT };
