-- 0007 — Récapitulatifs hebdomadaires.
--
-- Un récap est dérivé de résultats finalisés, jamais des alignements du jour :
-- sinon un échange de mardi fabriquerait un exploit de la semaine dernière. La
-- ligne retient la révision de résultat dont elle est issue, ce qui permet de
-- reconnaître un récap devenu obsolète après une correction officielle.

CREATE TABLE IF NOT EXISTS weekly_recaps (
    id BIGSERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    season VARCHAR(10) NOT NULL,
    week_number INTEGER NOT NULL,
    result_revision INTEGER NOT NULL DEFAULT 1,
    pool_mode VARCHAR(24) NOT NULL,
    payload JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT weekly_recaps_unique UNIQUE (pool_id, season, week_number)
);

CREATE INDEX IF NOT EXISTS idx_weekly_recaps_pool
    ON weekly_recaps(pool_id, season, week_number DESC);
