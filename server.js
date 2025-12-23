const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI).then(() => console.log("Spotify Clone Ready"));

const User = mongoose.model('User', { username: {type: String, unique: true}, password: {type: String}, pref: String });
const Song = mongoose.model('Song', { title: String, videoId: String, thumbnail: String, artist: String, owner: String });

app.get('/api/config', (req, res) => res.json({ yt_key: process.env.YOUTUBE_API_KEY }));
app.post('/api/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await new User({ username: req.body.username, password: hash, pref: req.body.pref }).save();
    res.json({ m: "success" });
});
app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) res.json({ m: "ok", username: user.username, pref: user.pref });
    else res.status(401).send();
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pixel Spotify</title>
    <script src="https://www.youtube.com/iframe_api"></script>
    <style>
        :root { --sp-green: #1DB954; --sp-black: #121212; --sp-card: #181818; --sp-player: #5c1a1a; }
        body { background: #000; color: white; font-family: 'Circular Std', sans-serif, Arial; margin: 0; padding-bottom: 180px; }
        
        .header { padding: 40px 20px 20px; font-size: 24px; font-weight: bold; }
        .search-box { margin: 0 20px; background: #242424; padding: 12px; border-radius: 8px; display: flex; align-items: center; color: #b3b3b3; }
        .search-box input { background: transparent; border: none; color: white; width: 100%; outline: none; margin-left: 10px; }

        /* Screenshot style Grid - Discover Section */
        .section-label { padding: 25px 20px 10px; font-size: 18px; font-weight: bold; }
        .discover-grid { 
            display: grid; 
            grid-template-columns: repeat(2, 1fr); 
            grid-template-rows: repeat(4, 180px); /* 4 rows as requested */
            gap: 15px; padding: 0 20px; 
        }
        .discover-card { 
            background: linear-gradient(to bottom, #333, #181818); 
            border-radius: 12px; overflow: hidden; position: relative;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }
        .discover-card img { width: 100%; height: 100%; object-fit: cover; opacity: 0.8; }
        .discover-card .tag { position: absolute; bottom: 10px; left: 10px; font-weight: bold; font-size: 14px; text-shadow: 2px 2px 4px #000; }

        /* Native Player Bar - Screenshot Clone */
        .native-player { 
            position: fixed; bottom: 80px; left: 8px; right: 8px; 
            background: var(--sp-player); border-radius: 10px; height: 65px;
            display: flex; align-items: center; padding: 0 12px; z-index: 1000;
        }
        .native-player img { width: 45px; height: 45px; border-radius: 6px; margin-right: 12px; }
        .song-meta { flex: 1; overflow: hidden; }
        .song-meta b { font-size: 13px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .song-meta span { font-size: 11px; color: #ccc; }
        .p-controls { display: flex; align-items: center; gap: 15px; }
        .play-btn { font-size: 24px; color: white; cursor: pointer; }

        /* Full Screen UI - Screenshot 2 Clone */
        #full-player { 
            position: fixed; top: 100%; left: 0; width: 100%; height: 100%; 
            background: linear-gradient(to bottom, #2a4d46, #121212); 
            z-index: 2000; transition: 0.5s ease; padding: 40px 25px; box-sizing: border-box;
        }
        #full-player.active { top: 0; }
        .big-art { width: 100%; aspect-ratio: 1/1; border-radius: 10px; margin-top: 40px; box-shadow: 0 15px 50px rgba(0,0,0,0.5); }
        .seek-container { width: 100%; margin-top: 50px; }
        input[type=range] { width: 100%; accent-color: white; }
        
        #yt-hidden { position: absolute; top: -1000px; visibility: hidden; }

        /* Bottom Nav */
        .nav-bar { position: fixed; bottom: 0; width: 100%; height: 75px; background: rgba(0,0,0,0.95); display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #222; }
    </style>
</head>
<body>
    <div id="yt-hidden"></div>

    <div class="header">Search</div>
    <div class="search-box">🔍 <input id="q" placeholder="What do you want to listen to?" onchange="search()"></div>

    <div class="section-label">Discover something new</div>
    <div class="discover-grid" id="grid">
        </div>

    <div class="native-player" id="mini-player" onclick="toggleFull(true)" style="display:none">
        <img id="m-img" src="">
        <div class="song-meta">
            <b id="m-title">Song Name</b>
            <span id="m-artist">Artist Name</span>
        </div>
        <div class="p-controls">
            <span style="font-size:20px">🎧</span>
            <span style="font-size:20px">+</span>
            <span class="play-btn" onclick="event.stopPropagation(); playPause()">⏸</span>
        </div>
    </div>

    <div id="full-player">
        <div onclick="toggleFull(false)" style="font-size:30px">⌵</div>
        <img id="f-img" class="big-art" src="">
        <div style="margin-top:30px">
            <h2 id="f-title" style="margin:0">Song Title</h2>
            <p id="f-artist" style="color:#b3b3b3">Artist Name</p>
        </div>
        <div class="seek-container">
            <input type="range" id="seek" value="0" step="1" onchange="seekTo(this.value)">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px">
                <span id="cur">0:00</span><span id="dur">0:00</span>
            </div>
        </div>
        <div style="display:flex; justify-content:space-around; align-items:center; margin-top:40px">
            <span style="font-size:30px">🔀</span>
            <span style="font-size:40px">⏮</span>
            <span style="font-size:70px" onclick="playPause()">⏸</span>
            <span style="font-size:40px">⏭</span>
            <span style="font-size:30px">🔁</span>
        </div>
    </div>

    <div class="nav-bar">
        <div onclick="location.reload()">🏠<br><small>Home</small></div>
        <div onclick="search()">🔍<br><small>Search</small></div>
        <div onclick="loadLib()">📚<br><small>Library</small></div>
    </div>

    <script>
        let yt; let KEY = ""; let USER = localStorage.getItem('pixelUser');
        function onYouTubeIframeAPIReady() {
            yt = new YT.Player('yt-hidden', { events: { 'onReady': init, 'onStateChange': onState } });
        }

        async function init() {
            const r = await fetch('/api/config'); const d = await r.json(); KEY = d.yt_key;
            fetchSongs("Bollywood LoFi 2024");
        }

        async function fetchSongs(q) {
            const r = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&q='+q+'&type=video&maxResults=8&key='+KEY);
            const d = await r.json(); render(d.items);
        }

        function render(songs) {
            const g = document.getElementById('grid'); g.innerHTML = '';
            songs.forEach(s => {
                const vid = s.id.videoId; const t = s.snippet.title; const img = s.snippet.thumbnails.high.url;
                g.innerHTML += \`
                <div class="discover-card" onclick="play('\${vid}','\${t.replace(/'/g,"")}','\${img}')">
                    <img src="\${img}">
                    <div class="tag">\${t.substring(0,20)}...</div>
                </div>\`;
            });
        }

        function play(id, t, img) {
            document.getElementById('mini-player').style.display = 'flex';
            document.getElementById('m-title').innerText = document.getElementById('f-title').innerText = t;
            document.getElementById('m-img').src = document.getElementById('f-img').src = img;
            yt.loadVideoById(id);
            toggleFull(true);
        }

        function onState(e) {
            if(e.data == 1) {
                document.getElementById('dur').innerText = format(yt.getDuration());
                document.getElementById('seek').max = yt.getDuration();
                setInterval(() => {
                    document.getElementById('cur').innerText = format(yt.getCurrentTime());
                    document.getElementById('seek').value = yt.getCurrentTime();
                }, 1000);
            }
        }

        function format(s) { let m = Math.floor(s/60); s = Math.floor(s%60); return m+":"+(s<10?'0'+s:s); }
        function toggleFull(s) { document.getElementById('full-player').classList.toggle('active', s); }
        function playPause() { yt.getPlayerState() == 1 ? yt.pauseVideo() : yt.playVideo(); }
        function seekTo(v) { yt.seekTo(v); }
        function search() { fetchSongs(document.getElementById('q').value); }
    </script>
</body>
</html>
    `);
});

app.listen(process.env.PORT || 5000);
