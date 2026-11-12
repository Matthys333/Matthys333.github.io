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