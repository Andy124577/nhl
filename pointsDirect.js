/* ============================================================ */
/* POINTS EN DIRECT — les points du soir, ajoutés aux totaux    */
/* ------------------------------------------------------------ */
/* Les totaux de pool viennent de /current-stats et de          */
/* /current-teams, relevés une fois par jour, à minuit. Ce      */
/* module suit la salle `points` du serveur                     */
/* (services/pointsEnDirect.js) et tient ce que les matchs du   */
/* soir y ajoutent : un but, une aide, la victoire d'un gardien */
/* ou d'un club. Les pages l'appliquent à leurs lignes          */
/* (joueurs / clubs) et se redessinent à chaque changement      */
/* (surChangement).                                              */
/*                                                              */
/* Onglet caché : on se désabonne — le serveur cesse alors de   */
/* relever la LNH pour nous. Au retour, il renvoie l'état       */
/* complet. Sans socket : /live-points toutes les 30 s, onglet  */
/* visible seulement.                                            */
/*                                                              */
/* Le direct ne vaut que sur les relevés de minuit qu'il        */
/* complète (`releve`). Quand ils changent sous une page        */
/* ouverte, les pages relisent les leurs (surNouveauReleve)     */
/* avant que le nouveau direct ne s'applique.                   */
/*                                                              */
/* suivre() / arreter() se comptent : la fiche d'un joueur peut */
/* suivre le temps d'être ouverte sans couper la page.          */
/*                                                              */
/* Dépend de lib/pointsEnDirect.js (window.FZLive) et de         */
/* lib/scoring.js, chargés avant.                               */
/* ============================================================ */
(function () {
    const BASE = window.location.hostname.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;
    const SONDAGE_MS = 30000;

    let direct = null;
    let signature = '';
    const abonnes = [];
    const rechargeurs = [];     // pages : relire leurs relevés de minuit
    let releve = null;          // version des relevés que `direct` complète
    let rechargement = null;    // { releve, promesse } en cours
    let demandes = 0;           // suivre() moins arreter()
    let actif = false;          // abonné en ce moment (onglet visible)
    let socketBranche = false;
    let minuteur = null;

    /** Une relecture par nouvelle version, partagée par les envois qui l'attendent. */
    function rechargerReleves(cible) {
        if (!rechargement || rechargement.releve !== cible) {
            rechargement = {
                releve: cible,
                promesse: Promise.all(rechargeurs.map(rappel => Promise.resolve().then(rappel)
                    .catch(erreur => console.warn('Points en direct : relevés non relus', erreur))))
            };
        }
        return rechargement.promesse;
    }

    async function recevoir(charge) {
        if (!charge || typeof charge !== 'object' || !window.FZLive) return;
        const sig = FZLive.signature(charge);
        if (sig === signature) return;
        signature = sig;
        // Nouveaux relevés de minuit : la page relit les siens d'abord, sans
        // quoi les matchs que le relevé vient de prendre au direct
        // sortiraient de ses totaux.
        if (charge.releve && releve && charge.releve !== releve && rechargeurs.length) {
            await rechargerReleves(charge.releve);
            // Un envoi plus récent est arrivé pendant la relecture : c'est lui
            // qui s'applique.
            if (signature !== sig) return;
        }
        if (charge.releve) releve = charge.releve;
        direct = charge;
        abonnes.forEach(rappel => {
            try { rappel(direct); } catch (erreur) { console.warn('Points en direct :', erreur); }
        });
    }

    function socket() {
        return typeof window.fzSocketPartage === 'function' ? window.fzSocketPartage() : null;
    }

    async function sonder() {
        if (document.hidden) return;
        try {
            const reponse = await fetch(`${BASE}/live-points`, { cache: 'no-store' });
            if (reponse.ok) recevoir(await reponse.json());
        } catch { /* le prochain passage réessaiera */ }
    }

    function demarrerSondage() {
        if (minuteur) return;
        minuteur = setInterval(sonder, SONDAGE_MS);
        sonder();
    }

    function arreterSondage() {
        if (minuteur) { clearInterval(minuteur); minuteur = null; }
    }

    function brancher(s) {
        if (socketBranche) return;
        socketBranche = true;
        s.on('points:direct', charge => { if (actif) recevoir(charge); });
        // La salle ne survit pas à une reconnexion : on s'y réabonne, et le
        // sondage, qui couvrait la coupure, s'arrête.
        s.on('connect', () => {
            if (!actif) return;
            arreterSondage();
            s.emit('points:suivre');
        });
        s.on('disconnect', () => { if (actif) demarrerSondage(); });
    }

    function abonner() {
        if (actif || demandes === 0 || document.visibilityState !== 'visible') return;
        actif = true;
        const s = socket();
        if (!s) { demarrerSondage(); return; }
        brancher(s);
        if (s.connected) s.emit('points:suivre');
        else demarrerSondage();
    }

    function desabonner() {
        if (!actif) return;
        actif = false;
        arreterSondage();
        const s = socket();
        if (s && s.connected) s.emit('points:arreter');
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') abonner();
        else desabonner();
    });

    window.FZPointsDirect = {
        /** À appeler par une page qui affiche des totaux de pool. Un arreter() par suivre(). */
        suivre() { demandes += 1; abonner(); },
        arreter() {
            demandes = Math.max(0, demandes - 1);
            if (demandes === 0) desabonner();
        },
        /** Les lignes de /current-stats, avec les points du soir. */
        joueurs(lignes) {
            return direct && window.FZLive ? FZLive.appliquerAuxJoueurs(lignes, direct) : (lignes || []);
        },
        /** Les fiches de /current-teams, avec les matchs finis du soir. */
        clubs(fiches) {
            return direct && window.FZLive ? FZLive.appliquerAuxClubs(fiches, direct) : (fiches || []);
        },
        charge() { return direct; },
        surChangement(rappel) { if (typeof rappel === 'function') abonnes.push(rappel); },
        /**
         * `rappel` relit les relevés de minuit de la page (/current-stats,
         * /current-teams) quand le serveur en a de nouveaux. Il peut rendre
         * une promesse : le nouveau direct n'est appliqué qu'une fois relus.
         */
        surNouveauReleve(rappel) { if (typeof rappel === 'function') rechargeurs.push(rappel); }
    };
})();
