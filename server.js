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
const roomAdmins = new Map(); // Jam kisne banaya hai track karne ke liye

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
    
    // 1. Room Validation Check
    socket.on("check-room", (room, callback) => {
        const exists = io.sockets.adapter.rooms.has(room);
        callback(exists);
    });

    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username;
        
        // Pehla banda admin banega (End Jam control ke liye)
        if (!roomAdmins.has(room)) {
            roomAdmins.set(room, socket.id);
        }
        
        sendUserList(room);
        io.to(room).emit("notification", `${username} joined the jam!`);
    });

    // 2. Play/Change Song Sync
    socket.on("sync-play", (data) => {
        if (socket.room) {
            socket.to(socket.room).emit("play-client", data);
        }
    });

    // 3. Pause/Play/Seek Sync (Universal - Sabke liye)
    socket.on("sync-control", (data) => {
        if (socket.room) {
            // "to(room)" baki sabko bhejega, "emit" khud ko nahi bhejega
            socket.to(socket.room).emit("control-client", data);
        }
    });

    // 4. End Jam Logic (Sirf Admin kar sakega)
    socket.on("end-jam", (room) => {
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("jam-ended");
            roomAdmins.delete(room);
        }
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
            const room = socket.room;
            if (roomAdmins.get(room) === socket.id) roomAdmins.delete(room);
            sendUserList(room);
        }
    });
});

server.listen(process.env.PORT || 5000, () => console.log("🚀 Pixel Server: Port 5000"));
