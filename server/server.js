const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const GameEngine = require('./GameEngine');

const server = new WebSocket.Server({ port: 8080 });
const gameEngine = new GameEngine();

console.log('🚀 Multiplayer Game Server running on port 8080');

server.on('connection', (ws) => {
    const playerId = uuidv4();
    console.log(`Player ${playerId} connected`);
    
    // Thêm player mới
    const player = gameEngine.addPlayer(playerId, ws);
    
    // Gửi thông tin khởi tạo
    ws.send(JSON.stringify({
        type: 'INIT',
        playerId: playerId,
        player: player,
        arena: gameEngine.arena
    }));
    
    // Broadcast player joined
    broadcast({
        type: 'PLAYER_JOINED',
        player: player
    }, playerId);
    
    // Handle messages từ client
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleClientMessage(playerId, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    // Handle disconnect
    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected`);
        gameEngine.removePlayer(playerId);
        broadcast({
            type: 'PLAYER_LEFT',
            playerId: playerId
        });
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
    });
});

function handleClientMessage(playerId, message) {
    switch (message.type) {
        case 'MOVEMENT':
            gameEngine.setPlayerDirection(playerId, message.direction);
            break;
        case 'CHAT_MESSAGE':
            broadcast({
                type: 'CHAT_MESSAGE',
                playerId: playerId,
                message: message.message,
                timestamp: Date.now()
            });
            break;
    }
}

function broadcast(message, excludePlayerId = null) {
    const payload = JSON.stringify(message);
    server.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && 
            (!excludePlayerId || client !== getPlayerWebSocket(excludePlayerId))) {
            client.send(payload);
        }
    });
}

function getPlayerWebSocket(playerId) {
    const player = gameEngine.players.get(playerId);
    return player ? player.ws : null;
}

// Game loop: 60 FPS
setInterval(() => {
    gameEngine.update();
    
    // Broadcast game state tới tất cả clients
    const gameState = gameEngine.getGameState();
    broadcast({
        type: 'GAME_STATE_UPDATE',
        gameState: gameState,
        timestamp: Date.now()
    });
}, 1000 / 60);

// Cleanup intervals on process exit
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit();
});