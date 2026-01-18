# Créer des utilisateurs de test

Pour tester la fonctionnalité de changement d'utilisateur en tant qu'admin, vous pouvez créer des utilisateurs de test.

## Méthode 1: Via la console du navigateur

1. Ouvrez votre site: `https://fantazy.ca`
2. Ouvrez la console du navigateur (F12 → Console)
3. Collez et exécutez ce code:

```javascript
fetch('https://fantazy.ca/create-test-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken: 'admin' })
})
.then(res => res.json())
.then(data => {
    console.log('✅ Résultat:', data);
    alert(`✅ ${data.message}\nCréés: ${data.created.join(', ')}\nDéjà existants: ${data.skipped.join(', ')}\n\n${data.info}`);
});
```

## Méthode 2: Via curl (depuis votre terminal)

```bash
curl -X POST https://fantazy.ca/create-test-users \
  -H "Content-Type: application/json" \
  -d '{"adminToken":"admin"}'
```

## Utilisateurs créés

Les utilisateurs suivants seront créés:

| Nom d'utilisateur | Mot de passe |
|-------------------|--------------|
| alex              | test123      |
| marie             | test123      |
| jean              | test123      |
| sophie            | test123      |
| thomas            | test123      |
| emma              | test123      |

## Utilisation

Une fois les utilisateurs créés:

1. Connectez-vous avec le compte **admin**
2. Allez sur n'importe quelle page
3. Cliquez sur l'avatar de l'admin (en haut à droite)
4. Vous verrez la liste des utilisateurs
5. Cliquez sur un utilisateur pour basculer vers son compte

**Note:** Le compte admin garde ses privilèges même quand il bascule vers un autre utilisateur, permettant de tester l'application du point de vue de différents utilisateurs.
