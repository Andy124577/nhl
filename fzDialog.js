/* ============================================================
   FENÊTRES DE DIALOGUE — en remplacement de alert/confirm/prompt
   ------------------------------------------------------------
   Une boîte native affiche « fantazy.ca indique » en titre, ignore le
   thème, et ne sait dire ni « réussi » ni « attention ». Tout le site
   passe désormais par ces fonctions, qui renvoient une promesse :

     fzAlert(message, type?)            -> se résout à la fermeture
     fzAlert({ title, message, type, note, confirmLabel, ... })
     fzConfirm({ title, message, confirmLabel, danger, ... })
                                        -> true si confirmé, sinon false
     fzCopy({ title, message, value })  -> lien à copier (remplace prompt)
     fzModal({ ... })                   -> la forme complète, voir ouvrir()
     fzNotice(title, bodyHTML, danger?) -> ancienne signature, gardée

   Types : success, error, warning, info, question, danger. Le type
   choisit l'icône et sa teinte ; `icon` en impose une autre.

   `message` est du texte (échappé ; une ligne vide sépare deux
   paragraphes). `bodyHTML` est du HTML de confiance, écrit par le code
   appelant — jamais une valeur venue d'un utilisateur ou du serveur sans
   passer par fzDialog.escape().

   Aucune dépendance, rien n'est créé au chargement : la fenêtre naît au
   premier appel. Les confirmations native étaient bloquantes ; celles-ci
   ne le sont pas — l'appelant doit les attendre (`await`).
   ============================================================ */
(function () {
    'use strict';

    const SVG = (corps, largeur) =>
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${largeur || 2.2}"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${corps}</svg>`;

    const ICONES = {
        check:    SVG('<path class="fzd-draw" pathLength="1" d="M20 6 9 17l-5-5"/>', 2.6),
        x:        SVG('<path d="M18 6 6 18M6 6l12 12"/>', 2.6),
        alert:    SVG('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
        info:     SVG('<path d="M12 11v6M12 7h.01"/>', 2.8),
        help:     SVG('<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>', 2.6),
        offline:  SVG('<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11.2a10 10 0 0 1 2.2 1.7M12 20h.01"/>'),
        trash:    SVG('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>'),
        lock:     SVG('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
        unlock:   SVG('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>'),
        link:     SVG('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
        download: SVG('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
        users:    SVG('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
        swap:     SVG('<path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>'),
        skip:     SVG('<path d="M5 4l10 8-10 8V4zM19 5v14"/>'),
        leave:    SVG('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
        refresh:  SVG('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
        calendar: SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
        user:     SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
        copy:     SVG('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
        close:    SVG('<path d="M18 6 6 18M6 6l12 12"/>', 2.2)
    };

    /** Icône et teinte par défaut de chaque type. */
    const TYPES = {
        success:  { icon: 'check', tone: 'success', title: 'C’est fait' },
        error:    { icon: 'x',     tone: 'error',   title: 'Une erreur est survenue' },
        warning:  { icon: 'alert', tone: 'warning', title: 'Attention' },
        info:     { icon: 'info',  tone: 'info',    title: 'Information' },
        question: { icon: 'help',  tone: 'info',    title: 'Confirmer' },
        danger:   { icon: 'alert', tone: 'danger',  title: 'Action définitive' }
    };

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    /** Texte brut -> paragraphes : ligne vide = nouveau paragraphe. */
    function texteEnHtml(texte) {
        return String(texte == null ? '' : texte).trim()
            .split(/\n\s*\n/)
            .map(bloc => `<p>${echapper(bloc).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    /** Les fenêtres ouvertes, la dernière au-dessus : seule elle écoute le clavier. */
    const pile = [];
    let numero = 0;

    function auDessus() { return pile[pile.length - 1] || null; }

    function focusables(racine) {
        return [...racine.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )].filter(el => el.offsetParent !== null || el === document.activeElement);
    }

    document.addEventListener('keydown', e => {
        const dessus = auDessus();
        if (!dessus) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (dessus.fermable) dessus.annuler();
            return;
        }
        if (e.key === 'Tab') {
            // Le focus reste dans la fenêtre : derrière, rien n'est cliquable.
            const liste = focusables(dessus.carte);
            if (!liste.length) { e.preventDefault(); return; }
            const premier = liste[0];
            const dernier = liste[liste.length - 1];
            if (!dessus.carte.contains(document.activeElement)) {
                e.preventDefault();
                premier.focus();
            } else if (e.shiftKey && document.activeElement === premier) {
                e.preventDefault();
                dernier.focus();
            } else if (!e.shiftKey && document.activeElement === dernier) {
                e.preventDefault();
                premier.focus();
            }
        }
    }, true);

    /**
     * La fenêtre, sous toutes ses formes.
     *
     * Options :
     *   title, message (texte), bodyHTML (HTML de confiance), note (texte
     *   ou { title, text, icon }), type, icon, confirmLabel, cancelLabel
     *   (null = pas de bouton Annuler), danger, align ('center' | 'start'),
     *   wide, dismissible (Échap, clic à côté, croix — vrai par défaut),
     *   password / confirmation (champ à remplir), copyValue (lien à
     *   copier), onSubmit(valeur) -> message d'erreur ou rien : la fenêtre
     *   reste ouverte tant qu'il y a une erreur.
     *
     * Résout : la valeur saisie si un champ est présent, sinon true ;
     * null si la fenêtre est fermée sans confirmer.
     */
    function ouvrir(options) {
        const opts = options || {};
        const typeNom = TYPES[opts.type] ? opts.type : (opts.danger ? 'danger' : (opts.cancelLabel === null ? 'info' : 'question'));
        const type = TYPES[typeNom];
        const icone = ICONES[opts.icon] || ICONES[type.icon];
        const danger = !!opts.danger || typeNom === 'danger';
        const champ = !!(opts.password || opts.confirmation);
        const annulerLibelle = opts.cancelLabel === undefined ? 'Annuler' : opts.cancelLabel;
        const confirmerLibelle = opts.confirmLabel || (annulerLibelle ? 'Confirmer' : 'OK');
        const fermable = opts.dismissible !== false;
        const id = `fzd-${++numero}`;

        const note = opts.note
            ? (typeof opts.note === 'string' ? { text: opts.note } : opts.note)
            : null;

        const corps = [
            opts.bodyHTML || (opts.message != null ? texteEnHtml(opts.message) : ''),
            note ? `
                <div class="fzd-note">
                    <span class="fzd-note-icon">${ICONES[note.icon] || ICONES.info}</span>
                    <span>
                        ${note.title ? `<strong class="fzd-note-title">${echapper(note.title)}</strong>` : ''}
                        ${echapper(note.text || '')}
                    </span>
                </div>` : '',
            opts.password ? `
                <input type="password" class="fzd-input" autocomplete="current-password"
                       placeholder="Votre mot de passe" aria-label="Mot de passe">` : '',
            opts.confirmation ? `
                <input type="text" class="fzd-input" autocomplete="off" autocapitalize="off"
                       spellcheck="false" placeholder="Votre nom d’utilisateur" aria-label="Nom d’utilisateur">` : '',
            opts.copyValue != null ? `
                <div class="fzd-copy">
                    <input type="text" class="fzd-input" readonly value="${echapper(opts.copyValue)}"
                           aria-label="${echapper(opts.copyLabel || 'Lien')}">
                    <button type="button" class="fzd-copy-btn" data-fzd="copy">${ICONES.copy}<span>Copier</span></button>
                </div>` : '',
            champ ? '<div class="fzd-error" aria-live="polite"></div>' : ''
        ].join('');

        const overlay = document.createElement('div');
        overlay.className = 'fzd-overlay';
        overlay.dataset.tone = type.tone;
        overlay.innerHTML = `
            <div class="fzd-card${opts.align === 'start' ? ' is-start' : ''}${opts.wide ? ' is-wide' : ''}"
                 role="${danger || typeNom === 'error' || typeNom === 'warning' ? 'alertdialog' : 'dialog'}"
                 aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-b">
                ${fermable ? `<button type="button" class="fzd-close" data-fzd="cancel" aria-label="Fermer">${ICONES.close}</button>` : ''}
                <div class="fzd-head">
                    <div class="fzd-icon" aria-hidden="true">${icone}</div>
                    <h2 class="fzd-title" id="${id}-t">${echapper(opts.title || type.title)}</h2>
                </div>
                <div class="fzd-body" id="${id}-b">${corps}</div>
                <div class="fzd-actions">
                    ${annulerLibelle ? `<button type="button" class="fzd-btn fzd-btn--ghost" data-fzd="cancel">${echapper(annulerLibelle)}</button>` : ''}
                    <button type="button" class="fzd-btn ${danger ? 'fzd-btn--danger' : 'fzd-btn--primary'}" data-fzd="ok">${echapper(confirmerLibelle)}</button>
                </div>
            </div>`;

        return new Promise(resolve => {
            const avant = document.activeElement;
            const carte = overlay.querySelector('.fzd-card');
            const ok = overlay.querySelector('[data-fzd="ok"]');
            const saisie = champ ? overlay.querySelector('.fzd-input') : null;
            const erreur = overlay.querySelector('.fzd-error');
            let terminee = false;

            const entree = { carte, fermable, annuler: () => fermer(null) };
            pile.push(entree);
            if (pile.length === 1) document.documentElement.classList.add('fzd-lock');
            document.body.appendChild(overlay);

            function fermer(valeur) {
                if (terminee) return;
                terminee = true;
                const i = pile.indexOf(entree);
                if (i >= 0) pile.splice(i, 1);
                if (!pile.length) document.documentElement.classList.remove('fzd-lock');

                overlay.classList.add('is-leaving');
                let retire = false;
                const retirer = () => { if (!retire) { retire = true; overlay.remove(); } };
                overlay.addEventListener('animationend', e => { if (e.target === overlay) retirer(); });
                setTimeout(retirer, 220);   // mouvement réduit : pas d'animationend

                if (avant && typeof avant.focus === 'function' && document.contains(avant)) {
                    avant.focus({ preventScroll: true });
                }
                resolve(valeur);
            }

            async function soumettre() {
                if (terminee || ok.disabled) return;
                const valeur = champ ? (saisie.value || '') : true;
                if (champ && !valeur) {
                    erreur.textContent = opts.password
                        ? 'Veuillez saisir votre mot de passe.'
                        : 'Veuillez saisir votre nom d’utilisateur.';
                    saisie.focus();
                    return;
                }
                if (!opts.onSubmit) { fermer(valeur); return; }

                const libelle = ok.innerHTML;
                ok.disabled = true;
                ok.innerHTML = '<span class="fzd-spinner" aria-hidden="true"></span> Un instant…';
                let probleme = null;
                try { probleme = await opts.onSubmit(valeur); }
                catch (e) { probleme = (e && e.message) || 'Une erreur est survenue.'; }
                ok.disabled = false;
                ok.innerHTML = libelle;

                if (probleme) {
                    if (erreur) erreur.textContent = probleme;
                    if (saisie) { saisie.value = ''; saisie.focus(); }
                    return;
                }
                fermer(valeur);
            }

            async function copier(bouton) {
                const lien = overlay.querySelector('.fzd-copy .fzd-input');
                let reussi = false;
                try {
                    await navigator.clipboard.writeText(opts.copyValue);
                    reussi = true;
                } catch {
                    // Contexte non sécurisé ou permission refusée : l'ancienne
                    // commande marche encore sur une sélection.
                    lien.focus();
                    lien.select();
                    try { reussi = document.execCommand('copy'); } catch { reussi = false; }
                }
                const texte = bouton.querySelector('span');
                if (reussi) {
                    bouton.classList.add('is-done');
                    bouton.innerHTML = `${ICONES.check.replace('class="fzd-draw" ', '')}<span>Copié !</span>`;
                } else if (texte) {
                    lien.select();
                    texte.textContent = 'Ctrl+C';
                }
            }

            overlay.addEventListener('click', e => {
                if (e.target === overlay) { if (fermable) fermer(null); return; }
                const bouton = e.target.closest('[data-fzd]');
                if (!bouton) return;
                if (bouton.dataset.fzd === 'cancel') fermer(null);
                else if (bouton.dataset.fzd === 'ok') soumettre();
                else if (bouton.dataset.fzd === 'copy') copier(bouton);
            });

            if (saisie) {
                saisie.addEventListener('keydown', e => {
                    if (e.key === 'Enter') { e.preventDefault(); soumettre(); }
                });
            }

            // Premier focus : le champ à remplir ; sinon, pour une action
            // destructive, « Annuler » — un Entrée réflexe ne doit rien détruire.
            const lienACopier = overlay.querySelector('.fzd-copy .fzd-input');
            const annuler = overlay.querySelector('.fzd-actions [data-fzd="cancel"]');
            const cible = saisie || (danger && annuler) || ok;
            requestAnimationFrame(() => {
                cible.focus({ preventScroll: true });
                if (lienACopier) lienACopier.select();
            });
        });
    }

    /** Normalise (message, type|options) ou ({...}) en options. */
    function options(message, extra) {
        if (message && typeof message === 'object') return { ...message };
        const base = typeof extra === 'string' ? { type: extra } : { ...(extra || {}) };
        return { ...base, message };
    }

    function fzAlert(message, extra) {
        const opts = options(message, extra);
        return ouvrir({
            type: 'info',
            ...opts,
            confirmLabel: opts.confirmLabel || 'OK',
            cancelLabel: null
        }).then(() => undefined);
    }

    function fzConfirm(message, extra) {
        const opts = options(message, extra);
        return ouvrir({
            type: opts.danger ? 'danger' : 'question',
            confirmLabel: 'Confirmer',
            cancelLabel: 'Annuler',
            ...opts
        }).then(valeur => valeur === true);
    }

    function fzCopy(opts) {
        const o = opts || {};
        return ouvrir({
            type: 'info',
            icon: 'link',
            confirmLabel: 'Terminé',
            ...o,
            copyValue: String(o.value == null ? '' : o.value),
            cancelLabel: null
        }).then(() => undefined);
    }

    /** Ancienne signature de navbar.js : un titre, du HTML, un bouton. */
    function fzNotice(title, bodyHTML, danger = false) {
        return ouvrir({
            title, bodyHTML,
            type: danger ? 'error' : 'info',
            confirmLabel: 'OK',
            cancelLabel: null
        });
    }

    window.fzModal = ouvrir;
    window.fzAlert = fzAlert;
    window.fzConfirm = fzConfirm;
    window.fzCopy = fzCopy;
    window.fzNotice = fzNotice;
    window.fzDialog = { open: ouvrir, alert: fzAlert, confirm: fzConfirm, copy: fzCopy, escape: echapper };
})();
