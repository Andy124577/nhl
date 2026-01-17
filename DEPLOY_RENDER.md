# Guide de déploiement sur Render.com 🚀

## ✨ Déploiement avec PostgreSQL GRATUIT

Votre application utilise maintenant PostgreSQL gratuit sur Render! Plus besoin de volumes persistants payants.

**Coût total: $0/mois** 🎉

---

## 🚀 Déploiement en 3 étapes

### Étape 1: Préparer votre code

```bash
# Assurez-vous que tous vos changements sont committés
git add .
git commit -m "Ready for Render deployment"
git push origin main  # ou votre branche principale
```

### Étape 2: Créer un compte Render.com

1. Allez sur **https://render.com**
2. Créez un compte gratuit
3. Connectez votre compte **GitHub**

### Étape 3: Déployer avec Blueprint (render.yaml)

1. Dans le dashboard Render, cliquez sur **"New +"** → **"Blueprint"**
2. Sélectionnez **"Connect a repository"**
3. Trouvez votre repository **`Andy124577/nhl`**
4. Render détecte automatiquement `render.yaml` 🎉
5. Cliquez sur **"Apply"**

**C'est tout!** ✅

Render va automatiquement:
- ✅ Créer le service web Node.js (gratuit)
- ✅ Créer la base de données PostgreSQL (gratuit)
- ✅ Créer les tables (users, pools, trades)
- ✅ Connecter le service à la base de données
- ✅ Installer les dépendances
- ✅ Démarrer l'application

---

## 📊 Ce qui est créé

### Service Web
- **Name**: willie-pooler
- **Type**: Node.js
- **Plan**: Free ($0/mois)
- **RAM**: 512 MB
- **Auto-deploy**: Activé

### Base de données PostgreSQL
- **Name**: willie-pooler-db
- **Database**: nhl_pool
- **User**: nhl_pool_user
- **Plan**: Free ($0/mois)
- **Storage**: 1 GB
- **Tables**: users, pools, trades

---

## 🔄 Vérifier le déploiement

Attendez 3-5 minutes pendant que Render déploie votre app.

Vous verrez dans les logs:
```
📁 Data directory: /opt/render/project/src/data
🗄️  Initializing PostgreSQL database...
✅ Users table ready
✅ Pools table ready
✅ Trades table ready
✅ Database initialization complete
✅ PostgreSQL database initialized successfully
🚀 Serveur en cours d'exécution sur http://localhost:10000
💾 Using PostgreSQL for data storage
```

Votre application sera disponible à: **`https://fantazy.ca`**

---

## 📦 Migration des données existantes

Si vous avez déjà des utilisateurs, pools et trades dans vos fichiers JSON locaux, vous devez les migrer vers PostgreSQL:

### Option A: Via terminal SSH (si disponible sur votre plan)

```bash
# Se connecter au service
render ssh willie-pooler

# Installer les dépendances si nécessaire
npm install

# Exécuter le script de migration
node migrate-to-postgres.js
```

### Option B: Via endpoint temporaire

1. Ajoutez temporairement ce code dans `server.js` après les autres routes:

```javascript
app.post('/admin/migrate-data', async (req, res) => {
    try {
        // Lire les fichiers JSON
        const users = JSON.parse(fs.readFileSync('./users.json', 'utf-8'));
        const drafts = JSON.parse(fs.readFileSync('./draft.json', 'utf-8'));
        const trades = JSON.parse(fs.readFileSync('./trades.json', 'utf-8'));

        // Migrer users
        for (const user of users) {
            await db.createUser(user.username, user.password, user.isAdmin || false);
        }

        // Migrer pools
        for (const [poolName, poolData] of Object.entries(drafts)) {
            await db.createOrUpdatePool(poolName, poolData);
        }

        // Migrer trades
        for (const [poolName, poolTrades] of Object.entries(trades)) {
            if (poolTrades.pending) {
                for (const trade of poolTrades.pending) {
                    const id = await db.createTrade(poolName, trade);
                    await db.updateTradeStatus(id, 'pending');
                }
            }
            if (poolTrades.completed) {
                for (const trade of poolTrades.completed) {
                    const id = await db.createTrade(poolName, trade);
                    await db.updateTradeStatus(id, 'completed');
                }
            }
        }

        res.json({ success: true, message: 'Migration complete!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

2. Déployez le code
3. Visitez: `https://fantazy.ca/admin/migrate-data` (POST request)
4. **Supprimez cet endpoint après la migration!**

### Option C: Commencer à zéro

Si vous n'avez pas encore de données importantes, vous pouvez simplement commencer à zéro et recréer les utilisateurs et pools.

---

## 💰 Coûts

| Service | Plan | Prix |
|---------|------|------|
| Web Service | Free | **$0/mois** |
| PostgreSQL Database | Free | **$0/mois** |
| **TOTAL** | | **$0/mois** |

### Limitations du plan gratuit

**Web Service:**
- 750 heures/mois (suffisant pour 1 app)
- 512 MB RAM
- Service dort après 15 min d'inactivité
- Réveil automatique à la première requête (~30 secondes)

**PostgreSQL:**
- 1 GB de stockage
- Connexions limitées (suffisant pour petites apps)
- Expire après 90 jours d'inactivité

💡 **Astuce:** Pour éviter que votre app dorme, utilisez un service comme [UptimeRobot](https://uptimerobot.com) (gratuit) pour ping votre app toutes les 5 minutes.

---

## 🔄 Mises à jour

### Déploiement automatique (recommandé)

Render détecte automatiquement les pushs sur votre branche principale et redéploie.

```bash
git add .
git commit -m "Update features"
git push origin main
```

Render redéploie automatiquement en ~2-3 minutes!

### Déploiement manuel

Dans le dashboard Render:
1. Sélectionnez votre service
2. Cliquez sur **"Manual Deploy"** → **"Deploy latest commit"**

---

## 🐛 Debugging

### Voir les logs

Dashboard Render → Votre service → **"Logs"**

Tous les `console.log()` apparaissent en temps réel.

### Problèmes courants

**❌ "Cannot connect to database"**
- Vérifiez que DATABASE_URL est bien configuré dans les variables d'environnement
- Vérifiez que la base de données PostgreSQL est bien créée et active
- Regardez les logs pour plus de détails

**❌ "Table does not exist"**
- La base de données n'a pas été initialisée
- Vérifiez les logs au démarrage pour voir si `initializeDatabase()` a réussi
- Redéployez manuellement si nécessaire

**❌ Service ne démarre pas**
- Vérifiez les logs pour les erreurs
- Assurez-vous que `npm start` fonctionne localement
- Vérifiez que toutes les dépendances sont dans `package.json`

**❌ Service dort trop souvent**
- C'est normal sur le plan gratuit après 15 min d'inactivité
- Utilisez UptimeRobot pour ping votre app régulièrement
- Ou passez au plan payant ($7/mois) pour un service toujours actif

---

## 📊 Accéder à la base de données

### Via Render Dashboard

1. Dashboard → votre base de données PostgreSQL
2. Onglet **"Info"**
3. Vous y trouverez:
   - Hostname
   - Port
   - Database name
   - Username
   - Password
   - Connection string

### Avec un client PostgreSQL

Utilisez les infos de connexion avec:
- **pgAdmin** (GUI)
- **psql** (CLI)
- **DBeaver** (GUI)
- **TablePlus** (GUI)

Exemple avec psql:
```bash
psql postgresql://nhl_pool_user:PASSWORD@HOST:PORT/nhl_pool
```

### Requêtes utiles

```sql
-- Voir tous les utilisateurs
SELECT * FROM users;

-- Voir tous les pools
SELECT pool_name, created_at FROM pools;

-- Voir les échanges en attente
SELECT * FROM trades WHERE status = 'pending';

-- Compter les données
SELECT
    (SELECT COUNT(*) FROM users) as users_count,
    (SELECT COUNT(*) FROM pools) as pools_count,
    (SELECT COUNT(*) FROM trades) as trades_count;
```

---

## 🎉 Félicitations!

Votre pool NHL est maintenant en ligne 24/7 avec PostgreSQL! 🏒

### URLs importantes

- **Application**: `https://fantazy.ca`
- **Dashboard Render**: `https://dashboard.render.com`
- **Logs**: Dashboard → Votre service → Logs
- **Database**: Dashboard → willie-pooler-db

### Prochaines étapes

1. ✅ Testez toutes les fonctionnalités
2. ✅ Migrez vos données existantes (si applicable)
3. ✅ Créez des utilisateurs
4. ✅ Configurez vos pools
5. ✅ Invitez vos amis!
6. ✅ (Optionnel) Configurez UptimeRobot pour éviter le sommeil

---

## 🔧 Configuration avancée

### Variables d'environnement

Pour ajouter des variables d'environnement:
1. Dashboard → votre service → **"Environment"**
2. Ajoutez vos variables
3. Redéployez

Variables déjà configurées:
- `NODE_ENV=production`
- `DATABASE_URL` (automatique depuis la base de données)

### Custom Domain

Pour utiliser votre propre domaine:
1. Dashboard → votre service → **"Settings"** → **"Custom Domain"**
2. Ajoutez votre domaine (ex: `pool.monsite.com`)
3. Configurez les DNS selon les instructions Render

---

## 🆘 Support

- **Documentation Render**: https://render.com/docs
- **PostgreSQL Guide**: https://render.com/docs/databases
- **Community Forum**: https://community.render.com

Bon déploiement! 🚀
