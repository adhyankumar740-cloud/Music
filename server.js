const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI).then(() => console.log("System Ready"));

const User = mongoose.model('User', { 
    username: {type: String, unique: true}, 
    password: {type: String},
    preference: String 
});
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String, artist: String, owner: String });

// APIs
app.get('/api/config', (req, res) => res.json({ yt_key: process.env.YOUTUBE_API_KEY }));

app.post('/api/register', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await new User({ username: req.body.username, password: hash, preference: req.body.pref }).save();
        res.json({ m: "success" });
    } catch (e) { res.status(400).json({ m: "Error" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ m: "ok", username: user.username, pref: user.preference });
    } else { res.status(401).json({ m: "Fail" }); }
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
    <title>Pixel Tech Music</title>
    <script src="https://www.youtube.com/iframe_api"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Inter:wght@300;500;700&display=swap');
        :root { --neon: #bc13fe; --bg: #030005; --card: rgba(20, 10, 30, 0.7); }
        body { background: var(--bg); color: white; font-family: 'Inter', sans-serif; margin: 0; overflow-x: hidden; }
        
        /* High Tech UI Elements */
        .neon-text { font-family: 'Orbitron', sans-serif; color: var(--neon); text-shadow: 0 0 10px var(--neon); }
        .glass { background: var(--card); backdrop-filter: blur(15px); border: 1px solid rgba(188, 19, 254, 0.2); border-radius: 20px; }

        /* Auth/Preference Screen */
        #auth { position: fixed; inset: 0; background: var(--bg); z-index: 2000; display: flex; align-items: center; justify-content: center; }
        .auth-box { width: 85%; max-width: 400px; padding: 30px; text-align: center; }
        select, input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 10px; border: 1px solid #333; background: #111; color: white; box-sizing: border-box; }
        .cyber-btn { width: 100%; padding: 15px; border-radius: 10px; border: none; background: var(--neon); color: white; font-family: 'Orbitron'; cursor: pointer; box-shadow: 0 0 15px var(--neon); }

        /* Home Content */
        .top-bar { padding: 25px; display: flex; justify-content: space-between; align-items: center; }
        .search-container { padding: 0 20px; }
        .search-input { width: 100%; padding: 15px 25px; border-radius: 30px; background: var(--card); border: 1px solid #333; color: white; outline: none; }

        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding: 20px; }
        .card { position: relative; overflow: hidden; border-radius: 15px; background: #111; border-bottom: 3px solid var(--neon); }
        .card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; transition: 0.5s; }
        .card-body { padding: 10px; background: linear-gradient(transparent, black); position: absolute; bottom: 0; width: 100%; }
        .card b { font-size: 12px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Full Screen Tech Player */
        #player-ui { position: fixed; top: 100%; left: 0; width: 100%; height: 100%; background: var(--bg); z-index: 1500; transition: 0.6s cubic-bezier(0.19, 1, 0.22, 1); padding: 40px 20px; box-sizing: border-box; text-align: center; }
        #player-ui.active { top: 0; }
        .art-glow { width: 280px; height: 280px; border-radius: 50%; margin: 40px auto; position: relative; box-shadow: 0 0 50px var(--neon); }
        .art-glow img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; animation: rotate 20s linear infinite; }
        
        @keyframes rotate { from {transform: rotate(0deg);} to {transform: rotate(360deg);} }

        /* Real Slider */
        .controls-container { width: 100%; margin-top: 40px; }
        .time-info { display: flex; justify-content: space-between; font-family: 'Orbitron'; font-size: 10px; color: var(--neon); margin-bottom: 10px; }
        #seek-bar { width: 100%; height: 6px; -webkit-appearance: none; background: #222; border-radius: 5px; outline: none; }
        #seek-bar::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; background: var(--neon); border-radius: 50%; cursor: pointer; box-shadow: 0 0 10px var(--neon); }

        /* Hidden YT Video */
        #yt-player-hidden { position: absolute; top: -1000px; left: -1000px; width: 1px; height: 1px; visibility: hidden; }

        .nav-bottom { position: fixed; bottom: 0; width: 100%; height: 70px; background: rgba(0,0,0,0.8); backdrop-filter: blur(10px); display: flex; justify-content: space-around; align-items: center; border-top: 1px solid var(--neon); }
    </style>
</head>
<body>
    <div id="yt-player-hidden"></div>

    <div id="auth">
        <div class="auth-box glass">
            <h1 class="neon-text">PIXEL TECH</h1>
            <div id="login-fields">
                <input id="u" placeholder="USERNAME">
                <input id="p" type="password" placeholder="PASSWORD">
                <select id="pref">
                    <option value="New Bollywood 2024">Bollywood Hits</option>
                    <option value="Lofi Hip Hop Mix">Lofi Vibes</option>
                    <option value="Punjabi Latest">Punjabi Tadka</option>
                    <option value="Arijit Singh Hits">Romantic (Arijit)</option>
                </select>
                <button class="cyber-btn" onclick="auth('login')">INITIALIZE LOGIN</button>
                <p onclick="auth('register')" style="font-size:10px; margin-top:15px; cursor:pointer;">NEW SYSTEM? CREATE ACCOUNT</p>
            </div>
        </div>
    </div>

    <div class="top-bar">
        <h2 class="neon-text">SYSTEM ACTIVE</h2>
        <div style="font-size: 20px;">🎧</div>
    </div>

    <div class="search-container">
        <input class="search-input" id="q" placeholder="ENTER FREQUENCY (SEARCH)..." onchange="search()">
    </div>

    <div id="grid" class="grid"></div>

    <div id="player-ui" class="glass">
        <div onclick="togglePlayer(false)" style="font-size:30px; text-align:left;">✕</div>
        <div class="art-glow">
            <img id="big-img" src="">
        </div>
        <h2 id="big-title" class="neon-text" style="font-size:18px; margin-top:20px;">LOADING...</h2>
        <p id="big-artist" style="color:#888;">ARTIST UNKNOWN</p>

        <div class="controls-container">
            <div class="time-info">
                <span id="current-time">0:00</span>
                <span id="duration">0:00</span>
            </div>
            <input type="range" id="seek-bar" value="0" step="1" onchange="seek(this.value)">
            
            <div style="display:flex; justify-content:center; gap:40px; margin-top:30px; font-size:40px;">
                <span onclick="playPause()" id="play-icon" style="cursor:pointer; color:var(--neon);">⏸</span>
            </div>
        </div>
    </div>

    <div class="nav-bottom">
        <div onclick="location.reload()" style="color:var(--neon)">🏠</div>
        <div onclick="loadLib()">📁</div>
        <div onclick="logout()">⚙️</div>
    </div>

    <script>
        let ytPlayer;
        let KEY = "";
        let USER = localStorage.getItem('pixelUser');
        let PREF = localStorage.getItem('pixelPref') || "Top Hits";

        if(USER) document.getElementById('auth').style.display='none';

        // Initialize YouTube Player Hidden
        function onYouTubeIframeAPIReady() {
            ytPlayer = new YT.Player('yt-player-hidden', {
                events: {
                    'onStateChange': onPlayerStateChange,
                    'onReady': onPlayerReady
                }
            });
        }

        async function onPlayerReady() {
            const r = await fetch('/api/config');
            const d = await r.json(); KEY = d.yt_key;
            fetchSongs(PREF);
        }

        async function auth(type) {
            const u = document.getElementById('u').value, p = document.getElementById('p').value, pr = document.getElementById('pref').value;
            const r = await fetch('/api/'+type, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p, pref:pr}) });
            if(r.ok) { 
                if(type==='login') { 
                    const d = await r.json();
                    localStorage.setItem('pixelUser', d.username); 
                    localStorage.setItem('pixelPref', d.pref); 
                    location.reload(); 
                } else alert("Reg Successful!");
            }
        }

        async function fetchSongs(q) {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+q+'&type=video&maxResults=20&key='+KEY);
            const d = await r.json(); render(d.items, true);
        }

        function render(songs, isS) {
            const g = document.getElementById('grid'); g.innerHTML = '';
            songs.forEach(s => {
                const vid = isS ? s.id.videoId : s.videoId;
                const t = (isS ? s.snippet.title : s.title).replace(/'/g,"");
                const img = isS ? s.snippet.thumbnails.medium.url : s.thumbnail;
                const art = isS ? s.snippet.channelTitle : (s.artist || "System");
                g.innerHTML += \`
                    <div class="card" onclick="openPlayer('\${vid}', '\${t}', '\${img}', '\${art}')">
                        <img src="\${img}">
                        <div class="card-body">
                            <b>\${t}</b>
                            \${isS ? \`<button onclick="event.stopPropagation();save('\${vid}','\${t}','\${img}','\${art}')" style="background:var(--neon); border:none; color:white; border-radius:50%; position:absolute; right:10px; top:10px;">+</button>\`:''}
                        </div>
                    </div>\`;
            });
        }

        function openPlayer(id, t, img, art) {
            document.getElementById('player-ui').classList.add('active');
            document.getElementById('big-img').src = img;
            document.getElementById('big-title').innerText = t;
            document.getElementById('big-artist').innerText = art;
            ytPlayer.loadVideoById(id);
        }

        function togglePlayer(show) { document.getElementById('player-ui').classList.toggle('active', show); }

        // Real Slider Logic
        function onPlayerStateChange(event) {
            if (event.data == YT.PlayerState.PLAYING) {
                const duration = ytPlayer.getDuration();
                document.getElementById('duration').innerText = formatTime(duration);
                document.getElementById('seek-bar').max = duration;
                setInterval(updateProgress, 1000);
            }
        }

        function updateProgress() {
            const current = ytPlayer.getCurrentTime();
            document.getElementById('current-time').innerText = formatTime(current);
            document.getElementById('seek-bar').value = current;
        }

        function seek(val) { ytPlayer.seekTo(val, true); }

        function formatTime(s) {
            let m = Math.floor(s / 60);
            s = Math.floor(s % 60);
            return m + ":" + (s < 10 ? '0' + s : s);
        }

        function playPause() {
            const state = ytPlayer.getPlayerState();
            if(state == 1) { ytPlayer.pauseVideo(); document.getElementById('play-icon').innerText = '▶'; }
            else { ytPlayer.playVideo(); document.getElementById('play-icon').innerText = '⏸'; }
        }

        async function save(v,t,i,a) { await fetch('/api/playlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoId:v,title:t,thumbnail:i, artist:a, owner:USER})}); }
        async function loadLib() { const r = await fetch('/api/playlist?user='+USER); render(await r.json(), false); }
        async function search() { fetchSongs(document.getElementById('q').value); }
        function logout() { localStorage.clear(); location.reload(); }
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT);
