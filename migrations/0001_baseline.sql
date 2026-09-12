-- 0001 — Schéma de base, tel qu'il existait avant le registre de migrations.
--
-- Ce fichier ne crée rien de neuf : il décrit ce que initializeDatabase()
-- créait déjà à chaque démarrage. Il est écrit en IF NOT EXISTS pour qu'une
-- base déjà en service le traverse sans effet, et pour qu'une base vierge
-- obtienne exactement la même forme. Aucun DROP ici : une migration qui
-- détruit des données d'utilisateurs n'est pas une migration.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS pools (
    id SERIAL PRIMARY KEY,
    pool_name VARCHAR(255) UNIQUE NOT NULL,
    pool_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    pool_name VARCHAR(255) NOT NULL,
    trade_data JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trades_pool_name ON trades(pool_name);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

CREATE TABLE IF NOT EXISTS trade_listings (
    id SERIAL PRIMARY KEY,
    pool_name VARCHAR(255) NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    player_name VARCHAR(255) NOT NULL,
    category VARCHAR(20) NOT NULL,
    listed_by VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trade_listings_pool_name ON trade_listings(pool_name);
CREATE INDEX IF NOT EXISTS idx_trade_listings_status ON trade_listings(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_listings_active_unique
    ON trade_listings(pool_name, team_name, player_name) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS cached_stats (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(100) UNIQUE NOT NULL,
    data JSONB NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pool_rank_snapshots (
    id SERIAL PRIMARY KEY,
    pool_name VARCHAR(255) NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    rank INT NOT NULL,
    points NUMERIC NOT NULL,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_name, team_name, snapshot_date)
);

-- player_game_logs existait via migrations/create_player_game_logs.sql, qui
-- commence par un DROP TABLE. Recréé ici sans le DROP : une base qui porte
-- déjà des feuilles de match ne doit pas les perdre en appliquant le registre.
CREATE TABLE IF NOT EXISTS player_game_logs (
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
    games_started INTEGER DEFAULT 0,
    decision VARCHAR(5),
    shots_against INTEGER DEFAULT 0,
    goals_against INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_pct DECIMAL(5,3),
    shutouts INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_player_game UNIQUE(player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_player_game_logs_player_id ON player_game_logs(player_id);
CREATE INDEX IF NOT EXISTS idx_player_game_logs_season ON player_game_logs(season);
CREATE INDEX IF NOT EXISTS idx_player_game_logs_game_date ON player_game_logs(game_date DESC);
CREATE INDEX IF NOT EXISTS idx_player_game_logs_position ON player_game_logs(position);
CREATE INDEX IF NOT EXISTS idx_player_game_logs_composite ON player_game_logs(player_id, season, game_date DESC);
-- La recherche hebdomadaire du tête-à-tête filtre par nom + saison + date.
CREATE INDEX IF NOT EXISTS idx_player_game_logs_name_season_date
    ON player_game_logs(player_name, season, game_date);
