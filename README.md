# Régate au large

Simulateur de régate dans le navigateur (Vite + TypeScript + Three.js).

## Lancer le jeu

```bash
npm install
npm run dev
```

Puis ouvre l'adresse affichée (en général http://localhost:5173).

## Commandes

- ← → (ou Q / D) : barrer
- ↑ ↓ (ou Z / S) : border / choquer la voile
- Espace : envoyer / affaler le spi
- V : changer de vue (cockpit, poursuite, ciel) ; cliquer-glisser pour regarder autour
- M : couper le son ; R : recommencer

## Tests

```bash
npm test                 # tests unitaires (Vitest)
npm run build            # vérification des types + build de production
npx playwright install chromium   # une seule fois
npm run e2e              # partie automatique dans un navigateur sans écran, captures dans captures/
```

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/physics/` | vent, polaire, bateau, houle : code pur, sans rendu, testable |
| `src/game/` | régate : parcours, chrono, classement, boucle à pas fixe |
| `src/ai/` | adversaires |
| `src/render/` | 3D (Three.js) et 2D (vue du ciel, instruments) |
| `src/ui/` | tableau de bord |
| `src/audio/` | sons |
| `src/net/` | multijoueur (étape 5) |
| `prototype/` | le prototype d'origine en un seul fichier |

La simulation tourne à pas fixe (60 Hz), séparée du rendu, qui interpole entre deux pas.
Elle est déterministe à graine égale.
