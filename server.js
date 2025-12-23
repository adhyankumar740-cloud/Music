const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());

/* ================= JAM ROOMS ================= */
const rooms = {}; 
// roomId: { videoId, time, playing }

io.on('connection', socket => {

  socket.on('join-room', room => {
    socket.join(room);
    if (rooms[room]) {
      socket.emit('sync', rooms[room]);
    }
  });

  socket.on('play-song', data => {
    rooms[data.room] = {
      videoId: data.videoId,
      time: data.time,
      playing: true
    };
    socket.to(data.room).emit('play-song', rooms[data.room]);
  });

  socket.on('pause-song', data => {
    if (rooms[data.room]) {
      rooms[data.room].playing = false;
      socket.to(data.room).emit('pause-song');
    }
  });

  socket.on('seek-song', data => {
    if (rooms[data.room]) {
      rooms[data.room].time = data.time;
      socket.to(data.room).emit('seek-song', data.time);
    }
  });

});

/* ================= FRONTEND ================= */
app.get('/', (req, res) => {
res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pixel Music Jam</title>
<script src="/socket.io/socket.io.js"></script>
<script src="https://www.youtube.com/iframe_api"></script>

<style>
body{
margin:0;
font-family:Inter;
background:linear-gradient(180deg,#2b0a5a,#0b0014);
color:white;
padding-bottom:120px;
}
.header{padding:20px;font-size:22px;font-weight:700}
button{
background:#7b2cff;
color:white;
border:none;
padding:10px 16px;
border-radius:10px;
}
input{
background:#1a0033;
border:none;
color:white;
padding:10px;
border-radius:8px;
}
#yt{position:absolute;top:-999px}
</style>
</head>

<body>
<div id="yt"></div>

<div class="header">🎧 Pixel Music Jam</div>

<div style="padding:20px">
<button onclick="createJam()">Create Jam</button>
<br><br>
<input id="room" placeholder="Enter Jam Code">
<button onclick="joinJam()">Join</button>
</div>

<script>
let yt, socket, roomId;

socket = io();

function createJam(){
roomId = Math.random().toString(36).substr(2,6);
alert("Jam Code: " + roomId);
socket.emit('join-room', roomId);
}

function joinJam(){
roomId = document.getElementById('room').value;
socket.emit('join-room', roomId);
}

function onYouTubeIframeAPIReady(){
yt = new YT.Player('yt', {
events:{
onReady:()=>{},
onStateChange:onState
}
});
}

function play(videoId){
yt.loadVideoById(videoId);
socket.emit('play-song',{
room:roomId,
videoId,
time:0
});
}

function toggle(){
if(yt.getPlayerState()==1){
yt.pauseVideo();
socket.emit('pause-song',{room:roomId});
}else{
yt.playVideo();
socket.emit('play-song',{
room:roomId,
videoId: yt.getVideoData().video_id,
time: yt.getCurrentTime()
});
}
}

function onState(e){
if(e.data==1){
socket.emit('seek-song',{
room:roomId,
time: yt.getCurrentTime()
});
}
}

socket.on('play-song', d=>{
yt.loadVideoById(d.videoId, d.time);
});

socket.on('pause-song', ()=>{
yt.pauseVideo();
});

socket.on('seek-song', t=>{
yt.seekTo(t,true);
});
</script>

<button onclick="play('dQw4w9WgXcQ')" style="margin:20px">
▶ Test Jam Song
</button>

</body>
</html>`);
});

server.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Pixel Music Jam Running")
);
