# Ce projet est un TCG sous forme de site
    Il contiendra :
        - Une partie dans laquelle l'utilisateur pourra se connecter à son compte
        - Des cartes à tirer avec le temps
        - Des boosters de 5 cartes
        - Un marché pour trade entre les utilisateurs
        - Un système d'évolutions des cartes en fonction de ses réussites (on verra les critères après)
        - Une vitrine que les utilisateurs pourront se servir pour exhiber leurs meilleures cartes

# Ce qui a été ajouté jusqu'à lors :
    - La page de connexion (inscription + login)
    - La page d'accueil
        - L'affichage des boosters avec le timer qui diminue (6 boosters max, 5 cartes / booster)
        - Les boutons menant à :
            - La boutique
            - La collection
            - Les échanges
            - Le marché
            - Le classement
            - L'ouverture des boosters (1 par 1 ou tout d'un coup)
    - La boutique (achat de packs)
    - La collection de chaque joueur
    - Les échanges entre joueurs (créer, accepter, annuler)
    - Le marché (mise en vente, achat, enchères)
    - Le classement
    - Le système de RAM
        - Récompense quotidienne
        - Recyclage des cartes
        - Quiz avec récompenses
    - Les raretés, tirées selon des taux de drop dans les boosters :
        - Vulgaris (85 %)
        - Insolitus (11,5 %)
        - Rarus (2,5 %)
        - Eximius (0,6 %)
        - Legendarius (0,31 %)
        - Mythicus (0,08 %)
        - Arcanus (0,01 %)
    - Une pénalité de drop après le quiz RAM, pendant 15 minutes :
        - Mauvaise réponse (-10 %) : plus aucune carte Rarus ou plus rare dans les boosters ouverts
        - Triche, sortie d'onglet (-30 %) : uniquement des cartes Vulgaris

# Version statique (GitHub Pages)
    Le site n'a plus besoin de serveur Node/Express : tout tourne dans le navigateur.
    - js/api.js remplace server.js : il intercepte les appels fetch('/api/...') et exécute la même logique
      (boosters, boutique, marché, échanges, quiz, classement...) en local.
    - Les comptes, collections, marché et échanges sont stockés dans le localStorage du navigateur.
    - Les mots de passe sont hachés (SHA-256) avant d'être stockés.
    - Les cartes viennent de data/cards.json et les images de Image_TCG/cards/.
    - Sauvegarde / restauration (console du navigateur) :
        TCG.exportSave()     -> télécharge tcg-sauvegarde.json
        TCG.importSave(file) -> restaure une sauvegarde
        TCG.reset()          -> efface toutes les données locales
    - Limite : les données sont propres à chaque navigateur. Le marché, les échanges et le classement
      ne regroupent donc que les comptes créés sur le même navigateur.

# Comment lancer le projet :
    - En ligne : https://matthys333.github.io (GitHub Pages, branche main, dossier / racine)
    - En local : servir le dossier avec n'importe quel serveur statique, par exemple
        python3 -m http.server 3000
      puis aller sur http://localhost:3000
      (ne pas ouvrir les fichiers en double-clic : les fetch vers data/cards.json exigent http)
    - (Optionnel) Ajouter des cartes automatiquement, avec Node installé :
        node watcher.js
        - Il surveille le dossier Image_TCG/cards
        - Chaque nouvelle image ajoutée devient automatiquement une carte dans data/cards.json
          avec une rareté et des stats tirées au hasard (taux différents de ceux des boosters)
        - Puis commit + push : le site se met à jour tout seul

# Comment est organisé le projet :
    - index.html, login.html, shop.html, ... : les pages du site, css/ : leurs styles
    - js/api.js : l'API émulée dans le navigateur (remplace server.js)
    - data/cards.json : la liste des cartes
    - Image_TCG/cards/ : les images des cartes
    - watcher.js : l'ajout automatique des nouvelles cartes (outil local, facultatif)
    - Cartes_description.txt : ce qui définit une carte
        - Une rareté (qui évoluera par la suite)
        - Un rang d'apparition
        - Le nom de la personne
        - Une image
        - Une valeur de base

# Ce qu'il faut implémenter :
    - La vitrine pour exhiber ses meilleures cartes
    - Le système d'évolution des cartes

# Propostition de Jorlui :
    - Quand une carte est révélée, un son particulier en ressort

# Proposition de Philéas :
    - Ajouter un effet ou une petite animation en fonction de la rareté de la carte