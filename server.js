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

const TRADES_FILE = path.join(__dirname, 'data', 'trades.json');

// Utilitaire pour lire les offres d'échanges
function getTrades() {
    if (!fs.existsSync(TRADES_FILE)) {
        fs.writeFileSync(TRADES_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(TRADES_FILE, 'utf-8');
    return JSON.parse(data || '[]');
}

function saveTrades(trades) {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

// 1. Récupérer toutes les offres d'échanges actives
app.get('/api/trades', (req, res) => {
    res.json(getTrades());
});

// 2. Créer une offre d'échange (Autorisé dès qu'on possède au moins 1 exemplaire)
app.post('/api/trades/create', (req, res) => {
    const { username, offeredCardId, wantedCardId } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    // Autorisé si le joueur possède au moins 1 exemplaire de la carte qu'il propose
    if (!user || !user.collection || (user.collection[offeredCardId] || 0) < 1) {
        return res.status(400).json({ error: "Vous ne possédez pas cette carte à échanger." });
    }

    const trades = getTrades();
    const newTrade = {
        id: `trade_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        username,
        offeredCardId,
        wantedCardId,
        createdAt: new Date().toISOString()
    };

    trades.push(newTrade);
    saveTrades(trades);
    res.json({ success: true, trade: newTrade });
});

// 3. Accepter un échange
app.post('/api/trades/accept', (req, res) => {
    const { username, tradeId } = req.body;
    const trades = getTrades();
    const tradeIndex = trades.findIndex(t => t.id === tradeId);

    if (tradeIndex === -1) {
        return res.status(404).json({ error: "Offre introuvable." });
    }

    const trade = trades[tradeIndex];
    if (trade.username === username) {
        return res.status(400).json({ error: "Vous ne pouvez pas accepter votre propre offre." });
    }

    const users = getUsers();
    const creator = users.find(u => u.username.toLowerCase() === trade.username.toLowerCase());
    const acceptor = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!creator || !acceptor) {
        return res.status(404).json({ error: "Utilisateurs introuvables." });
    }

    // Vérifier que l'acquéreur possède bien la carte demandée (wantedCardId)
    if (!acceptor.collection || (acceptor.collection[trade.wantedCardId] || 0) < 1) {
        return res.status(400).json({ error: "Vous ne possédez pas la carte demandée par cette offre." });
    }

    // Vérifier que le créateur possède toujours la carte offerte (offeredCardId)
    if (!creator.collection || (creator.collection[trade.offeredCardId] || 0) < 1) {
        return res.status(400).json({ error: "Le créateur de l'offre ne possède plus la carte." });
    }

    // --- EFFECTUER LE TRANSFERT DES CARTES ---
    // 1. Le créateur donne offeredCardId et reçoit wantedCardId
    creator.collection[trade.offeredCardId] -= 1;
    if (creator.collection[trade.offeredCardId] <= 0) delete creator.collection[trade.offeredCardId];
    creator.collection[trade.wantedCardId] = (creator.collection[trade.wantedCardId] || 0) + 1;

    // 2. L'acquéreur donne wantedCardId et reçoit offeredCardId
    acceptor.collection[trade.wantedCardId] -= 1;
    if (acceptor.collection[trade.wantedCardId] <= 0) delete acceptor.collection[trade.wantedCardId];
    acceptor.collection[trade.offeredCardId] = (acceptor.collection[trade.offeredCardId] || 0) + 1;

    // Supprimer l'offre active
    trades.splice(tradeIndex, 1);

    saveUsers(users);
    saveTrades(trades);

    res.json({ success: true });
});

// 4. Annuler sa propre offre
app.post('/api/trades/cancel', (req, res) => {
    const { username, tradeId } = req.body;
    let trades = getTrades();
    const trade = trades.find(t => t.id === tradeId);

    if (!trade || trade.username !== username) {
        return res.status(403).json({ error: "Action non autorisée." });
    }

    trades = trades.filter(t => t.id !== tradeId);
    saveTrades(trades);
    res.json({ success: true });
});

// 6. Route pour gérer l'achat en boutique (Boosters et Cartes à l'unité)
app.post('/api/shop/buy-pack', (req, res) => {
    const { username, cost, cardIds } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    // Gestion de la monnaie ECTS (initialisée à 60 par défaut si absente)
    const currentEcts = user.ects ?? 60;
    if (currentEcts < cost) {
        return res.status(400).json({ error: "Crédits ECTS insuffisants." });
    }

    // Déduction des ECTS
    user.ects = currentEcts - cost;

    // Sécurité : conversion de la collection en dictionnaire si c'était un ancien format tableau
    if (!user.collection || Array.isArray(user.collection)) {
        user.collection = {};
    }

    // Ajout des cartes achetées dans l'inventaire du joueur
    if (Array.isArray(cardIds)) {
        cardIds.forEach(id => {
            user.collection[id] = (user.collection[id] || 0) + 1;
        });
    }

    saveUsers(users);
    res.json({ success: true, ects: user.ects, collection: user.collection });
});