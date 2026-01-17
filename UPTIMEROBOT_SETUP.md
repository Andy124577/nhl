# Guide UptimeRobot - Garder votre app toujours active 🔔

## Pourquoi UptimeRobot?

Sur le plan gratuit de Render.com, votre service web **dort après 15 minutes d'inactivité**. Le réveil prend ~30 secondes, ce qui peut frustrer les utilisateurs.

**UptimeRobot** ping votre app toutes les 5 minutes, la gardant **toujours active** et **instantanée**!

**Coût: 100% GRATUIT** ✅

---

## 🚀 Configuration en 5 minutes

### Étape 1: Créer un compte UptimeRobot

1. Allez sur **https://uptimerobot.com**
2. Cliquez sur **"Sign Up"**
3. Créez un compte gratuit (email + mot de passe)
4. Confirmez votre email

### Étape 2: Ajouter votre moniteur

1. Connectez-vous au dashboard UptimeRobot
2. Cliquez sur **"+ Add New Monitor"**

### Étape 3: Configurer le moniteur

Remplissez le formulaire:

**Monitor Type:**
- Sélectionnez **"HTTP(s)"**

**Friendly Name:**
- Entrez: `Willie Pooler NHL`

**URL (or IP):**
- Entrez: `https://fantazy.ca`
  - (Remplacez par votre URL Render réelle)

**Monitoring Interval:**
- Sélectionnez **"Every 5 minutes"** (le minimum gratuit)

**Monitor Timeout:**
- Laissez **30 seconds** (par défaut)

**Alert Contacts:**
- Ajoutez votre email si vous voulez être notifié en cas de problème
- (Optionnel mais recommandé)

Cliquez sur **"Create Monitor"** ✅

---

## ✅ Résultat

UptimeRobot va maintenant:
- ✅ Ping votre app toutes les 5 minutes
- ✅ Empêcher le service de dormir
- ✅ Vérifier que votre app fonctionne
- ✅ Vous alerter si elle tombe (optionnel)

Votre app sera **toujours instantanée** pour vos utilisateurs! 🚀

---

## 📊 Vérifier que ça fonctionne

Dans le dashboard UptimeRobot, vous verrez:
- **Status**: Should show **"Up"** with a green checkmark
- **Uptime**: Percentage (devrait être ~99.9%)
- **Response Time**: Temps de réponse moyen
- **Last Checked**: Devrait se mettre à jour toutes les 5 minutes

---

## 🔧 Configuration avancée (optionnel)

### Alertes par email

1. Dashboard → **"My Settings"** → **"Alert Contacts"**
2. Ajoutez votre email
3. Dans votre moniteur, activez les alertes

Vous serez notifié si:
- ❌ Votre app tombe
- ❌ Votre app est lente (>30s)
- ✅ Votre app se rétablit

### Moniteurs multiples (gratuit)

Le plan gratuit permet **50 moniteurs**! Vous pouvez ajouter:
- Moniteur principal: `https://fantazy.ca`
- Moniteur API: `https://fantazy.ca/draft`
- Moniteur santé: Un endpoint `/health` personnalisé

### Endpoint de santé personnalisé

Ajoutez dans votre `server.js`:

```javascript
// Health check endpoint pour UptimeRobot
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
```

Puis configurez UptimeRobot pour ping: `https://fantazy.ca/health`

---

## 💡 Bonnes pratiques

### 1. Nom descriptif
Utilisez un nom clair pour votre moniteur:
- ✅ "Willie Pooler NHL - Production"
- ❌ "Monitor 1"

### 2. Intervalle optimal
- **5 minutes** = Parfait pour le plan gratuit
- Plus court = Inutile et gaspille les requêtes
- Plus long = Risque de sommeil

### 3. Plusieurs points de vérification
Si vous avez plusieurs services:
- App principale
- Base de données
- API tierces

Ajoutez un moniteur pour chacun!

### 4. Alertes intelligentes
Configurez les alertes pour:
- ✅ Down pendant 5 minutes (évite les fausses alertes)
- ✅ Temps de réponse > 10 secondes
- ❌ Ne pas alerter pour chaque microbe

---

## 📱 Application mobile

UptimeRobot a une app mobile (iOS/Android):
- Voir le status de vos apps
- Recevoir des notifications push
- Gérer vos moniteurs

**Télécharger:**
- iOS: https://apps.apple.com/app/uptimerobot/id1104878581
- Android: https://play.google.com/store/apps/details?id=com.uptimerobot

---

## 🆓 Limites du plan gratuit

Le plan gratuit de UptimeRobot offre:
- ✅ **50 moniteurs** (largement suffisant!)
- ✅ **Vérifications toutes les 5 minutes**
- ✅ **Alertes illimitées** par email
- ✅ **Historique de 60 jours**
- ✅ **Public status pages** (optionnel)
- ✅ **SSL monitoring**

**Plus que suffisant pour votre pool NHL!** 🏒

Si besoin de plus:
- Plan Pro: $7/mois
  - Vérifications toutes les 1 minute
  - Alertes SMS
  - Historique illimité

Mais le plan gratuit est parfait pour vous! ✅

---

## 🔍 Alternatives à UptimeRobot

Si vous cherchez d'autres options:

### Cron-job.org
- Gratuit
- Ping toutes les 5 minutes
- Plus simple mais moins de fonctionnalités
- https://cron-job.org

### Freshping
- Gratuit
- 50 moniteurs
- Interface moderne
- https://freshping.io

### BetterUptime
- Gratuit pour 1 moniteur
- Très joli dashboard
- https://betteruptime.com

**Mais UptimeRobot reste le meilleur choix!** 👍

---

## ❓ FAQ

**Q: C'est vraiment gratuit pour toujours?**
A: Oui! UptimeRobot offre le plan gratuit depuis 2010.

**Q: Ça consomme beaucoup de bande passante?**
A: Non, c'est juste une requête HTTP simple toutes les 5 minutes.

**Q: Mon app va vraiment rester éveillée?**
A: Oui! Render reset le timer d'inactivité à chaque requête.

**Q: Et si UptimeRobot tombe?**
A: Peu probable, mais votre app dormira après 15 min. Pas critique.

**Q: Dois-je configurer quelque chose sur Render?**
A: Non, rien! UptimeRobot ping simplement votre URL publique.

**Q: Ça marche aussi pour la base de données?**
A: La base de données PostgreSQL gratuite de Render ne dort pas, seulement le service web.

---

## 🎉 Vous êtes prêt!

Votre configuration devrait ressembler à:

```
Monitor Name: Willie Pooler NHL
Type: HTTP(s)
URL: https://fantazy.ca
Interval: Every 5 minutes
Timeout: 30 seconds
Status: Up ✅
```

Votre app est maintenant **toujours active et instantanée** pour vos utilisateurs! 🚀

---

## 📞 Support

- **UptimeRobot Help**: https://blog.uptimerobot.com/
- **Render Status**: https://status.render.com/
- **Community Forum**: https://community.render.com/

Bon monitoring! 📊
