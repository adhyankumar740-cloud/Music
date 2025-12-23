const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- DB SETUP ---
mongoose.connect(process.env.MONGODB_URI).catch(e => console.log("DB Error"));
const Song = mongoose.model('Song', { 
    title: String, videoId: String, thumbnail: String, userEmail: String 
});

// --- API ---
app.get('/api/config', (req, res) => res.json({ 
    yt_key: process.env.YOUTUBE_API_KEY,
    google_client_id: process.env.GOOGLE_CLIENT_ID // Render mein ye bhi daalna hoga
}));

app.get('/api/playlist', async (req, res) => {
    const email = req.query.email;
    res.json(await Song.find({ userEmail: email }));
});

app.post('/api/playlist', async (req, res) => {
    await new Song(req.body).save();
    res.json({ m: "ok" });
});

// --- PWA ---
app.get('/manifest.json', (req, res) => res.json({
    "name": "Pixel Music", "short_name": "Pixel", "start_url": "/", "display": "standalone",
    "background_color": "#0a0510", "theme_color": "#9d50bb",
    "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/3844/3844724.png", "sizes": "512x512", "type": "image/png" }]
}));

app.get('/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send("self.addEventListener('install', e => self.skipWaiting()); self.addEventListener('fetch', e => e);");
});

// --- FRONTEND ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pixel Spotify</title>
    <link rel="manifest" href="/manifest.json">
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <style>
        :root { --bg: #070707; --purple: #9d50bb; --card: #181818; --text-dim: #b3b3b3; }
        body { background: var(--bg); color: white; font-family: 'Segoe UI', sans-serif; margin: 0; overflow-x: hidden; }
        
        .header { padding: 15px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.5); position: sticky; top: 0; z-index: 100; }
        .hero { background: linear-gradient(to bottom, #4e1b7a, var(--bg)); padding: 40px 20px; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 20px; }
        .card { background: var(--card); padding: 15px; border-radius: 8px; transition: 0.3s; cursor: pointer; position: relative; }
        .card:hover { background: #282828; }
        .card img { width: 100%; border-radius: 5px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        .card b { display: block; margin-top: 10px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card span { color: var(--text-dim); font-size: 12px; }

        /* Spotify Player Bar */
        .player-bar { position: fixed; bottom: 0; width: 100%; height: 90px; background: #000; border-top: 1px solid #282828; display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center; padding: 0 15px; box-sizing: border-box; }
        .now-playing { display: flex; align-items: center; gap: 12px; }
        .now-playing img { width: 55px; height: 55px; border-radius: 4px; display:none; }
        .song-info b { font-size: 14px; display: block; }
        .song-info span { font-size: 11px; color: var(--text-dim); }
        
        .controls { text-align: center; }
        iframe { width: 100%; height: 40px; border:none; }
        
        .search-container { padding: 0 20px; margin-top: -20px; }
        input { background: #333; border: none; padding: 10px 20px; border-radius: 20px; color: white; width: 250px; }
        .hidden { display: none; }
    </style>
</head>
<body>

    <div class="header">
        <h2 style="color:var(--purple)">Pixel Music</h2>
        <div id="g_id_onload" data-client_id="" data-callback="handleLogin"></div>
        <div class="g_id_signin" data-type="standard"></div>
        <div id="user-profile" class="hidden"></div>
    </div>

    <div class="hero" id="hero-section">
        <h1 id="welcome-msg">Good Evening</h1>
        <div class="search-container">
            <input id="q" placeholder="What do you want to listen to?">
            <button onclick="search()" style="background:var(--purple); border:none; color:white; padding:10px; border-radius:50%; cursor:pointer;">🔍</button>
        </div>
    </div>

    <h3 style="padding: 0 20px;">Recommended for you</h3>
    <div id="grid" class="grid"></div>

    <div class="player-bar">
        <div class="now-playing">
            <img id="p-img" src="">
            <div class="song-info">
                <b id="p-title">Select a song</b>
                <span id="p-artist">YouTube Music</span>
            </div>
        </div>
        <div class="controls">
            <div id="player-div"></div>
        </div>
        <div style="text-align: right">
            <button onclick="loadPlaylist()" id="lib-btn" class="hidden" style="background:none; color:white; border:1px solid white; padding:5px 10px; border-radius:15px; cursor:pointer;">Your Library ❤️</button>
        </div>
    </div>

    <script>
        let KEY = ""; let USER = null;

        async function init() {
            const r = await fetch('/api/config');
            const d = await r.json();
            KEY = d.yt_key;
            document.getElementById('g_id_onload').setAttribute('data-client_id', d.google_client_id);
            loadRecommended();
            if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
        }

        // Spotify-style Recommended Songs on start
        async function loadRecommended() {
            const hits = ["Lofi hip hop mix", "Top hits 2024", "Arijit Singh best songs"];
            const randomHit = hits[Math.floor(Math.random() * hits.length)];
            fetchSongs(randomHit);
        }

        async function fetchSongs(query) {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+query+'&type=video&maxResults=10&key='+KEY);
            const d = await r.json();
            render(d.items, true);
        }

        function handleLogin(response) {
            const base64Url = response.credential.split('.')[1];
            USER = JSON.parse(window.atob(base64Url));
            document.getElementById('welcome-msg').innerText = "Hi, " + USER.given_name;
            document.getElementById('lib-btn').classList.remove('hidden');
            document.querySelector('.g_id_signin').classList.add('hidden');
        }

        async function search() {
            fetchSongs(document.getElementById('q').value);
        }

        function render(songs, isS) {
            const g = document.getElementById('grid'); g.innerHTML = '';
            songs.forEach(s => {
                const id = isS ? s.id.videoId : s.videoId;
                const t = (isS ? s.snippet.title : s.title).replace(/'/g,"");
                const img = isS ? s.snippet.thumbnails.medium.url : s.thumbnail;
                g.innerHTML += \`
                    <div class="card" onclick="play('\${id}', '\${t}', '\${img}')">
                        <img src="\${img}">
                        <b>\${t}</b>
                        <span>YouTube Video</span>
                        \${isS && USER ? \`<button onclick="event.stopPropagation();save('\${id}','\${t}','\${img}')" style="position:absolute; bottom:10px; right:10px; background:var(--purple); border:none; border-radius:50%; color:white; width:30px; height:30px;">+</button>\` : ''}
                    </div>\`;
            });
        }

        async function save(v,t,i) {
            await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i, userEmail: USER.email})});
            alert("Added to Library");
        }

        async function loadPlaylist() {
            const r = await fetch('/api/playlist?email=' + USER.email);
            render(await r.json(), false);
        }

        function play(id, t, img) {
            document.getElementById('p-title').innerText = t;
            const pImg = document.getElementById('p-img');
            pImg.src = img; pImg.style.display = 'block';
            document.getElementById('player-div').innerHTML = '<iframe src="https://www.youtube.com/embed/'+id+'?autoplay=1&control=0" allow="autoplay"></iframe>';
        }

        init();
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Spotify Clone Live"));
