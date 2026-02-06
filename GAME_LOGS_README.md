# NHL Game Logs Cache System (PostgreSQL)

## Overview

This system stores game-by-game statistics for NHL players in PostgreSQL (NeonTech) to enable the "Historique de match" (Game History) feature in the player modal.

## Why PostgreSQL Instead of JSON?

✅ **Centralized** - works across all server instances (important for Render)
✅ **Production-ready** - you're already using NeonTech
✅ **Fast queries** - indexed lookups for specific players
✅ **Scalable** - can handle millions of records
✅ **Efficient** - only loads data you need, not entire file
✅ **Easy updates** - upsert logic updates only changed games
✅ **No deployment issues** - data persists between deployments

## Database Schema

```sql
CREATE TABLE player_game_logs (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL,
    player_name VARCHAR(255) NOT NULL,
    position VARCHAR(5) NOT NULL,
    season VARCHAR(10) NOT NULL,
    game_id BIGINT NOT NULL,
    game_date DATE NOT NULL,
    home_road_flag CHAR(1),
    opponent_abbrev VARCHAR(5),
    team_abbrev VARCHAR(5),
    game_result VARCHAR(5),

    -- Skater stats
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    plus_minus INTEGER DEFAULT 0,
    pim INTEGER DEFAULT 0,
    shots INTEGER DEFAULT 0,
    power_play_goals INTEGER DEFAULT 0,
    power_play_points INTEGER DEFAULT 0,
    shorthanded_goals INTEGER DEFAULT 0,
    shorthanded_points INTEGER DEFAULT 0,
    game_winning_goals INTEGER DEFAULT 0,
    toi VARCHAR(10),

    -- Goalie stats
    games_started INTEGER DEFAULT 0,
    decision VARCHAR(5),
    shots_against INTEGER DEFAULT 0,
    goals_against INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_pct DECIMAL(5,3),
    shutouts INTEGER DEFAULT 0,

    last_updated TIMESTAMP DEFAULT NOW(),

    UNIQUE(player_id, game_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_player_game_logs_player_id ON player_game_logs(player_id);
CREATE INDEX idx_player_game_logs_season ON player_game_logs(season);
CREATE INDEX idx_player_game_logs_game_date ON player_game_logs(game_date DESC);
CREATE INDEX idx_player_game_logs_position ON player_game_logs(position);
CREATE INDEX idx_player_game_logs_composite ON player_game_logs(player_id, season, game_date DESC);
```

## Setup Instructions

### 1. Run Database Migration

First, create the `player_game_logs` table:

```bash
node run_migration.js
```

This will execute `migrations/create_player_game_logs.sql` and create the table with all indexes.

### 2. Generate Player Stats

Make sure you have the latest player list:

```bash
python api.py
```

This creates `nhl_filtered_stats.json` with ~500 active players.

### 3. Fetch and Store Game Logs

Run the fetch script to populate the database:

```bash
node fetch_game_logs.js
# Or use npm script:
npm run fetch-game-logs
```

This will:
- Fetch game logs for all ~500 players from NHL API
- Save to PostgreSQL database
- Takes 3-5 minutes
- Shows progress and statistics

### 4. Verify Database

Check that data was loaded:

```sql
SELECT
    COUNT(DISTINCT player_id) as total_players,
    COUNT(*) as total_games,
    MAX(last_updated) as last_updated
FROM player_game_logs
WHERE season = '20252026';
```

You should see:
- **total_players**: ~500
- **total_games**: ~25,000
- **last_updated**: recent timestamp

## How It Works

### 1. Fetch Script (`fetch_game_logs.js`)

- Reads player list from `nhl_filtered_stats.json`
- Fetches game logs from NHL API for each player
- Uses **upsert** logic (INSERT ... ON CONFLICT UPDATE)
- Updates existing games, inserts new ones
- Safe to run multiple times

### 2. Server Endpoint (`/player-gamelog/:playerId`)

- Queries PostgreSQL for player's games
- Uses indexed lookup (very fast)
- Returns games sorted by date (newest first)
- Includes all skater and goalie stats

### 3. Frontend Display

- User clicks "Historique de match" in player modal
- Frontend calls `/player-gamelog/:playerId`
- Server queries database and returns formatted data
- Frontend displays game-by-game table

## Stats Stored Per Game

### Skaters:
- Goals, Assists, Points
- Plus/Minus, PIM, Shots
- Power Play Points, Shorthanded Points
- Game Winning Goals, Time on Ice

### Goalies:
- Decision (W/L/O)
- Shots Against, Goals Against, Saves
- **Save Percentage** (properly formatted!)
- Shutouts, PIM, Time on Ice

## Updating Game Logs

### Daily Updates

Run the fetch script after each game day:

```bash
node fetch_game_logs.js
```

The script uses upsert logic, so it will:
- Update stats for games already in database
- Insert new games that were just played
- No duplicates will be created

### Automated Updates (Recommended)

Set up a cron job to run daily:

```bash
# Edit crontab
crontab -e

# Add this line (runs at 3 AM daily)
0 3 * * * cd /path/to/nhl && node fetch_game_logs.js >> logs/gamelog_fetch.log 2>&1
```

Or use a Render Cron Job (if you're on paid plan):

```yaml
# render.yaml
services:
  - type: cron
    name: fetch-game-logs
    env: node
    schedule: "0 3 * * *"
    buildCommand: npm install
    startCommand: node fetch_game_logs.js
```

## Performance

**Database Size:**
- ~500 players × 50 games × 400 bytes = ~10 MB
- Plus indexes: ~20 MB total
- Negligible for PostgreSQL

**Query Performance:**
- Player lookup: <5ms (indexed)
- Full season query: <10ms
- Aggregations: <50ms

**Fetch Time:**
- Initial load: 3-5 minutes
- Daily update: 1-2 minutes (fewer new games)

## Troubleshooting

### Table doesn't exist
**Error**: `relation "player_game_logs" does not exist`
**Solution**: Run the migration: `node run_migration.js`

### No games found for player
**Error**: `Player game logs not found`
**Solution**: Run fetch script: `node fetch_game_logs.js`

### Database connection failed
**Error**: `Database connection failed`
**Solution**:
- Check DATABASE_URL environment variable
- Verify NeonTech database is running
- Check network connection

### Fetch script fails
**Error**: `fetch failed` during script
**Solutions**:
- Check internet connection
- NHL API might be down - try later
- Some players don't have game logs yet

### Duplicate key error
**Error**: `duplicate key value violates unique constraint`
**Solution**: This shouldn't happen due to ON CONFLICT clause. If it does, check migration ran correctly.

## Database Queries (Examples)

### Get player's last 10 games

```sql
SELECT * FROM player_game_logs
WHERE player_id = 8478402 AND season = '20252026'
ORDER BY game_date DESC
LIMIT 10;
```

### Get top scorers in last 10 games

```sql
SELECT
    player_name,
    SUM(goals) as goals,
    SUM(assists) as assists,
    SUM(points) as points
FROM (
    SELECT DISTINCT ON (player_id, game_id)
        player_name, goals, assists, points
    FROM player_game_logs
    WHERE season = '20252026'
        AND position != 'G'
    ORDER BY player_id, game_id, game_date DESC
    LIMIT 10
) last_10
GROUP BY player_name
ORDER BY SUM(points) DESC
LIMIT 10;
```

### Get goalie stats

```sql
SELECT
    player_name,
    COUNT(*) as games_played,
    SUM(CASE WHEN decision = 'W' THEN 1 ELSE 0 END) as wins,
    AVG(save_pct) as avg_save_pct,
    SUM(shutouts) as shutouts
FROM player_game_logs
WHERE season = '20252026' AND position = 'G'
GROUP BY player_name
ORDER BY avg_save_pct DESC;
```

## Files

- **Migration**: `migrations/create_player_game_logs.sql`
- **Migration Runner**: `run_migration.js`
- **Fetch Script**: `fetch_game_logs.js`
- **Server Endpoint**: `server.js` - `/player-gamelog/:playerId`
- **Database Config**: `db.js`

## Benefits Over JSON

| Feature | JSON File | PostgreSQL |
|---------|-----------|------------|
| Multi-server support | ❌ | ✅ |
| Partial queries | ❌ | ✅ |
| Memory efficient | ❌ (loads all) | ✅ (loads only needed) |
| Atomic updates | ❌ | ✅ |
| Query flexibility | ❌ | ✅ |
| Deployment persistence | ❌ | ✅ |
| Analytics | ❌ | ✅ |
| Concurrent access | ⚠️ | ✅ |

## Production Considerations

1. **Indexes are crucial** - makes queries 100x faster
2. **Run fetch script daily** - keeps data fresh
3. **Monitor database size** - should stay under 50 MB
4. **Use connection pooling** - already configured in db.js
5. **Set up monitoring** - track query performance
6. **Consider cleanup** - remove old seasons if needed

## Cleanup Old Seasons (Optional)

If you want to remove old season data:

```sql
-- Remove games from previous season
DELETE FROM player_game_logs WHERE season = '20242025';

-- Keep only current season
DELETE FROM player_game_logs WHERE season != '20252026';

-- Vacuum to reclaim space
VACUUM player_game_logs;
```

---

**Questions?** Check the code comments in `fetch_game_logs.js` and `server.js` for implementation details.
