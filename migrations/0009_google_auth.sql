-- 0009 — Connexion avec Google.
--
-- Un compte peut désormais s'ouvrir par Google plutôt que par mot de passe.
-- On ne garde de Google que l'identifiant stable du compte (`sub`) : ni
-- adresse courriel, ni nom, ni photo. Le `sub` suffit à reconnaître la
-- personne au retour ; le reste serait un renseignement de plus à protéger
-- sans rien apporter (Loi 25, minimisation).
--
-- Le mot de passe devient facultatif : un compte créé par Google n'en a pas.
-- routes/identity.js refuse alors toute connexion par mot de passe pour ce
-- compte, plutôt que de comparer à une valeur vide.
--
-- L'index unique est partiel : des milliers de comptes sans Google (NULL)
-- doivent pouvoir coexister, mais un même compte Google ne peut ouvrir
-- qu'un seul compte Fantazy.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
    ON users(google_sub) WHERE google_sub IS NOT NULL;

ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
