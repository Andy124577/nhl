# Migrer vers une base de données externe (Neon.tech)

Ce guide vous permet de passer de PostgreSQL sur Render à une base de données PostgreSQL gratuite externe, vous donnant **750h complètes** sur Render au lieu de 375h.

## Pourquoi cette migration?

**Avant:**
- Service web Render: ~375h/mois
- PostgreSQL Render: ~375h/mois
- **Total: 750h divisé en 2 = site arrêté après ~15 jours**

**Après:**
- Service web Render: **750h/mois complet** ✅
- PostgreSQL Neon.tech: **Gratuit illimité** ✅
- **Total: Site fonctionne tout le mois!** 🎉

---

## Étape 1: Créer un compte Neon.tech

1. Allez sur https://neon.tech
2. Cliquez sur **"Sign Up"**
3. Connectez-vous avec GitHub (recommandé) ou email
4. Plan: Sélectionnez **"Free"** (500 MB gratuit)

---

## Étape 2: Créer une base de données

1. Dans le dashboard Neon, cliquez sur **"Create Project"**
2. Paramètres:
   - **Name:** `nhl-fantasy-pool` (ou votre choix)
   - **Region:** Choisissez la région la plus proche (ex: US East pour Amérique du Nord)
   - **PostgreSQL Version:** 15 ou 16 (latest)
3. Cliquez sur **"Create Project"**

---

## Étape 3: Obtenir l'URL de connexion

1. Une fois le projet créé, allez dans **"Connection Details"**
2. Copiez la **"Connection string"** (format: `postgresql://user:password@host/database`)
3. Elle ressemble à:
   ```
   postgresql://neondb_owner:abc123xyz@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Gardez cette URL secrète!**

---

## Étape 4: Sauvegarder vos données actuelles (IMPORTANT!)

### Si vous avez déjà des données sur Render:

1. Allez sur votre dashboard Render
2. Sélectionnez votre base de données **"willie-pooler-db"**
3. Onglet **"Info"** → Copiez les **Connection Details**
4. Installez PostgreSQL localement (si pas déjà fait):
   ```bash
   # Windows: Téléchargez depuis https://www.postgresql.org/download/windows/
   # Mac: brew install postgresql
   # Linux: sudo apt install postgresql-client
   ```

5. Exportez vos données:
   ```bash
   pg_dump "VOTRE_RENDER_DATABASE_URL_ICI" > backup.sql
   ```

6. Importez dans Neon:
   ```bash
   psql "VOTRE_NEON_DATABASE_URL_ICI" < backup.sql
   ```

### Si vous n'avez pas encore de données:
- Passez directement à l'étape 5! ✅

---

## Étape 5: Configurer Render avec la nouvelle DB

1. Allez sur votre dashboard Render
2. Sélectionnez votre service web **"willie-pooler"**
3. Allez dans **Settings** → **Environment**
4. Trouvez la variable **`DATABASE_URL`**
5. Cliquez sur **Edit** (crayon)
6. Remplacez l'ancienne valeur par votre **Neon connection string**:
   ```
   postgresql://neondb_owner:abc123xyz@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
7. Cliquez sur **Save Changes**

---

## Étape 6: Supprimer l'ancienne base de données Render

**⚠️ ATTENTION: Ne faites ceci QU'APRÈS avoir vérifié que la nouvelle DB fonctionne!**

1. Testez d'abord que votre site fonctionne avec Neon
2. Une fois confirmé, allez sur Render Dashboard
3. Sélectionnez votre base de données **"willie-pooler-db"**
4. Settings → **Delete Database**
5. Confirmez la suppression

**Résultat:** Vous ne consommez plus que 750h pour un seul service! 🎉

---

## Étape 7: Vérifier que tout fonctionne

1. Visitez https://fantazy.ca
2. Créez un compte de test
3. Créez un pool
4. Vérifiez que les données persistent après redémarrage

Si tout fonctionne: **Félicitations!** Votre site fonctionnera maintenant tout le mois gratuitement!

---

## Étape 8: Mettre à jour render.yaml

Modifiez votre fichier `render.yaml` pour ne plus référencer la base de données Render:

```yaml
services:
  - type: web
    name: willie-pooler
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: # Sera configuré manuellement dans le dashboard

# Supprimez cette section:
# databases:
#   - name: willie-pooler-db
#     databaseName: nhl_pool
#     user: nhl_pool_user
#     plan: free
```

---

## Troubleshooting

### Erreur de connexion SSL:
Si vous obtenez une erreur SSL, ajoutez `?sslmode=require` à la fin de votre connection string.

### Tables non créées:
Les tables seront créées automatiquement au démarrage grâce à `db.initializeDatabase()` dans votre code.

### Données perdues:
Si vous avez oublié de sauvegarder, contactez le support Render rapidement - ils peuvent parfois restaurer.

---

## Alternatives à Neon.tech

Si Neon ne fonctionne pas pour vous:

1. **Supabase:** https://supabase.com (500 MB gratuit)
2. **ElephantSQL:** https://www.elephantsql.com (20 MB gratuit)
3. **Railway.app:** https://railway.app ($5 crédit/mois)

Toutes fonctionnent de la même manière - il suffit de copier la connection string!

---

## Résumé

✅ **Avant:** 750h/mois divisé en 2 services = ~15 jours
✅ **Après:** 750h/mois pour 1 seul service = **30-31 jours complets!**
✅ **Coût:** $0/mois (100% gratuit)
✅ **Effort:** ~15 minutes de configuration

Profitez de votre site gratuit tout le mois! 🚀
