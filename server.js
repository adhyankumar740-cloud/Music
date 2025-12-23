require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

/* ================= JAM STATE ================= */
const rooms = {};

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.on("join", room => {
    socket.join(room);
    if (!rooms[room]) {
      rooms[room] = { videoId: null, time: 0, playing: false };
    }
    socket.emit("sync", rooms[room]);
  });

  socket.on("play", ({ room, videoId }) => {
    rooms[room].videoId = videoId;
    rooms[room].playing = true;
    io.to(room).emit("play", videoId);
  });

  socket.on("pause", room => {
    rooms[room].playing = false;
    io.to(room).emit("pause");
  });

  socket.on("seek", ({ room, time }) => {
    rooms[room].time = time;
    io.to(room).emit("seek", time);
  });
});

/* ================= FRONTEND ================= */
app.get("/", (_, res) => {
res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pixel Music</title>

<script src="https://www.youtube.com/iframe_api"></script>
<script src="/socket.io/socket.io.js"></script>

<style>
:root{
  --bg:#121212;
  --card:#181818;
  --green:#1DB954;
  --text:#fff;
  --sub:#B3B3B3;
}
*{box-sizing:border-box}
body{
  margin:0;
  background:var(--bg);
  color:var(--text);
  font-family:system-ui,-apple-system;
  padding-bottom:160px;
}
.header{
  padding:18px;
  font-size:22px;
  font-weight:700;
}
.search{
  margin:0 16px;
  background:#242424;
  border-radius:8px;
  padding:12px;
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
  padding:16px;
}
.card{
  background:var(--card);
  border-radius:8px;
  overflow:hidden;
}
.card img{width:100%}
.card p{
  padding:8px;
  font-size:13px;
  color:var(--sub);
}

/* ===== PLAYER ===== */
.player-wrap{
  position:fixed;
  bottom:0;
  left:0;
  right:0;
  background:#181818;
  border-top:1px solid #282828;
}
.player{
  max-width:480px;
  margin:auto;
  padding:10px;
}
.track{
  display:flex;
  gap:10px;
  align-items:center;
}
.track img{
  width:48px;
  height:48px;
  border-radius:4px;
}
.track b{font-size:14px}
.track small{color:var(--sub)}
input[type=range]{
  width:100%;
  accent-color:var(--green);
}
.controls{
  display:flex;
  justify-content:space-around;
  align-items:center;
  margin-top:8px;
}
.controls button{
  background:none;
  border:none;
  color:white;
  font-size:22px;
}
.play{
  background:var(--green);
  color:black;
  width:48px;
  height:48px;
  border-radius:50%;
}
.extra{
  display:flex;
  justify-content:space-between;
  font-size:12px;
  color:var(--sub);
}
</style>
</head>

<body>

<div id="yt" style="display:none"></div>

<div class="header">Pixel Music</div>

<div class="search">
  <input id="q" placeholder="Search songs, artists" 
  onkeydown="if(event.key==='Enter')search()">
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

    <input type="range" id="seek" value="0">

    <div class="controls">
      <button onclick="jump(-10)">⏪</button>
      <button onclick="prev()">⏮</button>
      <button class="play" onclick="toggle()">▶</button>
      <button onclick="next()">⏭</button>
      <button onclick="jump(10)">⏩</button>
    </div>

    <div class="extra">
      <span onclick="joinJam()">🎧 Jam</span>
      <span>❤️ Like</span>
    </div>
  </div>
</div>

<script>
let yt, queue=[], index=0;
let socket=io(), ROOM=null;

function onYouTubeIframeAPIReady(){
  yt=new YT.Player("yt",{events:{onStateChange:e=>{
    if(e.data===1) setInterval(()=>seek.value=yt.getCurrentTime(),1000);
  }}});
}

function play(id,title,img){
  title=title.replace(/'/g,'');
  document.getElementById("title").innerText=title;
  document.getElementById("img").src=img;
  yt.loadVideoById(id);
  if(ROOM) socket.emit("play",{room:ROOM,videoId:id});
}

function toggle(){
  yt.getPlayerState()==1?yt.pauseVideo():yt.playVideo();
}

function jump(s){
  let t=yt.getCurrentTime()+s;
  yt.seekTo(t,true);
  if(ROOM) socket.emit("seek",{room:ROOM,time:t});
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
  let r=await fetch(
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q="+
    encodeURIComponent(q)+
    "&key=${process.env.YT}"
  );
  let d=await r.json();
  grid.innerHTML="";
  queue=[];
  d.items.forEach(v=>{
    queue.push(v.id.videoId);
    grid.innerHTML+=\`
    <div class="card" onclick="play(
      '\${v.id.videoId}',
      '\${v.snippet.title}',
      '\${v.snippet.thumbnails.high.url}'
    )">
      <img src="\${v.snippet.thumbnails.high.url}">
      <p>\${v.snippet.title}</p>
    </div>\`;
  });
}

function joinJam(){
  ROOM=prompt("Enter Jam Code");
  if(ROOM) socket.emit("join",ROOM);
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

/* ================= START ================= */
server.listen(process.env.PORT || 5000, () =>
  console.log("🎧 Pixel Music running")
);
