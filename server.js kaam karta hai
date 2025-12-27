const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const { OAuth2Client } = require('google-auth-library');
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 60000 
});
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Error:", err));

const User = mongoose.model("User", new mongoose.Schema({ 
    username: String, 
    googleId: String, 
    picture: String 
}));

// --- API ROUTES ---
app.get("/api/config", (req, res) => {
    res.json({ yt: process.env.YOUTUBE_API_KEY, gId: process.env.GOOGLE_CLIENT_ID });
});

app.post("/api/google-login", async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({ 
            idToken: token, 
            audience: process.env.GOOGLE_CLIENT_ID 
        });
        const payload = ticket.getPayload();
        let user = await User.findOneAndUpdate(
            { googleId: payload.sub }, 
            { username: payload.name, picture: payload.picture }, 
            { upsert: true, new: true }
        );
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
            // Hum yahan ensure kar rahe hain ki sirf wahi users dikhein jinka username set hai
            if (s && s.username) {
                users.push(s.username);
            }
        });
    }
    io.to(room).emit("room-users", users);
}



io.on("connection", (socket) => {
    console.log("New Socket Connected:", socket.id);

    // 1. Room Validation Check (Frontend calls this before joining)
    socket.on("check-room", (room, callback) => {
        const exists = io.sockets.adapter.rooms.has(room);
        callback(exists);
    });

    // 2. Joining Logic
    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username; // Display name for user list
        
        // Agar room naya hai, toh pehla banda admin banega
        if (!roomAdmins.has(room)) {
            roomAdmins.set(room, socket.id);
        }
        
        // Thoda delay taaki list proper sync ho (Latency fix for join)
        setTimeout(() => {
            sendUserList(room);
        }, 800);

        io.to(room).emit("notification", `${username} joined the jam!`);
    });

    // 3. Play/Change Song Sync
    socket.on("sync-play", (data) => {
        if (socket.room) {
            // Hum timestamp add karte hain taaki aage-piche na ho
            data.sentAt = Date.now(); 
            socket.to(socket.room).emit("play-client", data);
        }
    });

    // 4. Play/Pause/Seek Sync (Universal Access)
    socket.on("sync-control", (data) => {
        if (socket.room) {
            // Latency Compensation: Bhejte waqt ka server time
            data.serverTime = Date.now(); 
            socket.to(socket.room).emit("control-client", data);
        }
    });

    // 5. End Jam Logic (Host Only)
    socket.on("end-jam", (room) => {
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("jam-ended");
            roomAdmins.delete(room);
        }
    });

    // 6. Leaving & Disconnection
    socket.on("leave-room", () => {
        const room = socket.room;
        if (room) {
            socket.leave(room);
            if (roomAdmins.get(room) === socket.id) {
                // Agar admin chala gaya, toh admin list se hatao
                roomAdmins.delete(room);
            }
            sendUserList(room);
            socket.room = null;
        }
    });

    socket.on("disconnect", () => {
        if (socket.room) {
            const room = socket.room;
            if (roomAdmins.get(room) === socket.id) {
                roomAdmins.delete(room);
            }
            sendUserList(room);
        }
        console.log("Socket Disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Pixel Server Running on: http://localhost:${PORT}`));
