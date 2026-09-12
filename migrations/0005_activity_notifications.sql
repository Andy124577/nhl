-- 0005 — Activité de pool et notifications durables.
--
-- Petits enregistrements explicites, écrits dans la transaction qui change
-- l'état source. Pas de file de messages, pas d'event sourcing : la base reste
-- la vérité, la diffusion socket n'est qu'un signal de rafraîchissement.
--
-- `dedup_key` est ce qui rend un réessai inoffensif : deux tentatives de la
-- même opération produisent la même clé, donc une seule ligne.

CREATE TABLE IF NOT EXISTS pool_activity (
    id BIGSERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    type VARCHAR(48) NOT NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata_version SMALLINT NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dedup_key VARCHAR(200) NOT NULL UNIQUE
);

-- Pagination par curseur : (pool, moment, id) décroissants.
CREATE INDEX IF NOT EXISTS idx_pool_activity_cursor
    ON pool_activity(pool_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(48) NOT NULL,
    pool_id INTEGER REFERENCES pools(id) ON DELETE CASCADE,
    activity_id BIGINT REFERENCES pool_activity(id) ON DELETE SET NULL,
    subject JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    dedup_key VARCHAR(200) NOT NULL,
    CONSTRAINT notifications_recipient_dedup UNIQUE (recipient_user_id, dedup_key)
);

-- La pastille compte les non-lues encore affichables : c'est cette requête-là
-- qui doit être indexée, pas la liste complète.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(recipient_user_id, occurred_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
    ON notifications(recipient_user_id, occurred_at DESC);
