/* ============================================================
   NAVIGATION DES POOLS — menu « Mes pools », rail et tiroir
   ------------------------------------------------------------
   Le choix du pool vivait auparavant sur chaque page : une liste sur
   Classement, une étape 1 sur Échange, un onglet sur Pools. Il vit
   désormais à un seul endroit, et le reste du site suit.

   Maquette « Fantazy Menu » :
     — Mes pools : le pool actif déplié (état, rang, Réglages, Équipes,
       Règles), puis jusqu'à trois autres, épinglés d'abord, récents
       ensuite ; « Tous mes pools » ouvre la liste complète, avec
       recherche, filtres et épingles.
     — Rejoindre (rouge) et Créer (bleu), comme l'accueil sans pool.
     — Naviguer : les pages du pool actif.
     — Le compte, en bas.

   Ordinateur : rail fixe à gauche, sous la barre du haut (Mes pools et
                les deux tuiles ; la barre du haut porte déjà les pages
                et le compte).
   Téléphone  : tiroir ouvert par le bouton ☰ de la barre du haut.

   Épingles et récents restent dans ce navigateur (localStorage) : rien
   n'est écrit en base. Le rang vient de l'accueil, qui le calcule déjà
   (memoriserRangsPools, accueil.js) ; ailleurs, on montre l'état du pool.
   ============================================================ */
(function () {
    const ICONES = {
        menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
        chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`
    };

    // Material Symbols Rounded (npm @material-symbols/svg-400), en ligne
    // comme la barre du bas : pas de police d'icônes à charger.
    const MS = {
        fermer: 'M480-438 270-228q-9 9-21 9t-21-9q-9-9-9-21t9-21l210-210-210-210q-9-9-9-21t9-21q9-9 21-9t21 9l210 210 210-210q9-9 21-9t21 9q9 9 9 21t-9 21L522-480l210 210q9 9 9 21t-9 21q-9 9-21 9t-21-9L480-438Z',
        actif: 'm421-389-98-98q-9-9-22-9t-23 10q-9 9-9 22t9 22l122 123q9 9 21 9t21-9l239-239q10-10 10-23t-10-23q-10-9-23.5-8.5T635-603L421-389Zm59 309q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Z',
        aller: 'M686-450H190q-13 0-21.5-8.5T160-480q0-13 8.5-21.5T190-510h496L459-737q-9-9-9-21t9-21q9-9 21-9t21 9l278 278q5 5 7 10t2 11q0 6-2 11t-7 10L501-181q-9 9-21 9t-21-9q-9-9-9-21t9-21l227-227Z',
        reglages: 'M421-80q-14 0-25-9t-13-23l-15-94q-19-7-40-19t-37-25l-86 40q-14 6-28 1.5T155-226L97-330q-8-13-4.5-27t15.5-23l80-59q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521l-80-59q-12-9-15.5-23t4.5-27l58-104q8-13 22-17.5t28 1.5l86 40q16-13 37-25t40-18l15-95q2-14 13-23t25-9h118q14 0 25 9t13 23l15 94q19 7 40.5 18.5T669-710l86-40q14-6 27.5-1.5T804-734l59 104q8 13 4.5 27.5T852-580l-80 57q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l80 58q12 8 15.5 22.5T863-330l-58 104q-8 13-22 17.5t-28-1.5l-86-40q-16 13-36.5 25.5T592-206l-15 94q-2 14-13 23t-25 9H421Zm15-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z',
        equipes: 'M30-240q-12.75 0-21.37-8.63Q0-257.25 0-270v-23q0-38.57 41.5-62.78Q83-380 150.38-380q12.16 0 23.39.5t22.23 2.15q-8 17.35-12 35.17-4 17.81-4 37.18v65H30Zm240 0q-12.75 0-21.37-8.63Q240-257.25 240-270v-35q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v35q0 12.75-8.62 21.37Q702.75-240 690-240H270Zm510 0v-65q0-19.86-3.5-37.43T765-377.27q11-1.73 22.17-2.23 11.17-.5 22.83-.5 67.5 0 108.75 23.77T960-293v23q0 12.75-8.62 21.37Q942.75-240 930-240H780Zm-480-60h360v-6q0-37-50.5-60.5T480-390q-79 0-129.5 23.5T300-305v5ZM149.57-410q-28.57 0-49.07-20.56Q80-451.13 80-480q0-29 20.56-49.5Q121.13-550 150-550q29 0 49.5 20.5t20.5 49.93q0 28.57-20.5 49.07T149.57-410Zm660 0q-28.57 0-49.07-20.56Q740-451.13 740-480q0-29 20.56-49.5Q781.13-550 810-550q29 0 49.5 20.5t20.5 49.93q0 28.57-20.5 49.07T809.57-410ZM480-480q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm.35-60Q506-540 523-557.35t17-43Q540-626 522.85-643t-42.5-17q-25.35 0-42.85 17.15t-17.5 42.5q0 25.35 17.35 42.85t43 17.5ZM480-300Zm0-300Z',
        regles: 'M190-180h420q13 0 21.5 8.5T640-150q0 13-8.5 21.5T610-120H190q-13 0-21.5-8.5T160-150q0-13 8.5-21.5T190-180Zm150-194L202-512q-17-17-17.5-41.5T201-596l29-30 224 222-30 30q-17 17-42 17t-42-17Zm296-212L414-810l30-29q18-17 42.5-16.5T528-838l138 138q17 17 17 42t-17 42l-30 30Zm181 405L302-696l42-42 515 515q9 9 9 21t-9 21q-9 9-21 9t-21-9Z',
        tous: 'M179-179q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19ZM179-433q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19ZM179-687q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Z',
        chevron: 'M530-481 353-658q-9-9-8.5-21t9.5-21q9-9 21.5-9t21.5 9l198 198q5 5 7 10t2 11q0 6-2 11t-7 10L396-261q-9 9-21 8.5t-21-9.5q-9-9-9-21.5t9-21.5l176-176Z',
        rejoindre: 'M511-120q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h269v-600H511q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h269q24 0 42 18t18 42v600q0 24-18 42t-42 18H511Zm-26-330H150q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h333l-81-81q-9-9-8.5-21t9.5-21q9-9 21.5-9t21.5 9l133 133q9 9 9 21t-9 21L447-326q-8.8 9-20.9 8.5-12.1-.5-21.49-9.5-8.61-9-8.61-21.5t9-21.5l80-80Z',
        creer: 'M450-450H230q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h220v-220q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v220h220q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H510v220q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-220Z',
        compte: 'M372-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42ZM160-220v-34q0-38 19-65t49-41q67-30 128.5-45T480-420q62 0 123 15.5T731-360q31 14 50 41t19 65v34q0 25-17.5 42.5T740-160H220q-25 0-42.5-17.5T160-220Z',
        chercher: 'M378-329q-108.16 0-183.08-75Q120-479 120-585t75-181q75-75 181.5-75t181 75Q632-691 632-584.85 632-542 618-502q-14 40-42 75l242 240q9 8.56 9 21.78T818-143q-9 9-22.22 9-13.22 0-21.78-9L533-384q-30 26-69.96 40.5Q423.08-329 378-329Zm-1-60q81.25 0 138.13-57.5Q572-504 572-585t-56.87-138.5Q458.25-781 377-781q-82.08 0-139.54 57.5Q180-666 180-585t57.46 138.5Q294.92-389 377-389Z',
        retour: 'm274-450 227 227q9 9 9 21t-9 21q-9 9-21 9t-21-9L181-459q-5-5-7-10t-2-11q0-6 2-11t7-10l278-278q9-9 21-9t21 9q9 9 9 21t-9 21L274-510h496q13 0 21.5 8.5T800-480q0 13-8.5 21.5T770-450H274Z',
        rien: 'm270-245 57 57q5 5 11.5 4.5T350-189q5-5 5-11.5t-5-11.5l-58-57 60-60q5-5 5-11.5t-5-11.5q-5-5-11.5-5t-11.5 5l-59 59-59-59q-5-5-11-5t-11 5q-5 5-5 11.5t5 11.5l58 59-58 58q-5 5-5 12t5 12q5 5 12 5t12-5l57-57ZM136-136q-56-56-56-134t56-134q56-56 134-56t134 56q56 56 56 134t-56 134q-56 56-134 56t-134-56Zm437-247q-14 11-31.5 21.5T508-344q-5-14-11-28.5T483-399q54-21 91.5-69.5T612-584q0-81-57-138.5T417-780q-82 0-139.5 57.5T220-584q0 17 3.5 35.5T232-517q-13 2-29 6.5T174-500q-7-18-10.5-40t-3.5-44q0-107 75-181.5T417-840q106 0 180.5 75T672-584q0 43-15 85t-41 73l242 240q9 9 9 22t-9 22q-9 9-22 9t-22-9L573-383Z',
        epingle: 'M634-780v332l77 68q5 5 7 10.6 2 5.59 2 11.56v17.16q0 12.68-8.62 21.18-8.63 8.5-21.38 8.5H510v236q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Q450-62.25 450-75v-236H270q-12.75 0-21.37-8.58-8.63-8.59-8.63-21.28v-17.17q0-5.97 2-11.47 2-5.5 7-10.5l71-68v-332h-20q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h354q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-20ZM321-371h312l-59-55v-354H380v354l-59 55Zm156 0Z',
        epingleOn: 'M634-780v332l77 68q5 5 7 10.6 2 5.59 2 11.56v17.16q0 12.68-8.62 21.18-8.63 8.5-21.38 8.5H510v236q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Q450-62.25 450-75v-236H270q-12.75 0-21.37-8.58-8.63-8.59-8.63-21.28v-17.17q0-5.97 2-11.47 2-5.5 7-10.5l71-68v-332h-20q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h354q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-20Z',
        parametres: 'M421-80q-14 0-25-9t-13-23l-15-94q-19-7-40-19t-37-25l-86 40q-14 6-28 1.5T155-226L97-330q-8-13-4.5-27t15.5-23l80-59q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521l-80-59q-12-9-15.5-23t4.5-27l58-104q8-13 22-17.5t28 1.5l86 40q16-13 37-25t40-18l15-95q2-14 13-23t25-9h118q14 0 25 9t13 23l15 94q19 7 40.5 18.5T669-710l86-40q14-6 27.5-1.5T804-734l59 104q8 13 4.5 27.5T852-580l-80 57q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l80 58q12 8 15.5 22.5T863-330l-58 104q-8 13-22 17.5t-28-1.5l-86-40q-16 13-36.5 25.5T592-206l-15 94q-2 14-13 23t-25 9H421Zm15-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z',
    };
    const MS_NAV = {
        accueil: ['M220-180h150v-220q0-12.75 8.63-21.38Q387.25-430 400-430h160q12.75 0 21.38 8.62Q590-412.75 590-400v220h150v-390L480-765 220-570v390Zm-60 0v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H560q-12.75 0-21.37-8.63Q530-137.25 530-150v-220H430v220q0 12.75-8.62 21.37Q412.75-120 400-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Zm320-293Z', 'M160-180v-390q0-14.25 6.38-27 6.37-12.75 17.62-21l260-195q15.68-12 35.84-12Q500-825 516-813l260 195q11.25 8.25 17.63 21 6.37 12.75 6.37 27v390q0 24.75-17.62 42.37Q764.75-120 740-120H590q-12.75 0-21.37-8.63Q560-137.25 560-150v-220q0-12.75-8.62-21.38Q542.75-400 530-400H430q-12.75 0-21.37 8.62Q400-382.75 400-370v220q0 12.75-8.62 21.37Q382.75-120 370-120H220q-24.75 0-42.37-17.63Q160-155.25 160-180Z'],
        echanges: ['m194-323 100 100q9 9 9 21t-9 21q-9 9-21 9t-21-9L101-332q-5-5-7-10t-2-11q0-6 2-11t7-10l151-151q9-9 21-9t21 9q9 9 9 21t-9 21L194-383h286q13 0 21.5 8.5T510-353q0 13-8.5 21.5T480-323H194Zm572-254H480q-13 0-21.5-8.5T450-607q0-13 8.5-21.5T480-637h286L666-737q-9-9-9-21t9-21q9-9 21-9t21 9l151 151q5 5 7 10t2 11q0 6-2 11t-7 10L708-435q-9 9-21 9t-21-9q-9-9-9-21t9-21l100-100Z', 'm194-323 100 100q9 9 9 21t-9 21q-9 9-21 9t-21-9L101-332q-5-5-7-10t-2-11q0-6 2-11t7-10l151-151q9-9 21-9t21 9q9 9 9 21t-9 21L194-383h286q13 0 21.5 8.5T510-353q0 13-8.5 21.5T480-323H194Zm572-254H480q-13 0-21.5-8.5T450-607q0-13 8.5-21.5T480-637h286L666-737q-9-9-9-21t9-21q9-9 21-9t21 9l151 151q5 5 7 10t2 11q0 6-2 11t-7 10L708-435q-9 9-21 9t-21-9q-9-9-9-21t9-21l100-100Z'],
        classement: ['M140-180h187v-360H140v360Zm247 0h186v-600H387v600Zm246 0h187v-280H633v280Zm-553 0v-360q0-24.75 17.63-42.38Q115.25-600 140-600h187v-180q0-24.75 17.63-42.38Q362.25-840 387-840h186q24.75 0 42.38 17.62Q633-804.75 633-780v260h187q24.75 0 42.38 17.62Q880-484.75 880-460v280q0 24.75-17.62 42.37Q844.75-120 820-120H140q-24.75 0-42.37-17.63Q80-155.25 80-180Z', 'M110-120q-12.75 0-21.37-8.63Q80-137.25 80-150v-420q0-12.75 8.63-21.38Q97.25-600 110-600h150q12.75 0 21.38 8.62Q290-582.75 290-570v420q0 12.75-8.62 21.37Q272.75-120 260-120H110Zm295 0q-12.75 0-21.37-8.63Q375-137.25 375-150v-660q0-12.75 8.63-21.38Q392.25-840 405-840h150q12.75 0 21.38 8.62Q585-822.75 585-810v660q0 12.75-8.62 21.37Q567.75-120 555-120H405Zm295 0q-12.75 0-21.37-8.63Q670-137.25 670-150v-340q0-12.75 8.63-21.38Q687.25-520 700-520h150q12.75 0 21.38 8.62Q880-502.75 880-490v340q0 12.75-8.62 21.37Q862.75-120 850-120H700Z'],
        scores: ['M608-365q-14 0-24.5-10.5T573-400v-160q0-14 10.5-24.5T608-595h99q14 0 24.5 10.5T742-560v160q0 14-10.5 24.5T707-365h-99Zm15-50h69v-130h-69v130Zm-355 0h94q10.83 0 17.92 7.12 7.08 7.11 7.08 18 0 10.88-7.08 17.88-7.09 7-17.92 7H253q-14 0-24.5-10.5T218-400v-69q0-14 10.5-24.5T253-504h84v-41h-94q-10.83 0-17.92-7.12-7.08-7.11-7.08-18 0-10.88 7.08-17.88 7.09-7 17.92-7h109q14 0 24.5 10.5T387-560v69q0 14-10.5 24.5T352-456h-84v41ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h150v-50q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v50h260v-50q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v50h150q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm10-70h305v-35q0-10.83 7.12-17.92 7.11-7.08 18-7.08 10.88 0 17.88 7.08 7 7.09 7 17.92v35h305v-500H505v35q0 10.83-7.12 17.92-7.11 7.08-18 7.08-10.88 0-17.88-7.08-7-7.09-7-17.92v-35H150v500Zm0 0v-500 500Zm308.5-301.5Q450-540 450-553t8.5-21.5Q467-583 480-583t21.5 8.5Q510-566 510-553t-8.5 21.5Q493-523 480-523t-21.5-8.5Zm0 146Q450-394 450-407t8.5-21.5Q467-437 480-437t21.5 8.5Q510-420 510-407t-8.5 21.5Q493-377 480-377t-21.5-8.5Z', 'M608-365h99q14 0 24.5-10.5T742-400v-160q0-14-10.5-24.5T707-595h-99q-14 0-24.5 10.5T573-560v160q0 14 10.5 24.5T608-365Zm15-50h69v-130h-69v130Zm-370 50h109q11 0 18-7t7-18q0-11-7-18t-18-7h-94v-41h84q14 0 24.5-10.5T387-491v-69q0-14-10.5-24.5T352-595H243q-11 0-18 7t-7 18q0 11 7 18t18 7h94v41h-84q-14 0-24.5 10.5T218-469v69q0 14 10.5 24.5T253-365ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h150v-50q0-13 8.5-21.5T320-880q13 0 21.5 8.5T350-850v50h260v-50q0-13 8.5-21.5T640-880q13 0 21.5 8.5T670-850v50h150q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm361.5-371.5Q510-540 510-553t-8.5-21.5Q493-583 480-583t-21.5 8.5Q450-566 450-553t8.5 21.5Q467-523 480-523t21.5-8.5Zm0 146Q510-394 510-407t-8.5-21.5Q493-437 480-437t-21.5 8.5Q450-420 450-407t8.5 21.5Q467-377 480-377t21.5-8.5ZM498-677q7-7 7-18t-7-18q-7-7-18-7t-18 7q-7 7-7 18t7 18q7 7 18 7t18-7Zm0 430q7-7 7-18t-7-18q-7-7-18-7t-18 7q-7 7-7 18t7 18q7 7 18 7t18-7Z'],
        stats: ['M292.5-473.38Q284-464.75 284-452v145q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-145q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm332-215Q616-679.75 616-667v360q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-360q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm-166 302Q450-377.75 450-365v58q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-58q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Zm321.5 289.32q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z', 'M292.5-473.38Q284-464.75 284-452v145q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-145q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm332-215Q616-679.75 616-667v360q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-360q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62Zm-166 302Q450-377.75 450-365v58q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63 12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-58q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm321.5-370.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z'],
        repechage: ['M80-200v-45q0-17 11.5-28.5T120-285h20v125h-20q-17 0-28.5-11.5T80-200Zm104 40v-125h175l43-94 49 97-46 101q-5 11-15 16t-21 5H184Zm696-40q0 17-11.5 28.5T840-160h-20v-125h20q17 0 28.5 11.5T880-245v45Zm-104 40H591q-11 0-21-5t-15-16L300-740q-10-21 3-40.5t36-19.5q13 0 23 7t15 18l103 225 103-225q5-11 15-18t23-7q23 0 36 19.5t3 40.5L527-447l74 162h175v125Z', 'M80-200v-45q0-17 11.5-28.5T120-285h20v125h-20q-17 0-28.5-11.5T80-200Zm104 40v-125h175l43-94 49 97-46 101q-5 11-15 16t-21 5H184Zm696-40q0 17-11.5 28.5T840-160h-20v-125h20q17 0 28.5 11.5T880-245v45Zm-104 40H591q-11 0-21-5t-15-16L300-740q-10-21 3-40.5t36-19.5q13 0 23 7t15 18l103 225 103-225q5-11 15-18t23-7q23 0 36 19.5t3 40.5L527-447l74 162h175v125Z'],
    };
    const ms = (cle, classe = '') => `<svg class="fzm-ms ${classe}" viewBox="0 -960 960 960" aria-hidden="true"><path d="${MS[cle]}"/></svg>`;
    const msNav = cle => `<svg class="fzm-ms fzm-ms-contour" viewBox="0 -960 960 960" aria-hidden="true"><path d="${MS_NAV[cle][0]}"/></svg>` +
        `<svg class="fzm-ms fzm-ms-plein" viewBox="0 -960 960 960" aria-hidden="true"><path d="${MS_NAV[cle][1]}"/></svg>`;

    const echapper = texte => String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function pageCourante() {
        const chemin = window.location.pathname;
        if (chemin.includes('creer-pool')) return 'creer';
        if (chemin.includes('rejoindre-pool')) return 'rejoindre';
        if (/(^|\/)pool\.html$/.test(chemin)) return 'pool';
        if (chemin.includes('repechage') || chemin.includes('draftActif') ||
            chemin.includes('draftFini') || chemin.includes('draft.html')) return 'repechage';
        if (chemin.includes('classement')) return 'classement';
        if (chemin.includes('trade')) return 'trade';
        if (chemin.includes('stats')) return 'stats';
        if (chemin.includes('calendrier') || chemin.includes('match.html')) return 'calendrier';
        if (chemin.includes('index.html') || chemin.endsWith('/')) return 'accueil';
        return '';
    }

    // ==================== MÉMOIRE LOCALE ====================

    const CLE_EPINGLES = 'fzPoolsEpingles';
    const CLE_RECENTS = 'fzPoolsRecents';
    const CLE_RANGS = 'fzPoolsRangs';          // écrit par l'accueil
    const RANG_PERIME_MS = 7 * 24 * 3600 * 1000;

    function lireListe(cle) {
        try {
            const valeur = JSON.parse(localStorage.getItem(cle) || '[]');
            return Array.isArray(valeur) ? valeur.filter(n => typeof n === 'string') : [];
        } catch (e) { return []; }
    }

    function ecrireListe(cle, liste) {
        try { localStorage.setItem(cle, JSON.stringify(liste)); } catch (e) { /* navigation privée */ }
    }

    /** Le pool actif passe en tête des récents, à chaque rendu. */
    function noterRecent(nom) {
        if (!nom) return;
        const liste = lireListe(CLE_RECENTS);
        if (liste[0] === nom) return;
        ecrireListe(CLE_RECENTS, [nom, ...liste.filter(n => n !== nom)].slice(0, 40));
    }

    function basculerEpingle(nom) {
        const liste = lireListe(CLE_EPINGLES);
        ecrireListe(CLE_EPINGLES, liste.includes(nom) ? liste.filter(n => n !== nom) : [...liste, nom]);
    }

    function rangDe(nom) {
        try {
            const rang = JSON.parse(localStorage.getItem(CLE_RANGS) || '{}')[nom];
            if (rang && rang.rang > 0 && Date.now() - (rang.t || 0) < RANG_PERIME_MS) return rang;
        } catch (e) { /* illisible : pas de rang */ }
        return null;
    }

    /**
     * Mes pools, dans l'ordre d'usage : les récents d'abord, puis les
     * autres par nom. `epingles` garde l'ordre des récents, lui aussi.
     */
    function poolsOrdonnes() {
        const mesPools = FZPool.mine();
        const parNom = new Map(mesPools.map(p => [p.name, p]));
        const recents = lireListe(CLE_RECENTS).filter(n => parNom.has(n));
        const reste = mesPools.map(p => p.name).filter(n => !recents.includes(n));
        const ordre = [...recents, ...reste].map(n => parNom.get(n));
        const epingles = new Set(lireListe(CLE_EPINGLES).filter(n => parNom.has(n)));
        return { ordre, epingles };
    }

    // ==================== ÉTAT D'UN POOL ====================

    /** Saison LNH courante (20262027), bascule le 1er juillet : lib/season.js. */
    function saisonCourante() {
        const d = new Date();
        const annee = d.getUTCFullYear();
        const ouverture = d.getUTCMonth() + 1 >= 7 ? annee : annee - 1;
        return Number(`${ouverture}${ouverture + 1}`);
    }

    /** live — saison ou repêchage en cours ; soon — repêchage à venir ; done — saison passée. */
    function categorie(pool) {
        const etat = FZPool.draftState(pool.data).etat;
        if (etat === 'termine') {
            const saison = Number(pool.data && pool.data.saisonRepechage);
            return saison && saison < saisonCourante() ? 'done' : 'live';
        }
        return etat === 'encours' ? 'live' : 'soon';
    }

    function statut(pool) {
        if (FZPool.draftState(pool.data).etat === 'encours') return { texte: 'Repêchage en cours', ton: 'red' };
        const cat = categorie(pool);
        return {
            live: { texte: 'Saison en cours', ton: 'green' },
            soon: { texte: 'Repêchage à venir', ton: 'gold' },
            done: { texte: 'Terminé', ton: 'grey' }
        }[cat];
    }

    const ordinal = n => (n === 1 ? '1er' : `${n}e`);
    const pts = n => `${Math.round(n).toLocaleString('fr-CA')} pts`;

    /** « 2e sur 8 · 642 pts », « 4 / 10 inscrits · repêchage sam. 4 oct., 20 h »… */
    function resume(pool) {
        const etat = FZPool.draftState(pool.data);
        if (etat.etat === 'termine') {
            const fini = categorie(pool) === 'done';
            const rang = rangDe(pool.name);
            if (!rang) return fini ? 'Terminé' : 'Saison en cours';
            return `${fini ? 'Terminé ' : ''}${ordinal(rang.rang)} sur ${rang.sur}${rang.pts != null ? ` · ${pts(rang.pts)}` : ''}`;
        }
        if (etat.etat === 'encours') return `Repêchage · choix ${Math.min(etat.choixFait + 1, etat.choixTotal)} sur ${etat.choixTotal}`;
        const date = etat.prevuLe ? ` · repêchage ${FZPool.draftDate(etat.prevuLe, { court: true })}` : ' inscrits';
        return `${etat.inscrits} / ${etat.max}${date}`;
    }

    // ==================== FRAGMENTS ====================

    const COULEURS = ['#F08A12', '#3A6FD8', '#2E6B4A', '#8A3FB8', '#C0392B', '#1F8A8A', '#4A5A70', '#9C7A2E'];

    function initiales(nom) {
        // « CompuSport » → CS : une majuscule au milieu d'un mot en commence un autre.
        const mots = String(nom).replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2')
            .replace(/[#_\-–—]/g, ' ').split(/\s+/).filter(Boolean);
        const utiles = mots.filter(m => !/^(de|des|du|la|le|les|et|of|the)$/i.test(m));
        const m = utiles.length ? utiles : mots;
        if (!m.length) return '?';
        return (m[0][0] + (m[1] ? m[1][0] : (m[0][1] || ''))).toUpperCase();
    }

    function couleur(nom) {
        let h = 0;
        for (const c of String(nom)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return COULEURS[h % COULEURS.length];
    }

    /** Les initiales sur une couleur ; l'image du pool par-dessus s'il en a une. */
    function vignette(pool, classe) {
        const image = pool.data && pool.data.imageUrl;
        return `<span class="fzm-ava ${classe || ''}" style="--c:${couleur(pool.name)}" aria-hidden="true">${echapper(initiales(pool.name))}${image
            ? `<img src="${echapper(image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
    }

    function puceActif() {
        return `<span class="fzm-actif">${ms('actif')}Actif</span>`;
    }

    function rondAller() {
        return `<span class="fzm-aller">${ms('aller')}</span>`;
    }

    /** Le pool actif, déplié. */
    function carteActive(pool) {
        const st = statut(pool);
        const page = pageCourante() === 'pool' ? new URLSearchParams(window.location.search).get('onglet') : null;
        const admin = !!(window.FZPoolSettings && FZPoolSettings.isCreator(pool.name));
        const invitations = admin ? ((pool.data && pool.data.invitations) || []).length : 0;
        const lien = (onglet, icone, texte, badge) => `
            <a href="pool.html?onglet=${onglet}" class="fzm-lien${page === onglet ? ' is-on' : ''}"${page === onglet ? ' aria-current="page"' : ''}>
                ${ms(icone)}${texte}${badge ? `<b class="fzm-badge" title="Invitations en attente">${badge}</b>` : ''}
            </a>`;
        const rang = FZPool.draftState(pool.data).etat === 'termine' ? rangDe(pool.name) : null;
        const detail = rang
            ? `${ordinal(rang.rang)} sur ${rang.sur}${rang.pts != null ? ` · ${pts(rang.pts)}` : ''}`
            : (st.texte === resume(pool) ? '' : resume(pool));
        return `
            <div class="fzm-pool is-on">
                <div class="fzm-pool-tete">
                    ${vignette(pool)}
                    <span class="fzm-pool-txt">
                        <span class="fzm-pool-nom">${echapper(pool.name)}</span>
                        <span class="fzm-pool-sous">${echapper(pool.teamName)}</span>
                    </span>
                    ${puceActif()}
                </div>
                <div class="fzm-pool-corps">
                    <span class="fzm-pool-etat"><span class="fzm-statut is-${st.ton}">${st.texte}</span>${detail ? `<span>${echapper(detail)}</span>` : ''}</span>
                    <span class="fzm-liens">
                        ${lien('apercu', 'reglages', 'Réglages', invitations)}
                        ${lien('equipes', 'equipes', 'Équipes')}
                        ${lien('regles', 'regles', 'Règles')}
                    </span>
                </div>
            </div>`;
    }

    function ligneAutre(pool, epingle) {
        return `
            <div class="fzm-pool">
                <button type="button" class="fzm-pool-tete" data-fzm-pool="${echapper(pool.name)}"
                        aria-label="Activer ${echapper(pool.name)}">
                    ${vignette(pool)}
                    <span class="fzm-pool-txt">
                        <span class="fzm-pool-nom">${echapper(pool.name)}</span>
                        <span class="fzm-pool-sous">${epingle ? 'Épinglé · ' : ''}${echapper(resume(pool))}</span>
                    </span>
                    ${rondAller()}
                </button>
            </div>`;
    }

    /** « Mes pools » : l'actif, trois autres, et l'entrée vers la liste complète. */
    function sectionPools(fermable) {
        const tete = `
            <div class="fzm-tete">
                <span class="fzm-titre">Mes pools</span>
                ${fermable ? `<button type="button" class="fzm-icone-btn" data-fzm-fermer aria-label="Fermer le menu">${ms('fermer')}</button>` : ''}
            </div>`;
        const mesPools = FZPool.mine();
        if (!mesPools.length) {
            return tete + `<p class="fzm-vide">Aucun pool pour l’instant. Rejoins celui de tes amis ou crée le tien.</p>`;
        }
        const actif = mesPools.find(p => p.name === FZPool.get()) || mesPools[0];
        const { ordre, epingles } = poolsOrdonnes();
        const autres = ordre.filter(p => p.name !== actif.name);
        const choisis = [
            ...autres.filter(p => epingles.has(p.name)),
            ...autres.filter(p => !epingles.has(p.name))
        ].slice(0, 3);
        return tete + `
            <div class="fzm-pools">
                ${carteActive(actif)}
                ${choisis.map(p => ligneAutre(p, epingles.has(p.name))).join('')}
                ${mesPools.length > 1 ? `
                <button type="button" class="fzm-tous-btn" data-fzm-tous>
                    <span class="fzm-tous-ico">${ms('tous')}</span>
                    <span class="fzm-tous-txt">Tous mes pools</span>
                    <span class="fzm-compte-n">${mesPools.length}</span>
                    ${ms('chevron', 'fzm-chev')}
                </button>` : ''}
            </div>`;
    }

    function tuiles() {
        return `
            <div class="fzm-tuiles">
                <a href="rejoindre-pool.html" class="fzm-tuile">
                    <span class="fzm-tuile-ico">${ms('rejoindre')}</span>
                    <span class="fzm-tuile-txt"><strong>Rejoindre</strong><small>Un code ou une invitation</small></span>
                </a>
                <a href="creer-pool.html" class="fzm-tuile is-creer">
                    <span class="fzm-tuile-ico">${ms('creer')}</span>
                    <span class="fzm-tuile-txt"><strong>Créer</strong><small>Mes règles, mes invités</small></span>
                </a>
            </div>`;
    }

    /**
     * Les pages du pool actif. Deux liens suivent son état, comme la barre
     * du haut (navbar.js) :
     *   — « Échanges » tombe sans pool ou si le pool les a coupés ;
     *   — « Classement » n'a de sens qu'une fois le repêchage fini : avant,
     *     c'est « Repêchage » qui prend sa place.
     */
    function navigation() {
        const page = pageCourante();
        const donnees = FZPool.data();
        const fini = !!donnees && FZPool.draftState(donnees).etat === 'termine';
        const enAttente = Number(window.fzEchangesEnAttente) || 0;
        const liens = [
            { href: 'index.html', cle: 'accueil', texte: 'Accueil', icone: 'accueil' },
            donnees && donnees.allowTrades !== false &&
                { href: 'trade.html', cle: 'trade', texte: 'Échanges', icone: 'echanges', badge: true },
            fini
                ? { href: 'classement.html', cle: 'classement', texte: 'Classement', icone: 'classement' }
                : donnees && { href: 'repechage.html', cle: 'repechage', texte: 'Repêchage', icone: 'repechage' },
            { href: 'calendrier.html', cle: 'calendrier', texte: 'Scores', icone: 'scores' },
            { href: 'stats.html', cle: 'stats', texte: 'Stats', icone: 'stats' }
        ].filter(Boolean);
        const actif = FZPool.get();
        return `
            <p class="fzm-etiquette">Naviguer${actif ? ` · ${echapper(actif)}` : ''}</p>
            <nav class="fzm-nav" aria-label="Pages">
                ${liens.map(lien => `
                    <a href="${lien.href}" class="fzm-nav-lien${lien.cle === page ? ' is-on' : ''}"${lien.cle === page ? ' aria-current="page"' : ''}>
                        ${msNav(lien.icone)}<span>${lien.texte}</span>
                        ${lien.badge ? `<b class="fzm-badge" id="railTradeBadge"${enAttente ? '' : ' style="display:none"'}>${enAttente || ''}</b>` : ''}
                    </a>`).join('')}
            </nav>`;
    }

    function rangeeCompte() {
        const nom = localStorage.getItem('username') || '';
        const avatar = localStorage.getItem('avatarUrl') || '';
        return `
            <button type="button" class="fzm-compte" data-fzm-compte>
                <span class="fzm-compte-ava">${avatar
                    ? `<img src="${echapper(avatar)}" alt="" onerror="this.remove()">` : ''}${ms('compte')}</span>
                <span class="fzm-compte-txt"><strong>${echapper(nom)}</strong><small>Mon compte</small></span>
                ${ms('parametres', 'fzm-compte-reg')}
            </button>`;
    }

    // ==================== TOUS MES POOLS ====================

    const FILTRES = [['all', 'Tous'], ['live', 'En cours'], ['soon', 'À venir'], ['done', 'Terminés']];
    const vueTous = { q: '', f: 'all' };

    function listeTous() {
        const actif = FZPool.get();
        const { ordre, epingles } = poolsOrdonnes();
        const q = vueTous.q.trim().toLocaleLowerCase('fr');
        const garde = p => (vueTous.f === 'all' || categorie(p) === vueTous.f) &&
            (!q || p.name.toLocaleLowerCase('fr').includes(q) || String(p.teamName).toLocaleLowerCase('fr').includes(q));
        const epingles_ = ordre.filter(p => epingles.has(p.name) && garde(p));
        const reste = ordre.filter(p => !epingles.has(p.name) && garde(p));
        const ligne = p => {
            const on = p.name === actif;
            const pin = epingles.has(p.name);
            return `
                <li class="fzm-tous-ligne">
                    <button type="button" class="fzm-tous-choix" data-fzm-pool="${echapper(p.name)}"${on ? ' aria-current="true"' : ''}>
                        ${vignette(p)}
                        <span class="fzm-pool-txt">
                            <span class="fzm-pool-nom">${echapper(p.name)}</span>
                            <span class="fzm-pool-sous">${echapper(p.teamName)} · ${echapper(resume(p))}</span>
                        </span>
                    </button>
                    <button type="button" class="fzm-epingle${pin ? ' is-on' : ''}" data-fzm-pin="${echapper(p.name)}"
                            aria-pressed="${pin}" aria-label="${pin ? 'Désépingler' : 'Épingler'} ${echapper(p.name)}">
                        ${ms(pin ? 'epingleOn' : 'epingle')}
                    </button>
                    <span class="fzm-tous-etat">${on ? ms('actif', 'fzm-coche') : rondAller()}</span>
                </li>`;
        };
        const groupe = (titre, items) => items.length ? `
            <p class="fzm-etiquette">${titre}</p>
            <ul class="fzm-groupe">${items.map(ligne).join('')}</ul>` : '';
        const html = groupe('Épinglés', epingles_) +
            groupe(epingles_.length ? 'Récents' : 'Par dernière utilisation', reste);
        return html || `<div class="fzm-rien">${ms('rien')}<span>Aucun pool trouvé</span></div>`;
    }

    function filtresTous() {
        const mesPools = FZPool.mine();
        return FILTRES.map(([cle, texte]) => {
            const n = mesPools.filter(p => cle === 'all' || categorie(p) === cle).length;
            const on = cle === vueTous.f;
            return `<button type="button" class="fzm-filtre${on ? ' is-on' : ''}" data-fzm-filtre="${cle}" aria-pressed="${on}">${texte}<small>${n}</small></button>`;
        }).join('');
    }

    function monterTous() {
        let panneau = document.getElementById('fzmTous');
        if (!panneau) {
            panneau = document.createElement('div');
            panneau.id = 'fzmTous';
            panneau.className = 'fzm fzm-tous';
            panneau.setAttribute('role', 'dialog');
            panneau.setAttribute('aria-modal', 'true');
            panneau.setAttribute('aria-label', 'Tous mes pools');
            panneau.hidden = true;
            document.body.appendChild(panneau);
            panneau.addEventListener('input', e => {
                if (!e.target.matches('.fzm-cherche input')) return;
                vueTous.q = e.target.value;
                panneau.querySelector('.fzm-cherche-effacer').hidden = !vueTous.q;
                panneau.querySelector('.fzm-tous-liste').innerHTML = listeTous();
            });
        }
        panneau.innerHTML = `
            <div class="fzm-tete fzm-tous-tete">
                <button type="button" class="fzm-icone-btn" data-fzm-retour aria-label="Retour">${ms('retour')}</button>
                <span class="fzm-titre">Tous mes pools</span>
                <span class="fzm-tous-n">${FZPool.mine().length}</span>
            </div>
            <div class="fzm-tous-outils">
                <label class="fzm-cherche">
                    ${ms('chercher')}
                    <input type="search" placeholder="Rechercher un pool" value="${echapper(vueTous.q)}" aria-label="Rechercher un pool" enterkeyhint="search">
                    <button type="button" class="fzm-cherche-effacer" data-fzm-effacer aria-label="Effacer"${vueTous.q ? '' : ' hidden'}>${ms('fermer')}</button>
                </label>
                <div class="fzm-filtres">${filtresTous()}</div>
            </div>
            <div class="fzm-tous-liste">${listeTous()}</div>`;
        return panneau;
    }

    function ouvrirTous() {
        const panneau = monterTous();
        panneau.hidden = false;
        document.getElementById('fzDrawerScrim').hidden = false;
        document.body.classList.add('fz-drawer-open');
        requestAnimationFrame(() => panneau.classList.add('is-open'));
        const retour = panneau.querySelector('[data-fzm-retour]');
        if (retour) retour.focus();
    }

    function fermerTous() {
        const panneau = document.getElementById('fzmTous');
        if (!panneau || panneau.hidden) return false;
        panneau.classList.remove('is-open');
        vueTous.q = '';
        const tiroir = document.getElementById('fzDrawer');
        const tiroirOuvert = tiroir && !tiroir.hidden;
        if (!tiroirOuvert) {
            document.body.classList.remove('fz-drawer-open');
            document.getElementById('fzDrawerScrim').hidden = true;
        }
        setTimeout(() => {
            panneau.hidden = true;
            const retour = document.querySelector(tiroirOuvert ? '#fzDrawer [data-fzm-tous]' : '#fzSidebar [data-fzm-tous]');
            if (retour) retour.focus();
        }, 200);
        return true;
    }

    const tousOuvert = () => {
        const panneau = document.getElementById('fzmTous');
        return !!panneau && !panneau.hidden;
    };

    // ==================== MONTAGE ====================

    /**
     * Le rail en os, le temps que FZPool lise les pools.
     *
     * Le rail n'arrivait qu'avec les données : la page s'affichait pleine
     * largeur, puis tout son contenu sautait vers la droite. Monté tout de
     * suite, il décale la page dès le départ. Mêmes classes que le rail
     * chargé ; monterBarreLaterale() le remplace.
     * La salle de repêchage prend le rail à son compte : elle garde le sien.
     */
    function monterRailSquelette() {
        if (document.getElementById('fzSidebar') || window.location.pathname.includes('draftActif')) return;
        const rail = document.createElement('aside');
        rail.className = 'fz-sidebar fzm';
        rail.id = 'fzSidebar';
        rail.setAttribute('aria-label', 'Mes pools');
        rail.innerHTML = `
            <div class="fzm-rail" data-fz-sk inert>
                <div class="fzm-tete"><span class="fzm-titre">Mes pools</span></div>
                <div class="fzm-pools">
                    <div class="fzm-pool is-on fzm-os-carte">
                        <div class="fzm-pool-tete">
                            <span class="fzm-ava fz-bone"></span>
                            <span class="fzm-pool-txt">
                                <span class="fz-bone fz-sk-rail-name"></span>
                                <span class="fz-bone-flat fz-sk-rail-meta"></span>
                            </span>
                        </div>
                    </div>
                    <div class="fzm-pool"><div class="fzm-pool-tete"><span class="fzm-ava fz-bone"></span><span class="fzm-pool-txt"><span class="fz-bone fz-sk-rail-name"></span></span></div></div>
                </div>
            </div>`;
        document.body.appendChild(rail);
        document.body.classList.add('fz-has-sidebar');
        monterBasculeRail();
    }

    /**
     * Le bandeau de contexte en os (téléphone et tablette), pour la même
     * raison : arrivé avec les données, il poussait toute la page vers le
     * bas. Seulement si ce navigateur a un pool actif — sans pool, il n'y
     * aura pas de bandeau. monterBandeaux() le remplace.
     */
    function monterBandeauxSquelette() {
        if (!localStorage.getItem('activePool')) return;
        document.querySelectorAll('[data-fz-context]').forEach(hote => {
            if (hote.childElementCount) return;
            hote.innerHTML = `
                <div class="fz-context-bar" data-fz-sk inert>
                    <span class="fz-context-img fz-bone"></span>
                    <span class="fz-context-txt">
                        <span class="fz-context-label">Pool actif</span>
                        <span class="fz-bone fz-sk-context-name"></span>
                    </span>
                    <span class="fz-context-switch">Changer</span>
                </div>`;
        });
    }

    function monterBarreLaterale() {
        let rail = document.getElementById('fzSidebar');
        if (!rail) {
            rail = document.createElement('aside');
            rail.className = 'fz-sidebar';
            rail.id = 'fzSidebar';
            rail.setAttribute('aria-label', 'Mes pools');
            document.body.appendChild(rail);
        }
        // Une page peut reprendre le rail à son compte : le repêchage en
        // direct y met l'alignement et les limites d'équipe, et renvoie le
        // sélecteur de pool dans la barre du haut (la puce #fzNavbarPool,
        // déjà construite plus bas par montrerPucePool). Sans ce garde-fou,
        // la moindre mise à jour temps réel de FZPool rappellerait cette
        // fonction et effacerait le contenu que la page y a posé.
        const aLaPage = document.body.dataset.fzRail === 'page';
        rail.classList.toggle('fzm', !aLaPage);
        if (!aLaPage) {
            rail.innerHTML = `<div class="fzm-rail">${sectionPools(false)}${tuiles()}</div>`;
        }
        document.body.classList.add('fz-has-sidebar');
        monterBasculeRail();
    }

    /**
     * Masquer ou montrer le rail, au choix de chacun.
     *
     * Le rail prend sa largeur sur ordinateur : sur un écran étroit, ou pour
     * lire un grand tableau, on veut pouvoir le ranger. Le choix est mémorisé
     * par navigateur. La salle de repêchage garde toujours le sien : sa
     * pendule et l'alignement y sont calés sur la même colonne.
     */
    const CLE_RAIL_FERME = 'fzRailFerme';

    function railFerme() {
        try { return localStorage.getItem(CLE_RAIL_FERME) === '1'; } catch (e) { return false; }
    }

    function appliquerRail(ferme) {
        const permis = !document.body.classList.contains('fz-draft') &&
            !window.location.pathname.includes('draftActif');
        const effectif = ferme && permis;
        document.body.classList.toggle('fz-rail-ferme', effectif);
        const bouton = document.getElementById('fzRailToggle');
        if (bouton) {
            bouton.hidden = !permis;
            bouton.setAttribute('aria-expanded', String(!effectif));
            bouton.setAttribute('aria-label', effectif ? 'Afficher le panneau des pools' : 'Masquer le panneau des pools');
            bouton.title = effectif ? 'Afficher le panneau' : 'Masquer le panneau';
        }
    }

    function monterBasculeRail() {
        if (!document.getElementById('fzRailToggle')) {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'fz-rail-toggle';
            bouton.id = 'fzRailToggle';
            bouton.setAttribute('aria-controls', 'fzSidebar');
            bouton.innerHTML = ICONES.chevron;
            bouton.addEventListener('click', () => {
                const ferme = !document.body.classList.contains('fz-rail-ferme');
                try { localStorage.setItem(CLE_RAIL_FERME, ferme ? '1' : '0'); } catch (e) { /* navigation privée */ }
                appliquerRail(ferme);
            });
            document.body.appendChild(bouton);
        }
        appliquerRail(railFerme());
    }

    function monterTiroir() {
        let tiroir = document.getElementById('fzDrawer');
        if (!tiroir) {
            const html = `
                <div class="fz-drawer-scrim" id="fzDrawerScrim" hidden></div>
                <div class="fz-drawer fzm" id="fzDrawer" role="dialog" aria-modal="true"
                     aria-label="Menu" hidden>
                    <div class="fz-drawer-body" id="fzDrawerBody"></div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', html);
            tiroir = document.getElementById('fzDrawer');

            document.getElementById('fzDrawerScrim').addEventListener('click', () => {
                fermerTous();
                fermerTiroir();
            });
            document.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                if (fermerTous()) return;
                if (!tiroir.hidden) fermerTiroir();
            });
        }

        document.getElementById('fzDrawerBody').innerHTML =
            sectionPools(true) + tuiles() + navigation() +
            `<span class="fzm-ressort"></span>` + rangeeCompte();
    }

    function monterHamburger() {
        const gauche = document.querySelector('.navbar-desktop .navbar-left');
        if (!gauche || document.getElementById('fzBurger')) return;
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'fz-burger';
        bouton.id = 'fzBurger';
        bouton.setAttribute('aria-label', 'Ouvrir le menu');
        bouton.setAttribute('aria-expanded', 'false');
        bouton.innerHTML = ICONES.menu;
        bouton.addEventListener('click', ouvrirTiroir);
        gauche.insertBefore(bouton, gauche.firstChild);
    }

    /**
     * Puce « pool actif » qui remplace le logo dans la barre du haut sous
     * 769px (le CSS s'en charge, voir poolNav.css) : sans pool, un bouton
     * « Rejoindre un pool » à la place.
     */
    function montrerPucePool() {
        const marque = document.querySelector('.navbar-desktop .navbar-brand');
        if (!marque) return;

        let puce = document.getElementById('fzNavbarPool');
        if (!puce) {
            puce = document.createElement('a');
            puce.id = 'fzNavbarPool';
            marque.insertAdjacentElement('afterend', puce);
        }

        const actif = FZPool.get();
        const courant = FZPool.mine().find(p => p.name === actif);

        if (!courant) {
            puce.href = 'rejoindre-pool.html';
            puce.className = 'fz-navbar-pool fz-navbar-pool-empty';
            puce.onclick = null;
            puce.innerHTML = `<span>Rejoindre un pool</span>`;
            return;
        }

        puce.href = '#';
        puce.className = 'fz-navbar-pool';
        puce.innerHTML = `<img src="${echapper(FZPool.image(courant.data))}" class="fz-navbar-pool-img" alt=""
                               onerror="this.src='Icons/grayGroup.png'">` +
            `<span class="fz-navbar-pool-name">${echapper(courant.name)}</span>`;
        puce.onclick = e => { e.preventDefault(); ouvrirTiroir(); };
    }

    // ==================== INTERACTIONS ====================

    /** Redessine ce que montrent le rail, le tiroir et la liste complète. */
    function rafraichirMenus() {
        monterBarreLaterale();
        monterTiroir();
        const panneau = document.getElementById('fzmTous');
        if (panneau && !panneau.hidden) {
            panneau.querySelector('.fzm-filtres').innerHTML = filtresTous();
            panneau.querySelector('.fzm-tous-liste').innerHTML = listeTous();
        }
    }

    /**
     * Un seul écouteur pour tout le menu : le rail, le tiroir et la liste
     * se redessinent à chaque mise à jour, leurs boutons avec eux.
     *
     * N'importe quel élément portant `data-fz-pools` ouvre aussi le tiroir :
     * l'accueil a deux entrées de ce genre — la puce « Mes pools » du
     * téléphone et le « Voir les N pools » du tableau de bord.
     */
    document.addEventListener('click', e => {
        const cible = e.target.closest && e.target.closest(
            '[data-fz-pools], [data-fzm-pool], [data-fzm-pin], [data-fzm-tous], [data-fzm-retour], ' +
            '[data-fzm-filtre], [data-fzm-effacer], [data-fzm-fermer], [data-fzm-compte]');
        if (!cible) return;
        const d = cible.dataset;

        if ('fzPools' in d) { e.preventDefault(); ouvrirTiroir(); return; }
        if ('fzmFermer' in d) { fermerTiroir(); return; }
        if ('fzmTous' in d) { ouvrirTous(); return; }
        if ('fzmRetour' in d) { fermerTous(); return; }

        if ('fzmPin' in d) {
            basculerEpingle(d.fzmPin);
            rafraichirMenus();
            const meme = document.querySelector(`#fzmTous [data-fzm-pin="${CSS.escape(d.fzmPin)}"]`);
            if (meme) meme.focus();
            return;
        }

        if ('fzmFiltre' in d) {
            vueTous.f = d.fzmFiltre;
            rafraichirMenus();
            return;
        }

        if ('fzmEffacer' in d) {
            vueTous.q = '';
            const champ = document.querySelector('#fzmTous .fzm-cherche input');
            if (champ) { champ.value = ''; champ.focus(); }
            cible.hidden = true;
            document.querySelector('#fzmTous .fzm-tous-liste').innerHTML = listeTous();
            return;
        }

        if ('fzmCompte' in d) {
            // Le compte vit dans la barre du haut : on y ouvre son menu.
            fermerTiroir();
            setTimeout(() => {
                const avatar = document.getElementById('userAvatarBtn');
                if (avatar) avatar.click();
            }, 240);
            return;
        }

        if ('fzmPool' in d) {
            const nom = d.fzmPool;
            if (nom === FZPool.get()) { fermerTous(); return; }
            cible.classList.add('is-loading');
            noterRecent(nom);
            FZPool.set(nom);
        }
    });

    let elementAvantTiroir = null;

    function ouvrirTiroir() {
        const tiroir = document.getElementById('fzDrawer');
        const voile = document.getElementById('fzDrawerScrim');
        if (!tiroir) return;
        elementAvantTiroir = document.activeElement;
        tiroir.hidden = false;
        voile.hidden = false;
        document.body.classList.add('fz-drawer-open');
        const burger = document.getElementById('fzBurger');
        if (burger) burger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => tiroir.classList.add('is-open'));
        const premier = tiroir.querySelector('button, a');
        if (premier) premier.focus();
    }

    function fermerTiroir() {
        const tiroir = document.getElementById('fzDrawer');
        const voile = document.getElementById('fzDrawerScrim');
        if (!tiroir || tiroir.hidden) return;
        tiroir.classList.remove('is-open');
        if (!tousOuvert()) document.body.classList.remove('fz-drawer-open');
        const burger = document.getElementById('fzBurger');
        if (burger) burger.setAttribute('aria-expanded', 'false');
        // Attendre la fin de la glissade avant de retirer de l'ordre de tabulation.
        setTimeout(() => {
            tiroir.hidden = true;
            if (!tousOuvert()) voile.hidden = true;
            if (elementAvantTiroir && elementAvantTiroir.focus) elementAvantTiroir.focus();
        }, 220);
    }

    // ==================== CYCLE DE VIE ====================

    /**
     * Bandeau de contexte : sous 1100px le rail disparaît, et une page de
     * classement ou d'échange ne dirait plus sur quel pool elle porte.
     * Toute page qui en veut un pose `<div data-fz-context></div>`.
     */
    function monterBandeaux() {
        const actif = FZPool.get();
        document.querySelectorAll('[data-fz-context]').forEach(hote => {
            if (!actif) { hote.innerHTML = ''; return; }
            const pool = FZPool.mine().find(p => p.name === actif);
            if (!pool) { hote.innerHTML = ''; return; }
            hote.innerHTML = `
                <div class="fz-context-bar">
                    <img src="${echapper(FZPool.image(pool.data))}" class="fz-context-img" alt=""
                         onerror="this.src='Icons/grayGroup.png'">
                    <span class="fz-context-txt">
                        <span class="fz-context-label">Pool actif</span>
                        <span class="fz-context-name">${echapper(pool.name)}</span>
                    </span>
                    <button type="button" class="fz-context-switch">Changer</button>
                </div>`;
            hote.querySelector('.fz-context-switch').addEventListener('click', ouvrirTiroir);
        });
    }

    function rendre() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        noterRecent(FZPool.get());
        monterBarreLaterale();
        monterTiroir();
        monterHamburger();
        monterBandeaux();
        montrerPucePool();
    }

    async function demarrer() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return;
        monterRailSquelette();
        monterBandeauxSquelette();
        await FZPool.ready();
        rendre();
        // Le menu reflète l'état des repêchages : il doit suivre les mises
        // à jour temps réel. Sauf pendant qu'on s'en sert — reconstruire le
        // menu sous le doigt ferait rater le geste.
        FZPool.onData(() => {
            const tiroir = document.getElementById('fzDrawer');
            if (tousOuvert() || (tiroir && !tiroir.hidden)) return;
            rendre();
        });
        // Sur les pages qui se remettent à jour sans recharger, le tiroir
        // resterait ouvert par-dessus le contenu qu'on vient de demander.
        FZPool.on(() => { fermerTous(); fermerTiroir(); rendre(); });
    }

    function attendreNavbar() {
        if (document.querySelector('.navbar-desktop .navbar-left')) { demarrer(); return; }
        // navbar.js peut n'avoir pas encore construit son contenu selon
        // l'ordre des scripts de la page.
        const observateur = new MutationObserver(() => {
            if (document.querySelector('.navbar-desktop .navbar-left')) {
                observateur.disconnect();
                demarrer();
            }
        });
        const navbar = document.querySelector('.navbar');
        if (navbar) observateur.observe(navbar, { childList: true, subtree: true });
        else demarrer();   // page sans navbar : le rail suffit
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attendreNavbar);
    } else {
        attendreNavbar();
    }

    window.FZNav = { render: rendre, openDrawer: ouvrirTiroir, closeDrawer: fermerTiroir, openAllPools: ouvrirTous };
})();
