'use strict';

/**
 * Vancouver 6 - Edmonton 5 (prol.), 29 septembre 2026 — match 2026020004,
 * tel que la LNH le rend (/v1/score/now, /v1/gamecenter/{id}/boxscore,
 * /v1/player/{id}/game-log/20262027/2), réduit aux champs que le code lit.
 *
 * C'est le match du signalement : Evan Bouchard, 3 buts et 2 aides — 5 points
 * au cumulatif, 17 au barème fantasy (6 tirs, +2) —, joué pendant le relevé de
 * minuit. Relevé le 30 septembre 2026.
 */

const BOUCHARD = 8480803, MCDAVID = 8478402, DRAISAITL = 8477934, LANKINEN = 8480947, JARRY = 8477465;

const match = {
    "id": 2026020004,
    "season": 20262027,
    "gameType": 2,
    "gameDate": "2026-09-29",
    "startTimeUTC": "2026-09-30T02:00:00Z",
    "gameState": "OFF",
    "awayTeam": {
        "abbrev": "VAN",
        "score": 6
    },
    "homeTeam": {
        "abbrev": "EDM",
        "score": 5
    },
    "periodDescriptor": {
        "number": 4,
        "periodType": "OT"
    },
    "gameOutcome": {
        "lastPeriodType": "OT",
        "otPeriods": 1
    }
};

const boxscore = {"id":2026020004,"gameState":"OFF","awayTeam":{"abbrev":"VAN","score":6},"homeTeam":{"abbrev":"EDM","score":5},"playerByGameStats":{"awayTeam":{"forwards":[{"playerId":8478444,"goals":0,"assists":1,"points":1,"sog":1,"plusMinus":-1,"toi":"14:51","powerPlayGoals":0,"name":{"default":"B. Boeser"}},{"playerId":8475848,"goals":0,"assists":0,"points":0,"sog":1,"plusMinus":0,"toi":"10:54","powerPlayGoals":0,"name":{"default":"B. Gallagher"}},{"playerId":8483395,"goals":0,"assists":0,"points":0,"sog":0,"plusMinus":1,"toi":"10:52","powerPlayGoals":0,"name":{"default":"A. Bains"}},{"playerId":8482055,"goals":0,"assists":1,"points":1,"sog":3,"plusMinus":-1,"toi":"17:40","powerPlayGoals":0,"name":{"default":"D. O'Connor"}},{"playerId":8482079,"goals":1,"assists":0,"points":1,"sog":1,"plusMinus":-1,"toi":"15:01","powerPlayGoals":0,"name":{"default":"M. Rossi"}},{"playerId":8480012,"goals":1,"assists":0,"points":1,"sog":1,"plusMinus":0,"toi":"19:23","powerPlayGoals":1,"name":{"default":"E. Pettersson"}},{"playerId":8481032,"goals":2,"assists":0,"points":2,"sog":3,"plusMinus":2,"toi":"11:51","powerPlayGoals":0,"name":{"default":"P. Cotter"}},{"playerId":8484136,"goals":1,"assists":1,"points":2,"sog":2,"plusMinus":1,"toi":"16:37","powerPlayGoals":0,"name":{"default":"M. Sasson"}},{"playerId":8478498,"goals":0,"assists":1,"points":1,"sog":0,"plusMinus":1,"toi":"15:35","powerPlayGoals":0,"name":{"default":"J. DeBrusk"}},{"playerId":8483476,"goals":1,"assists":0,"points":1,"sog":1,"plusMinus":1,"toi":"12:36","powerPlayGoals":0,"name":{"default":"J. Lekkerimäki"}},{"playerId":8483499,"goals":0,"assists":1,"points":1,"sog":1,"plusMinus":-1,"toi":"17:29","powerPlayGoals":0,"name":{"default":"L. Ohgren"}},{"playerId":8481024,"goals":0,"assists":1,"points":1,"sog":2,"plusMinus":-1,"toi":"13:37","powerPlayGoals":0,"name":{"default":"L. Karlsson"}}],"defense":[{"playerId":8474568,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":1,"toi":"14:25","powerPlayGoals":0,"name":{"default":"L. Schenn"}},{"playerId":8476467,"goals":0,"assists":1,"points":1,"sog":0,"plusMinus":-3,"toi":"23:38","powerPlayGoals":0,"name":{"default":"J. Oleksiak"}},{"playerId":8484240,"goals":0,"assists":0,"points":0,"sog":0,"plusMinus":-1,"toi":"20:40","powerPlayGoals":0,"name":{"default":"T. Willander"}},{"playerId":8484798,"goals":0,"assists":0,"points":0,"sog":1,"plusMinus":2,"toi":"22:46","powerPlayGoals":0,"name":{"default":"Z. Buium"}},{"playerId":8479425,"goals":0,"assists":2,"points":2,"sog":2,"plusMinus":2,"toi":"25:08","powerPlayGoals":0,"name":{"default":"F. Hronek"}},{"playerId":8483678,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":0,"toi":"16:01","powerPlayGoals":0,"name":{"default":"E. Pettersson"}}],"goalies":[{"playerId":8482447,"goalsAgainst":0,"saveShotsAgainst":"0/0","toi":"00:00","name":{"default":"L. Meriläinen"}},{"playerId":8480947,"decision":"W","goalsAgainst":5,"saveShotsAgainst":"32/37","toi":"61:43","name":{"default":"K. Lankinen"}}]},"homeTeam":{"forwards":[{"playerId":8479365,"goals":0,"assists":0,"points":0,"sog":1,"plusMinus":0,"toi":"09:21","powerPlayGoals":0,"name":{"default":"T. Frederic"}},{"playerId":8475786,"goals":0,"assists":0,"points":0,"sog":3,"plusMinus":1,"toi":"20:33","powerPlayGoals":0,"name":{"default":"Z. Hyman"}},{"playerId":8478472,"goals":0,"assists":0,"points":0,"sog":0,"plusMinus":-1,"toi":"14:57","powerPlayGoals":0,"name":{"default":"M. Joseph"}},{"playerId":8480029,"goals":0,"assists":1,"points":1,"sog":2,"plusMinus":3,"toi":"15:09","powerPlayGoals":0,"name":{"default":"A. Formenton"}},{"playerId":8477934,"goals":0,"assists":1,"points":1,"sog":5,"plusMinus":-1,"toi":"21:15","powerPlayGoals":0,"name":{"default":"L. Draisaitl"}},{"playerId":8482703,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":-1,"toi":"14:49","powerPlayGoals":0,"name":{"default":"C. Dach"}},{"playerId":8477953,"goals":0,"assists":0,"points":0,"sog":3,"plusMinus":-2,"toi":"17:55","powerPlayGoals":0,"name":{"default":"K. Kapanen"}},{"playerId":8486161,"goals":0,"assists":0,"points":0,"sog":0,"plusMinus":0,"toi":"08:22","powerPlayGoals":0,"name":{"default":"O. Michaels"}},{"playerId":8479368,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":-1,"toi":"12:18","powerPlayGoals":0,"name":{"default":"M. Jones"}},{"playerId":8483455,"goals":0,"assists":0,"points":0,"sog":1,"plusMinus":0,"toi":"11:06","powerPlayGoals":0,"name":{"default":"I. Howard"}},{"playerId":8481617,"goals":2,"assists":0,"points":2,"sog":7,"plusMinus":-2,"toi":"18:20","powerPlayGoals":1,"name":{"default":"V. Podkolzin"}},{"playerId":8478402,"goals":0,"assists":2,"points":2,"sog":0,"plusMinus":1,"toi":"22:51","powerPlayGoals":0,"name":{"default":"C. McDavid"}}],"defense":[{"playerId":8480803,"goals":3,"assists":2,"points":5,"sog":6,"plusMinus":2,"toi":"25:41","powerPlayGoals":0,"name":{"default":"E. Bouchard"}},{"playerId":8476473,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":-1,"toi":"18:29","powerPlayGoals":0,"name":{"default":"C. Murphy"}},{"playerId":8478854,"goals":0,"assists":1,"points":1,"sog":0,"plusMinus":-1,"toi":"22:41","powerPlayGoals":0,"name":{"default":"R. Shea"}},{"playerId":8475218,"goals":0,"assists":0,"points":0,"sog":2,"plusMinus":2,"toi":"20:56","powerPlayGoals":0,"name":{"default":"M. Ekholm"}},{"playerId":8482166,"goals":0,"assists":0,"points":0,"sog":0,"plusMinus":-2,"toi":"13:03","powerPlayGoals":0,"name":{"default":"S. Mukhamadullin"}},{"playerId":8478013,"goals":0,"assists":0,"points":0,"sog":1,"plusMinus":0,"toi":"16:25","powerPlayGoals":0,"name":{"default":"J. Walman"}}],"goalies":[{"playerId":8482221,"goalsAgainst":0,"saveShotsAgainst":"0/0","toi":"00:00","name":{"default":"D. Levi"}},{"playerId":8477465,"decision":"O","goalsAgainst":6,"saveShotsAgainst":"17/23","toi":"61:33","name":{"default":"T. Jarry"}}]}}};

const journaux = {
    "8477465": [
        {
            "gameId": 2026020004,
            "teamAbbrev": "EDM",
            "homeRoadFlag": "H",
            "gameDate": "2026-09-29",
            "goals": 0,
            "assists": 0,
            "commonName": {
                "default": "Oilers"
            },
            "opponentCommonName": {
                "default": "Canucks"
            },
            "gamesStarted": 1,
            "decision": "O",
            "shotsAgainst": 23,
            "goalsAgainst": 6,
            "savePctg": 0.73913,
            "shutouts": 0,
            "pim": 0,
            "toi": "61:33",
            "opponentAbbrev": "VAN"
        }
    ],
    "8480803": [
        {
            "gameId": 2026020004,
            "teamAbbrev": "EDM",
            "homeRoadFlag": "H",
            "gameDate": "2026-09-29",
            "goals": 3,
            "assists": 2,
            "commonName": {
                "default": "Oilers"
            },
            "opponentCommonName": {
                "default": "Canucks"
            },
            "points": 5,
            "plusMinus": 2,
            "powerPlayGoals": 0,
            "powerPlayPoints": 1,
            "gameWinningGoals": 0,
            "otGoals": 0,
            "shots": 6,
            "shifts": 28,
            "shorthandedGoals": 0,
            "shorthandedPoints": 0,
            "pim": 0,
            "toi": "25:41",
            "opponentAbbrev": "VAN"
        }
    ],
    "8480947": [
        {
            "gameId": 2026020004,
            "teamAbbrev": "VAN",
            "homeRoadFlag": "R",
            "gameDate": "2026-09-29",
            "goals": 0,
            "assists": 0,
            "commonName": {
                "default": "Canucks"
            },
            "opponentCommonName": {
                "default": "Oilers"
            },
            "gamesStarted": 1,
            "decision": "W",
            "shotsAgainst": 37,
            "goalsAgainst": 5,
            "savePctg": 0.864865,
            "shutouts": 0,
            "pim": 0,
            "toi": "61:43",
            "opponentAbbrev": "EDM"
        }
    ]
};

module.exports = { match, boxscore, journaux, BOUCHARD, MCDAVID, DRAISAITL, LANKINEN, JARRY };
