-- 0004 — Journal d'opérations (idempotence).
--
-- Un choix de repêchage envoyé deux fois — réseau incertain, double clic,
-- réessai automatique — ne doit pas consommer deux tours. Le client attache un
-- identifiant d'opération ; le serveur enregistre son résultat dans la même
-- transaction que l'effet. Un réessai du même identifiant relit le résultat au
-- lieu de rejouer l'effet.
--
-- `request_hash` distingue « le même réessai » de « un identifiant recyclé avec
-- une autre demande » : le second est refusé, pas servi depuis le cache.

CREATE TABLE IF NOT EXISTS operations (
    operation_id VARCHAR(128) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scope VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);
