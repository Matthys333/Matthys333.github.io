const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const CARDS_FILE = path.join(__dirname, 'data', 'cards.json');

app.use(express.json());
app.use(express.static('public'));
// Permet d'accéder aux images situées dans le dossier Image_TCG à la racine
app.use('/Image_TCG', express.static(path.join(__dirname, 'Image_TCG')));

// Utilitaire pour lire les utilisateurs du fichier JSON
function getUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data || '[]');
}

// Utilitaire pour sauvegarder les utilisateurs
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// 1. Route d'Inscription
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Veuillez remplir tous les champs.' });
    }

    const users = getUsers();
    const userExists = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (userExists) {
        return res.status(400).json({ message: 'Cet identifiant existe déjà !' });
    }

    users.push({
        username,
        password,
        collection: {}, // Initialisation du dictionnaire de collection vide
        created_at: new Date().toISOString()
    });

    saveUsers(users);
    res.json({ message: 'Compte créé avec succès ! Connectez-vous.' });
});

// 2. Route de Connexion
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
    }

    res.json({ message: 'Connexion réussie', username: user.username });
});

// 3. Route pour récupérer toutes les cartes du jeu (Codex)
app.get('/api/cards', (req, res) => {
    if (!fs.existsSync(CARDS_FILE)) {
        return res.json([]);
    }
    const data = fs.readFileSync(CARDS_FILE, 'utf-8');
    res.json(JSON.parse(data || '[]'));
});

// 4. Route pour ouvrir un booster et stocker les IDs/quantités dans le dictionnaire utilisateur
app.post('/api/open-stored-booster', (req, res) => {
    const { username } = req.body;
    if (!fs.existsSync(CARDS_FILE)) {
        return res.status(404).json({ error: "Aucune carte disponible." });
    }

    const cardsData = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
    if (cardsData.length === 0) {
        return res.status(400).json({ error: "Le deck de cartes est vide." });
    }

    // Fonction de tirage par rareté latine
    function pullCardByRarity() {
        const rand = Math.random() * 100;
        let targetRarity = 'Vulgaris';

        if (rand < 0.2) targetRarity = 'Arcanus';          // 0.2%
        else if (rand < 1.0) targetRarity = 'Mythicus';      // 0.8%
        else if (rand < 4.0) targetRarity = 'Legendarius';   // 3%
        else if (rand < 11.0) targetRarity = 'Eximius';      // 7%
        else if (rand < 25.0) targetRarity = 'Rarus';        // 14%
        else if (rand < 50.0) targetRarity = 'Insolitus';    // 25%
        else targetRarity = 'Vulgaris';                      // 50%

        let filteredCards = cardsData.filter(c => c.rarete && c.rarete.toLowerCase() === targetRarity.toLowerCase());

        if (filteredCards.length === 0) {
            filteredCards = cardsData;
        }

        return filteredCards[Math.floor(Math.random() * filteredCards.length)];
    }

    // Tirer 5 cartes pour le booster
    const pulledCards = [];
    for (let i = 0; i < 5; i++) {
        pulledCards.push(pullCardByRarity());
    }

    // Enregistrement / Stacking inter-serveur dans le dictionnaire utilisateur
    if (username) {
        const users = getUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (user) {
            // Si la collection n'existe pas ou était un ancien tableau, on initialise un objet
            if (!user.collection || Array.isArray(user.collection)) {
                user.collection = {};
            }
            
            pulledCards.forEach(card => {
                const cardId = card.id || card.nom;
                if (!user.collection[cardId]) {
                    user.collection[cardId] = 0;
                }
                user.collection[cardId] += 1;
            });

            saveUsers(users);
        }
    }

    res.json({
        success: true,
        cards: pulledCards
    });
});

// 5. Route pour récupérer l'inventaire d'un joueur sous forme d'objet { cardId: count }
app.get('/api/collection/:username', (req, res) => {
    const { username } = req.params;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    // Si l'utilisateur a encore un ancien format tableau dans users.json, on le convertit à la volée pour éviter les bugs
    if (Array.isArray(user.collection)) {
        const converted = {};
        user.collection.forEach(card => {
            const id = card.id || card.nom;
            converted[id] = (converted[id] || 0) + 1;
        });
        user.collection = converted;
        saveUsers(users);
    }

    res.json(user.collection || {});
});

app.listen(PORT, () => {
    console.log(`Serveur TCG démarré sur http://localhost:${PORT}`);
});