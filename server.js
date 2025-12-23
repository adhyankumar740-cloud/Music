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

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.error(err));

// Schemas
const UserSchema = new mongoose.Schema({
    username:{type:String,unique:true},
    password:String,
    liked: [String],
    recent: [String]
});
const User = mongoose.model("User", UserSchema);

const PlaylistSchema = new mongoose.Schema({
    username:String,
    name:String,
    songs:[String]
});
const Playlist = mongoose.model("Playlist", PlaylistSchema);

const RoomSchema = new mongoose.Schema({
    roomId:String,
    videoId:String,
    time:Number,
    playing:Boolean
});
const Room = mongoose.model("Room", RoomSchema);

// Serve frontend
app.get("/", (req,res)=>res.sendFile(__dirname+"/index.html"));

// API Endpoints
app.get("/api/config",(req,res)=>res.json({yt:process.env.YOUTUBE_API_KEY}));

app.post("/api/register", async(req,res)=>{
    try{
        const hash = await bcrypt.hash(req.body.password,10);
        await new User({username:req.body.username,password:hash,liked:[],recent:[]}).save();
        res.json({ok:true});
    }catch(e){res.status(400).json({error:"Username taken"})}
});

app.post("/api/login", async(req,res)=>{
    const user = await User.findOne({username:req.body.username});
    if(user && await bcrypt.compare(req.body.password,user.password)){
        res.json({ok:true,username:user.username,liked:user.liked,recent:user.recent});
    } else res.status(401).json({error:"Invalid credentials"});
});

// Playlist APIs
app.post("/api/playlist", async(req,res)=>{
    const p = new Playlist({username:req.body.username,name:req.body.name,songs:[]});
    await p.save(); res.json(p);
});
app.post("/api/playlist/add", async(req,res)=>{
    const p = await Playlist.findById(req.body.id);
    p.songs.push(req.body.videoId); await p.save(); res.json(p);
});
app.post("/api/playlist/remove", async(req,res)=>{
    const p = await Playlist.findById(req.body.id);
    p.songs = p.songs.filter(v=>v!==req.body.videoId); await p.save(); res.json(p);
});
app.get("/api/playlists/:username", async(req,res)=>{
    const p = await Playlist.find({username:req.params.username});
    res.json(p);
});

// Socket.IO - Jam Mode
io.on("connection", socket=>{
    socket.on("join", async roomId=>{
        socket.join(roomId);
        const room = await Room.findOne({roomId});
        if(room) socket.emit("sync", room);
    });
    socket.on("play", async data=>{
        await Room.findOneAndUpdate({roomId:data.roomId},data,{upsert:true});
        socket.to(data.roomId).emit("play",data);
    });
    socket.on("pause", roomId=>{
        socket.to(roomId).emit("pause");
    });
    socket.on("seek", data=>{
        socket.to(data.roomId).emit("seek", data.time);
    });
});

server.listen(process.env.PORT||5000, ()=>console.log("Pixel Music running"));
