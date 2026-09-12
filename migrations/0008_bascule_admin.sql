-- 0008 — La session se souvient de qui l'a ouverte.
--
-- `/admin-switch-user` ouvre une vraie session au nom de la personne visée.
-- C'est ce qu'on veut : l'administration voit l'application exactement comme
-- cette personne la voit, sans privilège résiduel qui fausserait le dépannage.
--
-- Mais la session obtenue ne gardait aucune trace de son origine. Après une
-- bascule, l'administration était `fza` et rien d'autre : plus moyen de lister
-- les comptes ni de basculer ailleurs, puisque `fza` n'est pas administrateur.
-- Un aller sans retour, et le seul moyen de revenir était de se déconnecter.
--
-- Cette colonne note l'administration qui a ouvert la session. Elle n'accorde
-- pas les droits d'administration — elle accorde exactement trois choses :
-- lister les comptes, basculer encore, et revenir chez soi.
--
-- ON DELETE SET NULL : si le compte d'administration disparaît, la session de
-- la personne visée reste valable, elle perd seulement son billet de retour.

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS impersonated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
