# Mission : « Régate au large », simulateur de régate réaliste

Tu vas transformer le prototype `regate.html` (dans ce dossier) en un vrai jeu de voile réaliste, jouable dans le navigateur, en solo et en ligne avec des amis.
Lis d'abord `regate.html` en entier : il contient déjà la physique (polaires, vent apparent, gîte, rappel, dessalage, dérive, surf, bascules, risées), la 3D Three.js (houle Gerstner, écume, coque profilée, foc, spi, barreur, penons), l'IA adverse, le départ avec compte à rebours et un multijoueur basé sur une API propre à claude.ai (`window.claude.use("room")`), qui **ne fonctionnera pas hors de claude.ai** et doit être remplacée.

Toute l'interface et les textes du jeu sont **en français**.

---

## 1. Règles de travail

- Avance **par étapes** (section 6). À la fin de chaque étape : le jeu se lance, les tests passent, et tu me montres un résumé + comment tester.
- Avant de coder une étape, propose-moi un plan court et attends mon accord si un choix est irréversible (techno serveur, hébergement).
- Commits git fréquents, messages clairs en français.
- Pas de dépendance lourde sans raison. Explique chaque nouvelle dépendance en une ligne.
- Le jeu doit rester fluide : **60 i/s sur un PC portable récent, 30 i/s minimum sur un téléphone milieu de gamme**. Prévois un réglage de qualité graphique (bas / moyen / élevé).

## 2. Architecture

- **Vite + TypeScript + Three.js** (dernière version stable).
- Découpage en modules :
  - `physics/` : vent, polaires, bateau, vagues. Code pur, sans rendu, testable.
  - `ai/` : les adversaires.
  - `render/` : la 3D (mer, ciel, bateaux, effets).
  - `ui/` : menus, instruments, panneau de réglage.
  - `net/` : client multijoueur.
  - `audio/` : sons.
- **Boucle de simulation à pas fixe** (60 Hz), séparée du rendu, avec interpolation.
- La simulation doit être **déterministe** à graine égale (vent, risées, vagues), pour les replays et le multijoueur.
- **Serveur multijoueur** dans `server/` : Node.js + WebSocket (ou Colyseus si tu le justifies).
  - Le serveur fait autorité sur le chrono, le départ et le classement.
  - Il y a des salons publics et des salons privés avec code.
  - Le serveur se déploie gratuitement (Render, Fly.io ou Railway). Écris un `DEPLOIEMENT.md` pas à pas pour un débutant.

## 3. Réalisme de la navigation (priorité n° 1)

- **Classes de bateaux**, chacune avec ses vraies polaires (tables vitesse/angle/force de vent, interpolées), sa masse, sa surface de voile et son moment de redressement :
  - Optimist, ILCA 7 (Laser), 470, 49er, catamaran Nacra 17.
- **Modèle de forces simplifié mais physique** :
  - portance et traînée de la voile selon l'angle d'incidence, ce qui détermine le bon réglage ;
  - moment de gîte contre moment de redressement (rappel, trapèze sur le 49er et le Nacra) ;
  - dérive selon la vitesse et l'angle ;
  - inertie réelle dans les virements et empannages.
- **Réglages fins** que le joueur peut toucher :
  - écoute de grand-voile, écoute de foc, hale-bas, cunningham, position du barreur (avant/arrière), dérive haute ou basse ;
  - chaque réglage a un effet visible sur la forme de la voile et un effet mesurable sur la vitesse.
- **Planing** : au-delà d'un seuil, le bateau déjauge. Gros gain de vitesse, sillage différent, son différent.
- **Vagues** :
  - surf au portant ;
  - bateau qui tape au près ;
  - houle dont la hauteur et la direction suivent la météo.
- **Champ de vent réaliste** :
  - risées et molles qui se déplacent avec le vent ;
  - bascules oscillantes et persistantes ;
  - effet de côte près des îles ;
  - **dévent** : un bateau fait de l'ombre au vent derrière lui et sous lui, comme en vrai.
- **Courant** : zones de courant visibles (marques sur l'eau, bouées qui penchent) qui modifient la route fond.
- **Règles de course (RRS simplifiées)** :
  - tribord amures prioritaire, bateau sous le vent prioritaire, zone des 3 longueurs aux bouées ;
  - détection des contacts, pénalité d'un tour (360°) à effectuer ;
  - pavillons et signaux sonores de départ réglementaires : 5 min, 4 min, 1 min, départ, rappel individuel.

## 4. Visuels et sons

- **Mer** :
  - océan par FFT, ou somme de Gerstner de meilleure qualité, avec mousse persistante dans le sillage ;
  - réflexion et réfraction, couleur selon la profondeur près des îles ;
  - embruns qui mouillent la caméra en vue cockpit.
- **Voiles** : simulation de tissu légère (ou déformation procédurale convaincante), avec faseyement réaliste, plis, lattes et penons animés par l'écoulement.
- **Lumière** :
  - ombres dynamiques et matériaux PBR ;
  - cycle jour/soleil couchant, ciel avec nuages volumétriques simples.
- **Météo** : beau temps, ciel couvert, pluie fine, brume.
- **Personnage** : barreur animé (rappel, passage d'un bord à l'autre au virement, mains sur la barre et l'écoute).
- **Caméras** : cockpit (regard libre), poursuite, TV (plans automatiques comme une retransmission), drone, vue tactique 2D.
- **Son spatialisé** :
  - vent selon le vent apparent, eau selon la vitesse, claquement de voile, bôme au virement ;
  - poulies qui cliquettent quand on borde, sifflet et corne du comité.

## 5. Contenu et expérience de jeu

- **Tutoriel interactif** en 6 courtes leçons : les allures, le réglage avec les penons, le virement, l'empannage, le départ, les priorités.
- **Panneau de réglage** à garder et améliorer : il fait gagner beaucoup de lisibilité.
- **Modes de jeu** : course rapide, championnat (plusieurs manches avec points), contre-la-montre avec **fantôme** de ton meilleur temps, entraînement libre.
- **Plans d'eau** : baie avec îles, lac, côte avec courant de marée. Plusieurs parcours : banane, triangle, côtier.
- **Replays** : revoir la course sous tous les angles, avec export de la trace.
- **IA** :
  - plusieurs niveaux ;
  - stratégie : jouer les bascules, chercher les risées, respecter les priorités, se placer au départ.
- **Commandes** : clavier, manette (Gamepad API), tactile avec gros boutons et curseur d'écoute glissable.
- **Sauvegarde** des réglages, records et progression (localStorage).

## 6. Étapes (dans cet ordre)

1. **Migration** : le projet Vite/TS reproduit exactement le prototype actuel, en solo.
2. **Physique** : nouveau moteur avec classes de bateaux, polaires, forces, réglages fins et planing. Écris des tests unitaires : la vitesse au près doit être cohérente avec les polaires, un virement doit faire perdre de la vitesse, etc.
3. **Vent et mer** : champ de vent avec dévent et courant, nouvelle mer, réglages de qualité.
4. **Règles et départ réglementaire**, pénalités, IA qui respecte les priorités.
5. **Multijoueur** : serveur, salons, synchronisation avec prédiction et réconciliation, `DEPLOIEMENT.md`.
6. **Visuels avancés** : voiles en tissu, barreur animé, lumière, météo, caméras TV et drone.
7. **Contenu** : tutoriel, championnat, fantôme, replays, plans d'eau.
8. **Finitions** : sons, manette, tactile, performances mobile, accessibilité (contrastes, taille du texte).

## 7. Vérification

- Tests unitaires de la physique (Vitest).
- Un script de test qui lance le jeu dans un navigateur sans écran (Playwright), joue 2 minutes avec l'IA et prend des captures de chaque caméra. Regarde ces captures toi-même pour repérer les bugs visuels.
- Un test multijoueur avec 2 à 4 clients simulés en local.
- À la fin, un `README.md` en français : comment lancer le jeu, jouer, déployer.
