#!/usr/bin/env node
/**
 * Paquets de déploiement : moins de fichiers, plus légers, même code.
 *
 * Le site n'a pas d'étape de compilation : chaque page liste ses feuilles et
 * ses scripts un par un (l'accueil en charge 31 et 46). En développement,
 * c'est pratique ; pour le visiteur, ce sont autant de requêtes et 1,6 Mo
 * de texte non minifié avant le premier affichage.
 *
 * Ce script, lancé par Render au déploiement (`npm run build`), écrit dans
 * dist/ une copie de chaque page où :
 *   - les feuilles CSS consécutives deviennent un seul fichier minifié ;
 *   - les scripts `defer` deviennent quelques fichiers minifiés, dans le même
 *     ordre d'exécution.
 * Les fichiers sources ne changent pas, et le site marche sans dist/ : le
 * serveur ne sert dist/ qu'en production (ou avec FZ_PAQUETS=1).
 *
 * Partage entre pages : une suite de fichiers que plusieurs pages chargent
 * dans le même ordre (navbar, activePool…) donne le même paquet, nommé par
 * son contenu ; le navigateur le garde d'une page à l'autre. Un paquet ne
 * change de nom que si son contenu change : il est servi « immutable ».
 *
 * Prudence : ce qui changerait le comportement reste tel quel.
 *   - Un script qui lit `document.currentScript` (il en déduit l'adresse de
 *     sa feuille) garde sa propre balise, sans minification.
 *   - Deux fonctions de même nom au premier niveau dans deux fichiers : dans
 *     un seul fichier, la dernière remplacerait la première dès le début. Le
 *     paquet est coupé entre les deux.
 *   - Une feuille ne passe jamais par-dessus un <style>, une feuille
 *     extérieure ou la fin du <head> : l'ordre de la cascade est gardé.
 *   - Chaque paquet est relu par l'analyseur JavaScript ; s'il ne passe pas,
 *     la construction échoue au lieu de livrer une page cassée.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const acorn = require('acorn');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'dist');

/** Un fichier chargé par au moins ce nombre de pages est « commun ». */
const SEUIL_COMMUN = 3;

const empreinte = (texte) => crypto.createHash('sha256').update(texte).digest('hex').slice(0, 12);

// ─── Lecture des balises ─────────────────────────────────────────────────

function attributs(balise) {
    const attr = {};
    for (const m of balise.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        const nom = m[1].toLowerCase();
        if (nom === 'link' || nom === 'script') continue;
        attr[nom] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return attr;
}

/** Fichiers servis par un autre que la racine, et leur source sur le disque. */
const ALIAS = {
    // Le client que Socket.IO sert lui-même : même fichier, même version.
    '/socket.io/socket.io.min.js': 'node_modules/socket.io/client-dist/socket.io.min.js'
};

/**
 * Un fichier du dépôt, sans ?v= ; null sinon. Une feuille doit être à la
 * racine : ses url() relatives (Icons/…, teams/…) restent justes dans un
 * paquet posé à la racine. Un script peut venir d'un dossier (vendor/, lib/).
 */
function fichierLocal(url, genre = 'css') {
    if (!url) return null;
    const chemin = url.split('?')[0].split('#')[0];
    if (ALIAS[chemin]) return ALIAS[chemin];
    if (/^[a-z]+:|^\//i.test(chemin) || chemin.startsWith('.')) return null;
    if (genre === 'css' && chemin.includes('/')) return null;
    const complet = path.join(RACINE, chemin);
    return fs.existsSync(complet) ? chemin : null;
}

/**
 * Les éléments de la page qui comptent pour les paquets, dans l'ordre :
 * feuilles, scripts à src, <style>, fin du <head>. Ce qui est dans un
 * commentaire HTML est ignoré.
 */
function lireElements(html) {
    const commentaires = [...html.matchAll(/<!--[\s\S]*?-->/g)].map(m => [m.index, m.index + m[0].length]);
    const dansCommentaire = (i) => commentaires.some(([a, b]) => i >= a && i < b);
    const elements = [];
    const motif = /<link\b[^>]*>|<script\b[^>]*>\s*<\/script>|<style\b|<\/head>/gi;
    for (const m of html.matchAll(motif)) {
        if (dansCommentaire(m.index)) continue;
        const texte = m[0];
        const debut = m.index;
        const fin = m.index + texte.length;
        const bas = texte.toLowerCase();
        if (bas.startsWith('<style')) { elements.push({ genre: 'coupure', debut, fin: debut }); continue; }
        if (bas === '</head>') { elements.push({ genre: 'coupure', debut, fin: debut }); continue; }
        const attr = attributs(texte.slice(0, texte.indexOf('>') + 1));
        if (bas.startsWith('<link')) {
            if ((attr.rel || '').toLowerCase() !== 'stylesheet') continue;
            const fichier = fichierLocal(attr.href);
            const simple = Object.keys(attr).every(a => a === 'rel' || a === 'href');
            elements.push(fichier && simple
                ? { genre: 'css', fichier, debut, fin }
                : { genre: 'coupure', debut, fin: debut });
            continue;
        }
        // <script src=…></script>
        if (!('src' in attr)) continue;
        if (!('defer' in attr)) continue; // les scripts bloquants restent tels quels
        const fichier = fichierLocal(attr.src, 'js');
        const simple = Object.keys(attr).every(a => a === 'src' || a === 'defer');
        const lisible = fichier && fs.readFileSync(path.join(RACINE, fichier), 'utf8');
        const ok = fichier && simple && !/document\.currentScript/.test(lisible);
        elements.push(ok
            ? { genre: 'js', fichier, debut, fin }
            : { genre: 'js-fixe', debut, fin });
    }
    return elements;
}

// ─── Groupes ─────────────────────────────────────────────────────────────

/** Les feuilles consécutives (sans coupure entre elles). */
function groupesCss(elements) {
    const groupes = [];
    let courant = [];
    for (const el of elements) {
        if (el.genre === 'css') { courant.push(el); continue; }
        if (el.genre === 'coupure' && courant.length) { groupes.push(courant); courant = []; }
    }
    if (courant.length) groupes.push(courant);
    return groupes;
}

/** Les scripts defer entre deux scripts defer qu'on ne regroupe pas. */
function groupesJs(elements) {
    const groupes = [];
    let courant = [];
    for (const el of elements) {
        if (el.genre === 'js') { courant.push(el); continue; }
        if (el.genre === 'js-fixe' && courant.length) { groupes.push(courant); courant = []; }
    }
    if (courant.length) groupes.push(courant);
    return groupes;
}

/** Coupe un groupe là où la nature (commun / propre à la page) change. */
function decouperParPartage(groupe, communs) {
    const morceaux = [];
    for (const el of groupe) {
        const commun = communs.has(el.fichier);
        const dernier = morceaux[morceaux.length - 1];
        if (dernier && dernier.commun === commun) dernier.elements.push(el);
        else morceaux.push({ commun, elements: [el] });
    }
    return morceaux.map(m => m.elements);
}

// ─── Minification ────────────────────────────────────────────────────────

const minifies = new Map();

function minifier(fichier, loader) {
    if (minifies.has(fichier)) return minifies.get(fichier);
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    let code;
    try {
        code = esbuild.transformSync(source, { loader, minify: true, legalComments: 'inline', charset: 'utf8' }).code;
    } catch (erreur) {
        throw new Error(`${fichier} : minification impossible (${erreur.message.split('\n')[0]})`);
    }
    minifies.set(fichier, code);
    return code;
}

/** Noms des fonctions déclarées au premier niveau d'un script. */
const fonctionsDe = new Map();
function fonctionsPremierNiveau(fichier) {
    if (fonctionsDe.has(fichier)) return fonctionsDe.get(fichier);
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    const noms = new Set();
    for (const noeud of ast.body) {
        if (noeud.type === 'FunctionDeclaration' && noeud.id) noms.add(noeud.id.name);
    }
    fonctionsDe.set(fichier, noms);
    return noms;
}

/** Coupe une suite de scripts avant tout fichier qui redéclare une fonction. */
function couperDoublons(elements) {
    const parts = [];
    let courant = [];
    let noms = new Set();
    for (const el of elements) {
        const siens = fonctionsPremierNiveau(el.fichier);
        if ([...siens].some(n => noms.has(n))) {
            parts.push(courant);
            courant = [];
            noms = new Set();
        }
        courant.push(el);
        siens.forEach(n => noms.add(n));
    }
    if (courant.length) parts.push(courant);
    return parts;
}

// ─── Écriture ────────────────────────────────────────────────────────────

const paquetsEcrits = new Map(); // nom → fichiers

function ecrirePaquet(elements, genre) {
    const loader = genre === 'css' ? 'css' : 'js';
    let contenu;
    if (genre === 'css') {
        contenu = elements.map(el => `/* ${el.fichier} */\n${minifier(el.fichier, loader)}`).join('\n');
    } else {
        // Le « ; » de tête : aucun fichier ne commence le paquet par une
        // directive "use strict" qui s'étendrait à tous les autres.
        contenu = ';' + elements.map(el => `\n/* ${el.fichier} */\n${minifier(el.fichier, loader)}\n;`).join('');
        try {
            acorn.parse(contenu, { ecmaVersion: 'latest', sourceType: 'script' });
        } catch (erreur) {
            throw new Error(`paquet ${elements.map(e => e.fichier).join(', ')} : ${erreur.message}`);
        }
    }
    const nom = `paquet-${empreinte(contenu)}.${loader}`;
    if (!paquetsEcrits.has(nom)) {
        fs.writeFileSync(path.join(SORTIE, nom), contenu);
        paquetsEcrits.set(nom, elements.map(e => e.fichier));
    }
    return nom;
}

function construirePage(page, communsCss, communsJs) {
    const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
    const elements = lireElements(html);
    const remplacements = []; // { debut, fin, texte }

    for (const groupe of groupesCss(elements)) {
        for (const morceau of decouperParPartage(groupe, communsCss)) {
            const nom = ecrirePaquet(morceau, 'css');
            morceau.forEach((el, i) => remplacements.push({
                debut: el.debut, fin: el.fin,
                texte: i === 0 ? `<link rel="stylesheet" href="${nom}">` : ''
            }));
        }
    }

    for (const groupe of groupesJs(elements)) {
        for (const morceau of decouperParPartage(groupe, communsJs)) {
            for (const part of couperDoublons(morceau)) {
                const nom = ecrirePaquet(part, 'js');
                part.forEach((el, i) => remplacements.push({
                    debut: el.debut, fin: el.fin,
                    texte: i === 0 ? `<script defer src="${nom}"></script>` : ''
                }));
            }
        }
    }

    remplacements.sort((a, b) => b.debut - a.debut);
    let sortie = html;
    for (const r of remplacements) {
        sortie = sortie.slice(0, r.debut) + r.texte + sortie.slice(r.fin);
    }
    // Lignes devenues vides.
    sortie = sortie.replace(/\n[ \t]+\n/g, '\n');
    fs.writeFileSync(path.join(SORTIE, page), sortie);

    const avant = elements.filter(e => e.genre === 'css' || e.genre === 'js').length;
    const apres = remplacements.filter(r => r.texte).length;
    return { page, avant, apres };
}

function main() {
    fs.rmSync(SORTIE, { recursive: true, force: true });
    fs.mkdirSync(SORTIE, { recursive: true });

    const pages = fs.readdirSync(RACINE)
        .filter(n => n.endsWith('.html') && !n.includes('.preview.'))
        .sort();

    // Combien de pages chargent chaque fichier ?
    const comptesCss = new Map();
    const comptesJs = new Map();
    for (const page of pages) {
        const elements = lireElements(fs.readFileSync(path.join(RACINE, page), 'utf8'));
        for (const el of new Set(elements.filter(e => e.genre === 'css').map(e => e.fichier))) comptesCss.set(el, (comptesCss.get(el) || 0) + 1);
        for (const el of new Set(elements.filter(e => e.genre === 'js').map(e => e.fichier))) comptesJs.set(el, (comptesJs.get(el) || 0) + 1);
    }
    const communs = (comptes) => new Set([...comptes].filter(([, n]) => n >= SEUIL_COMMUN).map(([f]) => f));
    const communsCss = communs(comptesCss);
    const communsJs = communs(comptesJs);

    const bilans = pages.map(page => construirePage(page, communsCss, communsJs));

    let octetsSource = 0;
    for (const fichiers of paquetsEcrits.values()) {
        for (const f of fichiers) octetsSource += fs.statSync(path.join(RACINE, f)).size;
    }
    const octetsPaquets = [...paquetsEcrits.keys()].reduce((s, n) => s + fs.statSync(path.join(SORTIE, n)).size, 0);

    for (const b of bilans) console.log(`  ${b.page.padEnd(26)} ${String(b.avant).padStart(3)} fichiers → ${b.apres}`);
    console.log(`✅ ${paquetsEcrits.size} paquets dans dist/ (${Math.round(octetsPaquets / 1024)} Ko, sources ${Math.round(octetsSource / 1024)} Ko)`);
}

if (require.main === module) {
    try {
        main();
    } catch (erreur) {
        console.error(`❌ Construction impossible : ${erreur.message}`);
        process.exit(1);
    }
}

module.exports = { lireElements, groupesCss, groupesJs, decouperParPartage, couperDoublons, attributs, fichierLocal };
