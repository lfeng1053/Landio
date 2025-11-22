class GameEngine {
    constructor() {
        this.players = new Map();
        this.spectators = new Map(); // spectatorId -> { id, name }
        this.arena = { width: 3200, height: 2000 };
        this.cellSize = 64;
        this.playerSize = 30;
        this.cols = Math.floor(this.arena.width / this.cellSize);
        this.rows = Math.floor(this.arena.height / this.cellSize);
        this.respawnDelay = 2000;
        this.elements = ['water', 'fung', 'lavar', 'desert'];
        this.elementColors = {
            water: '#3B82F6',
            fung: '#10B981',
            lavar: '#FF6B35',
            desert: '#F59E0B'
        };
        this.oppositeDirections = {
            UP: 'DOWN',
            DOWN: 'UP',
            LEFT: 'RIGHT',
            RIGHT: 'LEFT'
        };
        this.matchDuration = 3 * 60 * 1000;
        this.matchStartTime = null;
        this.gameState = {
            players: {},
            cells: this.createEmptyGrid(),
            gameTime: 0,
            timeRemaining: this.matchDuration,
            gameOver: false,
            winnerId: null,
            winnerName: null
        };
        this.lastUpdateTime = Date.now();
    }

    createEmptyGrid() {
        return Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => null)
        );
    }

    addPlayer(playerId, ws, config = {}) {
        const spawn = this.getRandomSpawn(1);
        const preferredElement = config.element;
        const element = this.selectElementForNewPlayer(preferredElement, playerId);
        
        const playerName = config.name ? this.sanitizeName(config.name, playerId) : this.generateDefaultName(playerId);
        const player = {
            id: playerId,
            name: playerName,
            element: element,
            color: this.elementColors[element],
            area: 0,
            col: spawn.col,
            row: spawn.row,
            x: spawn.x,
            y: spawn.y,
            direction: 'NONE',
            moveInterval: 120,
            moveProgress: 0,
            isMoving: false,
            fromX: spawn.x,
            fromY: spawn.y,
            targetX: spawn.x,
            targetY: spawn.y,
            targetCol: spawn.col,
            targetRow: spawn.row,
            isOutside: false,
            trail: new Set(),
            isRespawning: false,
            respawnTimeout: null,
            ws
        };

        const wasEmpty = this.players.size === 0;
        this.players.set(playerId, player);
        this.createSafeZone(player, 1);
        this.updatePlayerSnapshot(playerId);
        if (wasEmpty) {
            this.startMatchTimer();
        }

        return this.getPlayerSnapshot(playerId);
    }

    removePlayer(playerId) {
        this.clearTerritory(playerId);
        const player = this.players.get(playerId);
        if (player && player.respawnTimeout) {
            clearTimeout(player.respawnTimeout);
        }
        this.players.delete(playerId);
        delete this.gameState.players[playerId];
        if (this.players.size === 0) {
            this.resetMatchTimerState();
        }
    }

    addSpectator(spectatorId, name) {
        this.spectators.set(spectatorId, {
            id: spectatorId,
            name: name
        });
    }

    removeSpectator(spectatorId) {
        this.spectators.delete(spectatorId);
    }

    getPlayerCount() {
        return this.players.size;
    }

    setPlayerDirection(playerId, direction) {
        if (this.gameState.gameOver) return;
        const player = this.players.get(playerId);
        if (!player) return;
        const normalizedDirection = direction || 'NONE';

        if (this.isOppositeDirection(normalizedDirection, player.direction)) {
            return;
        }

        player.direction = normalizedDirection;
        this.tryStartMove(player);
    }

    claimCell(player) {
        const col = player.col;
        const row = player.row;

        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

        const currentOwner = this.gameState.cells[row][col];

        if (currentOwner && currentOwner.ownerId === player.id) {
            if (currentOwner.isTrail) {
                this.resetPlayer(player.id);
                return;
            }

            this.completePlayerTrail(player);
            this.fillCapturedAreas(player.id);
            return;
        }

        if (currentOwner && currentOwner.ownerId !== player.id) {
            if (currentOwner.isTrail) {
                this.handleTrailHit(currentOwner.ownerId, player.id, row, col);
            } else {
                this.decrementOwnerArea(currentOwner.ownerId);
                this.gameState.cells[row][col] = null;
            }
        }
        const isTrail = !currentOwner || currentOwner.ownerId !== player.id;
        const cellData = {
            ownerId: player.id,
            color: player.color,
            isTrail
        };

        if (isTrail && player.isOutside && this.isSelfTrailCollision(player, row, col)) {
            this.resetPlayer(player.id);
            return;
        }

        this.gameState.cells[row][col] = cellData;

        if (isTrail) {
            player.isOutside = true;
            const key = this.getCellKey(row, col);
            player.trail.add(key);
        } else {
            player.area += 1;
        }
        this.updatePlayerSnapshot(player.id);
    }

    clearTerritory(playerId) {
        let clearedSafe = 0;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const cell = this.gameState.cells[row][col];
                if (cell && cell.ownerId === playerId) {
                    if (!cell.isTrail) {
                        clearedSafe += 1;
                    }
                    this.gameState.cells[row][col] = null;
                }
            }
        }

        const player = this.players.get(playerId);
        if (player) {
            player.area = Math.max(0, player.area - clearedSafe);
            player.trail.clear();
            player.isOutside = false;
            this.updatePlayerSnapshot(playerId);
        }
    }

    update() {
        const now = Date.now();
        const deltaTime = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        this.gameState.gameTime += deltaTime;
        this.updateMatchTimer();
        if (this.gameState.gameOver) {
            return;
        }
        this.movePlayers(deltaTime);
    }

    movePlayers(deltaTime) {
        this.players.forEach(player => {
            if (player.isRespawning) {
                return;
            }
            if (!player.isMoving) {
                this.tryStartMove(player);
            }

            if (!player.isMoving) {
                this.updatePlayerSnapshot(player.id);
                return;
            }

            player.moveProgress += deltaTime / player.moveInterval;

            while (player.moveProgress >= 1) {
                player.moveProgress -= 1;
                this.finishMove(player);
                if (!this.tryStartMove(player)) {
                    player.moveProgress = 0;
                    break;
                }
            }

            if (player.isMoving) {
                player.x = this.lerp(player.fromX, player.targetX, player.moveProgress);
                player.y = this.lerp(player.fromY, player.targetY, player.moveProgress);
            }

            this.updatePlayerSnapshot(player.id);
        });
    }

    getDirectionDelta(direction) {
        switch (direction) {
            case 'UP': return { x: 0, y: -1 };
            case 'DOWN': return { x: 0, y: 1 };
            case 'LEFT': return { x: -1, y: 0 };
            case 'RIGHT': return { x: 1, y: 0 };
            default: return null;
        }
    }

    getAlignedPosition(col, row) {
        const padding = (this.cellSize - this.playerSize) / 2;
        return {
            x: col * this.cellSize + padding,
            y: row * this.cellSize + padding
        };
    }

    getRandomSpawn(radius = 1) {
        const attempts = 50;
        for (let i = 0; i < attempts; i++) {
            const col = this.getRandomCoordinate(this.cols, radius);
            const row = this.getRandomCoordinate(this.rows, radius);
            if (this.isZoneAvailable(col, row, radius)) {
                return { col, row, ...this.getAlignedPosition(col, row) };
            }
        }
        const fallbackCol = this.getRandomCoordinate(this.cols, radius);
        const fallbackRow = this.getRandomCoordinate(this.rows, radius);
        return { col: fallbackCol, row: fallbackRow, ...this.getAlignedPosition(fallbackCol, fallbackRow) };
    }

    getRandomCoordinate(max, radius) {
        const min = radius;
        const limit = Math.max(radius, max - radius - 1);
        return Math.floor(Math.random() * (limit - min + 1)) + min;
    }

    isZoneAvailable(centerCol, centerRow, radius) {
        for (let row = centerRow - radius; row <= centerRow + radius; row++) {
            if (row < 0 || row >= this.rows) continue;
            for (let col = centerCol - radius; col <= centerCol + radius; col++) {
                if (col < 0 || col >= this.cols) continue;
                if (this.gameState.cells[row][col]) {
                    return false;
                }
            }
        }
        return true;
    }

    fillCapturedAreas(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        const visited = Array.from({ length: this.rows }, () =>
            Array(this.cols).fill(false)
        );
        const queue = [];

        const enqueueIfOpen = (row, col) => {
            if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
            if (visited[row][col]) return;
            if (this.isPlayerCell(row, col, playerId)) return;
            visited[row][col] = true;
            queue.push({ row, col });
        };

        for (let col = 0; col < this.cols; col++) {
            enqueueIfOpen(0, col);
            enqueueIfOpen(this.rows - 1, col);
        }
        for (let row = 0; row < this.rows; row++) {
            enqueueIfOpen(row, 0);
            enqueueIfOpen(row, this.cols - 1);
        }

        while (queue.length > 0) {
            const { row, col } = queue.shift();
            enqueueIfOpen(row - 1, col);
            enqueueIfOpen(row + 1, col);
            enqueueIfOpen(row, col - 1);
            enqueueIfOpen(row, col + 1);
        }

        let captured = 0;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (visited[row][col]) continue;

                const cell = this.gameState.cells[row][col];
                if (cell && cell.ownerId === playerId) continue;

                if (cell && cell.ownerId !== playerId) {
                    const previousOwner = this.players.get(cell.ownerId);
                    if (previousOwner && previousOwner.area > 0) {
                        previousOwner.area = Math.max(0, previousOwner.area - 1);
                        this.updatePlayerSnapshot(previousOwner.id);
                    }
                }

                this.gameState.cells[row][col] = {
                    ownerId: playerId,
                    color: player.color
                };
                captured += 1;
            }
        }

        if (captured > 0) {
            player.area += captured;
            this.updatePlayerSnapshot(playerId);
        }
    }

    isPlayerCell(row, col, playerId) {
        const cell = this.gameState.cells[row][col];
        return cell && cell.ownerId === playerId;
    }

    getRandomColor() {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    handleTrailHit(victimId, attackerId, row, col) {
        const victim = this.players.get(victimId);
        if (!victim) return;

        const cell = this.gameState.cells[row]?.[col];
        if (!cell || cell.ownerId !== victimId || !cell.isTrail) {
            return;
        }

        this.resetPlayer(victimId);
    }

    tryStartMove(player) {
        if (player.direction === 'NONE') return false;
        const delta = this.getDirectionDelta(player.direction);
        if (!delta) return false;

        const newCol = player.col + delta.x;
        const newRow = player.row + delta.y;

        if (newCol < 0 || newCol >= this.cols || newRow < 0 || newRow >= this.rows) {
            player.direction = 'NONE';
            return false;
        }

        const alignedCurrent = this.getAlignedPosition(player.col, player.row);
        const alignedTarget = this.getAlignedPosition(newCol, newRow);

        player.fromX = alignedCurrent.x;
        player.fromY = alignedCurrent.y;
        player.targetX = alignedTarget.x;
        player.targetY = alignedTarget.y;
        player.targetCol = newCol;
        player.targetRow = newRow;
        player.isMoving = true;
        player.moveProgress = 0;
        return true;
    }

    finishMove(player) {
        player.col = player.targetCol;
        player.row = player.targetRow;
        player.x = player.targetX;
        player.y = player.targetY;
        player.isMoving = false;
        this.claimCell(player);
    }

    lerp(a, b, t) {
        return a + (b - a) * Math.min(Math.max(t, 0), 1);
    }

    resetPlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        this.clearTerritory(playerId);

        delete this.gameState.players[playerId];

        player.direction = 'NONE';
        player.isMoving = false;
        player.moveProgress = 0;
        player.trail.clear();
        player.isOutside = false;
        player.area = 0;
        player.isRespawning = true;

        if (player.respawnTimeout) {
            clearTimeout(player.respawnTimeout);
        }

        player.respawnTimeout = setTimeout(() => {
            this.finishRespawn(playerId);
        }, this.respawnDelay);
    }

    finishRespawn(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        const spawn = this.getRandomSpawn(1);
        player.col = spawn.col;
        player.row = spawn.row;
        player.x = spawn.x;
        player.y = spawn.y;
        player.direction = 'NONE';
        player.isMoving = false;
        player.moveProgress = 0;
        player.fromX = spawn.x;
        player.fromY = spawn.y;
        player.targetX = spawn.x;
        player.targetY = spawn.y;
        player.targetCol = spawn.col;
        player.targetRow = spawn.row;
        player.trail.clear();
        player.isOutside = false;
        player.area = 0;
        player.isRespawning = false;
        player.respawnTimeout = null;

        this.createSafeZone(player, 1);
    }

    completePlayerTrail(player) {
        if (!player.trail.size) {
            player.isOutside = false;
            return;
        }

        let promoted = 0;

        player.trail.forEach(key => {
            const { row, col } = this.parseCellKey(key);
            const cell = this.gameState.cells[row]?.[col];
            if (cell && cell.ownerId === player.id) {
                if (cell.isTrail) {
                    cell.isTrail = false;
                    promoted += 1;
                }
            }
        });

        if (promoted > 0) {
            player.area += promoted;
        }

        player.trail.clear();
        player.isOutside = false;
    }

    decrementOwnerArea(ownerId) {
        const owner = this.players.get(ownerId);
        if (owner && owner.area > 0) {
            owner.area -= 1;
            this.updatePlayerSnapshot(ownerId);
        }
    }

    getCellKey(row, col) {
        return `${row}:${col}`;
    }

    parseCellKey(key) {
        const [row, col] = key.split(':').map(Number);
        return { row, col };
    }

    isSelfTrailCollision(player, row, col) {
        const key = this.getCellKey(row, col);
        return player.trail.has(key);
    }

    createSafeZone(player, radius = 1) {
        player.isOutside = false;
        player.trail.clear();

        for (let row = player.row - radius; row <= player.row + radius; row++) {
            if (row < 0 || row >= this.rows) continue;

            for (let col = player.col - radius; col <= player.col + radius; col++) {
                if (col < 0 || col >= this.cols) continue;

                const cell = this.gameState.cells[row][col];
                if (cell && cell.ownerId === player.id && !cell.isTrail) {
                    continue;
                }

                if (cell && cell.ownerId !== player.id) {
                    this.decrementOwnerArea(cell.ownerId);
                }

                const isNewCell = !cell || cell.ownerId !== player.id;
                this.gameState.cells[row][col] = {
                    ownerId: player.id,
                    color: player.color,
                    isTrail: false
                };

                if (isNewCell) {
                    player.area += 1;
                }
            }
        }

        this.updatePlayerSnapshot(player.id);
    }

    getPlayerSnapshot(playerId) {
        const player = this.players.get(playerId);
        if (!player) return null;

        return {
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            color: player.color,
            area: player.area,
            element: player.element
        };
    }

    updatePlayerSnapshot(playerId) {
        const snapshot = this.getPlayerSnapshot(playerId);
        if (snapshot) {
            this.gameState.players[playerId] = snapshot;
        }
    }

    getGameState() {
        return this.gameState;
    }

    setPlayerName(playerId, rawName) {
        const player = this.players.get(playerId);
        if (!player) return;
        const sanitized = this.sanitizeName(rawName, playerId);
        player.name = sanitized;
        this.updatePlayerSnapshot(playerId);
        return sanitized;
    }

    setPlayerElement(playerId, element) {
        if (!this.elements.includes(element)) {
            return { success: false, reason: 'INVALID_ELEMENT' };
        }
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, reason: 'PLAYER_NOT_FOUND' };
        }
        if (player.element === element) {
            return {
                success: true,
                element: player.element,
                color: player.color
            };
        }

        if (!this.isElementAvailable(element, playerId)) {
            return { success: false, reason: 'ELEMENT_TAKEN' };
        }

        player.element = element;
        player.color = this.elementColors[element] || player.color;
        this.applyPlayerColorToCells(playerId, player.color);
        this.updatePlayerSnapshot(playerId);
        return {
            success: true,
            element: player.element,
            color: player.color
        };
    }

    applyPlayerColorToCells(playerId, color) {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const cell = this.gameState.cells[row][col];
                if (cell && cell.ownerId === playerId) {
                    cell.color = color;
                }
            }
        }
    }

    selectElementForNewPlayer(preferredElement, playerId) {
        if (preferredElement && this.isElementAvailable(preferredElement, playerId)) {
            return preferredElement;
        }
        const available = this.elements.find(el => this.isElementAvailable(el, playerId));
        return available || this.elements[0];
    }

    isElementAvailable(element, excludePlayerId = null) {
        if (!this.elements.includes(element)) return false;
        for (const player of this.players.values()) {
            if (player.element === element && player.id !== excludePlayerId) {
                return false;
            }
        }
        return true;
    }

    getElementAvailability() {
        const availability = {};
        this.elements.forEach(element => {
            availability[element] = this.isElementAvailable(element);
        });
        return availability;
    }

    isOppositeDirection(dirA, dirB) {
        if (!dirA || !dirB) return false;
        if (dirA === 'NONE' || dirB === 'NONE') return false;
        return this.oppositeDirections[dirA] === dirB || this.oppositeDirections[dirB] === dirA;
    }

    sanitizeName(name, playerId) {
        const fallback = this.generateDefaultName(playerId);
        if (!name) return fallback;
        const trimmed = name.trim().substring(0, 9);
        const cleaned = trimmed.replace(/[<>]/g, '').replace(/[^\p{L}\p{N}\s_\-]/gu, '');
        return cleaned || fallback;
    }

    generateDefaultName(playerId) {
        return `Player${playerId.slice(0, 4)}`;
    }

    updateMatchTimer() {
        if (this.gameState.gameOver) {
            this.gameState.timeRemaining = 0;
            return;
        }
        if (!this.matchStartTime) {
            this.gameState.timeRemaining = this.matchDuration;
            return;
        }
        const elapsed = Date.now() - this.matchStartTime;
        const remaining = Math.max(0, this.matchDuration - elapsed);
        this.gameState.timeRemaining = remaining;
        if (remaining === 0) {
            this.endMatch();
        }
    }

    endMatch() {
        if (this.gameState.gameOver) return;
        this.gameState.gameOver = true;
        const winner = this.determineWinner();
        this.gameState.winnerId = winner ? winner.id : null;
        this.gameState.winnerName = winner ? winner.name : null;

        this.players.forEach(player => {
            player.direction = 'NONE';
            player.isMoving = false;
            player.moveProgress = 0;
            this.updatePlayerSnapshot(player.id);
        });
    }

    determineWinner() {
        let winner = null;
        this.players.forEach(player => {
            if (!winner || (player.area || 0) > (winner.area || 0)) {
                winner = player;
            }
        });
        return winner;
    }

    startMatchTimer() {
        this.matchStartTime = Date.now();
        this.gameState.timeRemaining = this.matchDuration;
        this.gameState.gameOver = false;
        this.gameState.winnerId = null;
        this.gameState.winnerName = null;
    }

    resetMatchTimerState() {
        this.matchStartTime = null;
        this.gameState.timeRemaining = this.matchDuration;
        this.gameState.gameOver = false;
        this.gameState.winnerId = null;
        this.gameState.winnerName = null;
    }
}

module.exports = GameEngine;