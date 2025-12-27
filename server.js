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
            // UPDATED: Ab username ke saath profile picture aur admin status bhi bhej rahe hain
            if (s && (s.username || s.userData)) {
                users.push({
                    username: s.userData ? s.userData.username : s.username,
                    picture: s.userData ? s.userData.picture : null,
                    isAdmin: roomAdmins.get(room) === id
                });
            }
        });
    }
    // Dono events bhej rahe hain compatibility ke liye
    io.to(room).emit("room-users", users.map(u => u.username)); 
    io.to(room).emit("user-update", users); 
}

io.on("connection", (socket) => {
    console.log("New Socket Connected:", socket.id);

    // 1. Room Validation Check
    socket.on("check-room", (room, callback) => {
        const exists = io.sockets.adapter.rooms.has(room);
        callback(exists);
    });

    // 2. Joining Logic
    socket.on("join", (data) => {
        // Handle both old and new data structures
        const room = data.room;
        const user = data.user || { username: data.username };
        
        socket.join(room);
        socket.room = room;
        socket.username = user.username;
        socket.userData = user; // Storing full profile for shareable links
        
        if (!roomAdmins.has(room) || data.isAdmin) {
            roomAdmins.set(room, socket.id);
        }
        
        setTimeout(() => {
            sendUserList(room);
        }, 800);

        io.to(room).emit("notification", `${user.username} joined the jam!`);
        socket.to(room).emit("user-joined", user);
    });

    // 3. Play/Change Song Sync (Matches Frontend jam-play)
    socket.on("jam-play", (data) => {
        if (socket.room) {
            socket.to(socket.room).emit("sync-play", data);
        }
    });

    socket.on("sync-play", (data) => {
        if (socket.room) {
            data.sentAt = Date.now(); 
            socket.to(socket.room).emit("play-client", data);
            socket.to(socket.room).emit("sync-play", data);
        }
    });

    // 4. Play/Pause/Seek Sync (Matches Frontend jam-action)
    socket.on("jam-action", (data) => {
        if (socket.room) {
            socket.to(socket.room).emit("sync-action", data);
        }
    });

    socket.on("sync-control", (data) => {
        if (socket.room) {
            data.serverTime = Date.now(); 
            socket.to(socket.room).emit("control-client", data);
            socket.to(socket.room).emit("sync-action", data);
        }
    });

    // 5. End Jam Logic
    socket.on("close-room", (data) => {
        const room = data.room || data;
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("room-closed");
            io.to(room).emit("jam-ended");
            roomAdmins.delete(room);
        }
    });

    socket.on("end-jam", (room) => {
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("jam-ended");
            io.to(room).emit("room-closed");
            roomAdmins.delete(room);
        }
    });

    // 6. Leaving & Disconnection
    socket.on("leave-jam", (data) => {
        const room = data.room || socket.room;
        if (room) {
            socket.leave(room);
            if (roomAdmins.get(room) === socket.id) {
                roomAdmins.delete(room);
                io.to(room).emit("room-closed");
            }
            sendUserList(room);
            socket.room = null;
        }
    });

    socket.on("leave-room", () => {
        const room = socket.room;
        if (room) {
            socket.leave(room);
            if (roomAdmins.get(room) === socket.id) {
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
                io.to(room).emit("room-closed");
            }
            sendUserList(room);
        }
        console.log("Socket Disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Pixel Server Running on: http://localhost:${PORT}`));
