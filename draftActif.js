let fullPlayerData=[],imageList=[],draftData={},goalieData=[],teamData=[],currentClan=localStorage.getItem("draftClan"),username=localStorage.getItem("username");let currentCareerData=null,currentStats=null,currentTeams=null;const BASE_URL=window.location.hostname.includes("localhost")?"http://localhost:3000":window.location.origin;const PROV_ABBR={"Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB","Newfoundland and Labrador":"NL","Northwest Territories":"NT","Nova Scotia":"NS","Nunavut":"NU","Ontario":"ON","Prince Edward Island":"PE","Quebec":"QC","Québec":"QC","Saskatchewan":"SK","Yukon":"YT","Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"};function getCurrentPlayerStats(e,t){if(!currentStats||!currentStats.players)return null;if(t){const e=currentStats.players.find(e=>e.playerId===t);if(e)return e}return currentStats.players.find(t=>t.playerName===e)}function getCurrentTeamStats(e){return currentTeams&&currentTeams.teams?currentTeams.teams.find(t=>t.teamFullName===e):null}function showCustomAlert(e,t="info"){const a=document.getElementById("customAlertOverlay"),n=document.getElementById("alertMessage"),s=document.getElementById("alertIcon"),r=document.getElementById("alertOkButton");const box=a.querySelector(".custom-alert-box");if(box){box.setAttribute("role","alertdialog");box.setAttribute("aria-modal","true");box.setAttribute("aria-describedby","alertMessage")}switch(n.textContent=e,s.className="custom-alert-icon "+t,t){case"success":s.innerHTML=typeof getIcon==="function"?getIcon("check",24):"✓";break;case"error":s.innerHTML=typeof getIcon==="function"?getIcon("x",24):"✕";break;case"warning":s.innerHTML=typeof getIcon==="function"?getIcon("warning",24):"⚠";break;default:s.innerHTML=typeof getIcon==="function"?getIcon("info",24):"ℹ"}const avant=document.activeElement;a.classList.add("show");r.focus();const o=()=>{a.classList.remove("show"),r.removeEventListener("click",o),a.removeEventListener("click",l),document.removeEventListener("keydown",i);if(avant&&typeof avant.focus==="function")avant.focus()},l=e=>{e.target===a&&o()};r.addEventListener("click",o),a.addEventListener("click",l);const i=e=>{"Enter"!==e.key&&"Escape"!==e.key||(e.preventDefault(),o())};document.addEventListener("keydown",i)}console.log("🔍 draftClan:",localStorage.getItem("draftClan")),console.log("🔍 username:",localStorage.getItem("username"));const socket=io(BASE_URL);function toggleAdminDropdown(e){e.preventDefault(),e.stopPropagation();document.getElementById("adminDropdown").classList.toggle("show")}async function loadAdminUsers(){try{const e=await fetch(`${BASE_URL}/admin-users?adminToken=admin`),t=await e.json();if(e.ok){const e=t.users.filter(e=>"admin"!==e).slice(0,4),a=document.getElementById("adminUserList");0===e.length?a.innerHTML='<div class="admin-no-users">Aucun utilisateur</div>':a.innerHTML=e.map(e=>`\n                    <a href="#" class="admin-dropdown-item" onclick="switchToUser(event, '${e}')">\n                        <span class="user-avatar">${e.charAt(0).toUpperCase()}</span>\n                        <span class="user-name">${e}</span>\n                    </a>\n                `).join("")}}catch(e){console.error("Error loading users:",e),document.getElementById("adminUserList").innerHTML='<div class="admin-no-users">Erreur</div>'}}async function switchToUser(e,t){e.preventDefault(),e.stopPropagation();try{(await fetch(`${BASE_URL}/admin-switch-user`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({adminToken:"admin",targetUsername:t})})).ok?(localStorage.setItem("username",t),localStorage.setItem("activeUser",t),window.location.reload()):showCustomAlert("Erreur lors du changement d'utilisateur","error")}catch(e){console.error("Error switching user:",e),showCustomAlert("Erreur de connexion","error")}}function logout(e){e&&e.preventDefault(),localStorage.removeItem("isLoggedIn"),localStorage.removeItem("username"),localStorage.removeItem("isAdmin"),localStorage.removeItem("activeUser"),location.reload()}async function fetchPlayerData(){try{const e=await fetch("nhl_filtered_stats.json"),t=await e.json();fullPlayerData=[...t.Top_50_Defenders,...t.Top_100_Offensive_Players,...t.Top_Rookies],goalieData=t.Top_50_Goalies,teamData=t.Teams;try{const e=await fetch(`${BASE_URL}/current-stats`,{cache:"no-store"});currentStats=await e.json(),console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`)}catch(e){console.warn("⚠️ Could not load current stats, using cached data:",e)}try{const e=await fetch(`${BASE_URL}/current-teams`,{cache:"no-store"});currentTeams=await e.json(),console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`)}catch(e){console.warn("⚠️ Could not load current team standings, using cached data:",e)}await fetchImageData(),setTimeout(()=>loadDraftData(),300)}catch(e){console.error("Erreur chargement stats joueurs :",e)}}async function fetchImageData(){}socket.on("draftUpdated",e=>{e[currentClan]&&e[currentClan].teams?(draftData=e[currentClan],shouldRefreshDraftView(e[currentClan])&&updateTable()):console.warn("❌ WebSocket : données incomplètes pour le clan :",currentClan)}),socket.on("forceRefresh",()=>{console.log("🔁 Rafraîchissement forcé reçu"),setTimeout(loadDraftData,300)}),$(document).ready(function(){if(!currentClan||!username)return showCustomAlert("Vous devez être connecté et avoir un draft actif !","error"),void setTimeout(()=>{window.location.href="draft.html"},1500);const e="true"===localStorage.getItem("isLoggedIn"),t="true"===localStorage.getItem("isAdmin");e&&(t?($("#admin-users-link").css("display","block").html('\n                <div class="admin-dropdown-container">\n                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">\n                        Utilisateur ▼\n                    </a>\n                    <div class="admin-dropdown-menu" id="adminDropdown">\n                        <div class="admin-dropdown-header">Changer d\'utilisateur</div>\n                        <div id="adminUserList" class="admin-user-list">Chargement...</div>\n                    </div>\n                </div>\n            '),$("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`),loadAdminUsers()):$("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${username})</a>`)),fetchPlayerData(),setInterval(loadDraftData,7e3)}),document.addEventListener("click",function(e){const t=document.getElementById("adminDropdown");t&&!e.target.closest(".admin-dropdown-container")&&t.classList.remove("show")});let isLoading=!1;async function loadDraftData(){if(isLoading)return;isLoading=!0;const e=document.getElementById("loading");e&&!draftFirstLoadDone&&(e.style.display="block");try{const e=localStorage.getItem("draftClan"),t=await fetch(`${BASE_URL}/draft`,{cache:"no-store"}),a=await t.json();if(!a||!a[e])return void console.warn("Draft data incomplet ou manquant :",a);draftData=a[e],"function"==typeof window.fzSignalFetchOk&&window.fzSignalFetchOk(),shouldRefreshDraftView(a[e])&&updateTable()}catch(e){console.error("❌ Erreur chargement draft :",e),"function"==typeof window.fzSignalFetchEchec&&window.fzSignalFetchEchec()}finally{e&&(e.style.display="none"),isLoading=!1,draftFirstLoadDone=!0}}function getMatchingImage(e){return resolveHeadshotByName(e)}function getTeamLogoPath(e){if(!e||"null"===e)return null;return`teams/${e.split(",").pop().trim()}.png`}let currentSortBy="points";function populateMyPicksTable(e,t){const a=draftData.teams[e],n=$("#playerTable tbody");n.empty(),$("#tableHeaderRow").html("\n        <th>Photo</th>\n        <th>Nom</th>\n        <th>Type</th>\n        <th>GP</th>\n        <th>Stats</th>\n        <th class='points-column'>PTS</th>\n    ");let s=[];if((a.offensive||[]).forEach(e=>{const a=fullPlayerData.find(t=>t.skaterFullName===e);!a||t&&!e.toLowerCase().includes(t)||s.push({name:e,type:"Attaquant",typeCode:a.positionCode||"F",data:a,category:"skater"})}),(a.defensive||[]).forEach(e=>{const a=fullPlayerData.find(t=>t.skaterFullName===e);!a||t&&!e.toLowerCase().includes(t)||s.push({name:e,type:"Défenseur",typeCode:"D",data:a,category:"skater"})}),(a.rookie||[]).forEach(e=>{const a=fullPlayerData.find(t=>t.skaterFullName===e);!a||t&&!e.toLowerCase().includes(t)||s.push({name:e,type:"Recrue",typeCode:"*",data:a,category:"skater"})}),(a.goalie||[]).forEach(e=>{const a=goalieData.find(t=>t.goalieFullName===e);!a||t&&!e.toLowerCase().includes(t)||s.push({name:e,type:"Gardien",typeCode:"G",data:a,category:"goalie"})}),(a.teams||[]).forEach(e=>{const a=teamData.find(t=>t.teamFullName===e);!a||t&&!e.toLowerCase().includes(t)||s.push({name:e,type:"Équipe",typeCode:"T",data:a,category:"team"})}),0===s.length){const e=t?`<tr><td colspan="6">Aucun choix trouvé pour "${t}"</td></tr>`:'<tr><td colspan="6">Vous n\'avez pas encore fait de choix</td></tr>';return void n.append(e)}s.forEach(e=>{let t=null,a=null,s="";if("team"===e.category){const n=getTeamAbbreviation(e.name);t=n?`teams/${n}.png`:null,a=t,s=`W: ${e.data.wins}, L: ${e.data.losses}`}else"goalie"===e.category?(t=getMatchingImage(e.name),a=getTeamLogoPath(e.data.teamAbbrevs),s=`W: ${e.data.wins}, SV%: ${e.data.savePct?.toFixed(3)}`):(t=getMatchingImage(e.name),a=getTeamLogoPath(e.data.teamAbbrevs),s=`G: ${e.data.goals}, A: ${e.data.assists}`);const r=`\n            <tr>\n                <td>${t?`<div class="player-photo">\n                    <img src="${t}" alt="${e.name}" class="face">\n                    ${a&&"team"!==e.category?`<img src="${a}" alt="Team" class="logo">`:""}\n               </div>`:""}</td>\n                <td><strong>${e.name}</strong></td>\n                <td><span style="background: #ff2e2e; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">${e.typeCode}</span> ${e.type}</td>\n                <td>${e.data.gamesPlayed||"-"}</td>\n                <td>${s}</td>\n                <td class="points-column"><strong>${e.data.points||"-"}</strong></td>\n            </tr>\n        `;n.append(r)});const r=draftData.draftOrder[draftData.currentPickIndex];$("#draft-title").text(`Draft : ${currentClan}`),$("#draft-status").html(`\n        <div>\n            <p><strong>Tour actuel :</strong> ${r}</p>\n            <p class="${r===e?"your-turn":"wait-turn"}">\n                ${r===e?"🎯 C'est votre tour !":"⏳ Veuillez attendre votre tour."}\n            </p>\n            <p style="margin-top: 10px;"><strong>Total de vos choix:</strong> ${s.length}</p>\n        </div>\n    `),updateProgressCounter()}function updateTable(){if(isDraftComplete()){$("#draft-status").html("\n            <div class=\"draft-status-box\">\n                <p style='color:green; font-weight: bold;'>🎉 Le draft est terminé !</p>\n                <p>Merci à tous les participants.</p>\n                <p>Toutes les équipes ont complété leurs sélections.</p>\n            </div>\n        "),$("#playerTable tbody").empty();const e=`confettiFired_${currentClan}`;return localStorage.getItem(e)||(localStorage.setItem(e,"true"),launchConfetti()),void(document.getElementById("finishButton").style.display="block")}const e=$("#playerFilter").val(),t=$("#searchInput").val().toLowerCase(),a=$("#availabilityFilter").val(),n=getUserTeam();if("pickedByTeam"===a&&n&&draftData.teams[n])return void populateMyPicksTable(n,t);const s=new Set;Object.values(draftData.teams).forEach(e=>{[].concat(e.offensive||[],e.defensive||[],e.rookie||[],e.goalie||[],e.teams||[]).forEach(e=>s.add(e))});const r=$("#sortBy");if(r.empty(),"goalies"===e){r.append('<option value="points">Points</option>'),r.append('<option value="gamesPlayed">Matchs joués</option>'),r.append('<option value="wins">Victoires</option>'),r.append('<option value="Saves %">SV%</option>'),$("#tableHeaderRow").html("\n            <th>Photo</th>\n            <th>Gardien</th>\n            <th>GP</th>\n            <th>W</th>\n            <th>L</th>\n            <th>OTL</th>\n            <th>SV%</th>\n            <th>SO</th>\n            <th class='points-column'>PTS</th>\n            <th class='action-column'>Action</th>\n        "),r.val(currentSortBy);return void populateGoalieTable(_availFilter(goalieData,"goalieFullName","G",s,a,n).filter(e=>!t||(e.goalieFullName||"").toLowerCase().includes(t)).sort((e,t)=>t[currentSortBy]-e[currentSortBy]))}if("teams"===e){r.append('<option value="wins">Victoires</option>'),r.append('<option value="points">Points</option>'),$("#tableHeaderRow").html("\n            <th>Logo</th>\n            <th>Équipe</th>\n            <th>GP</th>\n            <th>Victoires</th>\n            <th>Défaites</th>\n            <th>OTL</th>\n            <th class='points-column'>Points</th>\n            <th class='action-column'>Action</th>\n        ");return void populateTeamTable(_availFilter(teamData,"teamFullName","T",s,a,n).filter(e=>!t||(e.teamFullName||"").toLowerCase().includes(t)).sort((e,t)=>t[currentSortBy]-e[currentSortBy]))}["offensive","defensive","rookies","all"].includes(e)&&(r.append('<option value="points">Points</option>'),r.append('<option value="gamesPlayed">Matchs joués</option>'),r.append('<option value="goals">Buts</option>'),r.append('<option value="assists">Passes</option>'),$("#tableHeaderRow").html("\n            <th>Photo</th>\n            <th>Joueur</th>\n            <th>GP</th>\n            <th>G</th>\n            <th>A</th>\n            <th class='points-column'>PTS</th>\n            <th class='action-column'>Action</th>\n        ")),r.val(currentSortBy);let o=[];if(o="rookies"===e?fullPlayerData.filter(e=>(e.gamesPlayed<=27||null===e.playerId||null===e.teamAbbrevs)&&"Tyler Seguin"!==e.skaterFullName).map(e=>({...e,positionCode:"*"})):"all"===e?fullPlayerData.map(e=>{const t=(e.gamesPlayed<=27||null===e.playerId||null===e.teamAbbrevs)&&"Tyler Seguin"!==e.skaterFullName;return{...e,positionCode:t?"*":e.positionCode}}):fullPlayerData,"offensive"===e?o=o.filter(e=>["C","R","L"].includes(e.positionCode)):"defensive"===e&&(o=o.filter(e=>"D"===e.positionCode)),"available"===a)o=o.filter(e=>!s.has(e.skaterFullName)).filter(e=>!_isCategoryFull(e.positionCode));else if("picked"===a)o=o.filter(e=>s.has(e.skaterFullName));else if("pickedByTeam"===a)if(n&&draftData.teams[n]){const e=draftData.teams[n];o=o.filter(t=>e.offensive.includes(t.skaterFullName)||e.defensive.includes(t.skaterFullName)||e.rookie?.includes(t.skaterFullName)||e.goalie?.includes(t.goalieFullName||t.skaterFullName)||e.teams?.includes(t.teamFullName))}else o=[];t&&(o=o.filter(e=>e.skaterFullName.toLowerCase().includes(t))),o.sort((e,t)=>t[currentSortBy]-e[currentSortBy]),populateTable(o)}function populateGoalieTable(e){const t=$("#playerTable tbody");t.empty(),e.forEach(e=>{const a=e.goalieFullName,n=e.playerId,s=getCurrentPlayerStats(a,n),r=s?.headshot,o=getMatchingImage(a),l=r||o,i=s?.teamAbbrev?`teams/${s.teamAbbrev}.png`:getTeamLogoPath(e.teamAbbrevs),c=`\n            <tr class="clickable-player-row" data-playerid="${n}" data-playername="${a}" data-isgoalie="true" style="cursor: pointer;" tabindex="0" role="button" aria-label="Voir les statistiques de carrière de ${a}">\n                <td>${l&&i?`<div class="player-photo">\n                    <img src="${l}" alt="${a}" class="face">\n                    <img src="${i}" alt="${s?.teamAbbrev||e.teamAbbrevs}" class="logo">\n               </div>`:""}</td>\n                <td>${a}</td>\n                <td>${e.gamesPlayed}</td>\n                <td>${e.wins}</td>\n                <td>${e.losses}</td>\n                <td>${e.otLosses}</td>\n                <td>${e.savePct?.toFixed(3)}</td>\n                <td>${e.shutouts}</td>\n                <td class="points-column">${e.points}</td>\n                <td class='action-column' onclick="event.stopPropagation();">\n                ${isUserTurn()&&!checkIfUserTeamIsDone()?`<button class="select-button" onclick="selectPlayer('${a}', 'G')" aria-label="Sélectionner ${a}">\n                            <img src="Icons/sign.png" alt="" class="select-icon" />\n                        </button>`:""}\n                </td>\n            </tr>\n        `;t.append(c)})}function populateTeamTable(e){const t=$("#playerTable tbody");t.empty(),e.forEach(e=>{const a=`\n            <tr>\n                <td><img src="${`teams/${getTeamAbbreviation(e.teamFullName)}.png`}" alt="${e.teamFullName}" class="logo" style="width:40px;"></td>\n                <td>${e.teamFullName}</td>\n                <td>${e.gamesPlayed}</td>\n                <td>${e.wins}</td>\n                <td>${e.losses}</td>\n                <td>${e.otLosses}</td>\n                <td class="points-column">${e.points}</td>\n                <td class='action-column'>\n                ${isUserTurn()&&!checkIfUserTeamIsDone()?`<button class="select-button" onclick="selectPlayer('${e.teamFullName}', 'T')" aria-label="Sélectionner ${e.teamFullName}">\n                            <img src="Icons/sign.png" alt="" class="select-icon" />\n                        </button>`:""}\n                </td>\n            </tr>\n        `;t.append(a)})}function getTeamAbbreviation(e){const t={Florida:"FLA",Calgary:"CGY","Montréal":"MTL",Nashville:"NSH",Louis:"STL",Washington:"WSH",Toronto:"TOR",Winnipeg:"WPG",Utah:"UTA",Detroit:"DET"},a=e.split(" ");return t[a[0]]?t[a[0]]:t[a[1]]?t[a[1]]:3===a.length?a.map(e=>e[0]).join("").toUpperCase():a[0].substring(0,3).toUpperCase()}function getUserTeam(){if(draftData&&draftData.teams)return Object.entries(draftData.teams).find(([e,t])=>t.members.includes(username))?.[0]}function isUserTurn(){return draftData.draftOrder[draftData.currentPickIndex]===getUserTeam()}function checkIfUserTeamIsDone(){const e=getUserTeam();if(!e||!draftData.teams[e])return!1;const t=draftData.config||{numOffensive:6,numDefensive:4,numGoalies:1,numRookies:1,numTeams:1},a=draftData.teams[e];return a.offensive.length===t.numOffensive&&a.defensive.length===t.numDefensive&&a.rookie?.length===t.numRookies&&a.goalie?.length===t.numGoalies&&a.teams?.length===t.numTeams}function checkIfAllTeamsAreDone(){if(!draftData||!draftData.teams)return!1;const e=draftData.config||{numOffensive:6,numDefensive:4,numGoalies:1,numRookies:1,numTeams:1},t=Object.values(draftData.teams).filter(e=>e.members&&e.members.length>0);return 0!==t.length&&t.every(t=>(t.offensive||[]).length===e.numOffensive&&(t.defensive||[]).length===e.numDefensive&&(t.rookie||[]).length===e.numRookies&&(t.goalie||[]).length===e.numGoalies&&(t.teams||[]).length===e.numTeams)}function isDraftComplete(){return Array.isArray(draftData.draftOrder)&&draftData.draftOrder.length>0&&checkIfAllTeamsAreDone()}


function isDraftNotStarted(){return !draftData||!Array.isArray(draftData.draftOrder)||draftData.draftOrder.length===0}function populateTable(e){const t=$("#playerTable tbody");if(t.empty(),!draftData||!draftData.draftOrder||!draftData.teams)return;if(isDraftComplete())return $("#draft-status").html("\n            <div class=\"draft-status-box\">\n                <p style='color:green; font-weight: bold;'>🎉 Le draft est terminé !</p>\n                <p>Merci à tous les participants.</p>\n                <p>Toutes les équipes ont complété leurs sélections.</p>\n            </div>\n        "),void $("#playerTable tbody").empty();const a=getUserTeam(),n=draftData.draftOrder[draftData.currentPickIndex];$("#draft-title").text(`Draft : ${currentClan}`),$("#draft-status").html(`\n    <div>\n        <p><strong>Tour actuel :</strong> ${n}</p>\n        <p class="${n===a?"your-turn":"wait-turn"}">\n        ${n===a?"🎯 C'est votre tour !":"⏳ Veuillez attendre votre tour."}\n        </p>\n    </div>\n    `),e.forEach(e=>{const a=e.skaterFullName||e.goalieFullName||e.teamFullName,n=e.positionCode||(e.savePct?"G":e.teamFullName?"T":"R"),s=e.playerId,r="G"===n,o="T"===n,l=getCurrentPlayerStats(a,s),i=l?.headshot,c=getMatchingImage(a),d=i||c,u=l?.teamAbbrev?`teams/${l.teamAbbrev}.png`:getTeamLogoPath(e.teamAbbrevs),m=`\n            <tr ${!o&&s?`class="clickable-player-row" data-playerid="${s}" data-playername="${a}" data-isgoalie="${r}" style="cursor: pointer;" tabindex="0" role="button" aria-label="Voir les statistiques de carrière de ${a}"`:""}>\n                <td>${d&&u?`<div class="player-photo">\n                <img src="${d}" alt="${a}" class="face">\n                <img src="${u}" alt="${l?.teamAbbrev||e.teamAbbrevs}" class="logo">\n              </div>`:""}</td>\n                <td class="player-col">${a}<span class="player-pos">${typeof pickPositionLabel==="function"?pickPositionLabel(n):n}</span></td>\n                <td>${e.gamesPlayed}</td>\n                <td>${e.goals??"-"}</td>\n                <td>${e.assists??"-"}</td>\n                <td class="points-column">${e.points??"-"}</td>\n                <td class='action-column' onclick="event.stopPropagation();">\n                ${isUserTurn()&&!checkIfUserTeamIsDone()?`<button class="select-button" onclick="selectPlayer('${a}', '${n}')" aria-label="Sélectionner ${a}">\n                            <img src="Icons/sign.png" alt="" class="select-icon" />\n                        </button>`:""}\n                </td>\n            </tr>\n        `;t.append(m)})}async function commitPlayerPick(e,t){try{let a="offensive";"D"===t?a="defensive":"G"===t?a="goalie":"*"===t?a="rookie":"T"===t&&(a="teams");const n=await fetch(`${BASE_URL}/pick-player`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clanName:currentClan,username:username,playerName:e,position:a})}),s=await n.json(),r=n.ok?"success":"error";return notifyPickResult(s.message,r),n.ok&&await loadDraftData(),n.ok}catch(e){return console.error("Erreur lors de la sélection :",e),showCustomAlert("Une erreur est survenue lors de la sélection","error"),!1}}function renderTeamsOverview(){const e=$("#teamsContainer");if(e.empty(),!draftData||!draftData.teams)return;const t=getUserTeam(),a=draftData.teams[t];if(!a)return;const n=`\n        <div class="team-block">\n            <h4>${t}</h4>\n            <p><strong>Membres :</strong> ${a.members.join(", ")||"Aucun membre"}</p>\n        </div>\n    `;e.append(n)}function updateProgressCounter(){const e=getUserTeam();if(!e||!draftData.teams[e])return;const t=draftData.teams[e],a=draftData.config||{numOffensive:6,numDefensive:4,numGoalies:1,numRookies:1,numTeams:1},n={offensive:{current:(t.offensive||[]).length,max:a.numOffensive},defensive:{current:(t.defensive||[]).length,max:a.numDefensive},rookie:{current:(t.rookie||[]).length,max:a.numRookies},goalie:{current:(t.goalie||[]).length,max:a.numGoalies},team:{current:(t.teams||[]).length,max:a.numTeams}};Object.keys(n).forEach(e=>{const t=n[e],a=t.max>0?t.current/t.max*100:0;$(`#mini-progress-${e}`).css("transform",`scaleX(${a/100})`),t.current>=t.max?($(`#mini-progress-${e}`).addClass("complete"),$(`#count-${e}`).addClass("complete").removeClass("in-progress")):t.current>0?($(`#mini-progress-${e}`).removeClass("complete"),$(`#count-${e}`).addClass("in-progress").removeClass("complete")):($(`#mini-progress-${e}`).removeClass("complete"),$(`#count-${e}`).removeClass("complete in-progress")),$(`#count-${e}`).text(`${t.current}/${t.max}`)})}function updateDraftHeader(){if(!draftData||!draftData.draftOrder)return;const e=draftData.currentPickIndex||0,t=e+1,a=draftData.draftOrder[e];$("#current-pick-number").text(t),$("#current-pick-team").text(a||""),(function(){const el=document.getElementById("draft-clan-name");if(!el)return;const img=draftData.imageUrl?`<img src="${draftData.imageUrl}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:8px;flex-shrink:0;" onerror="this.style.display='none'" alt="">`:("");el.innerHTML=img+(currentClan||"");}())}function renderRecentPicks(){if(!draftData)return;if(typeof renderPickCarousel!=="function")return;renderPickCarousel(draftData.picksHistory||[])}function renderSelectedPlayers(){const e=$("#selectedPlayersContainer");e.empty();const t=getUserTeam();if(!t||!draftData.teams[t])return;const a=draftData.teams[t],n=$("#selectedFilter").val();$("#selectedSort").val();let s=[];"offensive"!==n&&"all"!==n||(s=s.concat(a.offensive.map(e=>({name:e,type:"offensive"})))),"defensive"!==n&&"all"!==n||(s=s.concat(a.defensive.map(e=>({name:e,type:"defensive"})))),"goalies"!==n&&"all"!==n||(s=s.concat(a.goalie?.map(e=>({name:e,type:"goalie"}))||[])),"rookies"!==n&&"all"!==n||(s=s.concat(a.rookie?.map(e=>({name:e,type:"rookie"}))||[])),"teams"!==n&&"all"!==n||(s=s.concat(a.teams?.map(e=>({name:e,type:"team"}))||[])),s.reverse();const r=$("<ul class='selected-list'></ul>");s.forEach(e=>{const t=fullPlayerData.find(t=>t.skaterFullName===e.name)||goalieData.find(t=>t.goalieFullName===e.name)||teamData.find(t=>t.teamFullName===e.name),a=t?.points??"-",n=t?.assists??"-",s=`\n            <li>\n                <strong>${e.name}</strong> (${e.type}) – ${a} pts${"offensive"===e.type||"defensive"===e.type||"rookie"===e.type?`, ${n} passes`:""}\n            </li>\n        `;r.append(s)}),e.append(r)}function launchConfetti(){const e=Date.now()+3e3,t={startVelocity:30,spread:360,ticks:60,zIndex:1e3},a=setInterval(function(){const n=e-Date.now();if(n<=0)return void clearInterval(a);const s=n/3e3*50;confetti(Object.assign({},t,{particleCount:s,origin:{x:Math.random(),y:Math.random()-.2}}))},250)}function showProgressDetails(e){const t=$("#progressDetailsList");if(!e)return void t.hide();const a=getUserTeam();if(!a||!draftData.teams[a])return void t.hide();const n=draftData.teams[a];let s=[],r="",o="";switch(e){case"offensive":s=n.offensive||[],r="Attaquants",o="Aucun attaquant sélectionné";break;case"defensive":s=n.defensive||[],r="Défenseurs",o="Aucun défenseur sélectionné";break;case"rookie":s=n.rookie||[],r="Recrues",o="Aucune recrue sélectionnée";break;case"goalie":s=n.goalie||[],r="Gardien",o="Aucun gardien sélectionné";break;case"team":s=n.teams||[],r="Équipe",o="Aucune équipe sélectionnée"}if(0===s.length)t.html(`<div class="no-picks">${o}</div>`);else{const a=s.map(t=>{const a=fullPlayerData.find(e=>e.skaterFullName===t)||goalieData.find(e=>e.goalieFullName===t)||teamData.find(e=>e.teamFullName===t),n=getCurrentPlayerStats(t,a?.playerId);let s=null;if("team"===e){const e=getTeamAbbreviation(t);s=e?`teams/${e}.png`:null}else n?.teamAbbrev?s=`teams/${n.teamAbbrev}.png`:a?.teamAbbrevs&&(s=getTeamLogoPath(a.teamAbbrevs));const r=getMatchingImage(t);return`\n                <div class="progress-player-item">\n                    ${r?`<div class="progress-player-photo">\n                    <img src="${r}" alt="${t}" class="face">\n                    ${s&&"team"!==e?`<img src="${s}" alt="Team" class="logo">`:""}\n                   </div>`:s&&"team"===e?`<div class="progress-player-photo"><img src="${s}" alt="${t}" class="face"></div>`:'<div class="progress-player-photo no-image">?</div>'}\n                    <div class="progress-player-name">${t}</div>\n                </div>\n            `}).join("");t.html(`\n            <div class="progress-details-header">${r} sélectionnés (${s.length})</div>\n            <div class="progress-players-grid">${a}</div>\n        `)}t.show()}function getTeamLogoPath(e){if(!e||"null"===e)return null;return`teams/${e.split(",").pop().trim()}.png`}async function showCareerStats(e,t,a=!1){const n=document.getElementById("careerStatsModal"),s=document.getElementById("careerModalHeader"),r=document.getElementById("careerPlayerName"),o=document.getElementById("careerPlayerPosition"),l=document.getElementById("careerPlayerTeam"),i=document.getElementById("playerHeadshotContainer"),c=document.getElementById("loadingSpinner"),d=document.getElementById("careerFilters"),u=document.getElementById("careerStatsTable"),p=document.getElementById("careerSeasonHighlight"),g=document.getElementById("careerNameBanner");n.style.display="block",document.body.style.overflow="hidden",c.style.display="block",s.style.display="none",g.style.display="none",d.style.display="none",u.innerHTML="",document.getElementById("leagueFilter").value="nhl",document.getElementById("gameTypeFilter").value="regular";try{const t=await fetch(`${BASE_URL}/player-career/${e}`);if(!t.ok)throw new Error("Failed to fetch career stats");const a=await t.json();if(currentCareerData=a,c.style.display="none",s.style.display="flex",d.style.display="flex",r.textContent=a.playerName,o.textContent=a.isGoalie?"🥅 Gardien de but":"🏒 "+(a.position||"Joueur"),a.currentTeam){const e=getTeamLogoPath(a.currentTeam);l.innerHTML=e?`<img src="${e}" alt="${a.currentTeam}"> ${a.currentTeam}`:a.currentTeam}else l.textContent="";g.style.display="block";const tc=getTeamColors(a.currentTeam);g.style.setProperty("--team-primary",tc[0]),g.style.setProperty("--team-secondary",tc[1]);if(a.headshot?i.innerHTML=`<img src="${a.headshot}" alt="${a.playerName}">`:i.innerHTML='<div class="no-photo">🏒</div>',document.getElementById("playerHeight").textContent=a.height||"-",document.getElementById("playerWeight").textContent=a.weight?`${a.weight} lb`:"-",a.birthDate){const e=new Date(a.birthDate),t=new Date;let n=t.getFullYear()-e.getFullYear();const s=t.getMonth()-e.getMonth();(s<0||0===s&&t.getDate()<e.getDate())&&n--,document.getElementById("playerBirthDate").textContent=`${a.birthDate} (${n})`}else document.getElementById("playerBirthDate").textContent="-";let n="";if(a.birthCity&&(n+=a.birthCity),a.birthStateProvince&&(n+=(n?", ":"")+(PROV_ABBR[a.birthStateProvince]||a.birthStateProvince)),document.getElementById("playerBirthPlace").textContent=n||"-",a.draftInfo){const e=a.draftInfo,t=`${e.year}: Rd ${e.round}, Ch. ${e.pickInRound} (${e.teamAbbrev})`;document.getElementById("playerDraft").textContent=t}else document.getElementById("playerDraft").textContent="Non repêché";if(p){const cs=currentStats&&currentStats.players?currentStats.players.find(x=>x.playerId===e):null,pool=currentStats&&currentStats.players?currentStats.players.filter(x=>(x.position==="G")===a.isGoalie):[];if(cs&&pool.length){const rankOf=k=>{const sorted=[...pool].sort((x,y)=>(y[k]||0)-(x[k]||0)),v=cs[k]||0;let rank=1;for(let i=0;i<sorted.length;i++){if(i>0&&(sorted[i][k]||0)!==(sorted[i-1][k]||0))rank=i+1;if(sorted[i].playerId===cs.playerId)break}const tied=sorted.filter(x=>(x[k]||0)===v).length>1,ord=n=>{const s2=["th","st","nd","rd"],v2=n%100;return n+(s2[(v2-20)%10]||s2[v2]||s2[0])};return(tied?"Tied-":"")+ord(rank)},tiles=a.isGoalie?[["W","wins"],["SO","shutouts"],["GP","gamesPlayed"]]:[["G","goals"],["A","assists"],["PTS","points"]],ss=String(currentStats.season||""),sd=8===ss.length?`${ss.slice(0,4)}-${ss.slice(6,8)}`:ss;p.innerHTML=`<div class="cmh-season-label">Saison ${sd}</div><div class="cmh-season-tiles">`+tiles.map(([lb,k])=>`<div class="cmh-season-tile"><span class="cmh-mini-lbl">${lb}</span><span class="cmh-season-val">${cs[k]||0}</span><span class="cmh-season-rank">${rankOf(k)}</span></div>`).join("")+"</div>",p.style.display="block"}else p.style.display="none"}filterCareerStats()}catch(e){console.error("Error fetching career stats:",e),c.style.display="none",u.innerHTML='<p class="no-stats-message">❌ Erreur lors du chargement des statistiques</p>'}}function filterCareerStats(){if(!currentCareerData)return;const e=document.getElementById("leagueFilter").value,t=document.getElementById("gameTypeFilter").value,a=document.getElementById("careerStatsTable"),n=document.getElementById("statsCountBadge");let s=currentCareerData.seasons.filter(a=>{const n="all"===e||"nhl"===e&&"NHL"===a.league||"other"===e&&"NHL"!==a.league,s="all"===t||"regular"===t&&"regular"===a.gameType||"playoffs"===t&&"playoffs"===a.gameType;return n&&s});if(n.textContent=`${s.length} saison${s.length>1?"s":""} affichée${s.length>1?"s":""}`,0===s.length)return void(a.innerHTML='<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés</p>');let r="<table><thead><tr>";if(currentCareerData.isGoalie?r+='\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>W</th>\n            <th>L</th>\n            <th>OTL</th>\n            <th>SV%</th>\n            <th>GAA</th>\n            <th>SO</th>\n        ':r+='\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>G</th>\n            <th>A</th>\n            <th>PTS</th>\n            <th>+/-</th>\n            <th>PIM</th>\n            <th>SOG</th>\n        ',r+="</tr></thead><tbody>",s.forEach(e=>{r+="<tr>",r+=`<td class="season-col">${e.season}</td>`,r+=`<td class="league-col">${e.league}</td>`,r+=`<td class="team-col">${e.team?`<img src="teams/${e.team}.png" alt="${e.team}" title="${e.team}" onerror="this.style.opacity='0.3'">`:"-"}</td>`,r+=`<td>${e.gp}</td>`,currentCareerData.isGoalie?r+=`\n                <td>${e.wins}</td>\n                <td>${e.losses}</td>\n                <td>${e.otLosses}</td>\n                <td>${e.savePct?e.savePct.toFixed(3):"0.000"}</td>\n                <td>${e.gaa?e.gaa.toFixed(2):"0.00"}</td>\n                <td>${e.shutouts}</td>\n            `:r+=`\n                <td>${e.goals}</td>\n                <td>${e.assists}</td>\n                <td>${e.points}</td>\n                <td>${e.plusMinus>=0?"+"+e.plusMinus:e.plusMinus}</td>\n                <td>${e.pim}</td>\n                <td>${e.shots}</td>\n            `,r+="</tr>"}),"nhl"===e&&s.length>0){const e={gp:0,goals:0,assists:0,points:0,plusMinus:0,pim:0,shots:0,wins:0,losses:0,otLosses:0,shutouts:0,gamesForAvg:0,totalGAA:0,totalSVPct:0};if(s.forEach(t=>{e.gp+=t.gp||0,currentCareerData.isGoalie?(e.wins+=t.wins||0,e.losses+=t.losses||0,e.otLosses+=t.otLosses||0,e.shutouts+=t.shutouts||0,t.gaa&&t.gp>0&&(e.totalGAA+=t.gaa*t.gp,e.gamesForAvg+=t.gp),t.savePct&&(e.totalSVPct+=t.savePct)):(e.goals+=t.goals||0,e.assists+=t.assists||0,e.points+=t.points||0,e.plusMinus+=t.plusMinus||0,e.pim+=t.pim||0,e.shots+=t.shots||0)}),r+='<tr class="career-totals-row">',r+='<td colspan="3" class="career-totals-label">Carrière</td>',r+=`<td>${e.gp}</td>`,currentCareerData.isGoalie){const t=e.gamesForAvg>0?(e.totalGAA/e.gamesForAvg).toFixed(2):"0.00",a=s.length>0?(e.totalSVPct/s.length).toFixed(3):"0.000";r+=`\n                <td>${e.wins}</td>\n                <td>${e.losses}</td>\n                <td>${e.otLosses}</td>\n                <td>${a}</td>\n                <td>${t}</td>\n                <td>${e.shutouts}</td>\n            `}else r+=`\n                <td>${e.goals}</td>\n                <td>${e.assists}</td>\n                <td>${e.points}</td>\n                <td>${e.plusMinus>=0?"+"+e.plusMinus:e.plusMinus}</td>\n                <td>${e.pim}</td>\n                <td>${e.shots}</td>\n            `;r+="</tr>"}r+="</tbody></table>",a.innerHTML=r}function closeCareerModal(){document.getElementById("careerStatsModal").style.display="none",document.body.style.overflow="",currentCareerData=null}$("#sortBy").on("change",function(){currentSortBy=$(this).val(),updateTable()}),$("#toggleSelectedPlayers").on("click",function(){const e=$("#selectedPlayersContent"),t=e.is(":visible");e.slideToggle(200),$(this).text(t?"+":"−")}),$("#toggleTeamsOverview").on("click",function(){const e=$("#teamsContainer"),t=e.is(":visible");e.slideToggle(200),$(this).text(t?"+":"−")}),$("#availabilityFilter").on("change",updateTable),$("#searchInput").on("input",updateTable),$("#playerFilter").on("change",updateTable),$("#sortBy").on("change",updateTable),$("#selectedFilter").on("change",renderSelectedPlayers),$("#progressFilter").on("change",function(){showProgressDetails($(this).val())}),$("#carousel-prev").on("click",function(){this.disabled||scrollPickCarousel(-1)}),$("#carousel-next").on("click",function(){this.disabled||scrollPickCarousel(1)}),$(document).on("click",".clickable-player-row",function(){const e=$(this).data("playerid"),t=$(this).data("playername"),a=!0===$(this).data("isgoalie")||"true"===$(this).data("isgoalie");e&&t&&showCareerStats(e,t,a)}).on("keydown",".clickable-player-row",function(n){if("Enter"!==n.key&&" "!==n.key)return;n.preventDefault();const e=$(this).data("playerid"),t=$(this).data("playername"),a=!0===$(this).data("isgoalie")||"true"===$(this).data("isgoalie");e&&t&&showCareerStats(e,t,a)}),document.addEventListener("click",function(e){const t=document.getElementById("careerStatsModal");e.target===t&&closeCareerModal()});



(function () {
    const BASE_TITLE = "Draft Actif";
    let flashTimer = null;
    let wasMyTurn = false;

    function stopTitleFlash() {
        if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
        document.title = BASE_TITLE;
    }

    function startTitleFlash() {
        if (flashTimer) return;
        let on = true;
        document.title = "🎯 À vous !";
        flashTimer = setInterval(function () {
            document.title = on ? BASE_TITLE : "🎯 À vous !";
            on = !on;
        }, 1000);
    }

    

    let audioCtx = null;

    function unlockAudio() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === "suspended") audioCtx.resume();
        } catch (e) {  }
    }

    function playTurnSound() {
        try {
            if (!audioCtx) return;              
            if (audioCtx.state === "suspended") audioCtx.resume();
            const ctx = audioCtx;
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = "sine"; o.frequency.value = 880;
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
            o.start(); o.stop(ctx.currentTime + 0.45);
        } catch (e) {  }
    }

    

    function vibrateTurn() {
        try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {}
    }

    function notifyTurn() {
        try {
            if (!("Notification" in window)) return;
            if (Notification.permission !== "granted") return;
            if (!document.hidden) return;       
            const n = new Notification("C'est votre tour !", {
                body: "Le repêchage vous attend — sélectionnez un joueur.",
                tag: "fantazy-tour",            
                renotify: true
            });
            n.onclick = function () { window.focus(); n.close(); };
        } catch (e) {}
    }

    

    function onFirstGesture() {
        unlockAudio();
        try {
            if ("Notification" in window
                && Notification.permission === "default"
                && !localStorage.getItem("fzNotifAsked")) {
                localStorage.setItem("fzNotifAsked", "1");
                Notification.requestPermission();
            }
        } catch (e) {}
        document.removeEventListener("pointerdown", onFirstGesture);
        document.removeEventListener("keydown", onFirstGesture);
    }
    document.addEventListener("pointerdown", onFirstGesture, { passive: true });
    document.addEventListener("keydown", onFirstGesture);

    function picksUntilMyTurn() {
        if (!draftData || !Array.isArray(draftData.draftOrder)) return -1;
        const me = (typeof getUserTeam === "function") ? getUserTeam() : null;
        if (!me) return -1;
        const start = draftData.currentPickIndex || 0;
        for (let i = start; i < draftData.draftOrder.length; i++) {
            if (draftData.draftOrder[i] === me) return i - start;
        }
        return -1;
    }

    

    function appliquerIdentiteBanniere(equipePool) {
        const banner = document.getElementById("turn-banner");
        const zoneLogo = document.getElementById("turn-banner-logo");
        const imgLogo = document.getElementById("turn-banner-logo-img");
        if (!banner) return;

        const club = (equipePool && typeof resolveDrafterClub === "function")
            ? resolveDrafterClub(equipePool) : null;

        if (club && typeof getTeamColors === "function") {
            const [couleurA, couleurB] = getTeamColors(club.abbrev);
            banner.style.setProperty("--team-a", mixHex(couleurA, PICK_CARD_BASE, pickCardMuteRatio(couleurA)));
            banner.style.setProperty("--team-b", mixHex(couleurB, PICK_CARD_BASE, pickCardMuteRatio(couleurB) + 0.10));
            
            
            banner.style.setProperty("--team-deep", mixHex(couleurA, PICK_CARD_BASE_DEEP, 0.86));
        } else {
            banner.style.removeProperty("--team-a");
            banner.style.removeProperty("--team-b");
            banner.style.removeProperty("--team-deep");
        }
        
        
        
        banner.classList.toggle("is-unbranded", !club);

        if (zoneLogo && imgLogo) {
            if (club && club.logo) {
                imgLogo.src = club.logo;
                imgLogo.alt = club.abbrev || "";
                zoneLogo.hidden = false;
            } else {
                zoneLogo.hidden = true;
                imgLogo.removeAttribute("src");
            }
        }
    }

    


    
    function arreterDefilement() {
        const zone = document.getElementById("turn-banner-marquee");
        const corps = document.getElementById("turn-banner-body");
        if (zone) zone.hidden = true;
        if (corps) corps.hidden = false;
        dernierContenuDefilement = null; 
    }

    

    const PICK_RECENT_MS = 5000;
    let dernierLongueurHistorique = null;
    let finPickRecent = 0;
    let minuteurPickRecent = null;

    function noterChoixRecent(historique) {
        if (dernierLongueurHistorique !== null && historique.length > dernierLongueurHistorique) {
            finPickRecent = Date.now() + PICK_RECENT_MS;
            clearTimeout(minuteurPickRecent);
            minuteurPickRecent = setTimeout(function () {
                try { refreshTurnAlert(); } catch (e) {}
            }, PICK_RECENT_MS + 50);
        }
        dernierLongueurHistorique = historique.length;
    }

    

    function contextePanneau() {
        if (!draftData || !Array.isArray(draftData.draftOrder)) return "";
        const total = draftData.draftOrder.length;
        const idx = Math.min(draftData.currentPickIndex || 0, total);
        const teams = new Set(draftData.draftOrder).size || 1;
        const totalRondes = Math.ceil(total / teams);
        const ronde = Math.min(Math.floor(idx / teams) + 1, totalRondes);
        return `Choix ${Math.min(idx + 1, total)} sur ${total} · Ronde ${ronde} de ${totalRondes}`;
    }

    

    const FZ_LABELS_MANQUE = {
        offensive: ["attaquant", "attaquants"],
        defensive: ["défenseur", "défenseurs"],
        rookie: ["recrue", "recrues"],
        goalie: ["gardien", "gardiens"]
    };
    function texteManques() {
        const me = typeof getUserTeam === "function" ? getUserTeam() : null;
        if (!me || !draftData || !draftData.teams || !draftData.teams[me]) return "";
        const cfg = draftData.config || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1 };
        const equipe = draftData.teams[me];
        const groupes = [
            ["defensive", (cfg.numDefensive ?? 4) - (equipe.defensive || []).length],
            ["goalie", (cfg.numGoalies ?? 1) - (equipe.goalie || []).length],
            ["offensive", (cfg.numOffensive ?? 6) - (equipe.offensive || []).length],
            ["rookie", (cfg.numRookies ?? 1) - (equipe.rookie || []).length]
        ].filter(function (g) { return g[1] > 0; });
        if (!groupes.length) return "";
        const morceaux = groupes.map(function (g) {
            const n = g[1];
            const labels = FZ_LABELS_MANQUE[g[0]];
            return `${n} ${labels[n === 1 ? 0 : 1]}`;
        });
        if (morceaux.length === 1) return morceaux[0];
        return morceaux.slice(0, -1).join(", ") + " et " + morceaux[morceaux.length - 1];
    }

    

    function appliquerPanneauTour(myTurn) {
        const hero = document.getElementById("turn-banner-hero");
        const metric = document.getElementById("turn-banner-metric");
        const num = document.getElementById("turn-banner-metric-num");
        const label = document.getElementById("turn-banner-metric-label");
        const needs = document.getElementById("turn-banner-needs");
        const needsVal = document.getElementById("turn-banner-needs-value");
        const actions = document.getElementById("turn-banner-actions");
        const cta = document.getElementById("turn-banner-cta");
        if (!hero) return;
        hero.hidden = false;

        if (metric) metric.hidden = !myTurn; 
        if (needs) {
            const manques = myTurn ? texteManques() : "";
            needs.hidden = !manques;
            if (needsVal) needsVal.textContent = manques;
        }
        if (actions && cta) {
            if (myTurn) {
                actions.hidden = false;
                cta.textContent = "Faire ma sélection";
                cta.className = "turn-banner-cta";
            } else {
                
                
                
                actions.hidden = true;
            }
        }
        if (!myTurn) {
            const away = picksUntilMyTurn();
            if (num) num.textContent = away >= 0 ? String(away) : "";
            if (label) label.innerHTML = "choix<br> avant vous";
            if (metric) metric.hidden = away < 0;
        } else if (label) {
            label.innerHTML = "depuis<br> votre tour";
        }
    }

    function refreshTurnAlert() {
        const banner = document.getElementById("turn-banner");
        const header = document.querySelector(".draft-header");
        const hero = document.getElementById("turn-banner-hero");
        const hasData = draftData && Array.isArray(draftData.draftOrder) && draftData.draftOrder.length > 0;
        const myTurn = hasData && typeof isUserTurn === "function" && isUserTurn();
        const done = typeof checkIfUserTeamIsDone === "function" && checkIfUserTeamIsDone();
        const away = picksUntilMyTurn();
        const historique = (draftData && draftData.picksHistory) || [];

        noterChoixRecent(historique);

        
        
        const texte = document.getElementById("turn-banner-text") || banner;
        const sousTexte = document.getElementById("turn-banner-sub");

        if (banner) {
            if (!hasData) {
                banner.className = "turn-banner";
                arreterDefilement();
                if (hero) hero.hidden = true;
                texte.textContent = "";
                if (sousTexte) sousTexte.textContent = "";
                appliquerIdentiteBanniere(null);
                banner.removeAttribute("aria-label");
            } else if (done || away === -1) {
                banner.className = "turn-banner done";
                arreterDefilement();
                if (hero) hero.hidden = true;
                texte.textContent = "✓ Vous avez complété tous vos choix";
                if (sousTexte) sousTexte.textContent = "";
                appliquerIdentiteBanniere(null);
                banner.removeAttribute("aria-label");
            } else if (myTurn) {
                banner.className = "turn-banner your-turn";
                arreterDefilement();
                appliquerIdentiteBanniere(null);
                texte.textContent = contextePanneau();
                if (sousTexte) sousTexte.textContent = "";
                appliquerPanneauTour(true);
                banner.setAttribute("aria-label", `C'est votre tour ! ${contextePanneau()}`);
            } else {
                banner.className = "turn-banner waiting" + (away === 1 ? " next" : "");
                arreterDefilement();
                appliquerIdentiteBanniere(null);
                const equipeActuelle = typeof currentTurnTeam === "function" ? currentTurnTeam() : null;
                texte.textContent = [contextePanneau(), equipeActuelle ? `${equipeActuelle} choisit` : ""]
                    .filter(Boolean).join(" · ");
                if (sousTexte) sousTexte.textContent = "";
                appliquerPanneauTour(false);
                banner.setAttribute("aria-label", `En attente. ${texte.textContent}`);
            }
        }
        if (header) header.classList.toggle("is-my-turn", !!(myTurn && !done));

        if (myTurn && !done) {
            if (!wasMyTurn) {
                
                
                
                
                playTurnSound();
                vibrateTurn();
                notifyTurn();
                if (document.hidden) startTitleFlash();
            }
        } else {
            stopTitleFlash();
        }
        wasMyTurn = !!(myTurn && !done);

        try { refreshTurnClock(); } catch (e) {  }
    }

    

    const SKIP_AFTER_MS = 180000;   
    let clockTimer = null;

    function formatElapsed(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(s / 60);
        if (m < 1) return s + " s";
        return m + " min";
    }

    

    function formatElapsedClock(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(s / 60);
        const reste = s % 60;
        return m + ":" + (reste < 10 ? "0" : "") + reste;
    }

    function currentTurnTeam() {
        if (!draftData || !Array.isArray(draftData.draftOrder)) return null;
        return draftData.draftOrder[draftData.currentPickIndex || 0] || null;
    }

    function isPoolCreator() {
        try {
            if (!draftData) return false;
            if (draftData.creator) return draftData.creator === username;
            
            
            const t = draftData.teams && draftData.teams["Équipe 1"];
            return !!(t && t.members && t.members[0] === username);
        } catch (e) { return false; }
    }

    function refreshTurnClock() {
        const clock = document.getElementById("turn-clock");
        const skip = document.getElementById("turn-skip-btn");
        const metricNum = document.getElementById("turn-banner-metric-num");
        if (!clock && !skip) return;

        const hasData = draftData && Array.isArray(draftData.draftOrder) && draftData.draftOrder.length > 0;
        const complete = typeof checkIfAllTeamsAreDone === "function" && hasData && checkIfAllTeamsAreDone();
        const started = Number(draftData && draftData.turnStartedAt) || 0;

        if (!hasData || complete || !started) {
            if (clock) clock.hidden = true;
            if (skip) skip.hidden = true;
            
            
            
            
            const metricEnAttenteDeDonnees = hasData && !complete && !started
                && typeof isUserTurn === "function" && isUserTurn();
            if (metricEnAttenteDeDonnees) {
                const metric = document.getElementById("turn-banner-metric");
                if (metric) metric.hidden = true;
            }
            stopClockTimer();
            syncLiveRow();
            return;
        }

        const elapsed = Date.now() - started;
        const monTour = typeof isUserTurn === "function" && isUserTurn();

        
        
        
        
        if (metricNum && monTour) metricNum.textContent = formatElapsedClock(elapsed);

        if (clock) {
            clock.hidden = false;
            clock.textContent = "· " + formatElapsed(elapsed);
            
            
            
            clock.classList.toggle("is-long", elapsed >= SKIP_AFTER_MS);
        }

        if (skip) {
            const eligible = elapsed >= SKIP_AFTER_MS
                && isPoolCreator()
                && currentTurnTeam() !== (typeof getUserTeam === "function" ? getUserTeam() : null);
            if (eligible) {
                skip.hidden = false;
                skip.textContent = "Sauter le tour de " + (currentTurnTeam() || "cette équipe");
            } else {
                skip.hidden = true;
            }
        }

        startClockTimer();
        syncLiveRow();
    }

    function startClockTimer() {
        if (clockTimer) return;
        clockTimer = setInterval(function () {
            try { refreshTurnClock(); } catch (e) { stopClockTimer(); }
        }, 5000);
    }
    function stopClockTimer() {
        if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    }
    window.addEventListener("beforeunload", stopClockTimer);

    

    function syncLiveRow() {
        const row = document.getElementById("draft-live-row");
        if (!row) return;
        const chip = document.getElementById("conn-chip");
        const skip = document.getElementById("turn-skip-btn");
        row.hidden = !((chip && !chip.hidden) || (skip && !skip.hidden));
    }
    window.fzSyncDraftLiveRow = syncLiveRow;

    

    document.addEventListener("DOMContentLoaded", function () {
        const skip = document.getElementById("turn-skip-btn");
        if (!skip) return;
        skip.addEventListener("click", async function () {
            const equipe = currentTurnTeam();
            if (!equipe) return;
            const ok = window.confirm(
                "Sauter le tour de " + equipe + " ?\n\n"
                + "Cette équipe perdra ce choix et le repêchage passera à la suivante. "
                + "L'action est définitive."
            );
            if (!ok) return;
            skip.disabled = true;
            try {
                const r = await fetch(BASE_URL + "/skip-turn", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ clanName: currentClan, username: username })
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    showCustomAlert(data.message || "Impossible de sauter ce tour.", "error");
                } else if (typeof loadDraftData === "function") {
                    loadDraftData();
                }
            } catch (e) {
                showCustomAlert("Connexion perdue — le tour n'a pas été sauté. Réessayez.", "error");
            } finally {
                skip.disabled = false;
            }
        });
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) stopTitleFlash();
    });
    window.addEventListener("beforeunload", stopTitleFlash);

    if (typeof updateDraftHeader === "function") {
        const orig = updateDraftHeader;
        updateDraftHeader = function () {
            orig.apply(this, arguments);
            try { refreshTurnAlert(); } catch (e) { console.error("turn alert:", e); }
        };
    }
    document.addEventListener("DOMContentLoaded", function () {
        setTimeout(function () { try { refreshTurnAlert(); } catch (e) {} }, 600);
        
        
        
        const cta = document.getElementById("turn-banner-cta");
        if (cta) cta.addEventListener("click", function () {
            if (typeof window.fzOuvrirListeJoueurs === "function") window.fzOuvrirListeJoueurs();
        });
    });
})();




(function () {
    function refreshOverallProgress() {
        if (!draftData || !Array.isArray(draftData.draftOrder)) return;
        const total = draftData.draftOrder.length;
        const wrap = document.getElementById("draft-overall-progress");
        if (!wrap || total === 0) { if (wrap) wrap.style.display = "none"; return; }

        const idx = draftData.currentPickIndex || 0;
        const done = Math.min(idx, total);
        const teams = new Set(draftData.draftOrder).size || 1;
        const totalRounds = Math.ceil(total / teams);
        const curRound = Math.min(Math.floor(done / teams) + 1, totalRounds);
        const complete = (typeof checkIfAllTeamsAreDone === "function" && checkIfAllTeamsAreDone()) || done >= total;

        const label = document.getElementById("dop-label");
        const round = document.getElementById("dop-round");
        const fill = document.getElementById("dop-fill");

        wrap.style.display = "block";
        if (label) label.textContent = complete
            ? "Repêchage terminé · " + total + " choix"
            : "Choix " + Math.min(done + 1, total) + " / " + total;
        if (round) round.textContent = complete ? "✓ Terminé" : "Ronde " + curRound + " / " + totalRounds;
        
        
        
        if (fill) fill.style.transform = "scaleX(" + ((complete ? total : done) / total) + ")";
    }

    
    function refreshTableEmptyState() {
        const tbody = document.querySelector("#playerTable tbody");
        if (!tbody) return;
        const complete = typeof isDraftComplete === "function" && draftData && draftData.draftOrder && isDraftComplete();
        if (complete) return; 
        if (tbody.children.length > 0) return;

        const search = (document.getElementById("searchInput")?.value || "").trim();
        const cols = document.querySelectorAll("#tableHeaderRow th").length || 7;
        const msg = search
            ? `Aucun joueur ne correspond à « ${search} »`
            : "Aucun joueur disponible pour ce filtre";
        tbody.innerHTML = `<tr class="draft-empty-row"><td colspan="${cols}">
            <div class="draft-empty">
                <span class="draft-empty-icon">🔍</span>
                <span>${msg}</span>
            </div></td></tr>`;
    }

    function afterTableRender() {
        try { refreshOverallProgress(); } catch (e) { console.error(e); }
        try { refreshTableEmptyState(); } catch (e) { console.error(e); }
    }

    if (typeof updateDraftHeader === "function") {
        const orig = updateDraftHeader;
        updateDraftHeader = function () { orig.apply(this, arguments); afterTableRender(); };
    }
    if (typeof updateTable === "function") {
        const origT = updateTable;
        updateTable = function () { origT.apply(this, arguments); try { refreshTableEmptyState(); } catch (e) {} };
    }
    document.addEventListener("DOMContentLoaded", function () {
        setTimeout(afterTableRender, 650);
    });
})();




function _isCategoryFull(positionCode) {
    try {
        if (typeof getUserTeam !== "function" || !draftData || !draftData.teams) return false;
        const me = getUserTeam();
        if (!me || !draftData.teams[me]) return false;
        const cfg = draftData.config || { numOffensive: 6, numDefensive: 4, numGoalies: 1, numRookies: 1, numTeams: 1 };
        const t = draftData.teams[me];
        if (positionCode === "*") return (t.rookie || []).length >= cfg.numRookies;
        if (positionCode === "D") return (t.defensive || []).length >= cfg.numDefensive;
        if (["C", "R", "L"].includes(positionCode)) return (t.offensive || []).length >= cfg.numOffensive;
        if (positionCode === "G") return (t.goalie || []).length >= cfg.numGoalies;
        if (positionCode === "T") return (t.teams || []).length >= cfg.numTeams;
        return false;
    } catch (e) { return false; }
}




function _availFilter(list, nameKey, positionCode, pickedSet, availability, userTeam) {
    let out = list.slice();
    if (availability === "picked") {
        out = out.filter(o => pickedSet.has(o[nameKey]));
    } else if (availability === "pickedByTeam") {
        if (userTeam && draftData && draftData.teams && draftData.teams[userTeam]) {
            const tm = draftData.teams[userTeam];
            const owned = new Set([].concat(tm.offensive || [], tm.defensive || [], tm.rookie || [], tm.goalie || [], tm.teams || []));
            out = out.filter(o => owned.has(o[nameKey]));
        } else {
            out = [];
        }
    } else {
        
        out = out.filter(o => !pickedSet.has(o[nameKey]));
        if (_isCategoryFull(positionCode)) out = [];
    }
    return out;
}




(function () {
    let etat = "ok";            
    let dernierEchecFetch = 0;

    function chip() { return document.getElementById("conn-chip"); }

    function rendre() {
        const c = chip();
        if (!c) return;

        if (etat === "ok") {
            c.hidden = true;
            c.className = "conn-chip";
        } else if (etat === "reconnecting") {
            c.hidden = false;
            c.className = "conn-chip is-reconnecting";
            c.textContent = "Reconnexion…";
        } else {
            c.hidden = false;
            c.className = "conn-chip is-offline";
            c.textContent = "Hors ligne — vos choix ne partiront pas";
        }

        
        
        
        
        const bloque = etat !== "ok";
        document.querySelectorAll("button.select-button").forEach(function (b) {
            b.setAttribute("aria-disabled", bloque ? "true" : "false");
            b.classList.toggle("is-connection-blocked", bloque);
        });

        if (typeof window.fzSyncDraftLiveRow === "function") window.fzSyncDraftLiveRow();
    }

    function setEtat(nouveau) {
        if (etat === nouveau) return;
        etat = nouveau;
        rendre();
    }

    
    document.addEventListener("click", function (e) {
        const b = e.target.closest && e.target.closest("button.select-button");
        if (!b) return;
        if (b.getAttribute("aria-disabled") !== "true") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof showCustomAlert === "function") {
            showCustomAlert(
                "Connexion perdue. Votre choix ne serait pas enregistré — "
                + "attendez le retour de la connexion, elle se rétablit toute seule.",
                "error"
            );
        }
    }, true);

    if (typeof socket !== "undefined" && socket) {
        socket.on("connect", function () { setEtat(navigator.onLine ? "ok" : "offline"); });
        socket.on("disconnect", function () { setEtat(navigator.onLine ? "reconnecting" : "offline"); });
        socket.on("connect_error", function () { setEtat(navigator.onLine ? "reconnecting" : "offline"); });
        if (socket.io && socket.io.on) {
            socket.io.on("reconnect", function () { setEtat("ok"); });
            socket.io.on("reconnect_attempt", function () { setEtat(navigator.onLine ? "reconnecting" : "offline"); });
        }
    }

    window.addEventListener("offline", function () { setEtat("offline"); });
    window.addEventListener("online", function () { setEtat("reconnecting"); });

    

    window.fzSignalFetchEchec = function () {
        const maintenant = Date.now();
        if (maintenant - dernierEchecFetch < 20000) setEtat(navigator.onLine ? "reconnecting" : "offline");
        dernierEchecFetch = maintenant;
    };
    window.fzSignalFetchOk = function () {
        dernierEchecFetch = 0;
        if (etat !== "ok" && navigator.onLine
            && (typeof socket === "undefined" || !socket || socket.connected)) {
            setEtat("ok");
        }
    };

    document.addEventListener("DOMContentLoaded", rendre);
})();




(function () {
    const POSITIONS = [
        { cle: "offensive", titre: "Attaquants",  quota: "numOffensive" },
        { cle: "defensive", titre: "Défenseurs",  quota: "numDefensive" },
        { cle: "rookie",    titre: "Recrues",     quota: "numRookies"   },
        { cle: "goalie",    titre: "Gardiens",    quota: "numGoalies"   },
        { cle: "teams",     titre: "Équipes NHL", quota: "numTeams"     }
    ];

    function carte() { return document.querySelector(".player-selection-card"); }

    function texte(el, valeur) { if (el) el.textContent = valeur; }

    

    function rendreAlignement(hote, equipe) {
        hote.textContent = "";
        if (!equipe) {
            const p = document.createElement("p");
            p.className = "draft-done-sub";
            p.textContent = "Vous suiviez ce repêchage sans y participer : il n'y a donc pas d'alignement à afficher.";
            hote.appendChild(p);
            return;
        }

        const cfg = (draftData && draftData.config) || {};
        POSITIONS.forEach(function (pos) {
            const joueurs = equipe[pos.cle] || [];
            const bloc = document.createElement("div");
            bloc.className = "ddr-group";

            const titre = document.createElement("h3");
            titre.className = "ddr-title";
            titre.textContent = pos.titre;
            const compte = document.createElement("span");
            compte.className = "ddr-count";
            compte.textContent = cfg[pos.quota] != null
                ? joueurs.length + " / " + cfg[pos.quota]
                : String(joueurs.length);
            titre.appendChild(compte);
            bloc.appendChild(titre);

            const liste = document.createElement("ul");
            liste.className = "ddr-list";
            if (joueurs.length === 0) {
                const vide = document.createElement("li");
                vide.className = "ddr-empty";
                vide.textContent = "Aucun";
                liste.appendChild(vide);
            } else {
                joueurs.forEach(function (nom) {
                    const li = document.createElement("li");
                    li.className = "ddr-item";
                    li.textContent = nom;
                    liste.appendChild(li);
                });
            }
            bloc.appendChild(liste);
            hote.appendChild(bloc);
        });
    }

    function rendreFin() {
        const panneau = document.getElementById("draftDonePanel");
        if (!panneau) return;

        const me = (typeof getUserTeam === "function") ? getUserTeam() : null;
        const equipe = (me && draftData && draftData.teams) ? draftData.teams[me] : null;
        const total = (draftData && draftData.draftOrder) ? draftData.draftOrder.length : 0;

        
        
        const pool = currentClan ? currentClan + " · " : "";
        texte(document.getElementById("draftDoneSub"),
            total
                ? pool + "Les " + total + " choix sont faits. Voici votre alignement pour la saison."
                : pool + "Tous les choix sont faits. Voici votre alignement pour la saison.");

        
        
        const histo = (draftData && draftData.picksHistory) || [];
        const dernier = histo.length ? histo[histo.length - 1] : null;
        const blocDernier = document.getElementById("draftDoneLast");
        if (blocDernier) {
            if (dernier && dernier.player) {
                blocDernier.hidden = false;
                texte(document.getElementById("draftDoneLastPlayer"), dernier.player);
                texte(document.getElementById("draftDoneLastTeam"), dernier.team || "");
            } else {
                blocDernier.hidden = true;
            }
        }

        const hote = document.getElementById("draftDoneRoster");
        if (hote) rendreAlignement(hote, equipe);

        panneau.hidden = false;
    }

    function appliquerEtat() {
        const c = carte();
        if (!c || !draftData) return;

        const pasCommence = typeof isDraftNotStarted === "function" && isDraftNotStarted();
        const termine = !pasCommence
            && typeof isDraftComplete === "function"
            && isDraftComplete();

        const fin = document.getElementById("draftDonePanel");
        const debut = document.getElementById("draftNotStartedPanel");

        c.classList.toggle("is-draft-done", termine);
        c.classList.toggle("is-draft-notstarted", pasCommence);

        if (debut) debut.hidden = !pasCommence;
        if (fin && !termine) fin.hidden = true;
        if (termine) rendreFin();

        

        const flottant = document.getElementById("finishButton");
        if (flottant) flottant.style.display = "none";
    }

    
    if (typeof updateTable === "function") {
        const orig = updateTable;
        updateTable = function () {
            orig.apply(this, arguments);
            try { appliquerEtat(); } catch (e) { console.error("état du repêchage :", e); }
        };
    }
    document.addEventListener("DOMContentLoaded", function () {
        setTimeout(function () {
            try { appliquerEtat(); } catch (e) {}
        }, 700);
    });
    window.fzAppliquerEtatRepechage = appliquerEtat;
})();
