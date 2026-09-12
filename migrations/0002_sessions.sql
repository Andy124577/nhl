-- 0002 — Sessions serveur.
--
-- /login vérifiait le mot de passe puis renvoyait le nom d'utilisateur, que le
-- navigateur rangeait dans localStorage et renvoyait dans le corps de chaque
-- requête. N'importe qui pouvait donc écrire le nom de n'importe qui. Une
-- session rend l'identité vérifiable côté serveur.
--
-- Seule l'empreinte du jeton est stockée : une fuite de cette table ne donne
-- aucune session utilisable, exactement comme pour les mots de passe.

CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    token_hash CHAR(64) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
