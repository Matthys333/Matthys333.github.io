/* ==========================================================================
   TCG — API statique
   Remplace server.js : intercepte les fetch('/api/...') du site et exécute
   la même logique directement dans le navigateur.
   Les données (comptes, collections, marché, échanges) sont stockées dans
   le localStorage du navigateur ; les cartes viennent de data/cards.json.
   ========================================================================== */
(function () {
  'use strict';

  const DB_KEY = 'tcg_db_v1';
  const origFetch = window.fetch.bind(window);

  // ------------------------------------------------------------------
  // Stockage
  // ------------------------------------------------------------------
  function readDb() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      const db = raw ? JSON.parse(raw) : {};
      return {
        users: Array.isArray(db.users) ? db.users : [],
        trades: Array.isArray(db.trades) ? db.trades : [],
        market: Array.isArray(db.market) ? db.market : []
      };
    } catch (e) {
      return { users: [], trades: [], market: [] };
    }
  }
  function writeDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  // Les fonctions ci-dessous travaillent sur un "db" chargé en mémoire,
  // puis chaque route appelle save() une seule fois.
  let db = readDb();
  const reload = () => { db = readDb(); };
  const save = () => writeDb(db);

  const getUsers = () => db.users;
  const getTrades = () => db.trades;
  const readMarket = () => db.market;
  const findUser = (name) =>
    db.users.find(u => u.username.toLowerCase() === String(name || '').toLowerCase());

  // ------------------------------------------------------------------
  // Cartes
  // ------------------------------------------------------------------
  let cardsCache = null;
  async function getCards() {
    if (cardsCache) return cardsCache;
    const url = new URL('data/cards.json', document.baseURI).href;
    const res = await origFetch(url);
    if (!res.ok) throw new Error('Impossible de charger data/cards.json');
    const raw = await res.json();
    // Chemins d'images relatifs (le site peut être servi dans un sous-dossier)
    cardsCache = raw.map(c => Object.assign({}, c, {
      image: c.image ? encodeURI(String(c.image).replace(/^\//, '')) : c.image
    }));
    return cardsCache;
  }

  // ------------------------------------------------------------------
  // Utilitaires utilisateur (identiques à server.js)
  // ------------------------------------------------------------------
  function getUserRam(user) {
    if (typeof user.ram === 'number' && !Number.isNaN(user.ram)) return user.ram;
    if (typeof user.ects === 'number' && !Number.isNaN(user.ects)) {
      user.ram = user.ects;
      delete user.ects;
      return user.ram;
    }
    user.ram = 60;
    return user.ram;
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

  // Mots de passe : hachés (SHA-256) quand SubtleCrypto est disponible (https / localhost)
  async function hashPassword(username, password) {
    const text = 'tcg|' + String(username).toLowerCase() + '|' + password;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      return 'sha256:' + hex;
    }
    return 'plain:' + password;
  }
  async function checkPassword(user, password) {
    const stored = user.password || '';
    if (stored.startsWith('sha256:')) return stored === await hashPassword(user.username, password);
    if (stored.startsWith('plain:')) return stored === 'plain:' + password;
    return stored === password;
  }

  // ------------------------------------------------------------------
  // Marché : résolution des annonces expirées
  // ------------------------------------------------------------------
  function resolveExpiredListings() {
    const listings = readMarket();
    const now = Date.now();
    let updated = false;
    const remaining = [];

    for (const item of listings) {
      if (now >= item.endTime) {
        updated = true;
        const seller = findUser(item.seller);
        if (item.type === 'auction' && item.highestBidder) {
          const winner = findUser(item.highestBidder);
          if (winner) {
            const col = ensureUserCollection(winner);
            col[item.cardId] = (col[item.cardId] || 0) + 1;
          }
          if (seller) seller.ram = getUserRam(seller) + item.currentPrice;
        } else if (seller) {
          const col = ensureUserCollection(seller);
          col[item.cardId] = (col[item.cardId] || 0) + 1;
        }
      } else {
        remaining.push(item);
      }
    }

    if (updated) {
      db.market = remaining;
      save();
    }
    return updated;
  }

  // Équivalent du setInterval(resolveExpiredListings, 1000) du serveur
  setInterval(() => {
    reload();
    resolveExpiredListings();
  }, 1000);

  // ------------------------------------------------------------------
  // Constantes de jeu
  // ------------------------------------------------------------------
  const RANKING_RARITY_POINTS = {
    vulgaris: 1, insolitus: 3, rarus: 8, eximius: 20, legendarius: 50, mythicus: 120, arcanus: 300
  };
  const RECYCLE_RAM_VALUES = {
    vulgaris: 2, insolitus: 5, rarus: 12, eximius: 25, legendarius: 60, mythicus: 150, arcanus: 400
  };
  const RAM_QUIZ_PENALTY_DURATION_MS = 15 * 60 * 1000;
  const RAM_WRONG_ANSWER_PENALTY = 0.10;
  const RAM_CHEAT_PENALTY = 0.30;
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
    return { active: false, expiresAt: 0, remainingMs: 0, reduction: 0, reason: null };
  }

  // ------------------------------------------------------------------
  // Routes  (chaque handler renvoie [status, corps])
  // ------------------------------------------------------------------
  const routes = [];
  function route(method, path, handler) {
    const keys = [];
    const regex = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, regex, keys, handler });
  }
  const bad = (status, body) => [status, body];

  // 1. Inscription
  route('POST', '/api/register', async ({ body }) => {
    const { username, password } = body;
    if (!username || !password) return bad(400, { message: 'Veuillez remplir tous les champs.' });
    if (findUser(username)) return bad(400, { message: 'Cet identifiant existe déjà !' });

    db.users.push({
      username,
      password: await hashPassword(username, password),
      ram: 60,
      collection: {},
      created_at: new Date().toISOString()
    });
    save();
    return [200, { message: 'Compte créé avec succès ! Connectez-vous.' }];
  });

  // 2. Connexion
  route('POST', '/api/login', async ({ body }) => {
    const { username, password } = body;
    const user = findUser(username);
    if (!user || !(await checkPassword(user, password || ''))) {
      return bad(401, { message: 'Identifiant ou mot de passe incorrect.' });
    }
    return [200, { message: 'Connexion réussie', username: user.username, ram: getUserRam(user) }];
  });

  // 3. Codex
  route('GET', '/api/cards', async () => [200, await getCards()]);

  // 4. Ouverture d'un booster
  route('POST', '/api/open-stored-booster', async ({ body }) => {
    const { username } = body;
    const cardsData = await getCards();
    if (cardsData.length === 0) return bad(400, { error: 'Le deck de cartes est vide.' });

    let penaltyPointsShift = 0;
    if (username) {
      const activeUser = findUser(username);
      if (activeUser && (activeUser.rareDropPenaltyUntil || 0) > Date.now()) {
        const red = Number(activeUser.rareDropPenaltyReduction) || 0.10;
        penaltyPointsShift = red * 100;
      }
    }

    function pullCardByRarity() {
      const rand = Math.random() * 100 + penaltyPointsShift;
      let targetRarity;
      if (rand < 0.01) targetRarity = 'Arcanus';
      else if (rand < 0.09) targetRarity = 'Mythicus';
      else if (rand < 0.4) targetRarity = 'Legendarius';
      else if (rand < 1.0) targetRarity = 'Eximius';
      else if (rand < 3.5) targetRarity = 'Rarus';
      else if (rand < 15.0) targetRarity = 'Insolitus';
      else targetRarity = 'Vulgaris';

      let filtered = cardsData.filter(c => c.rarete && c.rarete.toLowerCase() === targetRarity.toLowerCase());
      if (filtered.length === 0) filtered = cardsData;
      return filtered[Math.floor(Math.random() * filtered.length)];
    }

    const pulledCards = [];
    for (let i = 0; i < 5; i++) pulledCards.push(pullCardByRarity());

    const user = username ? findUser(username) : null;
    if (user) {
      const collection = ensureUserCollection(user);
      pulledCards.forEach(card => {
        const id = card.id || card.nom;
        collection[id] = (collection[id] || 0) + 1;
      });
      save();
    }
    return [200, { success: true, cards: pulledCards }];
  });

  // 5. Collection / infos joueur
  route('GET', '/api/collection/:username', ({ params }) => {
    const user = findUser(params.username);
    if (!user) return bad(404, { error: 'Utilisateur introuvable.' });
    ensureUserCollection(user);
    save();
    return [200, user.collection || {}];
  });

  route('GET', '/api/user/:username', ({ params }) => {
    const user = findUser(params.username);
    if (!user) return bad(404, { error: 'Utilisateur introuvable.' });
    const collection = ensureUserCollection(user);
    return [200, { username: user.username, ram: getUserRam(user), collection }];
  });

  // ------------------------------------------------------------------
  // Échanges
  // ------------------------------------------------------------------
  route('GET', '/api/trades', () => [200, getTrades()]);

  route('POST', '/api/trades/create', ({ body }) => {
    const { username, offeredCardId, wantedCardId } = body;
    const user = findUser(username);
    if (!user || !user.collection || (user.collection[offeredCardId] || 0) < 1) {
      return bad(400, { error: 'Vous ne possédez pas cette carte à échanger.' });
    }
    const newTrade = {
      id: `trade_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      username,
      offeredCardId,
      wantedCardId,
      createdAt: new Date().toISOString()
    };
    db.trades.push(newTrade);
    save();
    return [200, { success: true, trade: newTrade }];
  });

  route('POST', '/api/trades/accept', ({ body }) => {
    const { username, tradeId } = body;
    const idx = db.trades.findIndex(t => t.id === tradeId);
    if (idx === -1) return bad(404, { error: 'Offre introuvable.' });

    const trade = db.trades[idx];
    if (trade.username.toLowerCase() === String(username).toLowerCase()) {
      return bad(400, { error: 'Vous ne pouvez pas accepter votre propre offre.' });
    }

    const creator = findUser(trade.username);
    const acceptor = findUser(username);
    if (!creator || !acceptor) return bad(404, { error: 'Utilisateurs introuvables.' });

    const creatorCol = ensureUserCollection(creator);
    const acceptorCol = ensureUserCollection(acceptor);

    if ((acceptorCol[trade.wantedCardId] || 0) < 1) {
      return bad(400, { error: 'Vous ne possédez pas la carte demandée par cette offre.' });
    }
    if ((creatorCol[trade.offeredCardId] || 0) < 1) {
      return bad(400, { error: "Le créateur de l'offre ne possède plus la carte." });
    }

    creatorCol[trade.offeredCardId] -= 1;
    if (creatorCol[trade.offeredCardId] <= 0) delete creatorCol[trade.offeredCardId];
    creatorCol[trade.wantedCardId] = (creatorCol[trade.wantedCardId] || 0) + 1;

    acceptorCol[trade.wantedCardId] -= 1;
    if (acceptorCol[trade.wantedCardId] <= 0) delete acceptorCol[trade.wantedCardId];
    acceptorCol[trade.offeredCardId] = (acceptorCol[trade.offeredCardId] || 0) + 1;

    db.trades.splice(idx, 1);
    save();
    return [200, { success: true }];
  });

  route('POST', '/api/trades/cancel', ({ body }) => {
    const { username, tradeId } = body;
    const trade = db.trades.find(t => t.id === tradeId);
    if (!trade || trade.username.toLowerCase() !== String(username).toLowerCase()) {
      return bad(403, { error: 'Action non autorisée.' });
    }
    db.trades = db.trades.filter(t => t.id !== tradeId);
    save();
    return [200, { success: true }];
  });

  // ------------------------------------------------------------------
  // Boutique
  // ------------------------------------------------------------------
  route('POST', '/api/shop/buy-pack', ({ body }) => {
    const { username, cost, cardIds } = body;
    const user = findUser(username);
    if (!user) return bad(404, { error: 'Utilisateur introuvable.' });

    const price = Number(cost);
    if (!Number.isFinite(price) || price < 0) return bad(400, { error: 'Prix invalide.' });

    const currentRam = getUserRam(user);
    if (currentRam < price) return bad(400, { error: 'Crédits RAM insuffisants.' });

    user.ram = currentRam - price;
    const collection = ensureUserCollection(user);
    if (Array.isArray(cardIds)) {
      cardIds.forEach(id => { collection[id] = (collection[id] || 0) + 1; });
    }
    save();
    return [200, { success: true, ram: user.ram, collection: user.collection }];
  });

  // ------------------------------------------------------------------
  // Marché & enchères
  // ------------------------------------------------------------------
  route('GET', '/api/market', () => {
    resolveExpiredListings();
    return [200, { success: true, listings: readMarket() }];
  });

  route('POST', '/api/market/create', ({ body }) => {
    const { username, cardId, type, price, durationMinutes } = body;
    const numericPrice = parseInt(price, 10);
    const durationMs = (parseInt(durationMinutes, 10) || 5) * 60 * 1000;

    if (!username || !cardId || isNaN(numericPrice) || numericPrice <= 0) {
      return bad(400, { success: false, error: 'Paramètres invalides.' });
    }
    const user = findUser(username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const collection = ensureUserCollection(user);
    if ((collection[cardId] || 0) <= 0) {
      return bad(400, { success: false, error: 'Vous ne possédez pas cette carte.' });
    }
    collection[cardId] -= 1;
    if (collection[cardId] <= 0) delete collection[cardId];

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
    db.market.push(newListing);
    save();
    return [200, { success: true, listing: newListing }];
  });

  route('POST', '/api/market/buy', ({ body }) => {
    const { username, listingId } = body;
    resolveExpiredListings();

    const index = db.market.findIndex(l => l.id === listingId);
    if (index === -1) return bad(404, { success: false, error: 'Annonce expirée ou déjà vendue.' });

    const listing = db.market[index];
    if (listing.type !== 'fixed') return bad(400, { success: false, error: 'Cette annonce est une enchère.' });
    if (listing.seller.toLowerCase() === String(username).toLowerCase()) {
      return bad(400, { success: false, error: 'Vous ne pouvez pas acheter votre propre carte.' });
    }

    const buyer = findUser(username);
    const seller = findUser(listing.seller);
    if (!buyer) return bad(404, { success: false, error: 'Acheteur introuvable.' });

    const buyerRam = getUserRam(buyer);
    if (buyerRam < listing.currentPrice) return bad(400, { success: false, error: 'RAM insuffisants.' });

    buyer.ram = buyerRam - listing.currentPrice;
    const buyerCol = ensureUserCollection(buyer);
    buyerCol[listing.cardId] = (buyerCol[listing.cardId] || 0) + 1;
    if (seller) seller.ram = getUserRam(seller) + listing.currentPrice;

    db.market.splice(index, 1);
    save();
    return [200, { success: true, newRam: buyer.ram, ram: buyer.ram }];
  });

  route('POST', '/api/market/bid', ({ body }) => {
    const { username, listingId, bidAmount } = body;
    const amount = parseInt(bidAmount, 10);
    resolveExpiredListings();

    const listing = db.market.find(l => l.id === listingId);
    if (!listing) return bad(404, { success: false, error: 'Enchère terminée ou introuvable.' });
    if (listing.type !== 'auction') return bad(400, { success: false, error: 'Cette annonce est à prix fixe.' });
    if (listing.seller.toLowerCase() === String(username).toLowerCase()) {
      return bad(400, { success: false, error: 'Vous ne pouvez pas enchérir sur votre propre carte.' });
    }

    const minRequired = listing.highestBidder ? listing.currentPrice + 1 : listing.startingPrice;
    if (isNaN(amount) || amount < minRequired) {
      return bad(400, { success: false, error: `L'enchère minimale est de ${minRequired} RAM.` });
    }

    const bidder = findUser(username);
    if (!bidder) return bad(404, { success: false, error: 'Enchérisseur introuvable.' });

    const bidderRam = getUserRam(bidder);
    if (bidderRam < amount) return bad(400, { success: false, error: 'RAM insuffisants.' });

    if (listing.highestBidder) {
      const previous = findUser(listing.highestBidder);
      if (previous) previous.ram = getUserRam(previous) + listing.currentPrice;
    }

    bidder.ram = bidderRam - amount;
    listing.currentPrice = amount;
    listing.highestBidder = bidder.username;
    save();
    return [200, { success: true, newRam: bidder.ram, ram: bidder.ram, listing }];
  });

  // ------------------------------------------------------------------
  // Classement
  // ------------------------------------------------------------------
  route('GET', '/api/ranking', async () => {
    const cardsData = await getCards();
    const cardMap = {};
    cardsData.forEach(card => { cardMap[card.id || card.nom] = card; });

    const entries = db.users.map(user => {
      const collection = ensureUserCollection(user);
      let totalCards = 0, uniqueCards = 0, rarityScore = 0, deckPowerScore = 0;

      Object.entries(collection).forEach(([cardId, qty]) => {
        const count = parseInt(qty, 10) || 0;
        if (count <= 0) return;
        totalCards += count;
        uniqueCards += 1;

        const card = cardMap[cardId];
        if (card) {
          const key = (card.rarete || 'vulgaris').toLowerCase();
          rarityScore += (RANKING_RARITY_POINTS[key] ?? 1) * count;
          const cafe = Number(card.stats?.cafe) || 0;
          const ectsStat = Number(card.stats?.ects ?? card.stats?.ram) || 0;
          deckPowerScore += (cafe + ectsStat) * count;
        }
      });

      const currentStreak = Number(user.quizStreak) || 0;
      const bestQuizStreak = Math.max(Number(user.bestQuizStreak) || 0, currentStreak);
      return {
        username: user.username,
        ram: getUserRam(user),
        totalCards, uniqueCards, rarityScore, deckPowerScore, bestQuizStreak
      };
    });

    return [200, {
      success: true,
      rankings: {
        ram: [...entries].sort((a, b) => b.ram - a.ram || b.rarityScore - a.rarityScore),
        rarity: [...entries].sort((a, b) => b.rarityScore - a.rarityScore || b.totalCards - a.totalCards),
        power: [...entries].sort((a, b) => b.deckPowerScore - a.deckPowerScore || b.rarityScore - a.rarityScore),
        quiz: [...entries].sort((a, b) => b.bestQuizStreak - a.bestQuizStreak || b.ram - a.ram)
      }
    }];
  });

  // ------------------------------------------------------------------
  // RAM : quotidien, recyclage, récompense quiz
  // ------------------------------------------------------------------
  route('POST', '/api/ram/daily', ({ body }) => {
    const user = findUser(body.username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const now = Date.now();
    const cooldownMs = 24 * 60 * 60 * 1000;
    const lastClaim = user.lastDailyRam || 0;
    if (now - lastClaim < cooldownMs) {
      return bad(400, {
        success: false,
        error: 'Allocation RAM quotidienne déjà récupérée.',
        remainingMs: cooldownMs - (now - lastClaim)
      });
    }
    const reward = 40;
    user.ram = getUserRam(user) + reward;
    user.lastDailyRam = now;
    save();
    return [200, { success: true, reward, ram: user.ram, nextClaimAt: now + cooldownMs }];
  });

  route('POST', '/api/ram/recycle', async ({ body }) => {
    const { username, cardId } = body;
    const qty = Math.max(1, parseInt(body.quantity ?? 1, 10) || 1);
    const user = findUser(username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const collection = ensureUserCollection(user);
    if ((collection[cardId] || 0) < qty) {
      return bad(400, { success: false, error: 'Exemplaires insuffisants pour le recyclage.' });
    }

    const cardsData = await getCards();
    const card = cardsData.find(c => (c.id || c.nom) === cardId);
    const rarityKey = (card?.rarete || 'vulgaris').toLowerCase();
    const totalGain = (RECYCLE_RAM_VALUES[rarityKey] ?? 2) * qty;

    collection[cardId] -= qty;
    if (collection[cardId] <= 0) delete collection[cardId];
    user.ram = getUserRam(user) + totalGain;
    save();
    return [200, { success: true, gained: totalGain, ram: user.ram, collection: user.collection }];
  });

  route('POST', '/api/ram/quiz-reward', ({ body }) => {
    const user = findUser(body.username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const now = Date.now();
    const cooldownMs = 3 * 60 * 1000;
    const lastQuiz = user.lastQuizRam || 0;
    if (now - lastQuiz < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - (now - lastQuiz)) / 1000);
      return bad(400, { success: false, error: `Surchauffe CPU ! Réessaie dans ${remainingSec}s.` });
    }
    const reward = 15;
    user.ram = getUserRam(user) + reward;
    user.lastQuizRam = now;
    save();
    return [200, { success: true, reward, ram: user.ram }];
  });

  // ------------------------------------------------------------------
  // Quiz RAM
  // ------------------------------------------------------------------
  route('POST', '/api/ram/quiz-start', ({ body }) => {
    const user = findUser(body.username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    if (user.quizSessionEnded) {
      user.quizStreak = 0;
      user.quizSessionEnded = false;
    }
    user.quizActiveSession = { startedAt: Date.now(), questionsAnswered: 0, askedQuestionIds: [] };
    save();

    return [200, {
      success: true,
      ram: getUserRam(user),
      streak: user.quizStreak || 0,
      bestStreak: user.bestQuizStreak || 0,
      questionsAnswered: 0,
      askedQuestionIds: [],
      dropPenalty: getActiveDropPenalty(user)
    }];
  });

  route('POST', '/api/ram/quiz-answer', ({ body }) => {
    const { username, isCorrect, questionId } = body;
    const user = findUser(username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    if (!user.quizActiveSession || user.quizSessionEnded) {
      user.quizStreak = 0;
      user.quizSessionEnded = false;
      user.quizActiveSession = { startedAt: Date.now(), questionsAnswered: 0, askedQuestionIds: [] };
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
      if (streak > bestStreak) bestStreak = streak;
      const reward = streak >= QUIZ_STREAK_THRESHOLD ? 10 : 5;
      ram += reward;
      user.ram = ram;
      user.quizStreak = streak;
      user.bestQuizStreak = bestStreak;
      save();
      return [200, {
        success: true,
        correct: true,
        reward,
        ram: user.ram,
        streak: user.quizStreak,
        bestStreak: user.bestQuizStreak,
        questionsAnswered: user.quizActiveSession.questionsAnswered,
        askedQuestionIds: user.quizActiveSession.askedQuestionIds,
        dropPenalty: getActiveDropPenalty(user, now)
      }];
    }

    user.quizStreak = 0;
    user.quizSessionEnded = true;
    user.quizActiveSession = null;
    user.rareDropPenaltyUntil = now + RAM_QUIZ_PENALTY_DURATION_MS;
    user.rareDropPenaltyReduction = RAM_WRONG_ANSWER_PENALTY;
    user.rareDropPenaltyReason = 'wrong_answer';
    save();
    return [200, {
      success: true,
      correct: false,
      ram: user.ram,
      streak: 0,
      bestStreak: user.bestQuizStreak || 0,
      dropPenalty: getActiveDropPenalty(user, now)
    }];
  });

  route('POST', '/api/ram/quiz-quit', ({ body }) => {
    const user = findUser(body.username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const currentStreak = user.quizStreak || 0;
    user.bestQuizStreak = Math.max(user.bestQuizStreak || 0, currentStreak);
    user.quizSessionEnded = true;
    user.quizActiveSession = null;
    save();
    return [200, {
      success: true,
      ram: getUserRam(user),
      streak: currentStreak,
      bestStreak: user.bestQuizStreak,
      dropPenalty: getActiveDropPenalty(user)
    }];
  });

  route('POST', '/api/ram/quiz-cheat', ({ body }) => {
    const user = findUser(body.username);
    if (!user) return bad(404, { success: false, error: 'Utilisateur introuvable.' });

    const now = Date.now();
    user.quizStreak = 0;
    user.quizSessionEnded = true;
    user.quizActiveSession = null;
    user.rareDropPenaltyUntil = now + RAM_QUIZ_PENALTY_DURATION_MS;
    user.rareDropPenaltyReduction = RAM_CHEAT_PENALTY;
    user.rareDropPenaltyReason = 'cheat_tab_switch';
    save();
    return [200, {
      success: true,
      ram: getUserRam(user),
      streak: 0,
      bestStreak: user.bestQuizStreak || 0,
      dropPenalty: getActiveDropPenalty(user, now)
    }];
  });

  // ------------------------------------------------------------------
  // Interception de fetch
  // ------------------------------------------------------------------
  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^\/?api\//.test(rawUrl)) return origFetch(input, init);

    const apiPath = '/' + rawUrl.replace(/^\//, '').split('?')[0].split('#')[0];
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    let body = {};
    if (init && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const m = apiPath.match(r.regex);
      if (!m) continue;

      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

      try {
        reload(); // état frais (autres onglets)
        const [status, data] = await r.handler({ body, params });
        return jsonResponse(status, data);
      } catch (err) {
        console.error('[API statique]', err);
        return jsonResponse(500, { error: 'Erreur interne : ' + err.message, message: 'Erreur interne.' });
      }
    }
    return jsonResponse(404, { error: 'Route introuvable.', message: 'Route introuvable.' });
  };

  // ------------------------------------------------------------------
  // Outils de sauvegarde (console ou boutons éventuels) :
  //   TCG.exportSave()  -> télécharge un fichier .json
  //   TCG.importSave(file) -> restaure depuis un fichier .json
  //   TCG.reset()       -> efface toutes les données locales
  // ------------------------------------------------------------------
  window.TCG = {
    exportSave() {
      const blob = new Blob([JSON.stringify(readDb(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tcg-sauvegarde.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async importSave(file) {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.users)) throw new Error('Fichier invalide.');
      writeDb({ users: data.users, trades: data.trades || [], market: data.market || [] });
      reload();
    },
    reset() {
      localStorage.removeItem(DB_KEY);
      reload();
    }
  };
})();
