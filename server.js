const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Serve files from the 'public' folder
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('A player joined: ' + socket.id);

  // When a player moves, update everyone else
  socket.on('playerMovement', (movementData) => {
    socket.broadcast.emit('playerMoved', movementData);
  });

  socket.on('disconnect', () => {
    console.log('A player left');
  });
});

server.listen(3000, () => {
  console.log('Santan Engine running on http://localhost:3000');
});