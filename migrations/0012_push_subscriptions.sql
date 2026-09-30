-- 0012 — Alertes sur l'appareil (Web Push).
--
-- Un navigateur qui accepte les alertes remet une adresse chez le service de
-- son fabricant et deux clés (lib/webPush.js). Une ligne par navigateur : la
-- même personne peut en avoir plusieurs (téléphone, ordinateur).
--
-- `endpoint` est unique : si une autre personne se connecte dans le même
-- navigateur, l'abonnement change de compte au lieu d'alerter les deux. La
-- ligne part avec le compte, à la déconnexion, et quand le service répond que
-- l'abonnement n'existe plus (404, 410).

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
