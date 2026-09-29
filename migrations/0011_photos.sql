-- 0011 — Les photos téléversées vivent dans la base.
--
-- Render (offre gratuite) efface son disque à chaque redémarrage : une photo
-- écrite dans uploads/ disparaissait au déploiement suivant. Chaque photo est
-- désormais optimisée (512 px au plus, WebP, sans métadonnées — voir
-- services/magasinPhotos.js), ce qui la ramène à quelques dizaines de Ko,
-- puis rangée ici et servie par /photos/<id>.webp.
--
-- `users.avatar_url` et `imageUrl` dans les données d'un pool portent
-- l'adresse ; la ligne part quand la photo est remplacée ou retirée, quand le
-- compte ou le pool est supprimé.

CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
