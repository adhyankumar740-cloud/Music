const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { OAuth2Client } = require('google-auth-library');
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" } 
});

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 1. Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Pixel Music Database Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// Models
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String }, 
    googleId: { type: String }, 
    picture: String
});
const User = mongoose.model("User", UserSchema);

const LibrarySchema = new mongoose.Schema({
    userId: String,
    songs: [{ id: String, title: String, img: String, artist: String }]
});
const Library = mongoose.model("Library", LibrarySchema);

// --- 2. API Routes ---

app.post("/api/google-login", async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        
        let user = await User.findOne({ googleId: payload.sub });
        if(!user) {
            user = await new User({ 
                username: payload.name, 
                googleId: payload.sub, 
                picture: payload.picture 
            }).save();
        }
        res.json({ ok: true, username: payload.name, userId: payload.sub, picture: payload.picture });
    } catch (e) { res.status(400).json({ error: "Google Auth Failed" }); }
});

app.get("/api/config", (req, res) => {
    res.json({ 
        yt: process.env.YOUTUBE_API_KEY, 
        gId: process.env.GOOGLE_CLIENT_ID 
    });
});

// --- 3. Socket.io (Elite Jam Engine) ---
const roomAdmins = new Map();

// Helper function to get all usernames in a room
function getUsersInRoom(room) {
    const clients = io.sockets.adapter.rooms.get(room);
    const users = [];
    if (clients) {
        for (const clientId of clients) {
            const clientSocket = io.sockets.sockets.get(clientId);
            if (clientSocket.username) users.push(clientSocket.username);
        }
    }
    return users;
}

io.on("connection", (socket) => {
    
    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username;

        // Admin Assign
        if (!roomAdmins.has(room)) {
            roomAdmins.set(room, socket.id);
            socket.emit("admin-status", true);
        } else {
            socket.emit("admin-status", false);
        }

        // Send updated user list to everyone in room
        io.to(room).emit("room-users", getUsersInRoom(room));
        io.to(room).emit("notification", `${username} joined! 🔥`);
    });

    socket.on("sync-play", (data) => {
        // Only admin should ideally control, but keeping flexible for jam
        if (socket.room) {
            socket.to(socket.room).emit("play", data);
        }
    });

    socket.on("leave", ({ room, username }) => {
        socket.leave(room);
        io.to(room).emit("room-users", getUsersInRoom(room));
        io.to(room).emit("notification", `${username} left the jam.`);
        
        if (roomAdmins.get(room) === socket.id) {
            roomAdmins.delete(room);
            io.to(room).emit("jam-ended");
        }
    });

    socket.on("disconnect", () => {
        if (socket.room) {
            const room = socket.room;
            io.to(room).emit("notification", `${socket.username} disconnected.`);
            
            // Update list after disconnect
            setTimeout(() => {
                io.to(room).emit("room-users", getUsersInRoom(room));
            }, 1000);

            if (roomAdmins.get(room) === socket.id) {
                roomAdmins.delete(room);
                io.to(room).emit("jam-ended");
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
