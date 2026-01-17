# Guide de déploiement sur Render.com 🚀

## ✨ Déploiement simplifié (RECOMMANDÉ)

Grâce au fichier `render.yaml` et au script d'initialisation automatique, votre application est **prête à déployer en 3 étapes**!

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
- ✅ Créer le volume persistant de 1GB (~$0.25/mois)
- ✅ Configurer `NODE_ENV=production`
- ✅ Installer les dépendances
- ✅ Initialiser vos fichiers de données (users.json, draft.json, trades.json)
- ✅ Démarrer l'application

### Étape 4: Vérifier le déploiement

Attendez 2-5 minutes pendant que Render déploie votre app.

Vous verrez dans les logs:
```
🔧 Initializing data files for production...
✅ Created data directory: /opt/render/project/src/data
✅ Initialized users.json from application directory
✅ Initialized draft.json from application directory
✅ Initialized trades.json from application directory
✅ Data initialization complete
🚀 Serveur en cours d'exécution sur http://localhost:10000
📁 Data directory: /opt/render/project/src/data
💾 Using JSON files for data storage
```

Votre application sera disponible à: **`https://willie-pooler.onrender.com`**

---

## 📋 Déploiement manuel (alternative)

Si vous préférez configurer manuellement au lieu d'utiliser render.yaml:

### Étape 1: Créer un Web Service

1. Dashboard Render → **"New +"** → **"Web Service"**
2. Connectez votre repository `Andy124577/nhl`
3. Configuration:
   - **Name**: `willie-pooler`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Étape 2: Ajouter le Volume Persistant

1. Dans la configuration, allez à **"Disks"**
2. Cliquez **"Add Disk"**:
   - **Name**: `nhl-data`
   - **Mount Path**: `/opt/render/project/src/data`
   - **Size**: `1 GB`

### Étape 3: Variable d'environnement

1. Allez à **"Environment"**
2. Ajoutez:
   - **Key**: `NODE_ENV`
   - **Value**: `production`

### Étape 4: Déployer

Cliquez sur **"Create Web Service"**

---

## 💰 Coûts

- **Web Service (Free tier)**: **$0/mois**
  - 750 heures/mois
  - 512 MB RAM
  - Redémarre après 15 min d'inactivité

- **Volume Persistant (1 GB)**: **~$0.25/mois**
  - Données persistent entre redémarrages
  - Backups automatiques

**Total: ~$0.25/mois** 💰

---

## 🔄 Mises à jour

### Déploiement automatique (recommandé)

Activez auto-deploy dans les settings Render:
1. **Settings** → **Build & Deploy**
2. Activez **"Auto-Deploy"**
3. Chaque `git push` déploie automatiquement!

### Déploiement manuel

1. Commitez vos changements:
   ```bash
   git add .
   git commit -m "Update features"
   git push origin main
   ```

2. Dans Render dashboard:
   - Cliquez sur **"Manual Deploy"** → **"Deploy latest commit"**

---

## 🐛 Debugging

### Voir les logs

Dans le dashboard Render:
1. Sélectionnez votre service
2. Allez dans **"Logs"**
3. Vous verrez tous les `console.log()` en temps réel

### Problèmes communs

**❌ Service ne démarre pas:**
- Vérifiez les logs pour les erreurs
- Assurez-vous que `npm start` fonctionne localement
- Vérifiez que le PORT est bien `process.env.PORT`

**❌ Données perdues après redémarrage:**
- Vérifiez que le volume est bien monté à `/opt/render/project/src/data`
- Vérifiez les logs d'initialisation des fichiers

**❌ "Cannot find module":**
- Vérifiez que toutes les dépendances sont dans `package.json`
- Relancez le build manuellement

---

## 📊 Vérifier les données

### Via SSH (Shell Access)

Render Free tier n'a pas de SSH, mais vous pouvez:

1. Ajouter un endpoint de diagnostic temporaire dans `server.js`:
   ```javascript
   app.get('/admin/data-check', (req, res) => {
       const files = fs.readdirSync(DATA_DIR);
       const stats = files.map(file => ({
           file,
           size: fs.statSync(`${DATA_DIR}/${file}`).size
       }));
       res.json({ dataDir: DATA_DIR, files: stats });
   });
   ```

2. Visitez: `https://willie-pooler.onrender.com/admin/data-check`

3. **Supprimez cet endpoint après vérification!**

---

## 🎉 Félicitations!

Votre pool NHL est maintenant en ligne 24/7! 🏒

### URLs importantes

- **Application**: `https://willie-pooler.onrender.com`
- **Dashboard Render**: `https://dashboard.render.com`
- **Logs**: Dashboard → Votre service → Logs

### Prochaines étapes

1. ✅ Testez toutes les fonctionnalités
2. ✅ Créez des utilisateurs
3. ✅ Configurez vos pools
4. ✅ Invitez vos amis!

---

## 🔮 Migration PostgreSQL (optionnel - future)

Si un jour vous avez besoin de PostgreSQL (10,000+ utilisateurs):

1. Créez une base PostgreSQL gratuite sur Render
2. Ajoutez `DATABASE_URL` dans les variables d'environnement
3. Utilisez le script `migrate-to-postgres.js` pour migrer vos données
4. Le code détectera automatiquement PostgreSQL et l'utilisera

Mais pour votre cas d'usage, **le volume persistant est parfait!** 👌
