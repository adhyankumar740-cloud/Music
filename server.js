const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Render ke Dashboard se ye values uthayi jayengi
const MONGO_URI = process.env.MONGODB_URI;
const YT_API_KEY = process.env.YOUTUBE_API_KEY;

mongoose.connect(MONGO_URI)
  .then(() => console.log("DB Connected Successfully"))
  .catch(err => console.log("DB Connection Error:", err));

const Song = mongoose.model('Song', {
    title: String,
    videoId: String,
    thumbnail: String
});

app.get('/api/config', (req, res) => {
    res.json({ yt_key: YT_API_KEY });
});

app.post('/api/playlist', async (req, res) => {
    try {
        const song = new Song(req.body);
        await song.save();
        res.json({ message: "Saved" });
    } catch (e) { res.status(500).json(e); }
});

app.get('/api/playlist', async (req, res) => {
    const songs = await Song.find();
    res.json(songs);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running!`));
