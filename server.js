const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE SETUP ---
mongoose.connect(process.env.MONGODB_URI).catch(e => console.log("DB Error"));
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String });

// --- API ENDPOINTS ---
app.get('/api/config', (req, res) => res.json({ yt_key: process.env.YOUTUBE_API_KEY }));
app.get('/api/playlist', async (req, res) => res.json(await Song.find()));
app.post('/api/playlist', async (req, res) => { await new Song(req.body).save(); res.json({ m: "ok" }); });
app.delete('/api/playlist/:id', async (req, res) => { await Song.deleteOne({ videoId: req.params.id }); res.json({ m: "ok" }); });

// --- PWA FILES (Generating on the fly) ---
app.get('/manifest.json', (req, res) => {
    res.json({
        "name": "Pixel Music", "short_name": "Pixel", "start_url": "/", "display": "standalone",
        "background_color": "#0a0510", "theme_color": "#9d50bb",
        "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/3844/3844724.png", "sizes": "192x192", "type": "image/png" }]
    });
});

app.get('/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send("self.addEventListener('install', e => console.log('SW Installed')); self.addEventListener('fetch', e => e);");
});

// --- FRONTEND (HTML) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pixel Music</title>
    <link rel="manifest" href="/manifest.json">
    <style>
        :root { --bg: #0a0510; --purple: #9d50bb; --card: #1a0b2e; }
        body { background: var(--bg); color: white; font-family: sans-serif; margin: 0; padding-bottom: 100px; }
        .nav { background: #000; padding: 15px; display: flex; justify-content: space-between; position: sticky; top: 0; z-index: 10; }
        .main { padding: 15px; background: linear-gradient(to bottom, #2d1b4e, #0a0510); min-height: 100vh; }
        .search-box { display: flex; gap: 8px; margin-bottom: 20px; }
        input { flex: 1; padding: 12px; border-radius: 20px; border: none; background: #222; color: white; }
        .btn { background: var(--purple); color: white; border: none; padding: 10px 15px; border-radius: 20px; cursor: pointer; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
        .card { background: var(--card); padding: 10px; border-radius: 10px; position: relative; }
        .card img { width: 100%; border-radius: 8px; }
        .card p { font-size: 11px; margin: 5px 0; height: 30px; overflow: hidden; }
        .player { position: fixed; bottom: 0; width: 100%; height: 80px; background: #111; display: flex; align-items: center; padding: 10px; box-sizing: border-box; border-top: 2px solid var(--purple); }
        iframe { width: 120px; height: 60px; border-radius: 5px; margin-left: auto; }
        .del { position: absolute; top: 5px; right: 5px; background: red; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="nav"> <b>Pixel Music 🎧</b> <span onclick="loadLib()">⭐ Library</span> </div>
    <div class="main">
        <div id="s-area" class="search-box">
            <input id="q" placeholder="Search Music..."> <button class="btn" onclick="search()">Search</button>
        </div>
        <div id="grid" class="grid"></div>
    </div>
    <div class="player"> <div id="info" style="font-size:12px; width:60%">Ready</div> <div id="play"></div> </div>

    <script>
        let KEY = "";
        async function init() { 
            const r = await fetch('/api/config'); const d = await r.json(); KEY = d.yt_key; 
            if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
        }
        init();

        async function search() {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+document.getElementById('q').value+'&type=video&maxResults=12&key='+KEY);
            const d = await r.json(); render(d.items, true);
        }

        function render(songs, isS) {
            const g = document.getElementById('grid'); g.innerHTML = '';
            songs.forEach(s => {
                const id = isS ? s.id.videoId : s.videoId;
                const t = (isS ? s.snippet.title : s.title).replace(/'/g,"");
                const img = isS ? s.snippet.thumbnails.medium.url : s.thumbnail;
                g.innerHTML += '<div class="card">' + (!isS ? '<button class="del" onclick="del(\\''+id+'\\')">×</button>' : '') + 
                    '<img src="'+img+'" onclick="play(\\''+id+'\\',\\''+t+'\\')"><p>'+t+'</p>' + 
                    (isS ? '<button class="btn" style="width:100%;font-size:10px" onclick="save(\\''+id+'\\',\\''+t+'\\',\\''+img+'\\')">Add ❤️</button>' : '') + '</div>';
            });
        }

        async function save(v,t,i) { await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i})}); alert("Saved!"); }
        async function loadLib() { const r = await fetch('/api/playlist'); render(await r.json(), false); }
        async function del(id) { if(confirm("Delete?")) { await fetch('/api/playlist/'+id, {method:'DELETE'}); loadLib(); } }
        function play(id,t) { document.getElementById('info').innerText = t; document.getElementById('play').innerHTML = '<iframe src="https://www.youtube.com/embed/'+id+'?autoplay=1" frameborder="0" allow="autoplay"></iframe>'; }
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Running"));
