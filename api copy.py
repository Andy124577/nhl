import requests
import json

# NHL API endpoints
url = "https://api.nhle.com/stats/rest/en/skater/summary"
url2 = "https://api.nhle.com/stats/rest/en/team/summary"
url3 = "https://api.nhle.com/stats/rest/en/goalie/summary"

headers = {"User-Agent": "Mozilla/5.0"}

# Query parameters for both seasons
query_params_2425 = {
    "limit": "-1",
    "cayenneExp": "seasonId=20242025 and gameTypeId=2"
}
query_params_2526 = {
    "limit": "-1",
    "cayenneExp": "seasonId=20252026 and gameTypeId=2"
}

# API requests
response_2425 = requests.get(url, headers=headers, params=query_params_2425)
response_2526 = requests.get(url, headers=headers, params=query_params_2526)
response_team = requests.get(url2, headers=headers, params=query_params_2425)
response_goalie = requests.get(url3, headers=headers, params=query_params_2425)

if all(r.status_code == 200 for r in [response_2425, response_2526, response_team, response_goalie]):
    data_2425 = response_2425.json()["data"]
    data_2526 = response_2526.json()["data"]
    team_data = response_team.json()["data"]
    goalie_data = response_goalie.json()["data"]

    stats_2526_lookup = {p["skaterFullName"].lower(): p for p in data_2526}
    player_lookup = {p["skaterFullName"].lower(): p for p in data_2425}

    def merge_stats(player_list):
        merged = []
        for p in player_list:
            name = p["skaterFullName"].lower()
            stats = stats_2526_lookup.get(name, {})
            merged.append({
                "playerId": p.get("playerId"),
                "skaterFullName": p.get("skaterFullName"),
                "teamAbbrevs_202425": p.get("teamAbbrevs"),
                "teamAbbrevs_202526": stats.get("teamAbbrevs"),
                "positionCode": p.get("positionCode"),
                "gamesPlayed_202425": p.get("gamesPlayed", 0),
                "gamesPlayed_202526": stats.get("gamesPlayed", 0),
                "goals_202526": stats.get("goals", 0),
                "assists_202526": stats.get("assists", 0),
                "points_202526": stats.get("points", 0)
            })
        return merged

    defenders = sorted(
        [p for p in data_2425 if p["positionCode"] == "D"],
        key=lambda x: x["points"],
        reverse=True
    )[:150]

    forwards = sorted(
        [p for p in data_2425 if p["positionCode"] in ["C", "R", "L"]],
        key=lambda x: x["points"],
        reverse=True
    )[:300]

    rookie_names = {
        "ivan demidov", "michael misa", "alexander nikishin", "jimmy snuggerud", "ryan leonard",
        "zeev buium", "zayne parekh", "ville koivunen", "gabriel perreault", "sam dickinson",
        "sam rinzel", "james hagens", "rutger mcgroarty", "matthew savoie", "calum ritchie",
        "matthew schaefer", "maxim shabanov", "anton frondell", "brad lambert", "artyom levshunov",
        "tij iginla", "konsta helenius", "cole eiserman", "beckett sennecke", "axel sandin pellikka",
        "kasper halttunen", "daniil but", "jordan dumais", "fraser minten", "matej blumel",
        "oliver moore", "nikita prishchepov", "isaac howard", "liam ohgren", "danila yurov",
        "matthew wood", "arseny gritsyuk", "owen pickering", "jani nyman",
        "logan mailloux", "justin sourdif", "easton cowan", "berkly catton",
        "caleb desnoyers", "carter yakemchuk", "dalibor dvorsky", "bradly nadeau",
        "ty mueller", "luca cagnoni", "quinn hutson", "cole hutson"
    }

    rookies = []
    for name in rookie_names:
        lower = name.lower()
        p = player_lookup.get(lower)
        if p:
            rookies.append(p)
        else:
            rookies.append({
                "playerId": None,
                "skaterFullName": name.title(),
                "teamAbbrevs": None,
                "positionCode": None,
                "gamesPlayed": 0,
                "goals": 0,
                "assists": 0,
                "points": 0
            })

    top_goalies = sorted(
        [g for g in goalie_data if g.get("gamesPlayed", 0) >= 10],
        key=lambda x: x.get("savePct", 0),
        reverse=True
    )[:60]

    def filter_goalie_fields(goalie_list):
        return [{
            "playerId": g.get("playerId"),
            "goalieFullName": g.get("goalieFullName"),
            "teamAbbrevs": g.get("teamAbbrevs"),
            "gamesPlayed": g.get("gamesPlayed"),
            "wins": g.get("wins"),
            "losses": g.get("losses"),
            "otLosses": g.get("otLosses"),
            "savePct": g.get("savePct"),
            "assists": g.get("assists"),
            "shutouts": g.get("shutouts"),
            "points": (
                g.get("wins", 0) * 2 +
                g.get("otLosses", 0) * 1 +
                g.get("assists", 0) * 1 +
                g.get("shutouts", 0) * 5
            )
        } for g in goalie_list]

    def filter_team_fields(team_list):
        return [{
            key: team.get(key) for key in [
                "gamesPlayed", "wins", "losses",
                "otLosses", "points", "teamFullName", "teamId", "seasonId"
            ]
        } for team in team_list]

    sorted_teams = sorted(team_data, key=lambda x: x.get("points", 0), reverse=True)

    sorted_data = {
        "Top_50_Defenders": merge_stats(defenders[:50]),
        "Top_100_Offensive_Players": merge_stats(forwards[:100]),
        "Top_Rookies": merge_stats(rookies),
        "Teams": filter_team_fields(sorted_teams),
        "Top_50_Goalies": filter_goalie_fields(top_goalies)
    }

    with open("nhl_filtered_stats.json", "w", encoding="utf-8") as json_file:
        json.dump(sorted_data, json_file, indent=4)

    print("Filtered NHL stats saved to nhl_filtered_stats.json ✅")

else:
    print("Error retrieving data from one or more endpoints ❌")