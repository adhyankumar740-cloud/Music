const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());

/* ================= JAM STATE ================= */
const rooms = {}; 
// roomId -> { videoId, time, playing }

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.on("join-jam", room => {
    socket.join(room);
    if (rooms[room]) socket.emit("jam-sync", rooms[room]);
  });

  socket.on("jam-play", data => {
    rooms[data.room] = {
      videoId: data.videoId,
      time: data.time,
      playing: true
    };
    socket.to(data.room).emit("jam-play", rooms[data.room]);
  });

  socket.on("jam-pause", room => {
    if (rooms[room]) rooms[room].playing = false;
    socket.to(room).emit("jam-pause");
  });

  socket.on("jam-seek", data => {
    if (rooms[data.room]) rooms[data.room].time = data.time;
    socket.to(data.room).emit("jam-seek", data.time);
  });

});

/* ================= API ================= */
app.get("/api/config", (req, res) => {
  res.json({ yt: process.env.YOUTUBE_API_KEY });
});

/* ================= FRONTEND ================= */
app.get("/", (req, res) => {
res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel Music</title>
<script src="/socket.io/socket.io.js"></script>
<script src="https://www.youtube.com/iframe_api"></script>

<style>
body{
margin:0;
font-family:Inter,system-ui;
background:linear-gradient(180deg,#2b0a5a,#0a0014);
color:white;
padding-bottom:160px;
}
.header{padding:22px;font-size:22px;font-weight:700}
.search{margin:0 20px;background:#1a0033;padding:12px;border-radius:12px}
.search input{width:100%;background:none;border:none;color:white;font-size:16px}
.section{padding:20px;font-size:18px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:0 20px}
.card{background:#3a1370;padding:12px;border-radius:14px}
.card img{width:100%;border-radius:10px}
.card b{display:block;margin-top:8px;font-size:14px}
.mini{
position:fixed;bottom:80px;left:12px;right:12px;
background:linear-gradient(90deg,#6d2cff,#9a6bff);
border-radius:14px;padding:10px;
display:flex;align-items:center;gap:12px
}
.mini img{width:42px;height:42px;border-radius:8px}
.play{width:36px;height:36px;background:white;color:black;
border-radius:50%;display:flex;align-items:center;justify-content:center}
#full{
position:fixed;top:100%;left:0;width:100%;height:100%;
background:linear-gradient(180deg,#7b2cff,#12001f 70%);
transition:.4s;padding:24px
}
#full.active{top:0}
.big{width:100%;border-radius:16px;margin-top:40px}
.nav{
position:fixed;bottom:0;width:100%;height:70px;
background:#0b0018;display:flex;justify-content:space-around;align-items:center
}
#yt{position:absolute;top:-999px}
</style>
</head>

<body>
<div id="yt"></div>

<div class="header">Pixel Music</div>
<div class="search"><input id="q" placeholder="Search music" onchange="search()"></div>

<div class="section">🔥 Trending</div>
<div class="grid" id="grid"></div>

<div class="section">🎧 Chill</div>
<div class="grid" id="grid2"></div>

<div class="mini" id="mini" style="display:none" onclick="openFull()">
<img id="mimg"><div><b id="mtitle"></b></div>
<div class="play" onclick="event.stopPropagation();toggle()">⏸</div>
<div onclick="toggleJam()">🎧</div>
</div>

<div id="full">
<div onclick="closeFull()" style="font-size:28px">⌵</div>
<img id="fimg" class="big">
<h2 id="ftitle"></h2>
<input type="range" id="seek" style="width:100%">
</div>

<div class="nav">
<div>🏠</div><div>🔍</div><div>🎶</div>
</div>

<script>
let yt,KEY,timer,queue=[],index=0;
let socket=io(),JAM=false,ROOM=null;

function onYouTubeIframeAPIReady(){
yt=new YT.Player("yt",{events:{onReady:init,onStateChange:onState}});
}

async function init(){
KEY=(await (await fetch("/api/config")).json()).yt;
fetchSongs("Bollywood Lofi",grid);
fetchSongs("Chill Hindi Songs",grid2);
}

async function fetchSongs(q,el){
const r=await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&q="+q+"&key="+KEY);
const d=await r.json(); el.innerHTML="";
d.items.forEach(x=>{
el.innerHTML+=\`
<div class="card" onclick="play('\${x.id.videoId}','\${x.snippet.title}','\${x.snippet.thumbnails.high.url}')">
<img src="\${x.snippet.thumbnails.high.url}">
<b>\${x.snippet.title.slice(0,28)}</b>
</div>\`;
queue.push(x.id.videoId);
});
}

function play(id,t,img){
mini.style.display="flex";
mtitle.innerText=ftitle.innerText=t;
mimg.src=fimg.src=img;
yt.loadVideoById(id);
if(JAM) socket.emit("jam-play",{room:ROOM,videoId:id,time:0});
}

function toggle(){
yt.getPlayerState()==1?yt.pauseVideo():yt.playVideo();
if(JAM) socket.emit("jam-pause",ROOM);
}

function onState(e){
if(e.data===1){
seek.max=yt.getDuration();
clearInterval(timer);
timer=setInterval(()=>seek.value=yt.getCurrentTime(),1000);
}
if(e.data===0){ // autoplay next
index=(index+1)%queue.length;
yt.loadVideoById(queue[index]);
}
}

seek.onchange=()=>{
yt.seekTo(seek.value,true);
if(JAM) socket.emit("jam-seek",{room:ROOM,time:seek.value});
}

function toggleJam(){
ROOM=prompt("Enter Jam Code");
JAM=true;
socket.emit("join-jam",ROOM);
}

socket.on("jam-play",d=>yt.loadVideoById(d.videoId,d.time));
socket.on("jam-pause",()=>yt.pauseVideo());
socket.on("jam-seek",t=>yt.seekTo(t,true));

function search(){fetchSongs(q.value,grid);}
function openFull(){full.classList.add("active")}
function closeFull(){full.classList.remove("active")}
</script>
</body>
</html>`);
});

server.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Pixel Music LIVE")
);
