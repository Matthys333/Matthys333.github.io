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
        ram: 60,
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
        ram: user.ram ?? 60
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

    let penaltyPointsShift = 0;
    const users = getUsers();
    if (username) {
        const activeUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (activeUser && (activeUser.rareDropPenaltyUntil || 0) > Date.now()) {
            const red = Number(activeUser.rareDropPenaltyReduction) || 0.10;
            penaltyPointsShift = red * 100; // 10 points pour -10%, 30 points pour -30%
        }
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

// Route utilitaire pour récupérer les infos d'un joueur (ram + collection)
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
        ram: user.ram ?? 60,
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
// BOUTIQUE ram
// ==========================================
app.post('/api/shop/buy-pack', (req, res) => {
    const { username, cost, cardIds } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    const currentram = user.ram ?? 60;
    if (currentram < cost) {
        return res.status(400).json({ error: "Crédits ram insuffisants." });
    }

    user.ram = currentram - cost;
    const collection = ensureUserCollection(user);

    if (Array.isArray(cardIds)) {
        cardIds.forEach(id => {
            collection[id] = (collection[id] || 0) + 1;
        });
    }

    saveUsers(users);
    res.json({ success: true, ram: user.ram, collection: user.collection });
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
                    seller.ram = (seller.ram ?? 60) + item.currentPrice;
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

    const buyerram = buyer?.ram ?? 60;
    if (!buyer || buyerram < listing.currentPrice) {
        return res.status(400).json({ success: false, error: 'ram insuffisants.' });
    }

    buyer.ram = buyerram - listing.currentPrice;
    const buyerCol = ensureUserCollection(buyer);
    buyerCol[listing.cardId] = (buyerCol[listing.cardId] || 0) + 1;

    if (seller) {
        seller.ram = (seller.ram ?? 60) + listing.currentPrice;
    }

    listings.splice(index, 1);
    saveUsers(users);
    writeMarket(listings);

    res.json({ success: true, newram: buyer.ram });
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
        return res.status(400).json({ success: false, error: `L'enchère minimale est de ${minRequired} ram.` });
    }

    const users = getUsers();
    const bidder = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    const bidderram = bidder?.ram ?? 60;
    if (!bidder || bidderram < amount) {
        return res.status(400).json({ success: false, error: 'ram insuffisants.' });
    }

    if (listing.highestBidder) {
        const previousBidder = users.find(u => u.username.toLowerCase() === listing.highestBidder.toLowerCase());
        if (previousBidder) {
            previousBidder.ram = (previousBidder.ram ?? 60) + listing.currentPrice;
        }
    }

    bidder.ram = bidderram - amount;
    listing.currentPrice = amount;
    listing.highestBidder = bidder.username;

    saveUsers(users);
    writeMarket(listings);

    res.json({ success: true, newram: bidder.ram, listing });
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
                const ramStat = Number(card.stats?.ram) || 0;
                deckPowerScore += (cafe + ramStat) * count;
            }
        });

        return {
            username: user.username,
            ram: user.ram ?? 60,
            totalCards,
            uniqueCards,
            rarityScore,
            deckPowerScore
        };
    });

    const byram = [...entries].sort((a, b) => b.ram - a.ram || b.rarityScore - a.rarityScore);
    const byRarity = [...entries].sort((a, b) => b.rarityScore - a.rarityScore || b.totalCards - a.totalCards);
    const byPower = [...entries].sort((a, b) => b.deckPowerScore - a.deckPowerScore || b.rarityScore - a.rarityScore);

    res.json({
        success: true,
        rankings: {
            ram: byram,
            rarity: byRarity,
            power: byPower
        }
    });
});

// Utilitaire pour lire/initialiser le solde RAM (compatible avec l'ancien champ ram)
function getUserRam(user) {
    if (typeof user.ram === 'number') return user.ram;
    if (typeof user.ram === 'number') {
        user.ram = user.ram;
        delete user.ram;
        return user.ram;
    }
    user.ram = 60;
    return user.ram;
}

// Barème de recyclage (Garbage Collector) par rareté
const RECYCLE_RAM_VALUES = {
    vulgaris: 2,
    insolitus: 5,
    rarus: 12,
    eximius: 25,
    legendarius: 60,
    mythicus: 150,
    arcanus: 400
};

// 1. Bonus quotidien (+40 RAM toutes les 24h)
app.post('/api/ram/daily', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const now = Date.now();
    const cooldownMs = 24 * 60 * 60 * 1000;
    const lastClaim = user.lastDailyRam || 0;

    if (now - lastClaim < cooldownMs) {
        const remainingMs = cooldownMs - (now - lastClaim);
        return res.status(400).json({
            success: false,
            error: 'Allocation RAM quotidienne déjà récupérée.',
            remainingMs
        });
    }

    const reward = 40;
    user.ram = getUserRam(user) + reward;
    user.lastDailyRam = now;

    saveUsers(users);
    res.json({ success: true, reward, ram: user.ram, nextClaimAt: now + cooldownMs });
});

// 2. Recycler une carte (Garbage Collector)
app.post('/api/ram/recycle', (req, res) => {
    const { username, cardId, quantity = 1 } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const collection = ensureUserCollection(user);
    if ((collection[cardId] || 0) < qty) {
        return res.status(400).json({ success: false, error: 'Exemplaires insuffisants pour le recyclage.' });
    }

    let cardsData = [];
    if (fs.existsSync(CARDS_FILE)) {
        cardsData = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8') || '[]');
    }
    const card = cardsData.find(c => (c.id || c.nom) === cardId);
    const rarityKey = (card?.rarete || 'vulgaris').toLowerCase();
    const unitValue = RECYCLE_RAM_VALUES[rarityKey] ?? 2;
    const totalGain = unitValue * qty;

    collection[cardId] -= qty;
    if (collection[cardId] <= 0) delete collection[cardId];

    user.ram = getUserRam(user) + totalGain;
    saveUsers(users);

    res.json({
        success: true,
        gained: totalGain,
        ram: user.ram,
        collection: user.collection
    });
});

// 3. Récompense mini-défi / Debug Express (+15 RAM, cooldown 3 min)
app.post('/api/ram/quiz-reward', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const now = Date.now();
    const cooldownMs = 3 * 60 * 1000;
    const lastQuiz = user.lastQuizRam || 0;

    if (now - lastQuiz < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - (now - lastQuiz)) / 1000);
        return res.status(400).json({
            success: false,
            error: `Surchauffe CPU ! Réessaie dans ${remainingSec}s.`
        });
    }

    const reward = 15;
    user.ram = getUserRam(user) + reward;
    user.lastQuizRam = now;

    saveUsers(users);
    res.json({ success: true, reward, ram: user.ram });
});

// ==========================================
// QUIZ RAM : ANTI-TRICHE (-30%), DIFFICULTÉ CROISSANTE & NON-RÉPÉTITION
// ==========================================
// ⚙️ Modifiable facilement pour tester (ex: 15 * 60 * 1000 = 15 min, ou 20 * 1000 = 20s)
const RAM_QUIZ_PENALTY_DURATION_MS = 15 * 60 * 1000;
const RAM_WRONG_ANSWER_PENALTY = 0.10; // -10% en cas de mauvaise réponse
const RAM_CHEAT_PENALTY = 0.30;        // -30% en cas de sortie d'onglet / triche
const QUIZ_STREAK_THRESHOLD = 10;

function getActiveDropPenalty(user, now = Date.now()) {
    const expiresAt = user.rareDropPenaltyUntil || 0;
    if (now < expiresAt) {
        return {
            active: true,
            expiresAt,
            remainingMs: expiresAt - now,
            reduction: user.rareDropPenaltyReduction || RAM_WRONG_ANSWER_PENALTY,
            reason: user.rareDropPenaltyReason || 'wrong_answer'
        };
    }
    return {
        active: false,
        expiresAt: 0,
        remainingMs: 0,
        reduction: 0,
        reason: null
    };
}

app.post('/api/ram/quiz-start', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    if (user.quizSessionEnded) {
        user.quizStreak = 0;
        user.quizSessionEnded = false;
    }

    user.quizActiveSession = {
        startedAt: Date.now(),
        questionsAnswered: 0,
        askedQuestionIds: []
    };

    saveUsers(users);

    res.json({
        success: true,
        ram: getUserRam(user),
        streak: user.quizStreak || 0,
        bestStreak: user.bestQuizStreak || 0,
        questionsAnswered: 0,
        askedQuestionIds: [],
        dropPenalty: getActiveDropPenalty(user)
    });
});

app.post('/api/ram/quiz-answer', (req, res) => {
    const { username, isCorrect, questionId } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    if (!user.quizActiveSession || user.quizSessionEnded) {
        user.quizStreak = 0;
        user.quizSessionEnded = false;
        user.quizActiveSession = {
            startedAt: Date.now(),
            questionsAnswered: 0,
            askedQuestionIds: []
        };
    }

    if (questionId && !user.quizActiveSession.askedQuestionIds.includes(questionId)) {
        user.quizActiveSession.askedQuestionIds.push(questionId);
    }
    user.quizActiveSession.questionsAnswered += 1;

    const now = Date.now();
    let ram = getUserRam(user);
    let streak = user.quizStreak || 0;
    let bestStreak = user.bestQuizStreak || 0;

    if (isCorrect) {
        streak += 1;
        if (streak > bestStreak) {
            bestStreak = streak;
        }
        const reward = streak >= QUIZ_STREAK_THRESHOLD ? 10 : 5;
        ram += reward;
        user.ram = ram;
        user.quizStreak = streak;
        user.bestQuizStreak = bestStreak;
        saveUsers(users);

        return res.json({
            success: true,
            correct: true,
            reward,
            ram: user.ram,
            streak: user.quizStreak,
            bestStreak: user.bestQuizStreak,
            questionsAnswered: user.quizActiveSession.questionsAnswered,
            askedQuestionIds: user.quizActiveSession.askedQuestionIds,
            dropPenalty: getActiveDropPenalty(user, now)
        });
    } else {
        user.quizStreak = 0;
        user.quizSessionEnded = true;
        user.quizActiveSession = null;
        user.rareDropPenaltyUntil = now + RAM_QUIZ_PENALTY_DURATION_MS;
        user.rareDropPenaltyReduction = RAM_WRONG_ANSWER_PENALTY;
        user.rareDropPenaltyReason = 'wrong_answer';
        saveUsers(users);

        return res.json({
            success: true,
            correct: false,
            ram: user.ram,
            streak: 0,
            bestStreak: user.bestQuizStreak || 0,
            dropPenalty: getActiveDropPenalty(user, now)
        });
    }
});

// Quitter volontairement le quiz : conserve la streak, clôture la série en cours, pas de malus
app.post('/api/ram/quiz-quit', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const currentStreak = user.quizStreak || 0;
    const bestStreak = Math.max(user.bestQuizStreak || 0, currentStreak);

    user.bestQuizStreak = bestStreak;
    user.quizSessionEnded = true;
    user.quizActiveSession = null;
    saveUsers(users);

    res.json({
        success: true,
        ram: getUserRam(user),
        streak: currentStreak,
        bestStreak: user.bestQuizStreak,
        dropPenalty: getActiveDropPenalty(user)
    });
});

// Sanction anti-triche : l'utilisateur a quitté l'onglet/page pendant le quiz actif
app.post('/api/ram/quiz-cheat', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const now = Date.now();
    user.quizStreak = 0;
    user.quizSessionEnded = true;
    user.quizActiveSession = null;
    user.rareDropPenaltyUntil = now + RAM_QUIZ_PENALTY_DURATION_MS;
    user.rareDropPenaltyReduction = RAM_CHEAT_PENALTY;
    user.rareDropPenaltyReason = 'cheat_tab_switch';
    saveUsers(users);

    res.json({
        success: true,
        ram: getUserRam(user),
        streak: 0,
        bestStreak: user.bestQuizStreak || 0,
        dropPenalty: getActiveDropPenalty(user, now)
    });
});

app.post('/api/ram/quiz-quit', (req, res) => {
    const { username } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const currentStreak = user.quizStreak || 0;
    const bestStreak = Math.max(user.bestQuizStreak || 0, currentStreak);

    // Aucune perte de RAM ni de streak, mais la série en cours ne pourra plus être continuée
    user.bestQuizStreak = bestStreak;
    user.quizSessionEnded = true;
    saveUsers(users);

    res.json({
        success: true,
        ram: getUserRam(user),
        streak: currentStreak,
        bestStreak: user.bestQuizStreak,
        dropPenalty: getActiveDropPenalty(user)
    });
});