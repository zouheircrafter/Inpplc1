# 🎫 Ticketing

Application web de gestion de tickets de support, en Node.js **sans aucune dépendance**.

## Démarrer

```bash
npm start            # http://localhost:3000
npm test             # tests de l'API
```

Variables d'environnement : `PORT` (défaut 3000), `DATA_FILE` (défaut `data/db.json`).

Comptes de démonstration créés au premier lancement :

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| admin | admin123 | Administrateur |
| agent | agent123 | Agent |
| user  | user123  | Utilisateur |

> Changez ou supprimez ces comptes avant toute mise en production.

## Fonctionnalités

- **Tickets** : titre, description, catégorie, priorité (basse → critique), statut
  (ouvert, en cours, en attente, résolu, fermé), assignation à un agent.
- **Commentaires** avec **notes internes** visibles seulement par les agents.
- **Historique** de chaque modification.
- **Recherche et filtres** (statut, priorité, catégorie, assigné) + tris.
- **Tableau de bord** : compteurs et répartition par statut / priorité.
- **Rôles** :
  - *Utilisateur* : crée ses tickets, ne voit que les siens, peut les modifier tant qu'ils
    sont ouverts, les fermer ou les rouvrir. Sa réponse relance un ticket « en attente ».
  - *Agent* : voit et traite tous les tickets, assigne, change le statut.
  - *Admin* : idem + gestion des utilisateurs et suppression de tickets.

## Structure

```
src/server.js   point d'entrée
src/app.js      API REST + serveur de fichiers statiques
src/store.js    stockage JSON et hachage des mots de passe (scrypt)
public/         interface web (HTML/CSS/JS)
test/           tests (node:test)
```

## API

Toutes les routes (sauf `/api/login` et `/api/meta`) attendent `Authorization: Bearer <token>`.

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/login` | `{username, password}` → `{token, user}` |
| POST | `/api/logout` | Ferme la session |
| GET | `/api/me` | Utilisateur courant |
| GET | `/api/stats` | Statistiques |
| GET | `/api/tickets` | Liste (`q`, `status`, `priority`, `category`, `assignee=me\|none\|<id>`, `sort`) |
| POST | `/api/tickets` | Créer un ticket |
| GET | `/api/tickets/:id` | Détail avec commentaires et historique |
| PATCH | `/api/tickets/:id` | Modifier (statut, priorité, assigné…) |
| DELETE | `/api/tickets/:id` | Supprimer (admin) |
| POST | `/api/tickets/:id/comments` | `{body, internal?}` |
| GET/POST | `/api/users` | Lister / créer (admin) |
| DELETE | `/api/users/:id` | Supprimer (admin) |

Les sessions sont gardées en mémoire : un redémarrage du serveur déconnecte tout le monde.
