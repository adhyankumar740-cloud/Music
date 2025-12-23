// ================== PIXEL MUSIC ==================
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// ================== JAM ROOMS ==================
let rooms = {}; 
/*
rooms = {
  roomId: {
    videoId,
    time,
    isPlaying
  }
}
*/

// ================== SOCKET ==================
io.on("connection", socket => {

  socket.on("join", room => {
    socket.join(room);
    if (!rooms[room]) {
      rooms[room] = { videoId: null, time: 0, isPlaying: false };
    }
    socket.emit("sync", rooms[room]);
  });

  socket.on("play", ({ room, videoId }) => {
    rooms[room].videoId = videoId;
    rooms[room].isPlaying = true;
    io.to(room).emit("play", videoId);
  });

  socket.on("pause", room => {
    rooms[room].isPlaying = false;
    io.to(room).emit("pause");
  });

  socket.on("seek", ({ room, time }) => {
    rooms[room].time = time;
    io.to(room).emit("seek", time);
  });
});

// ================== FRONTEND ==================
app.get("/", (req, res) => {
res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pixel Music</title>
<script src="https://www.youtube.com/iframe_api"></script>
<script src="/socket.io/socket.io.js"></script>

<style>
body{
  margin:0;
  background:radial-gradient(circle at top,#111,#000);
  color:#fff;
  font-family:system-ui;
  padding-bottom:160px;
}

.header{
  padding:20px;
  font-size:24px;
  font-weight:700;
}

.search{
  margin:0 20px;
  background:#1c1c1c;
  padding:12px;
  border-radius:12px;
}
.search input{
  width:100%;
  background:none;
  border:none;
  color:white;
  font-size:16px;
}

.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  padding:20px;
}
.card{
  background:#222;
  border-radius:14px;
  overflow:hidden;
}
.card img{
  width:100%;
}
.card p{
  padding:8px;
  font-size:13px;
}

/* PLAYER */
.player-wrap{
  position:fixed;
  bottom:20px;
  left:0;
  right:0;
  display:flex;
  justify-content:center;
}
.player{
  width:92%;
  max-width:420px;
  background:rgba(255,255,255,0.08);
  backdrop-filter:blur(16px);
  border-radius:24px;
  padding:16px;
}
.track{
  display:flex;
  gap:12px;
  align-items:center;
}
.track img{
  width:56px;
  height:56px;
  border-radius:12px;
}
.controls{
  display:flex;
  justify-content:space-between;
  margin-top:14px;
}
.controls button{
  background:none;
  border:none;
  color:white;
  font-size:22px;
}
.main{
  background:linear-gradient(135deg,#00ffe0,#00aaff);
  color:black;
  width:56px;
  height:56px;
  border-radius:50%;
}
input[type=range]{width:100%;}
</style>
</head>

<body>

<div id="yt" style="display:none"></div>

<div class="header">PIXEL MUSIC</div>

<div class="search">
  <input id="q" placeholder="Search music" onkeydown="if(event.key==='Enter')search()">
</div>

<div class="grid" id="grid"></div>

<!-- PLAYER -->
<div class="player-wrap">
  <div class="player">
    <div class="track">
      <img id="img">
      <div>
        <b id="title">Not Playing</b><br>
        <small>Pixel Music</small>
      </div>
    </div>

    <input type="range" id="seek" value="0" onchange="seek(this.value)">

    <div class="controls">
      <button onclick="jump(-10)">⏪</button>
      <button onclick="prev()">⏮</button>
      <button class="main" onclick="toggle()">▶</button>
      <button onclick="next()">⏭</button>
      <button onclick="jump(10)">⏩</button>
    </div>

    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px">
      <span onclick="joinJam()">🎧 Jam</span>
      <span>❤️ Like</span>
    </div>
  </div>
</div>

<script>
let yt, queue=[], index=0;
let socket = io();
let ROOM = null;

function onYouTubeIframeAPIReady(){
  yt = new YT.Player("yt",{events:{onStateChange:e=>{
    if(e.data===1) interval();
  }}});
}

function interval(){
  setInterval(()=>{
    seek.value = yt.getCurrentTime();
  },1000);
}

function play(id,title,img){
  document.getElementById("title").innerText=title;
  document.getElementById("img").src=img;
  yt.loadVideoById(id);
  if(ROOM) socket.emit("play",{room:ROOM,videoId:id});
}

function toggle(){
  yt.getPlayerState()==1 ? yt.pauseVideo() : yt.playVideo();
}

function seek(v){
  yt.seekTo(v,true);
  if(ROOM) socket.emit("seek",{room:ROOM,time:v});
}

function jump(s){
  seek(yt.getCurrentTime()+s);
}

function next(){
  index=(index+1)%queue.length;
  yt.loadVideoById(queue[index]);
}

function prev(){
  index=index<=0?queue.length-1:index-1;
  yt.loadVideoById(queue[index]);
}

async function search(){
  let q=document.getElementById("q").value;
  let r=await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q="+q+"&key=${process.env.YT}");
  let d=await r.json();
  queue=[];
  grid.innerHTML="";
  d.items.forEach(v=>{
    queue.push(v.id.videoId);
    grid.innerHTML+=\`
      <div class="card" onclick="play('\${v.id.videoId}','\${v.snippet.title.replace(/'/g,'')}','\${v.snippet.thumbnails.high.url}')">
        <img src="\${v.snippet.thumbnails.high.url}">
        <p>\${v.snippet.title}</p>
      </div>\`;
  });
}

function joinJam(){
  ROOM = prompt("Enter Jam Code");
  socket.emit("join",ROOM);
}

socket.on("play",id=>yt.loadVideoById(id));
socket.on("pause",()=>yt.pauseVideo());
socket.on("seek",t=>yt.seekTo(t,true));
socket.on("sync",s=>{
  if(s.videoId) yt.loadVideoById(s.videoId,s.time);
});
</script>
</body>
</html>`);
});

// ================== START ==================
server.listen(process.env.PORT || 5000, () =>
  console.log("🎧 Pixel Music Live")
);
