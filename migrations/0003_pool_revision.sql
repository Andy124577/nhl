-- 0003 — Révision de pool.
--
-- Un entier qui avance à chaque écriture validée. Il ne remplace pas le verrou
-- de ligne : il permet à un client de savoir que l'état qu'il affiche est
-- périmé, et à une requête d'annoncer sur quelle version elle a été calculée.
--
-- Les pools existants partent à 1 plutôt qu'à 0, pour qu'une révision absente
-- (0) se distingue d'une révision réelle.

ALTER TABLE pools ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
