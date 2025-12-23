const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("DB Connected"))
    .catch(e => console.log("DB Error:", e));

const User = mongoose.model('User', { username: {type: String, unique: true}, password: {type: String} });
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String, owner: String });

// --- AUTH API ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if(!username || !password) return res.status(400).json({m: "Missing fields"});
        const hash = await bcrypt.hash(password, 10);
        await new User({ username, password: hash }).save();
        res.json({ m: "success" });
    } catch (e) { res.status(400).json({ m: "User exists" }); }
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

// --- UI & FRONTEND ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pixel Music Ultra</title>
    <style>
        :root { 
            --deep-purple: #0f051d; 
            --vibrant-purple: #9d50bb; 
            --light-purple: #6e48aa;
            --glass: rgba(255, 255, 255, 0.1);
            --neon: #bf55ec;
        }
        body { 
            background: var(--deep-purple); 
            background: linear-gradient(135deg, #0f051d 0%, #2d1b4e 100%);
            color: white; font-family: 'Poppins', sans-serif; margin: 0; padding-bottom: 120px;
            min-height: 100vh;
        }
        
        /* Glassmorphism Auth */
        #auth-screen { 
            position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;
            background: radial-gradient(circle, #2d1b4e 0%, #0f051d 100%);
        }
        .auth-card {
            background: var(--glass); backdrop-filter: blur(10px); padding: 30px; border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); width: 85%; max-width: 350px; text-align: center;
        }
        .auth-input { 
            width: 100%; padding: 12px; margin: 10px 0; border-radius: 10px; border: none; 
            background: rgba(255,255,255,0.05); color: white; outline: none; box-sizing: border-box;
        }
        .auth-btn { 
            width: 100%; padding: 12px; border-radius: 10px; border: none; 
            background: linear-gradient(to right, var(--vibrant-purple), var(--light-purple));
            color: white; font-weight: bold; margin-top: 15px; cursor: pointer; box-shadow: 0 4px 15px rgba(157, 80, 187, 0.4);
        }

        /* Header & Neon Search */
        .header { padding: 30px 20px; text-align: left; }
        .header h2 { font-size: 28px; margin: 0; background: linear-gradient(to right, #fff, var(--neon)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .search-container { position: sticky; top: 10px; z-index: 100; padding: 0 20px; margin-top: 15px; }
        .search-bar { 
            background: var(--glass); backdrop-filter: blur(15px); padding: 12px 20px; border-radius: 30px; 
            display: flex; align-items: center; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .search-bar input { background: transparent; border: none; color: white; flex: 1; outline: none; font-size: 16px; }

        /* Grid Attraction */
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; }
        .card { 
            background: var(--glass); border-radius: 15px; padding: 12px; border: 1px solid rgba(255,255,255,0.05);
            transition: transform 0.3s ease, box-shadow 0.3s ease; position: relative;
        }
        .card:active { transform: scale(0.95); }
        .card img { width: 100%; border-radius: 12px; box-shadow: 0 10px 20px rgba(0,0,0,0.4); }
        .card b { display: block; font-size: 14px; margin-top: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card .add-lib { 
            position: absolute; top: 8px; right: 8px; background: var(--vibrant-purple); 
            border: none; color: white; border-radius: 50%; width: 30px; height: 30px; font-size: 20px; line-height: 30px;
        }

        /* Floating Player (Spotify Style) */
        .player-bar { 
            position: fixed; bottom: 85px; left: 15px; right: 15px; height: 70px; 
            background: rgba(45, 27, 78, 0.9); backdrop-filter: blur(20px); border-radius: 15px; 
            display: flex; align-items: center; padding: 0 12px; border: 1px solid var(--neon);
            box-shadow: 0 -5px 25px rgba(191, 85, 236, 0.2); z-index: 500;
        }
        .p-img { width: 50px; height: 50px; border-radius: 10px; margin-right: 12px; object-fit: cover; border: 1px solid var(--light-purple); }
        .p-info { flex: 1; overflow: hidden; }
        .p-info b { font-size: 13px; display: block; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p-info span { font-size: 11px; color: var(--text-dim); }
        .p-vid-box { width: 90px; height: 55px; border-radius: 8px; overflow: hidden; }

        /* Bottom Nav */
        .nav-bottom { 
            position: fixed; bottom: 0; width: 100%; height: 75px; 
            background: rgba(15, 5, 29, 0.95); display: flex; justify-content: space-around; align-items: center;
            border-top: 1px solid rgba(255,255,255,0.05); z-index: 600;
        }
        .nav-item { text-align: center; color: #888; font-size: 11px; transition: 0.3s; cursor: pointer; }
        .nav-item.active { color: var(--neon); text-shadow: 0 0 10px var(--neon); }
        .nav-item i { font-size: 24px; display: block; margin-bottom: 4px; }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>

    <div id="auth-screen">
        <div class="auth-card">
            <h1 style="color:var(--vibrant-purple); margin-top:0;">Pixel Music</h1>
            <p style="color:#bbb; font-size:14px;">Purple Private Music Cloud</p>
            <input id="u-id" class="auth-input" placeholder="Enter Username">
            <input id="u-pass" type="password" class="auth-input" placeholder="Enter Password">
            <button class="auth-btn" onclick="auth('login')">LOGIN</button>
            <button class="auth-btn" style="background:none; border:1px solid var(--vibrant-purple); margin-top:10px;" onclick="auth('register')">CREATE ACCOUNT</button>
        </div>
    </div>

    <div class="header">
        <h2>Enjoy Your <br>Vibe 🎧</h2>
    </div>

    <div class="search-container">
        <div class="search-bar">
            <input id="q" placeholder="Search song or artist..." onchange="search()">
            <span onclick="search()">🔍</span>
        </div>
    </div>

    <div id="main-content">
        <h3 style="padding: 20px 20px 0 20px;">Top Hits</h3>
        <div id="grid" class="grid"></div>
    </div>

    <div class="player-bar" id="p-bar" style="display:none">
        <img id="p-img" class="p-img" src="">
        <div class="p-info">
            <b id="p-title">Song Title</b>
            <span id="p-artist">Now Playing</span>
        </div>
        <div class="p-vid-box" id="p-vid"></div>
    </div>

    <div class="nav-bottom">
        <div class="nav-item active" onclick="location.reload()">🏠<br>Home</div>
        <div class="nav-item" onclick="loadLib()">💜<br>Library</div>
        <div class="nav-item" onclick="logout()">🚪<br>Logout</div>
    </div>

    <script>
        let KEY = ""; 
        let USER = localStorage.getItem('pixelUser');
        if(USER) document.getElementById('auth-screen').style.display='none';

        async function init() {
            const r = await fetch('/api/config');
            const d = await r.json(); KEY = d.yt_key;
            fetchSongs("New Bollywood Songs 2024");
        }

        async function auth(type) {
            const u = document.getElementById('u-id').value;
            const p = document.getElementById('u-pass').value;
            if(!u || !p) return alert("Bhai khali mat chhodo!");
            
            const r = await fetch('/api/'+type, { 
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({username:u, password:p}) 
            });
            const d = await r.json();
            
            if(d.m === 'success') {
                alert("Account ban gaya! Ab Login karo.");
            } else if(d.m === 'ok') {
                localStorage.setItem('pixelUser', u);
                location.reload();
            } else {
                alert("Error: " + d.m);
            }
        }

        async function fetchSongs(q) {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+q+'&type=video&maxResults=12&key='+KEY);
            const d = await r.json(); 
            render(d.items, true);
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
                        \${isS ? \`<button class="add-lib" onclick="event.stopPropagation();save('\${vid}','\${t}','\${img}')">+</button>\` : \`<button class="add-lib" style="background:red;" onclick="event.stopPropagation();del('\${vid}')">×</button>\`}
                    </div>\`;
            });
        }

        async function search() { fetchSongs(document.getElementById('q').value); }
        async function save(v,t,i) { 
            await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i, owner:USER})}); 
            alert("Purple Library mein save ho gaya! 💜"); 
        }
        async function loadLib() { 
            document.querySelector('.header h2').innerText="Your Library";
            const r = await fetch('/api/playlist?user='+USER); 
            render(await r.json(), false); 
        }
        async function del(id) { 
            await fetch('/api/playlist/'+id+'?user='+USER, {method:'DELETE'}); 
            loadLib(); 
        }
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
app.listen(PORT, () => console.log("Ultra Purple Live"));
