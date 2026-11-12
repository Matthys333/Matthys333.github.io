const fs = require('fs');
const path = require('path');

const CARDS_DIR = path.join(__dirname, 'Image_TCG', 'cards');
const CARDS_JSON_PATH = path.join(__dirname, 'data', 'cards.json');

if (!fs.existsSync(CARDS_DIR)) {
    fs.mkdirSync(CARDS_DIR, { recursive: true });
}

function syncImagesToCards() {
    let cards = [];
    if (fs.existsSync(CARDS_JSON_PATH)) {
        try {
            const data = fs.readFileSync(CARDS_JSON_PATH, 'utf-8');
            cards = JSON.parse(data || '[]');
        } catch (e) {
            cards = [];
        }
    }

    const files = fs.readdirSync(CARDS_DIR);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const imageFiles = files.filter(file => imageExtensions.includes(path.extname(file).toLowerCase()));

    let modified = false;

    // 1. Supprimer les cartes dont l'image n'existe plus dans le dossier
    const initialLength = cards.length;
    cards = cards.filter(card => {
        if (!card.image) return false;
        // Extrait le nom du fichier depuis le chemin de la carte (ex: /Image_TCG/cards/Dyclane.png -> Dyclane.png)
        const fileName = path.basename(card.image);
        const existsOnDisk = imageFiles.includes(fileName);
        if (!existsOnDisk) {
            console.log(`[SYNC] Image supprimée du dossier, suppression de la carte : ${card.nom || fileName}`);
        }
        return existsOnDisk;
    });

    if (cards.length !== initialLength) {
        modified = true;
    }

    // 2. Ajouter les nouvelles images détectées
    imageFiles.forEach(imgFile => {
        const imagePathRoute = `/Image_TCG/cards/${imgFile}`;
        const existsInCards = cards.some(card => card.image === imagePathRoute || (card.image && card.image.endsWith(imgFile)));

        if (!existsInCards) {
            const baseName = path.basename(imgFile, path.extname(imgFile));

            const newCard = {
                id: `card_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                nom: baseName,
                role: "",
                rarete: "Commun",
                rangApparition: cards.length + 1,
                image: imagePathRoute,
                stats: {
                    cafe: 0,
                    ects: 0
                },
                description: ""
            };

            cards.push(newCard);
            modified = true;
            console.log(`[SYNC] Nouvelle carte créée pour l'image : ${imgFile}`);
        }
    });

    if (modified) {
        fs.writeFileSync(CARDS_JSON_PATH, JSON.stringify(cards, null, 4), 'utf-8');
        console.log('[SYNC] Fichier cards.json mis à jour.');
    }
}

syncImagesToCards();

fs.watch(CARDS_DIR, (eventType, filename) => {
    if (filename) {
        syncImagesToCards();
    }
});

console.log(`[WATCHER] Surveillance active sur le dossier : ${CARDS_DIR}`);