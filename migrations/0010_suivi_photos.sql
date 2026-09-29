-- 0010 — Suivi des photos téléversées.
--
-- L'écran « Photos téléversées » de l'administration (routes/photos.js) dit,
-- pour chaque photo de profil, quand elle a été posée et si l'analyse
-- automatique l'a regardée. Sans ANTHROPIC_API_KEY, ou pendant une panne de
-- l'analyse, une photo est publiée sans avoir été vue
-- (services/moderationImage.js) : c'est elle qu'on veut repérer.
--
-- NULL : photo posée avant ce suivi — on ne sait ni quand, ni si elle a été
-- vue. Les images de pool portent la même information dans les données du
-- pool (`imageMeta`, à côté de `imageUrl`).

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_uploaded_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_checked BOOLEAN;
