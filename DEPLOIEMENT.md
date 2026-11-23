# Mettre « Régate au large » en ligne pour jouer avec tes potes

Ce guide t'explique, pas à pas, comment héberger **gratuitement** ton jeu et son serveur multijoueur.
À la fin, tu auras une adresse du genre `https://regate-au-large-xxxx.onrender.com` à envoyer à tes potes.

Compte environ **20 minutes** la première fois. Tu n'as besoin d'aucune carte bancaire.

> Pourquoi pas le lien claude.ai ? La page claude.ai ne peut pas se connecter à un serveur extérieur.
> Le jeu solo y marche, mais le jeu en ligne a besoin de **ton** serveur.

---

## Ce qu'il te faut

1. Un compte **GitHub** (gratuit) : c'est là que le code est rangé.
2. Un compte **Render** (gratuit) : c'est lui qui fait tourner le jeu sur Internet.

---

## Étape 1 — Mettre le code sur GitHub

1. Va sur <https://github.com> et crée un compte (bouton **Sign up**).
2. Une fois connecté, clique sur **+** en haut à droite, puis **New repository**.
3. Donne-lui un nom, par exemple `regate`. Tu peux le laisser **Private** (privé).
4. Ne coche rien d'autre, clique sur **Create repository**.
5. Le plus simple : **donne le nom du dépôt à Claude** (par exemple `ton-pseudo/regate`), il y envoie tout le code.

   Si tu préfères le faire toi-même depuis le dossier du jeu, dans un terminal :

   ```bash
   git remote add origin https://github.com/TON-PSEUDO/regate.git
   git push -u origin main
   ```

---

## Étape 2 — Créer le service sur Render

1. Va sur <https://render.com> et clique sur **Get Started**. Choisis **GitHub** pour te connecter : c'est plus simple.
2. Render te demande l'accès à tes dépôts GitHub : autorise au moins le dépôt `regate`.
3. Dans le tableau de bord Render, clique sur **New +**, puis **Blueprint**.
4. Choisis ton dépôt `regate`. Render lit le fichier `render.yaml` qui est déjà dans le code : tout est préréglé
   (offre **Free**, commande de construction, commande de démarrage).
5. Clique sur **Apply** (ou **Deploy Blueprint**).
6. Attends 3 à 5 minutes : Render installe et construit le jeu. Tu peux suivre l'avancement dans **Logs**.
   Quand tu vois `Régate au large : serveur prêt`, c'est bon.
7. En haut de la page du service, Render affiche ton adresse : `https://regate-au-large-xxxx.onrender.com`.

<details>
<summary>Si le bouton Blueprint n'apparaît pas : création à la main</summary>

1. **New +** → **Web Service** → choisis ton dépôt.
2. Remplis :
   - **Runtime** : `Node`
   - **Build Command** : `npm ci && npm run build`
   - **Start Command** : `npm start`
   - **Instance Type** : `Free`
3. Dans **Environment**, ajoute la variable `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` avec la valeur `1`.
4. Clique sur **Create Web Service**.
</details>

---

## Étape 3 — Jouer avec tes potes

1. Ouvre ton adresse Render dans le navigateur.
2. Clique sur l'onglet **Avec mes potes**, tape ton pseudo, puis **Créer un salon privé**.
3. Clique sur **Copier le lien** et envoie-le à tes potes (SMS, WhatsApp, Discord…).
   Ils peuvent aussi taper le **code à 4 lettres** dans « Code d'un salon ».
4. Toi seul (l'hôte) choisis le plan d'eau, le parcours, la météo, le ciel et le rythme.
   Chacun choisit sa propre assistance.
5. Quand tout le monde est là, clique sur **Lancer la course**. Le départ est donné une minute de jeu plus tard,
   pour tout le monde en même temps.

Jusqu'à **8 joueurs** par salon. **Partie rapide** te met dans un salon public avec des inconnus.

---

## Bon à savoir

- **Premier lancement lent** : en offre gratuite, Render met le serveur en veille après 15 minutes sans joueur.
  La première connexion le réveille en 30 à 60 secondes : patiente un peu, puis recharge la page.
- **Mises à jour automatiques** : chaque fois que du nouveau code arrive sur GitHub, Render reconstruit le jeu tout seul.
- **C'est gratuit** : l'offre Free de Render suffit largement pour jouer entre amis.
- **Le chrono officiel** est celui du serveur : personne ne peut tricher sur son temps.

---

## Jouer en réseau local, sans Internet (même Wi-Fi)

Sur l'ordinateur qui sert d'hôte, dans le dossier du jeu :

```bash
npm install
npm run build
npm start
```

Puis :
- toi, tu ouvres <http://localhost:8080> ;
- tes potes sur le même Wi-Fi ouvrent `http://ADRESSE-IP-DE-TON-PC:8080`
  (l'adresse IP se trouve dans les réglages Wi-Fi de ton ordinateur, par exemple `192.168.1.23`).

---

## En cas de problème

| Problème | Solution |
|---|---|
| « Impossible de joindre le serveur » | Tu es sur la page claude.ai : ouvre plutôt ton adresse Render. Sinon, le serveur se réveille : attends une minute et recharge. |
| La construction échoue sur Render | Ouvre **Logs**, copie le message d'erreur et donne-le à Claude. |
| « Aucun salon avec ce code » | Vérifie les 4 lettres. Un salon disparaît quand tout le monde est parti. |
| « Une course est en cours dans ce salon » | Attends l'arrivée, puis rejoins : tu pourras faire la course suivante. |
