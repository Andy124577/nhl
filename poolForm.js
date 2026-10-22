/* ============================================================
   CRÉER UN POOL — habillage (maquette « Fantazy Créer »)
   ------------------------------------------------------------
   Rien ici n'envoie quoi que ce soit : createClan() (equipes.js) lit
   toujours les mêmes champs. On ne fait que les piloter :
   - les boutons − / + des quantités, bornés par min / max du champ ;
   - le maximum de participants, dont le <select> reste la source ;
   - l'interrupteur du mot de passe (éteint = champ vidé = pool ouvert) ;
   - le total « N choix / équipe » et le bouton du bas, qui dit ce qui
     manque tant que le pool et l'équipe n'ont pas de nom.
   ============================================================ */
(function () {
    'use strict';

    const POSITIONS = ['numOffensive', 'numDefensive', 'numGoalies', 'numRookies', 'numTeams'];
    const $id = id => document.getElementById(id);

    function borne(champ, valeur) {
        const min = Number(champ.min || 0);
        const max = Number(champ.max || 99);
        return Math.min(max, Math.max(min, Number.isFinite(valeur) ? valeur : min));
    }

    /** Les boutons − / + suivent la valeur : grisés aux bornes. */
    function majStepper(stepper) {
        const champ = stepper.querySelector('input');
        if (!champ) return;
        const v = parseInt(champ.value, 10);
        stepper.querySelector('[data-step="-1"]').disabled = !(v > Number(champ.min || 0));
        stepper.querySelector('[data-step="1"]').disabled = !(v < Number(champ.max || 99));
    }

    function majTotal() {
        const total = POSITIONS.reduce((s, id) => s + (parseInt(($id(id) || {}).value, 10) || 0), 0);
        const cible = $id('fzpTotal');
        if (cible) cible.textContent = `${total} choix / équipe`;
    }

    /** Participants : une barre par place possible, la sienne en premier. */
    function majParticipants() {
        const select = $id('maxPlayers');
        const stepper = document.querySelector('[data-select-stepper="maxPlayers"]');
        if (!select || !stepper) return;
        const options = Array.from(select.options).map(o => Number(o.value));
        const v = Number(select.value);
        stepper.querySelector('output').textContent = v;
        stepper.querySelector('[data-step="-1"]').disabled = v <= options[0];
        stepper.querySelector('[data-step="1"]').disabled = v >= options[options.length - 1];

        const barres = $id('fzpSeats');
        if (barres) {
            const total = options[options.length - 1];
            if (barres.children.length !== total) {
                barres.innerHTML = '<span></span>'.repeat(total);
            }
            Array.from(barres.children).forEach((b, i) => {
                b.className = i === 0 ? 'is-me' : i < v ? 'is-on' : '';
            });
        }
    }

    function majBouton() {
        const bouton = $id('fzpCreate');
        if (!bouton) return;
        const pret = !!(($id('clanName') || {}).value || '').trim() && !!(($id('teamName') || {}).value || '').trim();
        bouton.classList.toggle('is-ready', pret);
        bouton.querySelector('.fzp-cta-label').textContent = pret ? 'Créer le pool' : 'Nomme ton pool et ton équipe';
        bouton.querySelector('.fzp-cta-ico').innerHTML = pret
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    }

    function majMotDePasse(actif, focus) {
        const bouton = $id('fzpPwToggle');
        const zone = $id('fzpPwField');
        const champ = $id('poolPassword');
        if (!bouton || !zone || !champ) return;
        bouton.setAttribute('aria-pressed', String(actif));
        const texte = bouton.querySelector('.fzp-toggle-text');
        texte.textContent = actif ? texte.dataset.on : texte.dataset.off;
        zone.hidden = !actif;
        if (!actif) champ.value = '';
        else if (focus) champ.focus();
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.body.classList.contains('fz-pool-form') || !$id('clanName')) return;

        document.querySelectorAll('[data-stepper]').forEach(stepper => {
            const champ = stepper.querySelector('input');
            stepper.addEventListener('click', e => {
                const b = e.target.closest('[data-step]');
                if (!b || b.disabled) return;
                champ.value = borne(champ, (parseInt(champ.value, 10) || 0) + Number(b.dataset.step));
                champ.dispatchEvent(new Event('input', { bubbles: true }));
            });
            champ.addEventListener('input', () => { majStepper(stepper); majTotal(); });
            // Saisie au clavier : ramenée dans les bornes en quittant le champ.
            champ.addEventListener('change', () => {
                champ.value = borne(champ, parseInt(champ.value, 10));
                majStepper(stepper); majTotal();
            });
            majStepper(stepper);
        });

        const select = $id('maxPlayers');
        const stepperMax = document.querySelector('[data-select-stepper="maxPlayers"]');
        if (select && stepperMax) {
            stepperMax.addEventListener('click', e => {
                const b = e.target.closest('[data-step]');
                if (!b || b.disabled) return;
                const i = select.selectedIndex + Number(b.dataset.step);
                if (i < 0 || i >= select.options.length) return;
                select.selectedIndex = i;
                // updatePoolModeInfo (equipes.js) écoute ce « change ».
                select.dispatchEvent(new Event('change', { bubbles: true }));
                majParticipants();
            });
            select.addEventListener('change', majParticipants);
        }

        const pw = $id('fzpPwToggle');
        if (pw) {
            pw.addEventListener('click', () => majMotDePasse(pw.getAttribute('aria-pressed') !== 'true', true));
            // Un navigateur qui remet le champ rempli au retour arrière.
            majMotDePasse(!!$id('poolPassword').value, false);
        }

        ['clanName', 'teamName'].forEach(id => $id(id).addEventListener('input', majBouton));

        majTotal();
        majParticipants();
        majBouton();
    });
})();
