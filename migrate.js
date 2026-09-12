#!/usr/bin/env node
/**
 * Applique les migrations en attente.
 *
 *   npm run migrate                  applique ce qui manque
 *   npm run migrate -- --etat        montre l'état sans rien écrire
 *
 * Le serveur applique déjà les migrations au démarrage ; cette commande sert à
 * les appliquer AVANT un déploiement, ce qui est l'ordre recommandé : un schéma
 * additif posé d'abord, des lecteurs compatibles ensuite, et seulement après
 * les nouveaux écrivains (voir FANTAZY_EVOLUTION_PLAN, section 10).
 *
 * Rejouer la commande est sans effet. En revanche, une migration réécrite après
 * avoir été appliquée, ou disparue du dépôt, arrête tout : c'est précisément le
 * moment où deux déploiements commencent à diverger en silence.
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const migrations = require('./lib/migrations.js');

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL absent : il n’y a pas de base à migrer.');
        process.exit(1);
    }

    const db = require('./db.js');
    const dossier = path.join(__dirname, 'migrations');
    const etatSeulement = process.argv.includes('--etat');

    try {
        if (etatSeulement) {
            const fichiers = fs.readdirSync(dossier).filter(f => migrations.MOTIF_NOM.test(f));
            const surDisque = migrations.ordonner(
                fichiers.map(f => ({ fichier: f, sql: fs.readFileSync(path.join(dossier, f), 'utf-8') }))
            );

            let appliquees = [];
            try {
                const r = await db.query('SELECT numero, fichier, empreinte FROM schema_migrations ORDER BY numero');
                appliquees = r.rows;
            } catch {
                console.log('ℹ️  Aucun registre : la base n’a jamais été migrée.');
            }

            const { aAppliquer, derives } = migrations.planifier(surDisque, appliquees);

            console.log(`\n${surDisque.length} migration(s) au dépôt, ${appliquees.length} appliquée(s).`);
            if (aAppliquer.length > 0) {
                console.log('\nEn attente :');
                aAppliquer.forEach(m => console.log(`  · ${m.fichier}`));
            } else {
                console.log('\nRien en attente.');
            }
            if (derives.length > 0) {
                console.log('\n⚠️  Dérive :');
                derives.forEach(d => console.log(`  · ${d.message}`));
                process.exit(2);
            }
            process.exit(0);
        }

        const resultat = await db.runMigrations({ dossier });
        console.log(resultat.appliquees.length > 0
            ? `\n✅ ${resultat.appliquees.length} migration(s) appliquée(s).`
            : '\n✅ Schéma déjà à jour.');
        process.exit(0);
    } catch (erreur) {
        console.error('\n❌', erreur.message);
        process.exit(1);
    }
}

main();
