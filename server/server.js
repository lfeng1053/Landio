const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const GameEngine = require('./GameEngine');

const server = new WebSocket.Server({ port: 8080 });
const gameEngine = new GameEngine();
const connectionStates = new Map(); // playerId -> { ws, initialized, isSpectator }
const MAX_PLAYERS = 4;

console.log('Multiplayer Game Server running on port 8080');

server.on('connection', (ws) => {
    const playerId = uuidv4();
    connectionStates.set(playerId, { ws, initialized: false, isSpectator: false });
    ws.playerId = playerId;

    sendPlayerConfig(ws, playerId);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleClientMessage(playerId, ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(playerId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
    });
});

function handleClientMessage(playerId, ws, message) {
    const state = connectionStates.get(playerId);
    if (!state) return;

    switch (message.type) {
        case 'INIT_PLAYER':
            if (state.initialized) return;
            handlePlayerInitialization(playerId, ws, message);
            break;
        case 'SPECTATE':
            if (state.initialized) return;
            handleSpectatorInitialization(playerId, ws, message);
            break;
        case 'MOVEMENT':
            if (!state.initialized) return;
            gameEngine.setPlayerDirection(playerId, message.direction);
            break;
        case 'SET_NAME':
            if (!state.initialized) return;
            const updatedName = gameEngine.setPlayerName(playerId, message.name);
            if (updatedName) {
                broadcast({
                    type: 'PLAYER_RENAMED',
                    playerId,
                    name: updatedName
                });
            }
            break;
        case 'SET_ELEMENT':
            if (!state.initialized) return;
            const result = gameEngine.setPlayerElement(playerId, message.element);
            if (result?.success) {
                broadcast({
                    type: 'PLAYER_ELEMENT_CHANGED',
                    playerId,
                    element: result.element,
                    color: result.color || null
                });
                broadcastElementAvailability();
            } else if (result && !result.success) {
                sendElementSelectionError(ws, result.reason);
            }
            break;
        case 'CHAT_MESSAGE':
            if (!state.initialized) return;
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
    const state = connectionStates.get(playerId);
    return state ? state.ws : null;
}

// Game loop: 60 FPS
setInterval(() => {
    gameEngine.update();
    
    // Broadcast game state to all clients
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

function handlePlayerInitialization(playerId, ws, message) {
    // Check if room is full (max 4 players)
    const activePlayers = gameEngine.getPlayerCount();
    if (activePlayers >= MAX_PLAYERS) {
        ws.send(JSON.stringify({
            type: 'ROOM_FULL',
            message: 'Room is full (max 4 players)'
        }));
        return;
    }

    const desiredElement = message.element;
    const desiredName = gameEngine.sanitizeName(message.name, playerId);

    if (!desiredElement) {
        sendElementSelectionError(ws, 'ELEMENT_REQUIRED');
        return;
    }

    if (!gameEngine.isElementAvailable(desiredElement)) {
        sendElementSelectionError(ws, 'ELEMENT_TAKEN');
        return;
    }

    const player = gameEngine.addPlayer(playerId, ws, {
        name: desiredName,
        element: desiredElement
    });

    const state = connectionStates.get(playerId);
    if (state) {
        state.initialized = true;
        state.isSpectator = false;
        if (state.ws) {
            state.ws.isInitialized = true;
        }
    }

    console.log(`Player ${playerId} joined as ${player.element}`);

    ws.send(JSON.stringify({
        type: 'INIT',
        playerId: playerId,
        player: player,
        arena: gameEngine.arena
    }));

    broadcast({
        type: 'PLAYER_JOINED',
        player: player
    }, playerId);

    broadcastElementAvailability();
}

function handleSpectatorInitialization(playerId, ws, message) {
    const desiredName = gameEngine.sanitizeName(message.name, playerId);
    
    gameEngine.addSpectator(playerId, desiredName);

    const state = connectionStates.get(playerId);
    if (state) {
        state.initialized = true;
        state.isSpectator = true;
        if (state.ws) {
            state.ws.isInitialized = true;
        }
    }

    console.log(`Spectator ${playerId} joined as ${desiredName}`);

    ws.send(JSON.stringify({
        type: 'SPECTATE_INIT',
        playerId: playerId,
        arena: gameEngine.arena
    }));

    broadcast({
        type: 'SPECTATOR_JOINED',
        playerId: playerId,
        name: desiredName
    }, playerId);
}

function handleDisconnect(playerId) {
    const state = connectionStates.get(playerId);
    if (!state) return;

    connectionStates.delete(playerId);

    if (state.initialized) {
        if (state.isSpectator) {
            console.log(`Spectator ${playerId} disconnected`);
            gameEngine.removeSpectator(playerId);
            broadcast({
                type: 'SPECTATOR_LEFT',
                playerId: playerId
            });
        } else {
            console.log(`Player ${playerId} disconnected`);
            gameEngine.removePlayer(playerId);
            broadcast({
                type: 'PLAYER_LEFT',
                playerId: playerId
            });
            broadcastElementAvailability();
        }
    }
}

function sendPlayerConfig(ws, playerId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type: 'PLAYER_CONFIG',
        playerId,
        availableElements: gameEngine.getElementAvailability()
    }));
}

function broadcastElementAvailability() {
    const payload = JSON.stringify({
        type: 'PLAYER_CONFIG',
        availableElements: gameEngine.getElementAvailability()
    });
    server.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && !client.isInitialized) {
            client.send(payload);
        }
    });
}

function sendElementSelectionError(ws, reason) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type: 'ELEMENT_SELECTION_ERROR',
        reason,
        availableElements: gameEngine.getElementAvailability()
    }));
}