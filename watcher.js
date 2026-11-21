const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const BASE_IMAGE_DIR = path.join(ROOT_DIR, 'Image_TCG');
const WATCH_DIR = path.join(BASE_IMAGE_DIR, 'cards');
const CARDS_FILE = path.join(ROOT_DIR, 'data', 'cards.json');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// ==========================================
// TAUX DE DROP POUR L'ATTRIBUTION DES RARETÉS
// ==========================================
const DROP_RATES = [
  { rarete: 'Arcanus',     chance: 0.2 },   // 0.2%
  { rarete: 'Mythicus',    chance: 0.8 },   // 0.8%
  { rarete: 'Legendarius', chance: 3.0 },   // 3.0%
  { rarete: 'Eximius',     chance: 7.0 },   // 7.0%
  { rarete: 'Rarus',       chance: 14.0 },  // 14.0%
  { rarete: 'Insolitus',   chance: 25.0 },  // 25.0%
  { rarete: 'Vulgaris',    chance: 50.0 }   // 50.0%
];

// Plages de statistiques générées selon la rareté tirée
const RARITY_BASE_STATS = {
  vulgaris:    { min: 1,  max: 3 },
  insolitus:   { min: 2,  max: 5 },
  rarus:       { min: 4,  max: 8 },
  eximius:     { min: 7,  max: 12 },
  legendarius: { min: 11, max: 18 },
  mythicus:    { min: 16, max: 25 },
  arcanus:     { min: 22, max: 35 }
};

function rollRarityFromDropRates() {
  const totalWeight = DROP_RATES.reduce((sum, item) => sum + item.chance, 0);
  let roll = Math.random() * totalWeight;

  for (const entry of DROP_RATES) {
    if (roll < entry.chance) {
      return entry.rarete;
    }
    roll -= entry.chance;
  }

  return 'Vulgaris';
}

function generateStatsForRarity(rarete) {
  const key = (rarete || 'vulgaris').toLowerCase();
  const range = RARITY_BASE_STATS[key] || RARITY_BASE_STATS.vulgaris;
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  return {
    cafe: randInt(range.min, range.max),
    ects: randInt(range.min, range.max)
  };
}

function formatCardNameFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function toPublicImagePath(fullFilePath) {
  const rel = path.relative(BASE_IMAGE_DIR, fullFilePath).split(path.sep).join('/');
  return `/Image_TCG/${rel}`;
}

function readCards() {
  if (!fs.existsSync(CARDS_FILE)) {
    fs.mkdirSync(path.dirname(CARDS_FILE), { recursive: true });
    fs.writeFileSync(CARDS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  const raw = fs.readFileSync(CARDS_FILE, 'utf-8');
  return JSON.parse(raw || '[]');
}

function writeCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
}

function registerNewImageCard(fullFilePath) {
  const ext = path.extname(fullFilePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return;
  if (!fs.existsSync(fullFilePath)) return;

  const publicPath = toPublicImagePath(fullFilePath);
  const cards = readCards();

  const alreadyExists = cards.some(c => c.image === publicPath);
  if (alreadyExists) return;

  const rarete = rollRarityFromDropRates();
  const cardName = formatCardNameFromFilename(fullFilePath);
  const slugBase = cardName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'carte';

  const newCard = {
    id: `${slugBase}_${Date.now().toString(36)}`,
    nom: cardName,
    rarete,
    image: publicPath,
    description: `Carte L2 Info : ${cardName}.`,
    stats: generateStatsForRarity(rarete)
  };

  cards.push(newCard);
  writeCards(cards);
  console.log(`[WATCHER] Nouvelle carte ajoutée : "${newCard.nom}" [${newCard.rarete}] -> ${newCard.image}`);
}

function scanExistingFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanExistingFiles(fullPath);
    } else if (entry.isFile()) {
      registerNewImageCard(fullPath);
    }
  }
}

function startWatcher() {
  if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
  }

  console.log(`[WATCHER] Surveillance active sur : ${WATCH_DIR}`);
  scanExistingFiles(WATCH_DIR);

  const pendingTimers = new Map();

  fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(WATCH_DIR, filename);

    // Debounce de 250 ms pour attendre la fin de l'écriture du fichier sur le disque
    if (pendingTimers.has(fullPath)) {
      clearTimeout(pendingTimers.get(fullPath));
    }

    const timer = setTimeout(() => {
      pendingTimers.delete(fullPath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        registerNewImageCard(fullPath);
      }
    }, 250);

    pendingTimers.set(fullPath, timer);
  });
}

startWatcher();