-- 0006 — Résultats hebdomadaires finalisés.
--
-- Les résultats vivaient uniquement dans le JSONB du pool, recalculés depuis
-- l'alignement courant. Un échange conclu mardi réécrivait donc le pointage de
-- la semaine dernière. Une ligne finalisée est figée : elle porte sa saison,
-- sa semaine, sa version de barème, la base d'alignement utilisée, et le
-- détail qui a produit le résultat.
--
-- Une correction officielle crée une révision de plus, jamais une deuxième
-- victoire : `standings_delta` dit exactement ce qui a été ajouté au classement,
-- donc exactement ce qu'il faut retirer avant d'appliquer la nouvelle version.

CREATE TABLE IF NOT EXISTS h2h_finalized_results (
    id BIGSERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    season VARCHAR(10) NOT NULL,
    week_number INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    superseded_at TIMESTAMPTZ,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    scoring_version VARCHAR(24) NOT NULL,
    roster_basis VARCHAR(32) NOT NULL,
    results JSONB NOT NULL,
    standings_delta JSONB NOT NULL,
    finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT h2h_results_unique UNIQUE (pool_id, season, week_number, revision)
);

CREATE INDEX IF NOT EXISTS idx_h2h_results_pool
    ON h2h_finalized_results(pool_id, season, week_number DESC);
