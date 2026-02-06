-- Migration: Create player_game_logs table
-- Description: Stores game-by-game statistics for all NHL players
-- Date: 2026-02-06

-- Drop table if exists (for clean migration)
DROP TABLE IF EXISTS player_game_logs CASCADE;

-- Create main table
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

    -- Constraints
    CONSTRAINT unique_player_game UNIQUE(player_id, game_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_player_game_logs_player_id ON player_game_logs(player_id);
CREATE INDEX idx_player_game_logs_season ON player_game_logs(season);
CREATE INDEX idx_player_game_logs_game_date ON player_game_logs(game_date DESC);
CREATE INDEX idx_player_game_logs_position ON player_game_logs(position);
CREATE INDEX idx_player_game_logs_composite ON player_game_logs(player_id, season, game_date DESC);

-- Comments for documentation
COMMENT ON TABLE player_game_logs IS 'Stores game-by-game statistics for NHL players';
COMMENT ON COLUMN player_game_logs.player_id IS 'NHL API player ID';
COMMENT ON COLUMN player_game_logs.season IS 'Season in format YYYYZZZZ (e.g., 20252026)';
COMMENT ON COLUMN player_game_logs.game_id IS 'NHL API game ID';
COMMENT ON COLUMN player_game_logs.home_road_flag IS 'H for home, R for road';
COMMENT ON COLUMN player_game_logs.game_result IS 'W, L, OT, SO, etc.';
COMMENT ON COLUMN player_game_logs.decision IS 'Goalie decision: W, L, O, null';
COMMENT ON COLUMN player_game_logs.save_pct IS 'Goalie save percentage (0.000 to 1.000)';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON player_game_logs TO your_app_user;
-- GRANT USAGE, SELECT ON SEQUENCE player_game_logs_id_seq TO your_app_user;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed successfully: player_game_logs table created';
END $$;
