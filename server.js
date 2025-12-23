const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI).then(() => console.log("DB OK"));

const User = mongoose.model('User', { username: {type: String, unique: true}, password: {type: String} });
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String, artist: String, owner: String });

app.get('/api/config', (req, res) => res.json({ yt_key: process.env.YOUTUBE_API_KEY }));

app.post('/api/register', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await new User({ username: req.body.username, password: hash }).save();
        res.json({ m: "success" });
    } catch (e) { res.status(400).json({ m: "error" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ m: "ok", username: user.username });
    } else { res.status(401).json({ m: "Invalid" }); }
});

app.get('/api/playlist', async (req, res) => res.json(await Song.find({ owner: req.query.user })));
app.post('/api/playlist', async (req, res) => { await new Song(req.body).save(); res.json({ m: "ok" }); });

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pixel Pro Music</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
        :root { --p: #9d50bb; --bg: #050208; --g: rgba(255,255,255,0.08); }
        body { background: var(--bg); color: white; font-family: 'Montserrat', sans-serif; margin: 0; overflow-x: hidden; }
        
        /* Premium Background */
        .bg-glow { position: fixed; top: -10%; left: -10%; width: 50%; height: 50%; background: radial-gradient(circle, rgba(157,80,187,0.2) 0%, transparent 70%); z-index: -1; }

        /* Auth Screen */
        #auth { position: fixed; inset: 0; background: var(--bg); z-index: 2000; display: flex; align-items: center; justify-content: center; }
        .auth-card { background: var(--g); backdrop-filter: blur(20px); padding: 40px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); width: 80%; text-align: center; }
        input { width: 100%; padding: 15px; margin: 10px 0; border-radius: 12px; border: none; background: #1a1a1a; color: white; box-sizing: border-box; }
        .btn { width: 100%; padding: 15px; border-radius: 30px; border: none; background: var(--p); color: white; font-weight: bold; cursor: pointer; margin-top: 10px; }

        /* Home UI */
        .header { padding: 30px 20px; }
        .search-area { padding: 0 20px; position: sticky; top: 10px; z-index: 100; }
        .search-box { background: var(--g); backdrop-filter: blur(10px); padding: 12px 20px; border-radius: 50px; display: flex; align-items: center; border: 1px solid rgba(255,255,255,0.1); }
        .search-box input { background: transparent; margin: 0; padding: 0; }

        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; }
        .card { background: var(--g); border-radius: 20px; padding: 10px; transition: 0.3s; position: relative; }
        .card img { width: 100%; border-radius: 15px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); }
        .card b { display: block; margin-top: 10px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card span { font-size: 10px; color: #aaa; }

        /* Full Screen Player (Spotify Style) */
        #player-screen { 
            position: fixed; top: 100%; left: 0; width: 100%; height: 100%; 
            background: linear-gradient(to bottom, #2d1b4e, var(--bg)); 
            transition: 0.5s ease-in-out; z-index: 1500; display: flex; flex-direction: column; align-items: center; padding: 40px 20px; box-sizing: border-box;
        }
        #player-screen.active { top: 0; }
        .close-player { position: absolute; top: 20px; left: 20px; font-size: 30px; cursor: pointer; }
        .p-big-img { width: 90%; aspect-ratio: 1/1; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); margin-top: 40px; }
        .p-details { width: 100%; margin-top: 30px; }
        .p-details h2 { margin: 0; font-size: 24px; }
        .p-details p { color: #aaa; margin: 5px 0; }
        
        /* Slider (Seek Bar) */
        .slider-container { width: 100%; margin-top: 30px; }
        .slider { width: 100%; height: 5px; background: #444; border-radius: 5px; position: relative; }
        .progress { width: 40%; height: 100%; background: var(--p); border-radius: 5px; position: relative; }
        .progress::after { content: ''; position: absolute; right: -5px; top: -4px; width: 12px; height: 12px; background: white; border-radius: 50%; }

        /* Video/Audio box */
        .vid-frame { width: 100%; height: 200px; margin-top: 20px; border-radius: 15px; overflow: hidden; border: 1px solid var(--p); }

        /* Bottom Tab Nav */
        .nav { position: fixed; bottom: 0; width: 100%; height: 70px; background: rgba(0,0,0,0.9); display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #222; }
    </style>
</head>
<body>
    <div class="bg-glow"></div>

    <div id="auth">
        <div class="auth-card">
            <h1 style="color:var(--p)">Pixel Pro</h1>
            <input id="u" placeholder="Username">
            <input id="p" type="password" placeholder="Password">
            <button class="btn" onclick="login()">Log In</button>
            <p style="font-size:12px; color:#888" onclick="reg()">Don't have an account? Register</p>
        </div>
    </div>

    <div class="header"><h2>Discover <span style="color:var(--p)">Music</span></h2></div>
    <div class="search-area"><div class="search-box"><input id="q" placeholder="Search Artists, Songs..." onchange="search()"></div></div>
    <div id="grid" class="grid"></div>

    <div id="player-screen">
        <div class="close-player" onclick="togglePlayer(false)">↓</div>
        <img id="big-img" class="p-big-img" src="">
        <div class="p-details">
            <h2 id="big-title">Song Title</h2>
            <p id="big-artist">Artist Name</p>
        </div>
        <div class="slider-container">
            <div class="slider"><div class="progress"></div></div>
            <div style="display:flex; justify-content:space-between; font-size:10px; margin-top:8px; color:#666"><span>1:24</span><span>3:45</span></div>
        </div>
        <div id="video-dest" class="vid-frame"></div>
    </div>

    <div class="nav">
        <div onclick="location.reload()">🏠<br><small>Home</small></div>
        <div onclick="loadLib()">💜<br><small>Library</small></div>
        <div onclick="logout()">🚪<br><small>Exit</small></div>
    </div>

    <script>
        let KEY = ""; let USER = localStorage.getItem('pixelUser');
        if(USER) document.getElementById('auth').style.display='none';

        async function init() {
            const r = await fetch('/api/config');
            const d = await r.json(); KEY = d.yt_key;
            fetchSongs("Top Hits 2024");
        }

        async function login() {
            const u = document.getElementById('u').value, p = document.getElementById('p').value;
            const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p}) });
            if(r.ok) { localStorage.setItem('pixelUser', u); location.reload(); } else alert("Error");
        }
        async function reg() {
            const u = document.getElementById('u').value, p = document.getElementById('p').value;
            await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p}) });
            alert("Account Created!");
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
                const art = isS ? s.snippet.channelTitle : (s.artist || "Unknown");
                g.innerHTML += \`
                    <div class="card" onclick="openPlayer('\${vid}', '\${t}', '\${img}', '\${art}')">
                        <img src="\${img}">
                        <b>\${t}</b>
                        <span>\${art}</span>
                        \${isS ? \`<button onclick="event.stopPropagation();save('\${vid}','\${t}','\${img}','\${art}')" style="position:absolute;top:5px;right:5px;background:var(--p);border:none;color:white;border-radius:50%;">+</button>\`:''}
                    </div>\`;
            });
        }

        function togglePlayer(show) { document.getElementById('player-screen').classList.toggle('active', show); }

        function openPlayer(id, t, img, art) {
            togglePlayer(true);
            document.getElementById('big-img').src = img;
            document.getElementById('big-title').innerText = t;
            document.getElementById('big-artist').innerText = art;
            document.getElementById('video-dest').innerHTML = '<iframe width="100%" height="100%" src="https://www.youtube.com/embed/'+id+'?autoplay=1" frameborder="0" allow="autoplay"></iframe>';
        }

        async function save(v,t,i,a) {
            await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i, artist:a, owner:USER})});
            alert("Added!");
        }

        async function search() { fetchSongs(document.getElementById('q').value); }
        async function loadLib() { const r = await fetch('/api/playlist?user='+USER); render(await r.json(), false); }
        function logout() { localStorage.clear(); location.reload(); }
        init();
    </script>
</body>
</html>
    `);
});

app.listen(process.env.PORT || 5000);
