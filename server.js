const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- DB SETUP ---
mongoose.connect(process.env.MONGODB_URI).catch(e => console.log("DB Error"));

const User = mongoose.model('User', { username: {type: String, unique: true}, password: {type: String} });
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String, owner: String });

// --- AUTH API ---
app.post('/api/register', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await new User({ username: req.body.username, password: hash }).save();
        res.json({ m: "success" });
    } catch (e) { res.status(400).json({ m: "Username exists" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ m: "ok", username: user.username });
    } else { res.status(401).json({ m: "Invalid" }); }
});

// --- MUSIC API ---
app.get('/api/config', (req, res) => res.json({ yt_key: process.env.YOUTUBE_API_KEY }));
app.get('/api/playlist', async (req, res) => res.json(await Song.find({ owner: req.query.user })));
app.post('/api/playlist', async (req, res) => { await new Song(req.body).save(); res.json({ m: "ok" }); });
app.delete('/api/playlist/:id', async (req, res) => { await Song.deleteOne({ videoId: req.params.id, owner: req.query.user }); res.json({ m: "ok" }); });

// --- PWA Support ---
app.get('/manifest.json', (req, res) => res.json({
    "name": "Pixel Music", "short_name": "Pixel", "start_url": "/", "display": "standalone",
    "background_color": "#070707", "theme_color": "#1DB954",
    "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/3844/3844724.png", "sizes": "512x512", "type": "image/png" }]
}));

// --- FRONTEND ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pixel Music</title>
    <link rel="manifest" href="/manifest.json">
    <style>
        :root { --spotify-green: #1DB954; --bg-black: #070707; --card-grey: #121212; --text-dim: #b3b3b3; }
        body { background: var(--bg-black); color: white; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding-bottom: 160px; }
        
        /* Login Overlay */
        #auth-screen { position: fixed; inset: 0; background: var(--bg-black); z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
        .auth-input { width: 100%; max-width: 300px; padding: 12px; margin: 10px 0; border-radius: 5px; border: none; background: #282828; color: white; }
        .auth-btn { width: 100%; max-width: 300px; padding: 12px; border-radius: 25px; border: none; background: var(--spotify-green); color: black; font-weight: bold; margin-top: 10px; }

        /* Mobile Header */
        .header { padding: 20px; background: linear-gradient(to bottom, #222, var(--bg-black)); }
        .search-bar { background: #282828; padding: 10px 15px; border-radius: 20px; display: flex; align-items: center; margin-top: 15px; }
        .search-bar input { background: transparent; border: none; color: white; flex: 1; outline: none; }

        /* Song Grid */
        .section-title { padding: 0 20px; margin-top: 20px; font-size: 22px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding: 20px; }
        .card { background: var(--card-grey); padding: 12px; border-radius: 8px; text-align: left; position: relative; }
        .card img { width: 100%; border-radius: 4px; aspect-ratio: 1/1; object-fit: cover; }
        .card b { display: block; font-size: 13px; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card span { font-size: 11px; color: var(--text-dim); }

        /* Spotify Player Bar (Fixed Bottom) */
        .player-bar { position: fixed; bottom: 70px; left: 10px; right: 10px; height: 60px; background: #282828; border-radius: 8px; display: flex; align-items: center; padding: 0 10px; z-index: 500; }
        .player-bar img { width: 45px; height: 45px; border-radius: 4px; margin-right: 12px; }
        .p-info { flex: 1; overflow: hidden; }
        .p-info b { font-size: 12px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p-info span { font-size: 10px; color: var(--text-dim); }
        .p-video { width: 100px; height: 50px; border-radius: 4px; overflow: hidden; border: 1px solid #444; }

        /* Bottom Nav */
        .nav-bottom { position: fixed; bottom: 0; width: 100%; height: 70px; background: rgba(0,0,0,0.9); display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #222; }
        .nav-item { text-align: center; color: var(--text-dim); font-size: 10px; text-decoration: none; cursor: pointer; }
        .nav-item.active { color: white; }
    </style>
</head>
<body>

    <div id="auth-screen">
        <h1 style="color:var(--spotify-green)">Pixel Music</h1>
        <input id="u-id" class="auth-input" placeholder="Username">
        <input id="u-pass" type="password" class="auth-input" placeholder="Password">
        <button class="auth-btn" onclick="auth('login')">Log In</button>
        <p onclick="auth('register')" style="color:var(--text-dim); font-size:12px; margin-top:15px">New user? Register here</p>
    </div>

    <div class="header">
        <h2>Good Evening</h2>
        <div class="search-bar">
            <span>🔍</span>
            <input id="q" placeholder="Search songs..." onchange="search()">
        </div>
    </div>

    <div id="content">
        <h3 class="section-title" id="sec-title">Recommended</h3>
        <div id="grid" class="grid"></div>
    </div>

    <div class="player-bar" id="p-bar" style="display:none">
        <img id="p-img" src="">
        <div class="p-info">
            <b id="p-title">Song Title</b>
            <span id="p-artist">YouTube Music</span>
        </div>
        <div class="p-video" id="p-vid"></div>
    </div>

    <div class="nav-bottom">
        <div class="nav-item active" onclick="location.reload()">🏠<br>Home</div>
        <div class="nav-item" onclick="loadLib()">📚<br>Library</div>
        <div class="nav-item" onclick="logout()">👤<br>Logout</div>
    </div>

    <script>
        let KEY = ""; let USER = localStorage.getItem('pixelUser');
        if(USER) document.getElementById('auth-screen').style.display='none';

        async function init() {
            const r = await fetch('/api/config');
            const d = await r.json(); KEY = d.yt_key;
            fetchSongs("Lofi hip hop");
        }

        async function auth(type) {
            const u = document.getElementById('u-id').value;
            const p = document.getElementById('u-pass').value;
            const r = await fetch('/api/'+type, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p}) });
            const d = await r.json();
            if(d.m === 'ok' || d.m === 'success') {
                if(type==='login') { localStorage.setItem('pixelUser', u); location.reload(); }
                else alert("Registered! Now Login.");
            } else alert("Error: " + d.m);
        }

        async function fetchSongs(q) {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+q+'&type=video&maxResults=10&key='+KEY);
            const d = await r.json(); render(d.items, true);
        }

        function render(songs, isS) {
            const g = document.getElementById('grid'); g.innerHTML = '';
            songs.forEach(s => {
                const vid = isS ? s.id.videoId : s.videoId;
                const t = (isS ? s.snippet.title : s.title).replace(/'/g,"");
                const img = isS ? s.snippet.thumbnails.medium.url : s.thumbnail;
                g.innerHTML += \`
                    <div class="card" onclick="play('\${vid}', '\${t}', '\${img}')">
                        <img src="\${img}">
                        <b>\${t}</b>
                        <span>YouTube</span>
                        \${isS ? \`<button onclick="event.stopPropagation();save('\${vid}','\${t}','\${img}')" style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.6);border:none;color:white;border-radius:50%;padding:5px">+</button>\`: \`<button onclick="event.stopPropagation();del('\${vid}')" style="position:absolute;top:5px;right:5px;background:red;border:none;color:white;border-radius:50%;width:20px;height:20px">×</button>\`}
                    </div>\`;
            });
        }

        async function search() { fetchSongs(document.getElementById('q').value); }
        async function save(v,t,i) { await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i, owner:USER})}); alert("Saved!"); }
        async function loadLib() { document.getElementById('sec-title').innerText="Your Library"; const r = await fetch('/api/playlist?user='+USER); render(await r.json(), false); }
        async function del(id) { await fetch('/api/playlist/'+id+'?user='+USER, {method:'DELETE'}); loadLib(); }
        function logout() { localStorage.clear(); location.reload(); }

        function play(id, t, img) {
            document.getElementById('p-bar').style.display = 'flex';
            document.getElementById('p-title').innerText = t;
            document.getElementById('p-img').src = img;
            document.getElementById('p-vid').innerHTML = '<iframe width="100%" height="100%" src="https://www.youtube.com/embed/'+id+'?autoplay=1&controls=1" frameborder="0" allow="autoplay"></iframe>';
        }

        init();
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Mobile Spotify Live"));
