const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

mongoose.connect(process.env.MONGODB_URI).then(() => console.log("DB Connected"));

const User = mongoose.model("User", new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String }
}));

app.post("/api/register", async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    try { await new User({ username: req.body.username, password: hash }).save(); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: "Taken" }); }
});

app.post("/api/login", async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) res.json({ ok: true, username: user.username });
    else res.status(401).json({ error: "Invalid" });
});

app.get("/api/config", (req, res) => res.json({ yt: process.env.YOUTUBE_API_KEY }));

io.on("connection", (socket) => {
    socket.on("join", (room) => socket.join(room));
    socket.on("sync-play", (data) => socket.to(data.room).emit("play", data));
});

server.listen(5000, () => console.log("Pixel Music Pro on 5000"));
