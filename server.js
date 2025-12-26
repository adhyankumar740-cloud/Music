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
    password: { type: String }, // Normal login ke liye
    googleId: { type: String }, // Google login ke liye
    picture: String
});
const User = mongoose.model("User", UserSchema);

const LibrarySchema = new mongoose.Schema({
    userId: String,
    songs: [{ id: String, title: String, img: String, artist: String }]
});
const Library = mongoose.model("Library", LibrarySchema);

// --- 2. API Routes ---

// Register (Normal)
app.post("/api/register", async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await new User({ username: req.body.username, password: hash }).save();
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "Username taken" }); }
});

// Login (Normal)
app.post("/api/login", async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ ok: true, username: user.username, userId: user._id });
    } else { res.status(401).json({ error: "Invalid credentials" }); }
});

// Google Login API
app.post("/api/google-login", async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        
        // Agar user pehli baar aa raha hai toh save karo
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

// Library Management
app.post("/api/library/add", async (req, res) => {
    const { userId, song } = req.body;
    await Library.findOneAndUpdate(
        { userId }, 
        { $addToSet: { songs: song } }, 
        { upsert: true }
    );
    res.json({ ok: true });
});

app.get("/api/library/:userId", async (req, res) => {
    const data = await Library.findOne({ userId: req.params.userId });
    res.json(data ? data.songs : []);
});

app.get("/api/config", (req, res) => {
    res.json({ 
        yt: process.env.YOUTUBE_API_KEY, 
        gId: process.env.GOOGLE_CLIENT_ID 
    });
});

// --- 3. Socket.io (Jam Engine) ---
const roomAdmins = new Map();

io.on("connection", (socket) => {
    socket.on("join", ({ room, username }) => {
        socket.join(room);
        socket.room = room;
        socket.username = username;

        if (!roomAdmins.has(room)) {
            roomAdmins.set(room, socket.id);
            socket.emit("admin-status", true);
        } else {
            socket.emit("admin-status", false);
        }
        io.to(room).emit("notification", `${username} joined the jam! 🔥`);
    });

    socket.on("sync-play", (data) => {
        if (socket.room) {
            io.to(data.room).emit("play", data);
        }
    });

    socket.on("end-jam", (room) => {
        if (roomAdmins.get(room) === socket.id) {
            io.to(room).emit("jam-ended");
            roomAdmins.delete(room);
        }
    });

    socket.on("disconnect", () => {
        if (socket.room) {
            io.to(socket.room).emit("notification", `${socket.username} left.`);
            if (roomAdmins.get(socket.room) === socket.id) {
                roomAdmins.delete(socket.room);
                io.to(socket.room).emit("jam-ended");
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
