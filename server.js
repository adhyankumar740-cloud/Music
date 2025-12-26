const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const { OAuth2Client } = require('google-auth-library');
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

mongoose.connect(process.env.MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const User = mongoose.model("User", new mongoose.Schema({ username: String, googleId: String, picture: String }));

app.get("/api/config", (req, res) => {
    res.json({ yt: process.env.YOUTUBE_API_KEY, gId: process.env.GOOGLE_CLIENT_ID });
});

app.post("/api/google-login", async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        let user = await User.findOneAndUpdate({ googleId: payload.sub }, { username: payload.name, picture: payload.picture }, { upsert: true, new: true });
        res.json({ ok: true, username: user.username, userId: user.googleId, picture: user.picture });
    } catch (e) { res.status(400).json({ error: "Auth Failed" }); }
});

// --- ELITE JAM ENGINE ---
const roomAdmins = new Map();

function sendUserList(room) {
    const clients = io.sockets.adapter.rooms.get(room);
    const users = [];
    if (clients) {
        clients.forEach(id => {
            const s = io.sockets.sockets.get(id);
            if (s && s.username) users.push(s.username);
        });
    }
    io.to(room).emit("room-users", users);
}

io.on("connection", (socket) => {
    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username;
        if (!roomAdmins.has(room)) roomAdmins.set(room, socket.id);
        
        sendUserList(room);
        io.to(room).emit("notification", `${username} joined the jam!`);
    });

    socket.on("sync-play", (data) => {
        if (socket.room) socket.to(socket.room).emit("play-client", data);
    });

    socket.on("leave-room", () => {
        const room = socket.room;
        if (room) {
            socket.leave(room);
            if (roomAdmins.get(room) === socket.id) roomAdmins.delete(room);
            sendUserList(room);
            socket.room = null;
        }
    });

    socket.on("disconnect", () => {
        if (socket.room) {
            sendUserList(socket.room);
            if (roomAdmins.get(socket.room) === socket.id) roomAdmins.delete(socket.room);
        }
    });
});

server.listen(process.env.PORT || 5000, () => console.log("🚀 Pixel Server: Port 5000"));
