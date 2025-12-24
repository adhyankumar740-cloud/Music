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
app.use(express.static(__dirname)); // Static files serve karne ke liye

mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.error("DB Connection Error:", err));

// Schemas
const User = mongoose.model("User", new mongoose.Schema({
    username:{type:String, unique:true, required:true},
    password:{type:String, required:true},
    liked:[String]
}));

const Playlist = mongoose.model("Playlist", new mongoose.Schema({
    username:String,
    name:String,
    songs:[{videoId:String, title:String}]
}));

const Room = mongoose.model("Room", new mongoose.Schema({
    roomId:String, videoId:String, time:Number, playing:Boolean
}));

// API Routes
app.get("/", (req,res) => res.sendFile(__dirname + "/index.html"));
app.get("/api/config", (req,res) => res.json({yt: process.env.YOUTUBE_API_KEY}));

app.post("/api/register", async(req,res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        const user = new User({username:req.body.username, password:hash});
        await user.save();
        res.json({ok:true});
    } catch(e) { res.status(400).json({error:"User exists"}); }
});

app.post("/api/login", async(req,res) => {
    const user = await User.findOne({username:req.body.username});
    if(user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ok:true, username:user.username});
    } else res.status(401).json({error:"Invalid login"});
});

app.get("/api/playlists/:username", async(req,res) => {
    const p = await Playlist.find({username:req.params.username});
    res.json(p);
});

app.post("/api/playlist", async(req,res) => {
    const p = new Playlist({username:req.body.username, name:req.body.name, songs:[]});
    await p.save(); res.json(p);
});

// Socket logic
io.on("connection", socket => {
    socket.on("join", async roomId => {
        socket.join(roomId);
        const room = await Room.findOne({roomId});
        if(room) socket.emit("sync", room);
    });
    socket.on("play", async data => {
        await Room.findOneAndUpdate({roomId:data.roomId}, data, {upsert:true});
        socket.to(data.roomId).emit("play", data);
    });
});

server.listen(5000, () => console.log("Server on http://localhost:5000"));
