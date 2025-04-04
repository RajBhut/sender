import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin:
      process.env.NODE_ENV === "production" ? false : "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// Serve static files from the dist directory in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(__dirname, "../dist")));

  // Handle React routing, return all requests to React app
  app.get("*", (req, res) => {
    res.sendFile(join(__dirname, "../dist/index.html"));
  });
}

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("create-room", () => {
    const roomId = Math.random().toString(36).substring(7);
    rooms.set(roomId, { host: socket.id });
    socket.join(roomId);
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      socket.join(roomId);
      socket.to(roomId).emit("user-joined", socket.id);
    } else {
      socket.emit("room-not-found");
    }
  });

  socket.on("offer", (offer, roomId, targetId) => {
    socket.to(targetId).emit("offer", offer, socket.id);
  });

  socket.on("answer", (answer, roomId, targetId) => {
    socket.to(targetId).emit("answer", answer, socket.id);
  });

  socket.on("ice-candidate", (candidate, roomId, targetId) => {
    socket.to(targetId).emit("ice-candidate", candidate, socket.id);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    rooms.forEach((room, roomId) => {
      if (room.host === socket.id) {
        rooms.delete(roomId);
        io.to(roomId).emit("host-disconnected");
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
