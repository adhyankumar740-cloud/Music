const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log("MongoDB Connected"));

const RoomSchema = new mongoose.Schema({
  roomId: String,
  videoId: String,
  time: Number,
  playing: Boolean
});
const Room = mongoose.model("Room", RoomSchema);

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/api/config", (req, res) => {
  res.json({ yt: process.env.YOUTUBE_API_KEY });
});

/* ===== JAM MODE ===== */
io.on("connection", socket => {

  socket.on("join", async roomId => {
    socket.join(roomId);
    let room = await Room.findOne({ roomId });
    if (room) socket.emit("sync", room);
  });

  socket.on("play", async data => {
    await Room.findOneAndUpdate(
      { roomId: data.roomId },
      data,
      { upsert: true }
    );
    socket.to(data.roomId).emit("play", data);
  });

  socket.on("pause", roomId => {
    socket.to(roomId).emit("pause");
  });

  socket.on("seek", data => {
    socket.to(data.roomId).emit("seek", data.time);
  });
});

server.listen(process.env.PORT || 5000, () =>
  console.log("Pixel Music running")
);
