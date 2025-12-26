const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" } 
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 1. Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connected: Pixel Music Database Ready"))
    .catch(err => console.error("❌ DB Connection Error:", err));

// User Model
const User = mongoose.model("User", new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
}));

// --- 2. API Routes ---

// Register
app.post("/api/register", async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await new User({ username: req.body.username, password: hash }).save();
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: "Username already taken" });
    }
});

// Login
app.post("/api/login", async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ ok: true, username: user.username });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// Send API Key to Frontend
app.get("/api/config", (req, res) => {
    res.json({ yt: process.env.YOUTUBE_API_KEY });
});

// --- 3. Advanced Socket.io (Jam Mode Engine) ---

const roomAdmins = new Map(); // Room ID -> Socket ID

io.on("connection", (socket) => {
    console.log("New Connection:", socket.id);

    // Join Room Logic
    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username;

        // Agar room khali hai, toh pehla joiner ADMIN banega
        if (!roomAdmins.has(room)) {
            roomAdmins.set(room, socket.id);
            socket.emit("admin-status", true);
            console.log(`Admin Set: ${username} for room ${room}`);
        } else {
            socket.emit("admin-status", false);
        }

        // Sabko notify karo
        io.to(room).emit("notification", `${username} joined the jam! 🔥`);
        console.log(`${username} joined room: ${room}`);
    });

    // Playback Sync (Change song for everyone)
    socket.on("sync-play", (data) => {
        if (socket.room) {
            // Hum io.to(room) use kar rahe hain taaki sender ka player bhi sync ho jaye
            io.to(data.room).emit("play", data);
            console.log(`Syncing track in ${data.room}: ${data.title}`);
        }
    });

    // End Jam (Only Admin can trigger this)
    socket.on("end-jam", (room) => {
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("jam-ended");
            roomAdmins.delete(room);
            console.log(`Room ${room} closed by admin.`);
        }
    });

    // Disconnect Logic
    socket.on("disconnect", () => {
        if (socket.room) {
            io.to(socket.room).emit("notification", `${socket.username} left the jam.`);
            
            // Agar Admin disconnect hota hai, toh room dissolve kar do
            if (roomAdmins.get(socket.room) === socket.id) {
                roomAdmins.delete(socket.room);
                io.to(socket.room).emit("jam-ended");
                console.log(`Admin left, closing room: ${socket.room}`);
            }
        }
        console.log("Disconnected:", socket.id);
    });
});

// --- 4. Server Start ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Pixel Music Pro Backend running on http://localhost:${PORT}`);
});
