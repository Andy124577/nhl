# NHL Game Logs Cache System

## Overview

This system caches game-by-game statistics for NHL players to enable the "Historique de match" (Game History) feature in the player modal.

## Why Cache Game Logs?

- **Performance**: Fetching game logs for hundreds of players takes time
- **API Limits**: Avoids hitting NHL API rate limits during user requests
- **Reliability**: Works even when NHL API is slow or unavailable
- **Size**: Only ~10-15 MB for entire season (very manageable!)

## How It Works

### 1. Data Fetching (`fetch_game_logs.js`)

The fetch script:
- Reads player list from `nhl_filtered_stats.json`
- Fetches game logs for each player from NHL API
- Processes ~500 players (forwards, defenders, goalies)
- Saves everything to `nhl_game_logs.json`

**Stats Stored Per Game:**

**Skaters:**
- Goals, Assists, Points
- Plus/Minus, PIM, Shots
- Power Play Points, Shorthanded Points
- Time on Ice

**Goalies:**
- Decision (W/L/O)
- Shots Against, Goals Against, Saves
- Save Percentage
- Shutouts, Time on Ice

### 2. Server Endpoint (`/player-gamelog/:playerId`)

The API endpoint reads from the cache file instead of making external API calls.

### 3. Frontend Display

When users select "Historique de match" in the player modal, the frontend fetches from `/player-gamelog/:playerId` and displays a game-by-game table.

## Setup Instructions

### First Time Setup

1. **Ensure you have player stats**:
   ```bash
   python api.py
   ```
   This creates `nhl_filtered_stats.json` with the list of active players.

2. **Fetch game logs**:
   ```bash
   node fetch_game_logs.js
   ```
   This will take 3-5 minutes to fetch all game logs.

3. **Verify cache was created**:
   ```bash
   ls -lh nhl_game_logs.json
   ```
   Should show a file around 10-15 MB.

### Regular Updates

Run the fetch script periodically to keep game logs up to date:

**After each game day:**
```bash
node fetch_game_logs.js
```

**Automated (cron job example):**
```bash
# Run daily at 3 AM
0 3 * * * cd /path/to/nhl && node fetch_game_logs.js >> logs/gamelog_fetch.log 2>&1
```

**Or use npm script:**
```bash
npm run fetch-game-logs
```

## Cache File Structure

```json
{
  "lastUpdated": "2026-02-06T01:00:00.000Z",
  "season": "20252026",
  "gameType": "2",
  "totalPlayers": 510,
  "totalGames": 25500,
  "players": [
    {
      "playerId": 8478402,
      "playerName": "Connor McDavid",
      "position": "C",
      "season": "20252026",
      "gameType": "2",
      "totalGames": 50,
      "gameLog": [
        {
          "gameId": 2025020001,
          "gameDate": "2025-10-09",
          "homeRoadFlag": "H",
          "opponentAbbrev": "CGY",
          "teamAbbrev": "EDM",
          "gameResult": "W",
          "goals": 2,
          "assists": 1,
          "points": 3,
          "plusMinus": 2,
          "shots": 5,
          "toi": "21:15",
          ...
        },
        ...
      ],
      "lastUpdated": "2026-02-06T01:00:00.000Z"
    },
    ...
  ]
}
```

## Troubleshooting

### Cache file doesn't exist
**Error**: `nhl_game_logs.json not found`
**Solution**: Run `node fetch_game_logs.js`

### Player not in cache
**Error**: `Player not found in cache`
**Solution**: The player might be a rookie or recently called up. Re-run the fetch script.

### Empty game logs
**Issue**: Player shows "0 matchs" (0 games)
**Reason**: Player hasn't played any games yet this season, or fetch failed for that player.

### API fetch failures
**Error**: `fetch failed` messages during fetch script
**Solution**:
- Check internet connection
- Try again later (NHL API might be down)
- Some players might not have game logs available yet

## Performance

- **Fetch time**: 3-5 minutes for ~500 players
- **Cache size**: 10-15 MB
- **API calls**: ~500 requests (10 per batch with 2s delay)
- **Server load**: Minimal - just reads from JSON file

## File Locations

- **Fetch Script**: `fetch_game_logs.js`
- **Cache File**: `nhl_game_logs.json` (gitignored)
- **Player Stats Source**: `nhl_filtered_stats.json`
- **Server Endpoint**: `server.js` - `/player-gamelog/:playerId`

## Notes

- Cache file is gitignored (too large for git)
- Must be regenerated on each deployment
- Consider adding to deployment scripts
- Safe to delete and regenerate anytime
