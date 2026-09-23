'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { creerModerateur, typeReel } = require('../../services/moderationImage.js');

const silencieux = { log() {}, warn() {}, error() {} };

/** Un vrai en-tête PNG, suivi de quelques octets. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(16)]);
const FAUX = Buffer.from('<html>pas une image</html>');

function fauxClient(reponse) {
    const appels = [];
    return {
        appels,
        beta: { messages: { create: async (params) => { appels.push(params); if (reponse instanceof Error) throw reponse; return reponse; } } }
    };
}
const verdict = (v) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(v) }] });

test('la signature du fichier décide du type, pas ce que le navigateur annonce', () => {
    assert.equal(typeReel(PNG), 'image/png');
    assert.equal(typeReel(JPEG), 'image/jpeg');
    assert.equal(typeReel(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
    assert.equal(typeReel(FAUX), null);
});

test('un faux fichier image est refusé, même sans clé', async () => {
    const m = creerModerateur({ apiKey: null, logger: silencieux });
    const r = await m.verifier({ tampon: FAUX, mimetype: 'image/png' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 400);
});

test('sans clé, une vraie image passe sans analyse', async () => {
    const m = creerModerateur({ apiKey: null, logger: silencieux });
    assert.deepEqual(await m.verifier({ tampon: PNG }), { ok: true, verifiee: false });
});

test('un verdict « refuser » bloque l’image et dit pourquoi', async () => {
    const client = fauxClient(verdict({ verdict: 'refuser', categorie: 'nudite', raison: 'Nudité.' }));
    const m = creerModerateur({ client, logger: silencieux });
    const r = await m.verifier({ tampon: JPEG, mimetype: 'image/jpeg' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 422);
    assert.match(r.message, /nudité/i);

    // L'appel porte l'image, le schéma de sortie et le repli serveur ; aucune
    // donnée sur la personne qui téléverse.
    const params = client.appels[0];
    assert.equal(params.model, 'claude-opus-5');
    assert.equal(params.output_config.format.type, 'json_schema');
    assert.equal(params.fallbacks, 'default');
    assert.equal(params.messages[0].content[0].source.media_type, 'image/jpeg');
    assert.ok(!JSON.stringify(params).includes('alice'));
});

test('un verdict « accepter » laisse passer', async () => {
    const m = creerModerateur({ client: fauxClient(verdict({ verdict: 'accepter', categorie: 'aucune', raison: 'Logo.' })), logger: silencieux });
    assert.deepEqual(await m.verifier({ tampon: PNG }), { ok: true, verifiee: true });
});

test('un refus du modèle lui-même vaut refus de l’image', async () => {
    const m = creerModerateur({ client: fauxClient({ stop_reason: 'refusal', stop_details: { category: null }, content: [] }), logger: silencieux });
    const r = await m.verifier({ tampon: PNG });
    assert.equal(r.ok, false);
});

test('une panne de l’API laisse passer l’image (repli choisi)', async () => {
    const erreur = Object.assign(new Error('Service indisponible'), { status: 529 });
    const m = creerModerateur({ client: fauxClient(erreur), logger: silencieux });
    assert.deepEqual(await m.verifier({ tampon: PNG }), { ok: true, verifiee: false });
});
