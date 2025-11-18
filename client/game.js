class GameClient {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.tabIndex = 0;
        this.canvas.focus();
        this.ws = null;
        
        this.playerId = null;
        this.gameState = {
            players: {},
            cells: []
        };
        
        this.currentDirection = 'NONE';
        this.directionMap = {
            ArrowUp: 'UP',
            ArrowDown: 'DOWN',
            ArrowLeft: 'LEFT',
            ArrowRight: 'RIGHT',
            w: 'UP',
            s: 'DOWN',
            a: 'LEFT',
            d: 'RIGHT'
        };
        this.arena = { width: 1600, height: 900 };
        this.cellSize = 40;
        this.playerSize = 30;
        this.camera = {
            x: 0,
            y: 0,
            width: this.canvas.width,
            height: this.canvas.height
        };
        this.lastFrameTime = 0;
        
        this.setupEventListeners();
        this.showLoginScreen();
    }

    showLoginScreen() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('gameContainer').style.display = 'none';
        
        document.getElementById('startButton').onclick = () => {
            this.connectToServer();
        };
    }

    showGameScreen() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'block';
    }

    connectToServer() {
        this.ws = new WebSocket('ws://localhost:8080');
        
        this.ws.onopen = () => {
            console.log('Connected to game server');
            this.showGameScreen();
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.addChatMessage('system', 'Disconnected from server');
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleServerMessage(message) {
        switch (message.type) {
            case 'INIT':
                this.playerId = message.playerId;
                this.arena = message.arena;
                this.gameState.players[message.playerId] = message.player;
                this.updateHUD();
                break;
                
            case 'GAME_STATE_UPDATE':
                this.gameState = message.gameState;
                this.updateHUD();
                break;
                
            case 'PLAYER_JOINED':
                this.gameState.players[message.player.id] = message.player;
                this.addChatMessage('system', `Player ${message.player.id.substr(0, 8)} joined`);
                break;
                
            case 'PLAYER_LEFT':
                delete this.gameState.players[message.playerId];
                this.addChatMessage('system', `Player ${message.playerId.substr(0, 8)} left`);
                break;
                
            case 'CHAT_MESSAGE':
                const player = this.gameState.players[message.playerId];
                const playerName = player ? `Player${message.playerId.substr(0, 8)}` : 'Unknown';
                this.addChatMessage('player', `${playerName}: ${message.message}`);
                break;
        }
    }

    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            // Chat input
            if (e.key === 'Enter') {
                this.focusChatInput();
                return;
            }

            // Spacebar stop temporarily disabled
            // if (e.code === 'Space') {
            //     this.setDirection('NONE');
            //     e.preventDefault();
            //     return;
            // }

            const direction = this.directionMap[e.key];
            if (direction && direction !== this.currentDirection) {
                this.setDirection(direction);
                e.preventDefault();
            }
        });

        // Chat system
        document.getElementById('sendButton').addEventListener('click', () => {
            this.sendChatMessage();
        });

        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
    }

    focusChatInput() {
        const chatInput = document.getElementById('chatInput');
        chatInput.focus();
    }

    sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (message && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'CHAT_MESSAGE',
                message: message
            }));
            chatInput.value = '';
        }
        
        // Refocus canvas for game controls
        this.canvas.focus();
    }

    addChatMessage(type, message) {
        const chatMessages = document.getElementById('chatMessages');
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${type}`;
        messageElement.textContent = message;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    update(delta) {
        // Movement handled by direction commands from key presses
    }

    render() {
        this.updateCamera();

        // Clear canvas
        this.ctx.fillStyle = '#0B1324';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawClaimedCells();
        this.drawGrid();

        // Draw players
        Object.values(this.gameState.players).forEach(player => {
            this.drawPlayer(player);
        });
    }

    drawGrid() {
        this.ctx.strokeStyle = '#0f3460';
        this.ctx.lineWidth = 1;
        
        const offsetX = this.camera.x % this.cellSize;
        const offsetY = this.camera.y % this.cellSize;

        // Vertical lines
        for (let x = -offsetX; x <= this.canvas.width; x += this.cellSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = -offsetY; y <= this.canvas.height; y += this.cellSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawClaimedCells() {
        if (!Array.isArray(this.gameState.cells) || this.gameState.cells.length === 0) return;

        const startCol = Math.max(0, Math.floor(this.camera.x / this.cellSize));
        const endCol = Math.min(
            this.gameState.cells[0].length,
            Math.ceil((this.camera.x + this.camera.width) / this.cellSize)
        );
        const startRow = Math.max(0, Math.floor(this.camera.y / this.cellSize));
        const endRow = Math.min(
            this.gameState.cells.length,
            Math.ceil((this.camera.y + this.camera.height) / this.cellSize)
        );

        for (let row = startRow; row < endRow; row++) {
            const rowData = this.gameState.cells[row];
            if (!rowData) continue;

            for (let col = startCol; col < endCol; col++) {
                const cell = rowData[col];
                if (!cell) continue;

                const x = col * this.cellSize - this.camera.x;
                const y = row * this.cellSize - this.camera.y;
                this.ctx.fillStyle = cell.color;
                if (cell.isTrail) {
                    this.ctx.globalAlpha = 0.5;
                } else {
                    this.ctx.globalAlpha = 1;
                }
                this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
                this.ctx.globalAlpha = 1;

                if (cell.isTrail) {
                    this.ctx.strokeStyle = '#ffffff55';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
                }
            }
        }
    }

    drawPlayer(player) {
        const isCurrentPlayer = player.id === this.playerId;
        const screenX = player.x - this.camera.x;
        const screenY = player.y - this.camera.y;

        if (screenX + this.playerSize < 0 || screenX > this.canvas.width ||
            screenY + this.playerSize < 0 || screenY > this.canvas.height) {
            return;
        }

        this.ctx.fillStyle = player.color;
        this.ctx.fillRect(screenX, screenY, this.playerSize, this.playerSize);

        this.ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : '#0b1324';
        this.ctx.lineWidth = isCurrentPlayer ? 3 : 2;
        this.ctx.strokeRect(screenX, screenY, this.playerSize, this.playerSize);

        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.fillText(player.id.substr(0, 4), screenX, screenY - 10);
        this.ctx.fillText(`${player.area || 0} cells`, screenX, screenY + this.playerSize + 15);
    }

    setDirection(direction) {
        if (!this.ws || direction === this.currentDirection) return;
        this.currentDirection = direction;
        this.ws.send(JSON.stringify({
            type: 'MOVEMENT',
            direction
        }));
    }

    updateHUD() {
        if (!this.playerId) return;
        
        const player = this.gameState.players[this.playerId];
        if (player) {
            document.getElementById('territory').textContent = player.area || 0;
            document.getElementById('cellsCaptured').textContent = player.area || 0;
            document.getElementById('playerCount').textContent = Object.keys(this.gameState.players).length;
        }

        this.updateScoreboard();
    }

    updateScoreboard() {
        const list = document.getElementById('scoreList');
        if (!list) return;

        const players = Object.values(this.gameState.players || {});
        players.sort((a, b) => (b.area || 0) - (a.area || 0));

        list.innerHTML = '';

        players.forEach((player, index) => {
            const item = document.createElement('li');
            if (player.id === this.playerId) {
                item.classList.add('current');
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.textContent = `${index + 1}. ${player.id.substr(0, 4)}`;

            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'player-score';
            scoreSpan.textContent = `${player.area || 0}`;

            item.appendChild(nameSpan);
            item.appendChild(scoreSpan);
            list.appendChild(item);
        });
    }

    updateCamera() {
        if (!this.playerId) return;
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        const centerX = player.x + this.playerSize / 2;
        const centerY = player.y + this.playerSize / 2;

        const maxX = Math.max(0, this.arena.width - this.camera.width);
        const maxY = Math.max(0, this.arena.height - this.camera.height);

        this.camera.x = Math.min(maxX, Math.max(0, centerX - this.camera.width / 2));
        this.camera.y = Math.min(maxY, Math.max(0, centerY - this.camera.height / 2));
    }

    gameLoop(timestamp = 0) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const delta = timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;

        this.update(delta);
        this.render();
        requestAnimationFrame((nextTimestamp) => this.gameLoop(nextTimestamp));
    }
}

// Khởi động game khi trang load
window.addEventListener('load', () => {
    const game = new GameClient();
    requestAnimationFrame((timestamp) => game.gameLoop(timestamp));
});