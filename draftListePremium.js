/**
 * Bascule Libres / Tous + liste des joueurs déjà pris.
 *
 * Règle de conception : même discipline que draftActifUI.js — aucune
 * logique de repêchage ici, uniquement de la lecture des variables déjà
 * globales de draftActif.js (fullPlayerData, goalieData, teamData,
 * draftData, getCurrentPlayerStats, getMatchingImage, getTeamLogoPath) et
 * un pilotage du <select> #availabilityFilter déjà existant — jamais de
 * réécriture de updateTable().
 *
 * #availabilityFilter portait déjà les valeurs "available"/"picked", mais
 * restait caché (voir son commentaire dans draftActif.html) : l'exposer
 * tel quel aurait laissé apparaître un bouton « Choisir » sur des joueurs
 * déjà pris, puisque la cellule Action de populateTable()/
 * populateGoalieTable() (draftActif.js) ne vérifie que isUserTurn() et
 * checkIfUserTeamIsDone(), jamais si CETTE ligne précise est déjà prise.
 * "Tous" affiche donc sa propre liste, en lecture seule, construite ici à
 * partir de draftData.picksHistory plutôt que de démasquer le tableau
 * existant.
 */

/* ============================================================
   1. BASCULE LIBRES / TOUS
   ============================================================ */
function initAvailabilityTabs() {
    const strip = document.getElementById('availabilityTabs');
    const select = document.getElementById('availabilityFilter');
    const vueLibres = document.getElementById('playerTableWrapper');
    const vueTous = document.getElementById('fzPickedListWrapper');
    if (!strip || !select || !vueLibres || !vueTous) return;

    const onglets = [
        { valeur: 'available', libelle: 'Libres' },
        { valeur: 'picked', libelle: 'Tous' }
    ];

    onglets.forEach(o => {
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'availability-tab';
        bouton.dataset.valeur = o.valeur;
        bouton.textContent = o.libelle;
        bouton.addEventListener('click', () => {
            if (select.value === o.valeur) return;
            select.value = o.valeur;
            // #availabilityFilter n'a pas de gestionnaire de "change" propre
            // (contrairement à #playerFilter) — il n'est lu qu'à l'intérieur
            // de updateTable(). On la rappelle donc directement ; l'événement
            // reste émis pour tout code qui l'écouterait plus tard.
            select.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof updateTable === 'function') updateTable();
        });
        strip.appendChild(bouton);
    });

    const refleter = () => {
        const surTous = select.value === 'picked';
        strip.querySelectorAll('.availability-tab').forEach(b => {
            b.classList.toggle('is-active', b.dataset.valeur === select.value);
        });
        vueLibres.hidden = surTous;
        vueTous.hidden = !surTous;
        if (surTous) fzRefreshPickedList();
    };
    select.addEventListener('change', refleter);
    refleter();
}

/* ============================================================
   2. LISTE "TOUS" — joueurs déjà repêchés, lecture seule
   ============================================================ */

/** Trouve la fiche d'un joueur déjà repêché dans les mêmes tableaux que
 *  le reste de la page (rien n'est recalculé ni inventé). */
function fzTrouverFichePick(pick) {
    const nom = pick.player;
    const skater = (typeof fullPlayerData !== 'undefined' ? fullPlayerData : []).find(j => j.skaterFullName === nom);
    if (skater) return { categorie: 'skater', data: skater };
    const goalie = (typeof goalieData !== 'undefined' ? goalieData : []).find(j => j.goalieFullName === nom);
    if (goalie) return { categorie: 'goalie', data: goalie };
    const equipe = (typeof teamData !== 'undefined' ? teamData : []).find(j => j.teamFullName === nom);
    if (equipe) return { categorie: 'team', data: equipe };
    return null;
}

function fzBuildPickedRow(pick, numeroChoix) {
    const fiche = fzTrouverFichePick(pick);
    if (!fiche) return null;
    const { categorie, data } = fiche;
    const nom = pick.player;

    const tr = document.createElement('tr');
    tr.className = 'fzd-picked-row';

    // Stats du jour : la photo, le logo ET le club servant à rapprocher le
    // joueur du rapport de blessures en sortent, la base statique en repli.
    const live = (categorie !== 'team' && typeof getCurrentPlayerStats === 'function')
        ? getCurrentPlayerStats(nom, data.playerId || null)
        : null;
    const teamAbbrev = (live && live.teamAbbrev) || data.teamAbbrevs;

    const tdPhoto = document.createElement('td');
    if (categorie !== 'team' && typeof getMatchingImage === 'function') {
        const photo = (live && live.headshot) || getMatchingImage(nom);
        const teamLogo = (live && live.teamAbbrev)
            ? `teams/${live.teamAbbrev}.png`
            : (typeof getTeamLogoPath === 'function' ? getTeamLogoPath(data.teamAbbrevs) : null);
        if (photo) {
            const wrap = document.createElement('div');
            wrap.className = 'player-photo';
            const img = document.createElement('img');
            img.className = 'face';
            img.src = photo;
            img.alt = nom;
            wrap.appendChild(img);
            if (teamLogo) {
                const logo = document.createElement('img');
                logo.className = 'logo';
                logo.src = teamLogo;
                logo.alt = '';
                wrap.appendChild(logo);
            }
            tdPhoto.appendChild(wrap);
        }
    }
    tr.appendChild(tdPhoto);

    const tdNom = document.createElement('td');
    tdNom.textContent = nom;
    // Pastille « indisponible » : une ancre que injuries.js remplit dès que
    // le rapport d'ESPN est arrivé. Sans le script, rien ne s'ajoute.
    if (categorie !== 'team' && typeof injuryBadgeHTML === 'function') {
        tdNom.insertAdjacentHTML('beforeend', injuryBadgeHTML(nom, teamAbbrev));
    }
    tr.appendChild(tdNom);

    const tdGP = document.createElement('td');
    tdGP.textContent = data.gamesPlayed ?? '–';
    tr.appendChild(tdGP);

    // G/A : n'ont de sens que pour les patineurs — un gardien affiche un
    // tiret plutôt qu'une valeur détournée (victoires/défaites) sous un
    // en-tête qui dirait autre chose.
    const tdG = document.createElement('td');
    tdG.textContent = categorie === 'skater' ? (data.goals ?? '–') : '–';
    tr.appendChild(tdG);

    const tdA = document.createElement('td');
    tdA.textContent = categorie === 'skater' ? (data.assists ?? '–') : '–';
    tr.appendChild(tdA);

    const tdPts = document.createElement('td');
    tdPts.className = 'points-column';
    tdPts.textContent = data.points ?? '–';
    tr.appendChild(tdPts);

    const tdStatut = document.createElement('td');
    tdStatut.className = 'fzd-status-cell';
    tdStatut.textContent = `${pick.team} · C${numeroChoix}`;
    tr.appendChild(tdStatut);

    return tr;
}

/** Rejouée par refreshDraftViews() (draftRefresh.js) après chaque rendu du
 *  tableau — ne reconstruit que si la vue "Tous" est bien celle affichée. */
function fzRefreshPickedList() {
    const wrapper = document.getElementById('fzPickedListWrapper');
    const corps = document.querySelector('#fzPickedList tbody');
    if (!wrapper || !corps || wrapper.hidden) return;

    const historique = (typeof draftData !== 'undefined' && draftData && draftData.picksHistory) || [];
    corps.innerHTML = '';

    if (!historique.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'no-picks';
        td.textContent = 'Aucun choix pour l\'instant.';
        tr.appendChild(td);
        corps.appendChild(tr);
        return;
    }

    const tri = typeof currentSortBy !== 'undefined' ? currentSortBy : 'points';
    const lignes = historique
        .map((pick, i) => ({ pick, numero: i + 1 }))
        .filter(({ pick }) => fzTrouverFichePick(pick))
        .sort((a, b) => {
            const fa = fzTrouverFichePick(a.pick).data, fb = fzTrouverFichePick(b.pick).data;
            return (fb[tri] || 0) - (fa[tri] || 0);
        });

    lignes.forEach(({ pick, numero }) => {
        const tr = fzBuildPickedRow(pick, numero);
        if (tr) corps.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initAvailabilityTabs();
});
