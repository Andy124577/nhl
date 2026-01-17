# Guide de déploiement sur Render.com

## 🚀 Configuration avec Volume Persistant

### Étape 1: Créer un compte Render.com
1. Allez sur https://render.com
2. Créez un compte (gratuit)
3. Connectez votre compte GitHub

### Étape 2: Créer un nouveau Web Service
1. Dans le dashboard Render, cliquez sur **"New +"** → **"Web Service"**
2. Connectez votre repository GitHub `Andy124577/nhl`
3. Sélectionnez la branche à déployer (probablement `main` ou votre branche actuelle)

### Étape 3: Configuration du service

**Basic Settings:**
- **Name**: `willie-pooler` (ou le nom de votre choix)
- **Region**: Choisissez le plus proche de vous (ex: `Oregon (US West)`)
- **Branch**: La branche de votre code (ex: `main`)
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Instance Type:**
- Sélectionnez **"Free"** (gratuit) pour commencer
- Vous pouvez upgrader plus tard si nécessaire

### Étape 4: Variables d'environnement (optionnel)
Pour l'instant, aucune variable d'environnement n'est nécessaire car nous utilisons les fichiers JSON.

### Étape 5: Créer le Volume Persistant

C'est l'étape CRUCIALE pour que vos données persistent:

1. Allez dans **"Disks"** (dans la configuration du service)
2. Cliquez sur **"Add Disk"**
3. Configuration du volume:
   - **Name**: `nhl-data`
   - **Mount Path**: `/home/user/nhl/data`
   - **Size**: `1 GB` (largement suffisant)

4. **IMPORTANT**: Modifiez votre `server.js` pour utiliser le bon chemin vers le volume

### Étape 6: Modifier les chemins des fichiers JSON

Avant de déployer, vous devez modifier `server.js` pour pointer vers le volume persistant:

```javascript
// Au début de server.js, changez:
const USERS_FILE = "./users.json";
const DRAFT_FILE = "./draft.json";
const TRADES_FILE = "./trades.json";

// En:
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/home/user/nhl/data' : '.';
const USERS_FILE = `${DATA_DIR}/users.json`;
const DRAFT_FILE = `${DATA_DIR}/draft.json`;
const TRADES_FILE = `${DATA_DIR}/trades.json`;
```

### Étape 7: Ajouter une variable d'environnement

Dans la configuration du service Render:
1. Allez dans **"Environment"**
2. Ajoutez: `NODE_ENV` = `production`

### Étape 8: Déployer!

1. Cliquez sur **"Create Web Service"**
2. Render va:
   - Cloner votre repository
   - Installer les dépendances (`npm install`)
   - Démarrer votre serveur (`npm start`)

3. Attendez que le déploiement se termine (2-5 minutes)
4. Votre application sera disponible à: `https://willie-pooler.onrender.com`

## 📝 Notes importantes

### Fichiers initiaux
Les fichiers JSON (users.json, draft.json, trades.json) doivent être copiés manuellement dans le volume la première fois. Vous avez 2 options:

**Option A: Via SSH (si disponible)**
```bash
# Se connecter au service
render ssh willie-pooler

# Copier les fichiers
cp /app/users.json /home/user/nhl/data/
cp /app/draft.json /home/user/nhl/data/
cp /app/trades.json /home/user/nhl/data/
```

**Option B: Créer un script d'initialisation**
Ajoutez ce code dans `server.js` juste avant `server.listen()`:

```javascript
// Initialize data files if they don't exist in the volume
const initializeDataFiles = () => {
    const files = [
        { source: './users.json', dest: USERS_FILE },
        { source: './draft.json', dest: DRAFT_FILE },
        { source: './trades.json', dest: TRADES_FILE }
    ];

    files.forEach(({ source, dest }) => {
        if (!fs.existsSync(dest) && fs.existsSync(source)) {
            fs.copyFileSync(source, dest);
            console.log(`✅ Initialized ${dest}`);
        }
    });
};

if (process.env.NODE_ENV === 'production') {
    initializeDataFiles();
}
```

### Coût

- **Web Service (Free tier)**: $0/mois
  - 750 heures/mois
  - 512 MB RAM
  - 0.5 CPU

- **Volume Persistant**: ~$0.25/mois
  - 1 GB de stockage
  - Vos données persistent entre redémarrages

**Total: ~$0.25/mois** 💰

### Redémarrages automatiques

Render peut redémarrer votre service:
- Après 15 minutes d'inactivité (plan gratuit)
- Lors des déploiements
- Lors de mises à jour système

**Avec le volume persistant, vos données restent intactes!** ✅

## 🔄 Mises à jour futures

Pour déployer de nouvelles versions:
1. Commit et push vos changements sur GitHub
2. Render déploie automatiquement (si auto-deploy activé)
3. OU cliquez sur **"Manual Deploy"** dans le dashboard Render

## 🐛 Debugging

Voir les logs:
1. Dans le dashboard Render
2. Allez dans **"Logs"**
3. Vous verrez tous les console.log() de votre application

## 🎉 C'est tout!

Votre application NHL fantasy pool sera en ligne et accessible 24/7!

---

## Migration PostgreSQL future (optionnel)

Si vous voulez migrer vers PostgreSQL plus tard pour éviter les frais du volume:

1. Créez une base PostgreSQL gratuite sur Render
2. Utilisez le script `migrate-to-postgres.js` pour migrer vos données
3. Terminez la migration du code dans `server.js`
4. Supprimez le volume persistant

Mais pour l'instant, le volume persistant est la solution la plus simple et rapide! 🚀
