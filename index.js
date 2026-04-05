let fullPlayerData = [],
    teamData = [],
    imageList = [],
    goalieData = [],
    currentStats = null,
    currentTeams = null;
const BASE_URL = window.location.hostname.includes("localhost") ? "http://localhost:3000" : window.location.origin;

function getCurrentPlayerStats(t, e) {
    if (!currentStats || !currentStats.players) return null;
    if (e) {
        const t = currentStats.players.find(t => t.playerId === e);
        if (t) return t
    }
    return currentStats.players.find(e => e.playerName === t)
}

function getCurrentTeamStats(t) {
    return currentTeams && currentTeams.teams ? currentTeams.teams.find(e => e.teamFullName === t) : null
}
async function fetchPlayerData() {
    showSkeletonLoader();
    try {
        const t = await fetch("nhl_filtered_stats.json");
        if (!t.ok) throw new Error(`Error: ${t.status} - ${t.statusText}`);
        const e = await t.json();
        fullPlayerData = [...e.Top_50_Defenders, ...e.Top_100_Offensive_Players, ...e.Top_Rookies], teamData = e.Teams, goalieData = e.Top_50_Goalies;
        try {
            const t = await fetch(`${BASE_URL}/current-stats`, {
                cache: "no-store"
            });
            currentStats = await t.json(), console.log(`✅ Current stats loaded: ${currentStats.players.length} players, last updated: ${currentStats.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current stats, using cached data:", t)
        }
        try {
            const t = await fetch(`${BASE_URL}/current-teams`, {
                cache: "no-store"
            });
            currentTeams = await t.json(), console.log(`✅ Current team standings loaded: ${currentTeams.teams.length} teams, last updated: ${currentTeams.lastUpdated}`)
        } catch (t) {
            console.warn("⚠️ Could not load current team standings, using cached data:", t)
        }
        updateTable(), hideSkeletonLoader()
    } catch (t) {
        console.error("Failed to fetch player data:", t), hideSkeletonLoader()
    }
}
async function fetchImageData() {
    if (imageList.length > 0) return;
    try {
        const t = await fetch("images.json");
        if (!t.ok) throw new Error(`Error: ${t.status} - ${t.statusText}`);
        imageList = await t.json()
    } catch (t) {
        console.error("Failed to fetch image data:", t)
    }
}

function getMatchingImage(t) {
    const e = t.replace(/\s/g, "_");
    return imageList.find(t => t.replace(/^faces\//, "").replace(/_\d{1,2}_\d{1,2}_\d{4}|_away/g, "").replace(".png", "") === e) || null
}

function getTeamLogoPath(t) {
    if (!t || "null" === t) return null;
    return `teams/${t.split(",").pop().trim()}.png`
}

function updateTable() {
    const t = document.getElementById("playerFilter").value,
        e = document.getElementById("sortBy").value,
        a = document.getElementById("searchInput").value.toLowerCase();
    if ("teams" === t) {
        return void populateTeamTable([...teamData].sort((t, e) => {
            const a = getCurrentTeamStats(t.teamFullName),
                n = getCurrentTeamStats(e.teamFullName),
                s = a ? a.points : t.points;
            return (n ? n.points : e.points) - s
        }))
    }
    if ("goalies" === t) {
        return void populateGoalieTable([...goalieData].sort((t, a) => {
            const n = getCurrentPlayerStats(t.goalieFullName, t.playerId),
                s = getCurrentPlayerStats(a.goalieFullName, a.playerId);
            let l = 0,
                o = 0;
            return "points" === e ? (l = n ? 5 * n.shutouts + 2 * n.wins + 1 * n.otLosses : t.points || 0, o = s ? 5 * s.shutouts + 2 * s.wins + 1 * s.otLosses : a.points || 0) : (l = n ? n[e] || 0 : t[e] || 0, o = s ? s[e] || 0 : a[e] || 0), o - l
        }))
    }
    let n = fullPlayerData;
    "offensive" === t ? n = n.filter(t => ["C", "R", "L"].includes(t.positionCode)) : "defensive" === t ? n = n.filter(t => "D" === t.positionCode) : "rookies" === t && (n = n.filter(t => t.gamesPlayed <= 27 || null === t.playerId || null === t.teamAbbrevs)), a && (n = n.filter(t => t.skaterFullName.toLowerCase().includes(a))), n.sort((t, a) => {
        const n = getCurrentPlayerStats(t.skaterFullName, t.playerId),
            s = getCurrentPlayerStats(a.skaterFullName, a.playerId),
            l = n ? n[e] || 0 : t[e] || 0,
            o = s ? s[e] || 0 : a[e] || 0;
        return (t.skaterFullName.includes("Barkov") || t.skaterFullName.includes("Tkachuk")) && console.log(`🔍 SORT ${t.skaterFullName}: sortBy=${e}, statsA=${!!n}, valueA=${l}, cachedValue=${t[e]}`), (a.skaterFullName.includes("Barkov") || a.skaterFullName.includes("Tkachuk")) && console.log(`🔍 SORT ${a.skaterFullName}: sortBy=${e}, statsB=${!!s}, valueB=${o}, cachedValue=${a[e]}`), o - l
    }), populatePlayerTable(n)
}
async function populatePlayerTable(t) {
    await fetchImageData();
    const e = document.getElementById("playerTable");
    e.innerHTML = '\n        <tr>\n            <th>Photo</th>\n            <th>Joueur</th>\n            <th>GP</th>\n            <th>G</th>\n            <th>AST</th>\n            <th class="points-column">PTS</th>\n        </tr>\n    ', t.forEach(t => {
        const a = t.skaterFullName,
            n = getCurrentPlayerStats(a, t.playerId),
            s = getMatchingImage(a),
            l = n?.headshot,
            o = n?.teamAbbrev || t.teamAbbrevs?.split(",").pop().trim(),
            r = t.playerId && o ? `https://assets.nhle.com/mugs/nhl/20252026/${o}/${t.playerId}.png` : null,
            d = s || l || r,
            i = n?.teamAbbrev ? `teams/${n.teamAbbrev}.png` : getTeamLogoPath(t.teamAbbrevs);
        let c, u, m, h;
        (a.includes("Barkov") || a.includes("Tkachuk")) && console.log(`🔍 DEBUG ${a}:`, {
            hasCurrentStats: !!n,
            gamesPlayed: n?.gamesPlayed,
            currentStats: n
        }), n && n.gamesPlayed > 0 ? (c = n.gamesPlayed || 0, u = n.goals || 0, m = n.assists || 0, h = n.points || 0) : (c = t.gamesPlayed || 0, u = t.goals || 0, m = t.assists || 0, h = t.points || 0);
        const g = d && i ? `\n            <div class="player-photo">\n                <img src="${d}" alt="${a}" class="face">\n                <img src="${i}" alt="${n?.teamAbbrev||t.teamAbbrevs}" class="logo">\n            </div>\n            ` : "",
            p = n?.position || t.positionCode || "N/A",
            y = document.createElement("tr");
        y.innerHTML = `\n            <td>${g}</td>\n            <td>${a}, ${p}</td>\n            <td>${c}</td>\n            <td>${u}</td>\n            <td>${m}</td>\n            <td class="points-column">${h}</td>\n        `, y.style.cursor = "pointer", y.onclick = () => showCareerStats(t.playerId, t.skaterFullName, !1), e.appendChild(y)
    })
}

function populateGoalieTable(t) {
    const e = document.getElementById("playerTable");
    e.innerHTML = "\n        <tr>\n            <th>Photo</th>\n            <th>Gardien</th>\n            <th>GP</th>\n            <th>W</th>\n            <th>L</th>\n            <th>OTL</th>\n            <th>SV%</th>\n            <th>SO</th>\n            <th>PTS</th>\n        </tr>\n    ", t.forEach(t => {
        const a = t.goalieFullName,
            n = getCurrentPlayerStats(a, t.playerId),
            s = getMatchingImage(a),
            l = n?.teamAbbrev ? `teams/${n.teamAbbrev}.png` : getTeamLogoPath(t.teamAbbrevs);
        let o, r, d, i, c, u, m;
        n && n.gamesPlayed > 0 ? (o = n.gamesPlayed || 0, r = n.wins || 0, d = n.losses || 0, i = n.otLosses || 0, c = n.savePct || 0, u = n.shutouts || 0, m = 5 * u + 2 * r + 1 * i) : (o = t.gamesPlayed || 0, r = t.wins || 0, d = t.losses || 0, i = t.otLosses || 0, c = t.savePct || 0, u = t.shutouts || 0, m = t.points || 0);
        const h = s && l ? `<div class="player-photo">\n                    <img src="${s}" alt="${a}" class="face">\n                    <img src="${l}" alt="${n?.teamAbbrev||t.teamAbbrevs}" class="logo">\n               </div>` : "",
            g = document.createElement("tr");
        g.innerHTML = `\n            <td>${h}</td>\n            <td>${a}</td>\n            <td>${o}</td>\n            <td>${r}</td>\n            <td>${d}</td>\n            <td>${i}</td>\n            <td>${c?.toFixed(3)}</td>\n            <td>${u}</td>\n            <td>${m}</td>\n        `, g.style.cursor = "pointer", g.onclick = () => showCareerStats(t.playerId, t.goalieFullName, !0), e.appendChild(g)
    })
}

function getTeamAbbreviation(t) {
    const e = {
            Florida: "FLA",
            Calgary: "CGY",
            "Montréal": "MTL",
            Nashville: "NSH",
            Louis: "STL",
            Washington: "WSH",
            Toronto: "TOR",
            Winnipeg: "WPG",
            Utah: "UTA",
            Detroit: "DET"
        },
        a = t.split(" ");
    return e[a[0]] ? e[a[0]] : 3 === a.length ? a.map(t => t[0]).join("").toUpperCase() : a[0].substring(0, 3).toUpperCase()
}

function populateTeamTable(t) {
    const e = document.getElementById("playerTable");
    e.innerHTML = "\n        <tr>\n            <th>Logo</th>\n            <th>Équipe</th>\n            <th>GP</th>\n            <th>V</th>\n            <th>D</th>\n            <th>DP</th>\n            <th>Points</th>\n        </tr>\n    ", t.forEach(t => {
        const a = `teams/${getTeamAbbreviation(t.teamFullName)}.png`,
            n = getCurrentTeamStats(t.teamFullName);
        let s, l, o, r, d;
        n && n.gamesPlayed > 0 ? (s = n.gamesPlayed || 0, l = n.wins || 0, o = n.losses || 0, r = n.otLosses || 0, d = n.points || 2 * l + 1 * r) : (s = t.gamesPlayed || 0, l = t.wins || 0, o = t.losses || 0, r = t.otLosses || 0, d = t.points || 0);
        const i = document.createElement("tr");
        i.innerHTML = `\n            <td><img src="${a}" alt="${t.teamFullName}" class="logo" style="width:40px;"></td>\n            <td>${t.teamFullName}</td>\n            <td>${s}</td>\n            <td>${l}</td>\n            <td>${o}</td>\n            <td>${r}</td>\n            <td>${d}</td>\n        `, i.style.cursor = "pointer", i.onclick = () => showLastYearStats(t, "team"), e.appendChild(i)
    })
}

function showLastYearStats(t, e) {
    const a = document.getElementById("lastYearModal"),
        n = document.getElementById("modalPlayerName"),
        s = document.getElementById("modalStats");
    let l = null,
        o = "";
    if ("player" === e ? (o = t.skaterFullName, l = fullPlayerData.find(t => t.skaterFullName === o)) : "goalie" === e ? (o = t.goalieFullName, l = goalieData.find(t => t.goalieFullName === o)) : "team" === e && (o = t.teamFullName, l = teamData.find(t => t.teamFullName === o)), n.textContent = o, l) {
        let t = "";
        if ("player" === e) t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Buts</div>\n                    <div class="stat-value">${l.goals||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Passes</div>\n                    <div class="stat-value">${l.assists||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${l.points||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">+/-</div>\n                    <div class="stat-value">${l.plusMinus||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">PIM</div>\n                    <div class="stat-value">${l.penaltyMinutes||0}</div>\n                </div>\n            `;
        else if ("goalie" === e) {
            const e = l.points || 0;
            t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Victoires</div>\n                    <div class="stat-value">${l.wins||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Défaites</div>\n                    <div class="stat-value">${l.losses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Prol.</div>\n                    <div class="stat-value">${l.otLosses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">% Arrêts</div>\n                    <div class="stat-value">${l.savePct?.toFixed(3)||"0.000"}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Blanchissages</div>\n                    <div class="stat-value">${l.shutouts||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${e}</div>\n                </div>\n            `
        } else "team" === e && (t = `\n                <div class="stat-item">\n                    <div class="stat-label">Matchs joués</div>\n                    <div class="stat-value">${l.gamesPlayed||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Victoires</div>\n                    <div class="stat-value">${l.wins||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Défaites</div>\n                    <div class="stat-value">${l.losses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Prol.</div>\n                    <div class="stat-value">${l.otLosses||0}</div>\n                </div>\n                <div class="stat-item">\n                    <div class="stat-label">Points</div>\n                    <div class="stat-value">${l.points||0}</div>\n                </div>\n            `);
        s.innerHTML = t
    } else s.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Aucune statistique disponible</p>';
    a.style.display = "block"
}

function closeLastYearModal() {
    document.getElementById("lastYearModal").style.display = "none"
}
window.onclick = function(t) {
    const e = document.getElementById("lastYearModal"),
        a = document.getElementById("careerStatsModal");
    t.target === e && closeLastYearModal(), t.target === a && closeCareerModal()
};
let currentCareerData = null;
async function showCareerStats(t, e, a = !1) {
    const n = document.getElementById("careerStatsModal"),
        s = document.getElementById("careerModalHeader"),
        l = document.getElementById("careerPlayerName"),
        o = document.getElementById("careerPlayerPosition"),
        r = document.getElementById("careerPlayerTeam"),
        d = document.getElementById("playerHeadshotContainer"),
        i = document.getElementById("careerFilters"),
        c = document.getElementById("careerStatsTable");
    currentPlayerId = t, n.style.display = "block", document.body.style.overflow = "hidden", showModalSkeleton(), document.getElementById("viewFilter").value = "career", document.getElementById("leagueFilter").value = "nhl", document.getElementById("gameTypeFilter").value = "regular";
    try {
        const e = await fetch(`${BASE_URL}/player-career/${t}`);
        if (!e.ok) throw new Error("Failed to fetch career stats");
        const a = await e.json();
        if (currentCareerData = a, hideModalSkeleton(), s.style.display = "flex", i.style.display = "flex", l.textContent = a.playerName, o.textContent = a.isGoalie ? "🥅 Gardien de but" : "🏒 " + (a.position || "Joueur"), a.currentTeam) {
            const t = getTeamLogoPath(a.currentTeam);
            r.innerHTML = t ? `<img src="${t}" alt="${a.currentTeam}"> ${a.currentTeam}` : a.currentTeam
        } else r.textContent = "";
        if (a.headshot ? d.innerHTML = `<img src="${a.headshot}" alt="${a.playerName}">` : d.innerHTML = '<div class="no-photo">🏒</div>', document.getElementById("playerHeight").textContent = a.height || "-", document.getElementById("playerWeight").textContent = a.weight ? `${a.weight} lb` : "-", a.birthDate) {
            const t = new Date(a.birthDate),
                e = new Date;
            let n = e.getFullYear() - t.getFullYear();
            const s = e.getMonth() - t.getMonth();
            (s < 0 || 0 === s && e.getDate() < t.getDate()) && n--, document.getElementById("playerBirthDate").textContent = `${a.birthDate} (Âge: ${n})`
        } else document.getElementById("playerBirthDate").textContent = "-";
        let n = "";
        if (a.birthCity && (n += a.birthCity), a.birthStateProvince && (n += (n ? ", " : "") + a.birthStateProvince), a.birthCountry && (n += (n ? ", " : "") + a.birthCountry), document.getElementById("playerBirthPlace").textContent = n || "-", document.getElementById("playerShoots").textContent = a.shootsCatches || "-", a.draftInfo) {
            const t = a.draftInfo,
                e = `${t.year}, ${t.teamAbbrev} (${t.overallPick}e au total), ${t.round}e ronde, ${t.pickInRound}e choix`;
            document.getElementById("playerDraft").textContent = e
        } else document.getElementById("playerDraft").textContent = "Non repêché";
        filterCareerStats();
        const c = document.querySelector(".filter-group-career:has(#leagueFilter)"),
            u = document.querySelector(".filter-group-career:has(#gameTypeFilter)");
        c && (c.style.display = "flex"), u && (u.style.display = "flex")
    } catch (t) {
        console.error("Error fetching career stats:", t), hideModalSkeleton(), s.style.display = "flex", c.innerHTML = '<p class="no-stats-message">❌ Erreur lors du chargement des statistiques</p>'
    }
}

function filterCareerStats() {
    if (!currentCareerData) return;
    const t = document.getElementById("leagueFilter").value,
        e = document.getElementById("gameTypeFilter").value,
        a = document.getElementById("careerStatsTable"),
        n = document.getElementById("statsCountBadge");
    let s = currentCareerData.seasons.filter(a => {
        const n = "all" === t || "nhl" === t && "NHL" === a.league || "other" === t && "NHL" !== a.league,
            s = "all" === e || "regular" === e && "regular" === a.gameType || "playoffs" === e && "playoffs" === a.gameType;
        return n && s
    });
    if (n.textContent = `${s.length} saison${s.length>1?"s":""} affichée${s.length>1?"s":""}`, 0 === s.length) return void(a.innerHTML = '<p class="no-stats-message">Aucune statistique correspondant aux filtres sélectionnés</p>');
    let l = "<table><thead><tr>";
    if (currentCareerData.isGoalie ? l += '\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>W</th>\n            <th>L</th>\n            <th>OTL</th>\n            <th>SV%</th>\n            <th>GAA</th>\n            <th>SO</th>\n        ' : l += '\n            <th class="season-col">Season</th>\n            <th class="league-col">League</th>\n            <th class="team-col">Team</th>\n            <th>GP</th>\n            <th>G</th>\n            <th>A</th>\n            <th>PTS</th>\n            <th>+/-</th>\n            <th>PIM</th>\n            <th>SOG</th>\n        ', l += "</tr></thead><tbody>", s.forEach(t => {
            l += "<tr>", l += `<td class="season-col">${t.season}</td>`, l += `<td class="league-col">${t.league}</td>`, l += `<td class="team-col">${t.team||"-"}</td>`, l += `<td>${t.gp}</td>`, currentCareerData.isGoalie ? l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${t.savePct?t.savePct.toFixed(3):"0.000"}</td>\n                <td>${t.gaa?t.gaa.toFixed(2):"0.00"}</td>\n                <td>${t.shutouts}</td>\n            ` : l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `, l += "</tr>"
        }), "nhl" === t && s.length > 0) {
        const t = {
            gp: 0,
            goals: 0,
            assists: 0,
            points: 0,
            plusMinus: 0,
            pim: 0,
            shots: 0,
            wins: 0,
            losses: 0,
            otLosses: 0,
            shutouts: 0,
            gamesForAvg: 0,
            totalGAA: 0,
            totalSVPct: 0
        };
        if (s.forEach(e => {
                t.gp += e.gp || 0, currentCareerData.isGoalie ? (t.wins += e.wins || 0, t.losses += e.losses || 0, t.otLosses += e.otLosses || 0, t.shutouts += e.shutouts || 0, e.gaa && e.gp > 0 && (t.totalGAA += e.gaa * e.gp, t.gamesForAvg += e.gp), e.savePct && (t.totalSVPct += e.savePct)) : (t.goals += e.goals || 0, t.assists += e.assists || 0, t.points += e.points || 0, t.plusMinus += e.plusMinus || 0, t.pim += e.pim || 0, t.shots += e.shots || 0)
            }), l += '<tr class="career-totals-row">', l += '<td colspan="3" class="career-totals-label">Carrière</td>', l += `<td>${t.gp}</td>`, currentCareerData.isGoalie) {
            const e = t.gamesForAvg > 0 ? (t.totalGAA / t.gamesForAvg).toFixed(2) : "0.00",
                a = s.length > 0 ? (t.totalSVPct / s.length).toFixed(3) : "0.000";
            l += `\n                <td>${t.wins}</td>\n                <td>${t.losses}</td>\n                <td>${t.otLosses}</td>\n                <td>${a}</td>\n                <td>${e}</td>\n                <td>${t.shutouts}</td>\n            `
        } else l += `\n                <td>${t.goals}</td>\n                <td>${t.assists}</td>\n                <td>${t.points}</td>\n                <td>${t.plusMinus>=0?"+"+t.plusMinus:t.plusMinus}</td>\n                <td>${t.pim}</td>\n                <td>${t.shots}</td>\n            `;
        l += "</tr>"
    }
    l += "</tbody></table>", a.innerHTML = l
}

function closeCareerModal() {
    document.getElementById("careerStatsModal").style.display = "none", document.body.style.overflow = "", currentCareerData = null, currentGameLogData = null
}
let currentGameLogData = null,
    currentPlayerId = null;
async function handleViewChange() {
    const t = document.getElementById("viewFilter").value,
        e = document.querySelector(".filter-group-career:has(#leagueFilter)"),
        a = document.querySelector(".filter-group-career:has(#gameTypeFilter)"),
        n = document.getElementById("statsCountBadge");
    "gamelog" === t ? (e && (e.style.display = "none"), a && (a.style.display = "none"), n.style.display = "block", n.textContent = "Chargement...", await showGameLog(currentPlayerId)) : (e && (e.style.display = "flex"), a && (a.style.display = "flex"), filterCareerStats())
}
async function showGameLog(t) {
    try {
        const e = await fetch(`/player-gamelog/${t}`),
            a = await e.json();
        if (currentGameLogData = a, !a.gameLog || 0 === a.gameLog.length) return document.getElementById("careerStatsTable").innerHTML = '<p style="text-align: center; padding: 20px;">Aucun match joué cette saison.</p>', void(document.getElementById("statsCountBadge").textContent = "0 matchs");
        document.getElementById("statsCountBadge").textContent = `${a.gameLog.length} matchs`, renderGameLogTable(a.gameLog, a.playerInfo.isGoalie)
    } catch (t) {
        console.error("Error fetching game log:", t), document.getElementById("careerStatsTable").innerHTML = '<p style="text-align: center; padding: 20px; color: red;">Erreur lors du chargement des statistiques de match.</p>'
    }
}

function renderGameLogTable(t, e) {
    const a = document.getElementById("careerStatsTable");
    let n = "<table><thead><tr>";
    n += e ? "\n            <th>DATE</th>\n            <th>OPP</th>\n            <th>RÉS</th>\n            <th>DÉC</th>\n            <th>GA</th>\n            <th>SA</th>\n            <th>SV</th>\n            <th>SV%</th>\n            <th>BL</th>\n            <th>PUN</th>\n            <th>TG</th>\n        " : "\n            <th>DATE</th>\n            <th>OPP</th>\n            <th>RÉS</th>\n            <th>B</th>\n            <th>P</th>\n            <th>PTS</th>\n            <th>+/-</th>\n            <th>PUN</th>\n            <th>TIR</th>\n            <th>TG</th>\n            <th>PP</th>\n            <th>SH</th>\n        ", n += "</tr></thead><tbody>", t.forEach((t, a) => {
        const s = a % 2 == 0 ? "even-row" : "odd-row",
            l = "H" === t.homeRoadFlag ? "vs" : "@",
            o = new Date(t.gameDate).toLocaleDateString("fr-CA", {
                month: "2-digit",
                day: "2-digit"
            });
        if (n += `<tr class="${s}">`, n += `<td>${o}</td>`, n += `<td>${l} ${t.opponentAbbrev}</td>`, n += `<td>${t.gameResult||"-"}</td>`, e) {
            const e = t.shotsAgainst || 0,
                a = t.goalsAgainst || 0;
            let s = t.saves || 0;
            e > 0 && (!s || 0 === s) && (s = e - a);
            let l = "-";
            if (e > 0) {
                l = (s / e).toFixed(3)
            }
            n += `<td>${t.decision||"-"}</td>`, n += `<td>${a}</td>`, n += `<td>${e}</td>`, n += `<td>${s}</td>`, n += `<td>${l}</td>`, n += `<td>${t.shutouts||0}</td>`, n += `<td>${t.pim||0}</td>`, n += `<td>${t.toi||"0:00"}</td>`
        } else n += `<td>${t.goals||0}</td>`, n += `<td>${t.assists||0}</td>`, n += `<td>${t.points||0}</td>`, n += `<td>${t.plusMinus>=0?"+":""}${t.plusMinus||0}</td>`, n += `<td>${t.pim||0}</td>`, n += `<td>${t.shots||0}</td>`, n += `<td>${t.toi||"0:00"}</td>`, n += `<td>${t.powerPlayPoints||0}</td>`, n += `<td>${t.shorthandedPoints||0}</td>`;
        n += "</tr>"
    }), n += "</tbody></table>", a.innerHTML = n
}

function showSkeletonLoader() {
    const t = document.getElementById("tableSkeleton"),
        e = document.getElementById("actualTable");
    t && (t.style.display = "block"), e && (e.style.display = "none")
}

function hideSkeletonLoader() {
    const t = document.getElementById("tableSkeleton"),
        e = document.getElementById("actualTable");
    t && (t.style.display = "none"), e && (e.style.display = "block")
}

function showModalSkeleton() {
    const t = document.getElementById("modalSkeleton"),
        e = document.getElementById("careerModalHeader"),
        a = document.getElementById("careerFilters"),
        n = document.getElementById("careerStatsTable");
    t && (t.style.display = "block"), e && (e.style.display = "none"), a && (a.style.display = "none"), n && (n.innerHTML = "")
}

function hideModalSkeleton() {
    const t = document.getElementById("modalSkeleton");
    t && (t.style.display = "none")
}

function toggleAdminDropdown(t) {
    t.preventDefault(), t.stopPropagation();
    document.getElementById("adminDropdown").classList.toggle("show")
}
async function loadAdminUsers() {
    try {
        const t = await fetch(`${BASE_URL}/admin-users?adminToken=admin`),
            e = await t.json();
        if (t.ok) {
            const t = e.users.filter(t => "admin" !== t).slice(0, 4),
                a = document.getElementById("adminUserList");
            0 === t.length ? a.innerHTML = '<div class="admin-no-users">Aucun utilisateur</div>' : a.innerHTML = t.map(t => `\n                    <a href="#" class="admin-dropdown-item" onclick="switchToUser(event, '${t}')">\n                        <span class="user-avatar">${t.charAt(0).toUpperCase()}</span>\n                        <span class="user-name">${t}</span>\n                    </a>\n                `).join("")
        }
    } catch (t) {
        console.error("Error loading users:", t), document.getElementById("adminUserList").innerHTML = '<div class="admin-no-users">Erreur</div>'
    }
}
async function switchToUser(t, e) {
    t.preventDefault(), t.stopPropagation();
    try {
        (await fetch(`${BASE_URL}/admin-switch-user`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                adminToken: "admin",
                targetUsername: e
            })
        })).ok ? (localStorage.setItem("username", e), localStorage.setItem("activeUser", e), window.location.reload()) : alert("Erreur lors du changement d'utilisateur")
    } catch (t) {
        console.error("Error switching user:", t), alert("Erreur de connexion")
    }
}

function logout(t) {
    t && t.preventDefault(), localStorage.removeItem("isLoggedIn"), localStorage.removeItem("username"), localStorage.removeItem("isAdmin"), localStorage.removeItem("activeUser"), location.reload()
}
document.getElementById("searchInput").addEventListener("input", updateTable), document.getElementById("playerFilter").addEventListener("change", updateTable), document.getElementById("sortBy").addEventListener("change", updateTable), fetchPlayerData(), $(document).ready(function() {
    const t = "true" === localStorage.getItem("isLoggedIn"),
        e = localStorage.getItem("username"),
        a = "true" === localStorage.getItem("isAdmin");
    t && (a ? ($("#admin-users-link").css("display", "block").html('\n                <div class="admin-dropdown-container">\n                    <a href="#" class="admin-dropdown-toggle" onclick="toggleAdminDropdown(event)">\n                        Utilisateur ▼\n                    </a>\n                    <div class="admin-dropdown-menu" id="adminDropdown">\n                        <div class="admin-dropdown-header">Changer d\'utilisateur</div>\n                        <div id="adminUserList" class="admin-user-list">Chargement...</div>\n                    </div>\n                </div>\n            '), $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`), loadAdminUsers()) : $("#login-link").html(`<a href="#" onclick="logout(event)">Déconnexion (${e})</a>`))
}), document.addEventListener("click", function(t) {
    const e = document.getElementById("adminDropdown");
    e && !t.target.closest(".admin-dropdown-container") && e.classList.remove("show")
});