const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

/* ================== DB ================== */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("🎧 Pixel Music DB Connected"));

const User = mongoose.model('User', {
  username: { type: String, unique: true },
  password: String,
  likes: Array,
  history: Array
});

/* ================== API ================== */
app.get('/api/config', (req, res) => {
  res.json({ yt: process.env.YOUTUBE_API_KEY });
});

app.post('/api/register', async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10);
  await new User({
    username: req.body.username,
    password: hash,
    likes: [],
    history: []
  }).save();
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const u = await User.findOne({ username: req.body.username });
  if (u && await bcrypt.compare(req.body.password, u.password))
    res.json(u);
  else res.status(401).send();
});

/* ================== FRONTEND ================== */
app.get('/', (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pixel Music</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://www.youtube.com/iframe_api"></script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root{
--green:#1db954;
--bg:#000;
--dark:#121212;
--card:#181818;
--hover:#282828;
--sub:#b3b3b3;
}
body{
margin:0;
background:var(--bg);
color:white;
font-family:Inter;
padding-bottom:170px;
}
.header{padding:30px;font-size:24px;font-weight:700}
.search{
margin:0 20px;
background:#222;
padding:12px;
border-radius:8px;
}
.search input{
width:100%;
background:none;
border:none;
color:white;
font-size:16px;
outline:none;
}

.grid{
display:grid;
grid-template-columns:repeat(2,1fr);
gap:15px;
padding:20px;
}
.card{
background:var(--card);
border-radius:12px;
padding:12px;
cursor:pointer;
transition:.25s;
}
.card:hover{
background:var(--hover);
transform:scale(1.03);
}
.card img{
width:100%;
border-radius:8px;
aspect-ratio:1/1;
object-fit:cover;
}
.card b{
display:block;
margin-top:10px;
font-size:14px;
}

.mini{
position:fixed;
bottom:80px;
left:10px;
right:10px;
height:60px;
background:#2a2a2a;
border-radius:12px;
display:flex;
align-items:center;
padding:10px;
gap:10px;
}
.mini img{
width:40px;
height:40px;
border-radius:6px;
}
.mini .meta{flex:1}
.mini b{font-size:13px}
.mini span{font-size:11px;color:var(--sub)}
.play{
width:34px;height:34px;
border-radius:50%;
background:white;
color:black;
display:flex;
align-items:center;
justify-content:center;
font-size:16px;
}

#full{
position:fixed;
top:100%;
left:0;
width:100%;
height:100%;
background:linear-gradient(to bottom,#355f55,#121212 70%);
transition:.4s;
z-index:999;
padding:25px;
box-sizing:border-box;
}
#full.active{top:0}
.big{
width:100%;
border-radius:12px;
margin-top:40px;
box-shadow:0 25px 70px rgba(0,0,0,.6);
}
.range{width:100%}
#yt{position:absolute;top:-999px}
</style>
</head>

<body>
<div id="yt"></div>

<div class="header">Pixel Music</div>
<div class="search">
<input id="q" placeholder="What do you want to listen to?" onchange="search()">
</div>

<div class="grid" id="grid"></div>

<div class="mini" id="mini" style="display:none" onclick="openFull()">
<img id="mimg">
<div class="meta">
<b id="mtitle"></b>
<span>Pixel Music</span>
</div>
<div class="play" onclick="event.stopPropagation();toggle()">▶</div>
</div>

<div id="full">
<div onclick="closeFull()" style="font-size:30px">⌵</div>
<img id="fimg" class="big">
<h2 id="ftitle"></h2>
<input type="range" id="seek" class="range" value="0" onchange="yt.seekTo(this.value)">
</div>

<script>
let yt,KEY,timer;

function onYouTubeIframeAPIReady(){
yt=new YT.Player('yt',{events:{onReady:init,onStateChange:onState}});
}

async function init(){
const r=await fetch('/api/config');
KEY=(await r.json()).yt;
fetchSongs("Bollywood Lofi");
}

async function fetchSongs(q){
const r=await fetch(
'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q='+q+'&key='+KEY
);
const d=await r.json();
render(d.items);
}

function render(s){
grid.innerHTML='';
s.forEach(x=>{
grid.innerHTML+=\`
<div class="card" onclick="play('\${x.id.videoId}','\${x.snippet.title.replace(/'/g,'')}','\${x.snippet.thumbnails.high.url}')">
<img src="\${x.snippet.thumbnails.high.url}">
<b>\${x.snippet.title.substring(0,30)}</b>
</div>\`;
});
}

function play(id,t,img){
mini.style.display='flex';
mtitle.innerText=ftitle.innerText=t;
mimg.src=fimg.src=img;
yt.loadVideoById(id);
openFull();
}

function toggle(){
yt.getPlayerState()==1?yt.pauseVideo():yt.playVideo();
}

function onState(e){
if(e.data===1){
clearInterval(timer);
seek.max=yt.getDuration();
timer=setInterval(()=>{
seek.value=yt.getCurrentTime();
},1000);
}
}

function search(){fetchSongs(q.value);}
function openFull(){full.classList.add('active')}
function closeFull(){full.classList.remove('active')}
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Pixel Music running")
);
