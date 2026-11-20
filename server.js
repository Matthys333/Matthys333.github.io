const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const CARDS_FILE = path.join(__dirname, 'data', 'cards.json');
const TRADES_FILE = path.join(__dirname, 'data', 'trades.json');
const MARKET_FILE = path.join(__dirname, 'data', 'market.json');

app.use(express.json());
app.use(express.static('public'));
// Permet d'accéder aux images situées dans le dossier Image_TCG à la racine
app.use('/Image_TCG', express.static(path.join(__dirname, 'Image_TCG')));

// Utilitaire pour lire les utilisateurs du fichier JSON
function getUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data || '[]');
}

// Utilitaire pour sauvegarder les utilisateurs
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function ensureUserCollection(user) {
    if (!user.collection || Array.isArray(user.collection)) {
        const converted = {};
        if (Array.isArray(user.collection)) {
            user.collection.forEach(card => {
                const id = card.id || card.nom;
                converted[id] = (converted[id] || 0) + 1;
            });
        }
        user.collection = converted;
    }
    return user.collection;
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
        ects: 60,
        collection: {},
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

    res.json({
        message: 'Connexion réussie',
        username: user.username,
        ects: user.ects ?? 60
    });
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

    function pullCardByRarity() {
        const rand = Math.random() * 100;
        let targetRarity = 'Vulgaris';

        if (rand < 0.1) targetRarity = 'Arcanus';
        else if (rand < 1.4) targetRarity = 'Mythicus';
        else if (rand < 7.0) targetRarity = 'Legendarius';
        else if (rand < 13.0) targetRarity = 'Eximius';
        else if (rand < 25.0) targetRarity = 'Rarus';
        else if (rand < 50.0) targetRarity = 'Insolitus';
        else targetRarity = 'Vulgaris';

        let filteredCards = cardsData.filter(c => c.rarete && c.rarete.toLowerCase() === targetRarity.toLowerCase());
        if (filteredCards.length === 0) {
            filteredCards = cardsData;
        }

        return filteredCards[Math.floor(Math.random() * filteredCards.length)];
    }

    const pulledCards = [];
    for (let i = 0; i < 5; i++) {
        pulledCards.push(pullCardByRarity());
    }

    if (username) {
        const users = getUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (user) {
            const collection = ensureUserCollection(user);
            pulledCards.forEach(card => {
                const cardId = card.id || card.nom;
                collection[cardId] = (collection[cardId] || 0) + 1;
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

    if (Array.isArray(user.collection)) {
        user.collection = ensureUserCollection(user);
        saveUsers(users);
    }

    res.json(user.collection || {});
});

// Route utilitaire pour récupérer les infos d'un joueur (ECTS + collection)
app.get('/api/user/:username', (req, res) => {
    const { username } = req.params;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    const collection = ensureUserCollection(user);
    res.json({
        username: user.username,
        ects: user.ects ?? 60,
        collection
    });
});

// ==========================================
// ÉCHANGES ENTRE JOUEURS
// ==========================================
function getTrades() {
    if (!fs.existsSync(TRADES_FILE)) {
        fs.writeFileSync(TRADES_FILE, JSON.stringify([], null, 2));
    }
    const data = fs.readFileSync(TRADES_FILE, 'utf-8');
    return JSON.parse(data || '[]');
}

function saveTrades(trades) {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

app.get('/api/trades', (req, res) => {
    res.json(getTrades());
});

app.post('/api/trades/create', (req, res) => {
    const { username, offeredCardId, wantedCardId } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

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

app.post('/api/trades/accept', (req, res) => {
    const { username, tradeId } = req.body;
    const trades = getTrades();
    const tradeIndex = trades.findIndex(t => t.id === tradeId);

    if (tradeIndex === -1) {
        return res.status(404).json({ error: "Offre introuvable." });
    }

    const trade = trades[tradeIndex];
    if (trade.username.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ error: "Vous ne pouvez pas accepter votre propre offre." });
    }

    const users = getUsers();
    const creator = users.find(u => u.username.toLowerCase() === trade.username.toLowerCase());
    const acceptor = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!creator || !acceptor) {
        return res.status(404).json({ error: "Utilisateurs introuvables." });
    }

    const creatorCol = ensureUserCollection(creator);
    const acceptorCol = ensureUserCollection(acceptor);

    if ((acceptorCol[trade.wantedCardId] || 0) < 1) {
        return res.status(400).json({ error: "Vous ne possédez pas la carte demandée par cette offre." });
    }

    if ((creatorCol[trade.offeredCardId] || 0) < 1) {
        return res.status(400).json({ error: "Le créateur de l'offre ne possède plus la carte." });
    }

    creatorCol[trade.offeredCardId] -= 1;
    if (creatorCol[trade.offeredCardId] <= 0) delete creatorCol[trade.offeredCardId];
    creatorCol[trade.wantedCardId] = (creatorCol[trade.wantedCardId] || 0) + 1;

    acceptorCol[trade.wantedCardId] -= 1;
    if (acceptorCol[trade.wantedCardId] <= 0) delete acceptorCol[trade.wantedCardId];
    acceptorCol[trade.offeredCardId] = (acceptorCol[trade.offeredCardId] || 0) + 1;

    trades.splice(tradeIndex, 1);

    saveUsers(users);
    saveTrades(trades);

    res.json({ success: true });
});

app.post('/api/trades/cancel', (req, res) => {
    const { username, tradeId } = req.body;
    let trades = getTrades();
    const trade = trades.find(t => t.id === tradeId);

    if (!trade || trade.username.toLowerCase() !== username.toLowerCase()) {
        return res.status(403).json({ error: "Action non autorisée." });
    }

    trades = trades.filter(t => t.id !== tradeId);
    saveTrades(trades);
    res.json({ success: true });
});

// ==========================================
// BOUTIQUE ECTS
// ==========================================
app.post('/api/shop/buy-pack', (req, res) => {
    const { username, cost, cardIds } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    const currentEcts = user.ects ?? 60;
    if (currentEcts < cost) {
        return res.status(400).json({ error: "Crédits ECTS insuffisants." });
    }

    user.ects = currentEcts - cost;
    const collection = ensureUserCollection(user);

    if (Array.isArray(cardIds)) {
        cardIds.forEach(id => {
            collection[id] = (collection[id] || 0) + 1;
        });
    }

    saveUsers(users);
    res.json({ success: true, ects: user.ects, collection: user.collection });
});

// ==========================================
// MARCHÉ & ENCHÈRES
// ==========================================
function readMarket() {
    if (!fs.existsSync(MARKET_FILE)) {
        fs.writeFileSync(MARKET_FILE, JSON.stringify([], null, 2));
        return [];
    }
    return JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8') || '[]');
}

function writeMarket(listings) {
    fs.writeFileSync(MARKET_FILE, JSON.stringify(listings, null, 2));
}

function resolveExpiredListings() {
    const listings = readMarket();
    const now = Date.now();
    let updated = false;
    const remainingListings = [];

    const users = getUsers();

    for (const item of listings) {
        if (now >= item.endTime) {
            updated = true;
            const seller = users.find(u => u.username.toLowerCase() === item.seller.toLowerCase());

            if (item.type === 'auction' && item.highestBidder) {
                const winner = users.find(u => u.username.toLowerCase() === item.highestBidder.toLowerCase());
                if (winner) {
                    const winnerCol = ensureUserCollection(winner);
                    winnerCol[item.cardId] = (winnerCol[item.cardId] || 0) + 1;
                }
                if (seller) {
                    seller.ects = (seller.ects ?? 60) + item.currentPrice;
                }
            } else {
                if (seller) {
                    const sellerCol = ensureUserCollection(seller);
                    sellerCol[item.cardId] = (sellerCol[item.cardId] || 0) + 1;
                }
            }
        } else {
            remainingListings.push(item);
        }
    }

    if (updated) {
        saveUsers(users);
        writeMarket(remainingListings);
    }
}

setInterval(resolveExpiredListings, 1000);

app.get('/api/market', (req, res) => {
    resolveExpiredListings();
    res.json({ success: true, listings: readMarket() });
});

app.post('/api/market/create', (req, res) => {
    const { username, cardId, type, price, durationMinutes } = req.body;
    const numericPrice = parseInt(price, 10);
    const durationMs = (parseInt(durationMinutes, 10) || 5) * 60 * 1000;

    if (!username || !cardId || isNaN(numericPrice) || numericPrice <= 0) {
        return res.status(400).json({ success: false, error: 'Paramètres invalides.' });
    }

    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const collection = ensureUserCollection(user);
    if ((collection[cardId] || 0) <= 0) {
        return res.status(400).json({ success: false, error: 'Vous ne possédez pas cette carte.' });
    }

    collection[cardId] -= 1;
    if (collection[cardId] <= 0) delete collection[cardId];
    saveUsers(users);

    const listings = readMarket();
    const newListing = {
        id: `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        seller: user.username,
        cardId,
        type: type === 'auction' ? 'auction' : 'fixed',
        startingPrice: numericPrice,
        currentPrice: numericPrice,
        highestBidder: null,
        createdAt: Date.now(),
        endTime: Date.now() + durationMs
    };

    listings.push(newListing);
    writeMarket(listings);

    res.json({ success: true, listing: newListing });
});

app.post('/api/market/buy', (req, res) => {
    const { username, listingId } = req.body;
    resolveExpiredListings();

    const listings = readMarket();
    const index = listings.findIndex(l => l.id === listingId);
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Annonce expirée ou déjà vendue.' });
    }

    const listing = listings[index];
    if (listing.type !== 'fixed') {
        return res.status(400).json({ success: false, error: 'Cette annonce est une enchère.' });
    }
    if (listing.seller.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'Vous ne pouvez pas acheter votre propre carte.' });
    }

    const users = getUsers();
    const buyer = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    const seller = users.find(u => u.username.toLowerCase() === listing.seller.toLowerCase());

    const buyerEcts = buyer?.ects ?? 60;
    if (!buyer || buyerEcts < listing.currentPrice) {
        return res.status(400).json({ success: false, error: 'ECTS insuffisants.' });
    }

    buyer.ects = buyerEcts - listing.currentPrice;
    const buyerCol = ensureUserCollection(buyer);
    buyerCol[listing.cardId] = (buyerCol[listing.cardId] || 0) + 1;

    if (seller) {
        seller.ects = (seller.ects ?? 60) + listing.currentPrice;
    }

    listings.splice(index, 1);
    saveUsers(users);
    writeMarket(listings);

    res.json({ success: true, newEcts: buyer.ects });
});

app.post('/api/market/bid', (req, res) => {
    const { username, listingId, bidAmount } = req.body;
    const amount = parseInt(bidAmount, 10);
    resolveExpiredListings();

    const listings = readMarket();
    const listing = listings.find(l => l.id === listingId);
    if (!listing) {
        return res.status(404).json({ success: false, error: 'Enchère terminée ou introuvable.' });
    }
    if (listing.type !== 'auction') {
        return res.status(400).json({ success: false, error: 'Cette annonce est à prix fixe.' });
    }
    if (listing.seller.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'Vous ne pouvez pas enchérir sur votre propre carte.' });
    }

    const minRequired = listing.highestBidder ? listing.currentPrice + 1 : listing.startingPrice;
    if (isNaN(amount) || amount < minRequired) {
        return res.status(400).json({ success: false, error: `L'enchère minimale est de ${minRequired} ECTS.` });
    }

    const users = getUsers();
    const bidder = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    const bidderEcts = bidder?.ects ?? 60;
    if (!bidder || bidderEcts < amount) {
        return res.status(400).json({ success: false, error: 'ECTS insuffisants.' });
    }

    if (listing.highestBidder) {
        const previousBidder = users.find(u => u.username.toLowerCase() === listing.highestBidder.toLowerCase());
        if (previousBidder) {
            previousBidder.ects = (previousBidder.ects ?? 60) + listing.currentPrice;
        }
    }

    bidder.ects = bidderEcts - amount;
    listing.currentPrice = amount;
    listing.highestBidder = bidder.username;

    saveUsers(users);
    writeMarket(listings);

    res.json({ success: true, newEcts: bidder.ects, listing });
});

app.listen(PORT, () => {
    console.log(`Serveur TCG démarré sur http://localhost:${PORT}`);
});

// ==========================================
// CLASSEMENT DES JOUEURS
// ==========================================
const RANKING_RARITY_POINTS = {
    vulgaris: 1,
    insolitus: 3,
    rarus: 8,
    eximius: 20,
    legendarius: 50,
    mythicus: 120,
    arcanus: 300
};

app.get('/api/ranking', (req, res) => {
    const users = getUsers();
    let cardsData = [];

    if (fs.existsSync(CARDS_FILE)) {
        cardsData = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8') || '[]');
    }

    const cardMap = {};
    cardsData.forEach(card => {
        const key = card.id || card.nom;
        cardMap[key] = card;
    });

    const entries = users.map(user => {
        const collection = ensureUserCollection(user);
        let totalCards = 0;
        let uniqueCards = 0;
        let rarityScore = 0;
        let deckPowerScore = 0;

        Object.entries(collection).forEach(([cardId, qty]) => {
            const count = parseInt(qty, 10) || 0;
            if (count <= 0) return;

            totalCards += count;
            uniqueCards += 1;

            const card = cardMap[cardId];
            if (card) {
                const rarityKey = (card.rarete || 'vulgaris').toLowerCase();
                const rarityPts = RANKING_RARITY_POINTS[rarityKey] ?? 1;
                rarityScore += rarityPts * count;

                const cafe = Number(card.stats?.cafe) || 0;
                const ectsStat = Number(card.stats?.ects) || 0;
                deckPowerScore += (cafe + ectsStat) * count;
            }
        });

        return {
            username: user.username,
            ects: user.ects ?? 60,
            totalCards,
            uniqueCards,
            rarityScore,
            deckPowerScore
        };
    });

    const byEcts = [...entries].sort((a, b) => b.ects - a.ects || b.rarityScore - a.rarityScore);
    const byRarity = [...entries].sort((a, b) => b.rarityScore - a.rarityScore || b.totalCards - a.totalCards);
    const byPower = [...entries].sort((a, b) => b.deckPowerScore - a.deckPowerScore || b.rarityScore - a.rarityScore);

    res.json({
        success: true,
        rankings: {
            ects: byEcts,
            rarity: byRarity,
            power: byPower
        }
    });
});