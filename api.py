import requests
import json

# NHL API endpoints
url = "https://api.nhle.com/stats/rest/en/skater/summary"
url2 = "https://api.nhle.com/stats/rest/en/team/summary"
url3 = "https://api.nhle.com/stats/rest/en/goalie/summary"

query_params = {
    "limit": "-1",
    "cayenneExp": "seasonId=20242025 and gameTypeId=2"
}

headers = {"User-Agent": "Mozilla/5.0"}

# Make the API requests
response = requests.get(url, headers=headers, params=query_params)
response1 = requests.get(url2, headers=headers, params=query_params)
response2 = requests.get(url3, headers=headers, params=query_params)

if response.status_code == 200 and response1.status_code == 200 and response2.status_code == 200:
    data = response.json()["data"]

    player_lookup = {skater["skaterFullName"].lower(): skater for skater in data}

    defenders = sorted(
        [skater for skater in data if skater["positionCode"] == "D"],
        key=lambda x: x["points"],
        reverse=True
    )[:150]

    forwards = sorted(
        [skater for skater in data if skater["positionCode"] in ["C", "R", "L"]],
        key=lambda x: x["points"],
        reverse=True
    )[:300]

    goalie_data = response2.json().get("data", [])
    # Filter goalies with at least 10 games played, then sort by save percentage
    # Filter goalies with at least 10 games played and calculate custom points
    top_goalies = sorted(
        [g for g in goalie_data if g.get("gamesPlayed", 0) >= 10],
        key=lambda x: x.get("savePct", 0),
        reverse=True
    )[:60]

    def filter_goalie_fields(goalie_list):
        return [
            {
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
            }
            for g in goalie_list
        ]

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
        lower_name = name.lower()
        if lower_name in player_lookup:
            rookies.append(player_lookup[lower_name])
        else:
            metadata = next((p for p in data if p["skaterFullName"].lower() == lower_name), {})
            rookies.append({
                "playerId": metadata.get("playerId"),
                "skaterFullName": name.title(),
                "teamAbbrevs": metadata.get("teamAbbrevs"),
                "positionCode": metadata.get("positionCode"),
                "gamesPlayed": 0,
                "goals": 0,
                "assists": 0,
                "points": 0
            })

    def filter_fields(skater_list):
        return [
            {key: skater.get(key) for key in [
                "playerId", "skaterFullName", "teamAbbrevs",
                "positionCode", "gamesPlayed", "goals", "assists", "points"
            ]}
            for skater in skater_list
        ]

    team_data = response1.json().get("data", [])
    sorted_teams = sorted(team_data, key=lambda x: x.get("points", 0), reverse=True)

    def filter_team_fields(team_list):
        return [
            {key: team.get(key) for key in [
                "gamesPlayed", "wins", "losses",
                "otLosses", "points", "teamFullName", "teamId", "seasonId"
            ]}
            for team in team_list
        ]

    sorted_data = {
        "Top_50_Defenders": filter_fields(defenders),
        "Top_100_Offensive_Players": filter_fields(forwards),
        "Top_Rookies": filter_fields(rookies),
        "Teams": filter_team_fields(sorted_teams),
        "Top_50_Goalies": filter_goalie_fields(top_goalies)
    }

    with open("nhl_filtered_stats.json", "w", encoding="utf-8") as json_file:
        json.dump(sorted_data, json_file, indent=4)

    print("Filtered NHL stats saved to nhl_filtered_stats.json ✅")
else:
    print(f"Error: {response.status_code} - {response.text}")
