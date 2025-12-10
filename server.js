const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

// Serve files from 'public' folder
app.use(express.static('public'));

let players = {};

io.on('connection', function (socket) {
    console.log('A user connected: ' + socket.id);

    // Create a new player object
    players[socket.id] = {
        x: 400,
        y: 300,
        playerId: socket.id,
        anim: 'down',
        skin: 'player' // Default Skin
    };

    // Send the players object to the new player
    socket.emit('currentPlayers', players);

    // Broadcast the new player to everyone else
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Handle Movement & Skin Updates
    socket.on('playerMovement', function (movementData) {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].anim = movementData.anim;
            players[socket.id].skin = movementData.skin; // Save Skin
            
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Handle Skin Change specifically
    socket.on('skinChange', function (data) {
        if (players[socket.id]) {
            players[socket.id].skin = data.skin;
        }
        // Tell everyone else
        socket.broadcast.emit('playerSkinChanged', { 
            playerId: socket.id, 
            skin: data.skin 
        });
    });

    socket.on('disconnect', function () {
        console.log('User disconnected: ' + socket.id);
        delete players[socket.id];
        // We use a custom name like 'playerDisconnected'
        io.emit('playerDisconnected', socket.id); 
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});