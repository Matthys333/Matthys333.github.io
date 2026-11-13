const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

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

    // Ajout de l'utilisateur avec son mot de passe en clair
    users.push({
        username,
        password,
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

    // Vérification directe en clair
    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
    }

    res.json({ message: 'Connexion réussie', username: user.username });
});

app.listen(PORT, () => {
    console.log(`Serveur TCG démarré sur http://localhost:${PORT}`);
});

const CARDS_FILE = path.join(__dirname, 'data', 'cards.json');

// Route pour récupérer toutes les cartes
app.get('/api/cards', (req, res) => {
    if (!fs.existsSync(CARDS_FILE)) {
        return res.json([]);
    }
    const data = fs.readFileSync(CARDS_FILE, 'utf-8');
    res.json(JSON.parse(data || '[]'));
});

app.post('/api/open-stored-booster', (req, res) => {
    const cardsPath = path.join(__dirname, 'data', 'cards.json');
    if (!fs.existsSync(cardsPath)) {
        return res.status(404).json({ error: "Aucune carte disponible." });
    }

    const cardsData = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
    if (cardsData.length === 0) {
        return res.status(400).json({ error: "Le deck de cartes est vide." });
    }

    // Fonction pour tirer une carte selon les probabilités de rareté latines
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

        // Filtrer les cartes correspondant à cette rareté (insensible à la casse)
        let filteredCards = cardsData.filter(c => c.rarete && c.rarete.toLowerCase() === targetRarity.toLowerCase());

        // Fallback de sécurité si aucune carte de cette rareté n'existe dans cards.json
        if (filteredCards.length === 0) {
            filteredCards = cardsData;
        }

        // Tirer une carte aléatoire parmi les cartes filtrées
        return filteredCards[Math.floor(Math.random() * filteredCards.length)];
    }

    // Tirer 5 cartes pour le booster
    const pulledCards = [];
    for (let i = 0; i < 5; i++) {
        pulledCards.push(pullCardByRarity());
    }

    res.json({
        success: true,
        cards: pulledCards
    });
});