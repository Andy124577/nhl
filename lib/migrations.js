/**
 * Registre de migrations — la partie qui décide, sans base ni disque.
 *
 * Le schéma vivait dans initializeDatabase(), réexécuté à chaque démarrage :
 * un CREATE TABLE IF NOT EXISTS ne dit pas si la table a la bonne forme, et
 * rien ne notait ce qui avait déjà été appliqué. Un registre répond aux trois
 * questions qui comptent : qu'est-ce qui reste à appliquer, est-ce que ce qui
 * a été appliqué correspond toujours au fichier, et est-ce qu'une migration a
 * disparu du dépôt.
 *
 * Ces trois réponses se testent sans Postgres (test/unit/migrations.test.js) ;
 * db.runMigrations() se contente de les exécuter.
 */

'use strict';

const crypto = require('crypto');

/** Nom attendu : `0007_recaps.sql`. Le numéro ordonne, le reste documente. */
const MOTIF_NOM = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function analyserNom(fichier) {
    const trouve = MOTIF_NOM.exec(fichier || '');
    if (!trouve) return null;
    return { numero: Number(trouve[1]), nom: trouve[2], fichier };
}

/** Empreinte du contenu, pour détecter un fichier modifié après coup. */
function empreinte(sql) {
    return crypto.createHash('sha256').update(sql == null ? '' : String(sql), 'utf8').digest('hex');
}

/**
 * Trie les migrations et refuse deux fois le même numéro.
 *
 * Deux fichiers `0005_` appliqués dans un ordre dépendant du système de
 * fichiers produiraient deux bases différentes à partir du même dépôt. Mieux
 * vaut refuser de démarrer.
 *
 * `entrees` : [{ fichier, sql }]
 */
function ordonner(entrees) {
    const analysees = [];
    for (const entree of entrees || []) {
        const meta = analyserNom(entree.fichier);
        if (!meta) continue; // fichier hors convention : ignoré, pas fatal
        analysees.push({ ...meta, sql: entree.sql, empreinte: empreinte(entree.sql) });
    }

    const vus = new Map();
    for (const m of analysees) {
        if (vus.has(m.numero)) {
            throw new Error(
                `Migrations en double pour le numéro ${String(m.numero).padStart(4, '0')} : ` +
                `${vus.get(m.numero)} et ${m.fichier}`
            );
        }
        vus.set(m.numero, m.fichier);
    }

    analysees.sort((a, b) => a.numero - b.numero);
    return analysees;
}

/**
 * Ce qu'il reste à faire, et ce qui cloche.
 *
 * `appliquees` : [{ numero, fichier, empreinte }] lues dans le registre.
 *
 * Renvoie `{ aAppliquer, derives }`. Une dérive n'est jamais réparée en
 * silence : une empreinte qui change veut dire qu'une migration déjà appliquée
 * a été réécrite, donc que la base et le dépôt ne racontent plus la même
 * histoire. L'appelant doit s'arrêter et le dire.
 */
function planifier(migrations, appliquees) {
    const parNumero = new Map((appliquees || []).map(a => [Number(a.numero), a]));
    const surDisque = new Set((migrations || []).map(m => m.numero));

    const aAppliquer = [];
    const derives = [];

    for (const migration of migrations || []) {
        const deja = parNumero.get(migration.numero);
        if (!deja) {
            aAppliquer.push(migration);
            continue;
        }
        if (deja.empreinte && deja.empreinte !== migration.empreinte) {
            derives.push({
                type: 'empreinte',
                numero: migration.numero,
                fichier: migration.fichier,
                message: `La migration ${migration.fichier} a été modifiée après avoir été appliquée.`
            });
        }
    }

    for (const deja of appliquees || []) {
        if (!surDisque.has(Number(deja.numero))) {
            derives.push({
                type: 'manquante',
                numero: Number(deja.numero),
                fichier: deja.fichier,
                message: `La migration ${deja.fichier} est enregistrée en base mais absente du dépôt.`
            });
        }
    }

    return { aAppliquer, derives };
}

module.exports = { MOTIF_NOM, analyserNom, empreinte, ordonner, planifier };
