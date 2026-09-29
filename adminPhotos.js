/* ============================================================
   PHOTOS TÉLÉVERSÉES — l'écran de vérification de l'administration
   ------------------------------------------------------------
   Chargé par navbar.js au premier clic sur « Photos téléversées » :
   seule l'administration en a besoin, aucune autre page ne le télécharge.

   Montre chaque photo en ligne (profil ou pool), qui l'a téléversée,
   quand, et si l'analyse automatique l'a vue (routes/photos.js).
   « Retirer » supprime la photo ; l'image par défaut la remplace.

   Tout ce qui vient du serveur passe par fzDialog.escape() avant
   d'entrer dans le HTML : noms de compte et de pool sont choisis par
   les membres.
   ============================================================ */
(function () {
    'use strict';

    const base = () => (window.location.hostname.includes('localhost') ? 'http://localhost:3000' : window.location.origin);
    const e = (texte) => window.fzDialog.escape(texte);

    const ETATS = {
        oui: { classe: 'is-ok', libelle: 'Vue par l’analyse' },
        non: { classe: 'is-non', libelle: 'Non vérifiée' },
        inconnu: { classe: 'is-inconnu', libelle: 'Avant le suivi' }
    };

    const etatDe = (photo) => (photo.verifiee === true ? ETATS.oui : (photo.verifiee === false ? ETATS.non : ETATS.inconnu));

    function dateLisible(iso) {
        if (!iso) return 'Date inconnue';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'Date inconnue';
        return d.toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function resume(photos) {
        const nonVues = photos.filter(p => p.verifiee !== true).length;
        const absentes = photos.filter(p => !p.fichierPresent).length;
        const morceaux = [`${photos.length} photo${photos.length > 1 ? 's' : ''}`];
        if (nonVues) morceaux.push(`${nonVues} non vue${nonVues > 1 ? 's' : ''} par l’analyse`);
        if (absentes) morceaux.push(`${absentes} fichier${absentes > 1 ? 's' : ''} introuvable${absentes > 1 ? 's' : ''}`);
        return morceaux.join(' · ');
    }

    function carte(photo, index) {
        const etat = etatDe(photo);
        const titre = photo.type === 'avatar' ? photo.username : `Pool « ${photo.pool} »`;
        // Une photo de profil est posée par son titulaire : le nom est déjà le titre.
        const auteur = photo.type === 'avatar'
            ? ''
            : (photo.par ? `par ${e(photo.par)} · ` : (photo.username ? `pool de ${e(photo.username)} · ` : ''));
        const vignette = photo.fichierPresent
            ? `<a class="fzap-vignette" href="${e(photo.url)}" target="_blank" rel="noopener" title="Ouvrir en grand">
                   <img src="${e(photo.url)}" alt="" loading="lazy" decoding="async">
               </a>`
            : `<div class="fzap-vignette is-absente">Fichier introuvable</div>`;

        return `
            <li class="fzap-carte" data-index="${index}">
                ${vignette}
                <div class="fzap-infos">
                    <span class="fzap-type">${photo.type === 'avatar' ? 'Photo de profil' : 'Image de pool'}</span>
                    <strong class="fzap-nom" title="${e(titre)}">${e(titre)}</strong>
                    <span class="fzap-meta">${auteur}${e(dateLisible(photo.le))}</span>
                    <span class="fzap-etat ${etat.classe}">${etat.libelle}</span>
                </div>
                <button type="button" class="fzap-retirer" data-index="${index}">Retirer</button>
            </li>`;
    }

    function corps(donnees) {
        const photos = donnees.photos || [];
        const alerte = donnees.analyseActive ? '' : `
            <div class="fzap-alerte" role="note">
                L’analyse automatique est désactivée sur le serveur (clé ANTHROPIC_API_KEY absente) :
                chaque nouvelle photo est publiée sans avoir été vue.
            </div>`;
        if (!photos.length) {
            return `<div class="fzap">${alerte}<p class="fzap-vide">Aucune photo téléversée pour l’instant.</p></div>`;
        }
        return `
            <div class="fzap">
                ${alerte}
                <p class="fzap-resume" aria-live="polite">${e(resume(photos))}</p>
                <ul class="fzap-grille">${photos.map(carte).join('')}</ul>
            </div>`;
    }

    async function retirer(photo, element, photos, racine) {
        const qui = photo.type === 'avatar'
            ? `La photo de profil de ${photo.username} sera supprimée. L’image par défaut la remplacera partout.`
            : `L’image du pool « ${photo.pool} » sera supprimée. L’image par défaut la remplacera.`;
        const confirme = await fzConfirm({
            title: 'Retirer cette photo ?',
            message: qui,
            confirmLabel: 'Retirer',
            danger: true
        });
        if (!confirme) return;

        const bouton = element.querySelector('.fzap-retirer');
        bouton.disabled = true;
        try {
            const r = await fetch(`${base()}/admin/photos/retirer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: photo.type, url: photo.url, username: photo.username, pool: photo.pool })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                bouton.disabled = false;
                fzAlert({ type: 'error', title: 'Photo non retirée', message: d.message || 'Le retrait a échoué.' });
                return;
            }
            photos.splice(photos.indexOf(photo), 1);
            element.classList.add('is-retiree');
            setTimeout(() => {
                element.remove();
                const ligne = racine.querySelector('.fzap-resume');
                if (ligne) ligne.textContent = resume(photos);
                if (!photos.length) {
                    racine.querySelector('.fzap-grille')?.remove();
                    ligne?.insertAdjacentHTML('afterend', '<p class="fzap-vide">Aucune photo téléversée pour l’instant.</p>');
                    ligne?.remove();
                }
            }, 180);
        } catch {
            bouton.disabled = false;
            fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
        }
    }

    async function ouvrir() {
        let donnees;
        try {
            const r = await fetch(`${base()}/admin/photos`);
            donnees = await r.json().catch(() => ({}));
            if (!r.ok) {
                fzAlert({ type: 'error', title: 'Photos indisponibles', message: donnees.message || 'La liste des photos n’a pas pu être chargée.' });
                return;
            }
        } catch {
            fzAlert({ type: 'error', icon: 'offline', title: 'Connexion impossible', message: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' });
            return;
        }

        const photos = (donnees.photos || []).slice();
        fzModal({
            title: 'Photos téléversées',
            type: 'info',
            icon: 'users',
            align: 'start',
            wide: true,
            bodyHTML: corps({ ...donnees, photos }),
            confirmLabel: 'Fermer',
            cancelLabel: null
        });

        // La fenêtre est dans la page dès l'appel : on branche ses boutons.
        const racines = document.querySelectorAll('.fzap');
        const racine = racines[racines.length - 1];
        if (!racine) return;

        const cartes = new Map();
        racine.querySelectorAll('.fzap-carte').forEach(li => cartes.set(li, photos[Number(li.dataset.index)]));

        racine.addEventListener('click', (evt) => {
            const bouton = evt.target.closest('.fzap-retirer');
            if (!bouton || bouton.disabled) return;
            const li = bouton.closest('.fzap-carte');
            const photo = cartes.get(li);
            if (photo) retirer(photo, li, photos, racine);
        });

        // Présent sur le disque mais illisible par le navigateur : on le dit.
        racine.addEventListener('error', (evt) => {
            const img = evt.target;
            if (!(img instanceof HTMLImageElement)) return;
            const lien = img.closest('.fzap-vignette');
            if (!lien) return;
            const remplacement = document.createElement('div');
            remplacement.className = 'fzap-vignette is-absente';
            remplacement.textContent = 'Image illisible';
            lien.replaceWith(remplacement);
        }, true);
    }

    window.fzAdminPhotos = { ouvrir };
})();
