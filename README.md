# Régate au large

Simulateur de course au large dans le navigateur (Vite + TypeScript + Three.js) : tu es skipper d'un **IMOCA 60 à foils**, en solitaire.

## Lancer le jeu

```bash
npm install
npm run dev
```

Puis ouvre l'adresse affichée (en général http://localhost:5173).

## Jouer en ligne avec tes potes

Le jeu en ligne a besoin du serveur (dossier `server/`). En local :

```bash
npm run build
npm start
```

Puis ouvre <http://localhost:8080>, onglet **Avec mes potes** : crée un salon et envoie le code ou le lien.
Pour le mettre sur Internet gratuitement, suis **[DEPLOIEMENT.md](DEPLOIEMENT.md)**.

En développement (`npm run dev`), lance aussi `npm run serveur` dans un autre terminal : Vite relaie le jeu en ligne vers lui.

## Plans d'eau

- **Baie des Îles** : grand plan d'eau ouvert, six parcours de 1 à 40 milles.
- **Île aux Corsaires** : le tour complet d'une grande île, ou un triangle sous ses falaises.
- **Archipel des Fous** : slalom entre une dizaine d'îlots.
- **Lac des Cimes** : lac de montagne, eau plate, vent qui tourne sans arrêt.

Météo au choix, dont **Variable** (le vent forcit et mollit, des grains passent avec rafales et pluie), et ciel au choix :
soleil, nuageux, pluie, brume, coucher de soleil.

## Parcours de la Baie des Îles

| Parcours | Longueur | Durée (IMOCA, 14 nds) |
|---|---|---|
| Banane courte | 2 milles | ~20 min |
| Triangle | 4,7 milles | ~30 min |
| Banane deux tours | 5,2 milles | ~35 min |
| Tour des îles (côtier) | 15 milles | ~1 h 45 |
| Raid du Rocher du Nord (grand large) | 40 milles | ~4 h 45 |

Sur les longs parcours, accélère le temps avec **T** (jusqu'à ×50) ; il revient tout seul à ×1 près des bouées.

## Commandes

| Touche | Action |
|---|---|
| ← → (ou Q D) | barrer ; pilote engagé : décaler la consigne de 1° (Maj : 10°) |
| ↑ ↓ (ou Z S) | border / choquer la grand-voile |
| Maj + ↑ ↓ | border / choquer la voile d'avant |
| W / X | chariot de grand-voile au vent / sous le vent |
| 1 à 5 | envoyer J1, J2, J3, Code 0, gennaker (45 à 75 s de manœuvre) |
| P / O | prendre / larguer un ris |
| K | basculer la quille au vent (ou la remettre au centre) |
| F | sortir le foil sous le vent / rentrer les foils |
| B | ballast : remplir au vent, transférer après un virement, vider |
| A | engager / débrayer le pilote ; Maj + A : mode cap compas ou angle au vent |
| Espace | virement ou empannage au pilote |
| T / Maj + T | accélérer / ralentir le temps |
| C | vue cockpit, poursuite, carte tactique (avec laylines) |
| + / − ou molette | zoom de la carte |
| M | son ; H : aide ; Échap : pause et menu |

L'**assistance** se règle dans le menu : *Débutant* (tout est automatique sauf la barre), *Équipier* (tu règles les écoutes et choisis voiles et ris), *Skipper* (tout à la main).

## Tests

```bash
npm test                 # tests unitaires (Vitest) : physique, polaires, parcours, IA, serveur multijoueur
npm run build            # vérification des types + build de production
npx playwright install chromium   # une seule fois
npm run e2e              # partie automatique dans un navigateur sans écran, captures dans captures/
```

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/physics/` | vent, polaires, classes de bateaux, modèle de forces, dynamique, îles : code pur, testable |
| `src/game/` | régate : parcours, passages de bouées, chrono, classement, assistances |
| `src/ai/` | adversaires |
| `src/render/` | 3D (Three.js) et 2D (carte tactique, instruments) |
| `src/ui/` | tableau de bord |
| `src/audio/` | sons |
| `src/net/` | client multijoueur (WebSocket, horloge synchronisée) |
| `server/` | serveur multijoueur Node.js : salons, départ, chrono et classement officiels ; sert aussi le jeu |
| `prototype/` | le prototype d'origine en un seul fichier |

### Le modèle physique en bref

- **Voiles** : portance et traînée selon l'incidence. Un mauvais réglage décroche ou faseye ; chaque voile d'avant a sa plage d'angles.
- **Gîte** : moment de gîte contre moment de redressement (forme, quille pendulaire, ballasts, foil) ; au-delà, départ au lof ou chavirage.
- **Dérive et carène** : traînée induite de la dérive, frottement, vague de carène, déjaugeage, allègement par le foil, ventilation à très haute vitesse.
- **Calage** : un coefficient η(vent, angle) fait coïncider la vitesse d'équilibre avec la polaire de l'IMOCA quand tout est bien réglé (tests à ±3 %).
- **Mer** : surf dans la houle au portant, mer qui tape au près.

La simulation tourne à pas fixe (60 Hz), séparée du rendu qui interpole, et elle est déterministe à graine égale.
