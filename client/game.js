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
        this.elementImages = {
            water: [],
            fung: null,
            lavar: null,
            desert: null
        };
        this.dirtImages = [];
        this.dirtIndexCache = new Map(); // Cache for dirt tile indices
        this.loadElementImages();
        this.loadDirtImages();
        this.playerName = '';
        this.availableElements = ['water', 'fung', 'lavar', 'desert'];
        this.selectedElement = this.availableElements[0];
        this.timerElement = document.getElementById('timer');
        this.statusMessageElement = document.getElementById('statusMessage');
        this.timerSync = null;
        this.elementSelectionInitialized = false;
        this.loginUIInitialized = false;
        this.elementAvailability = {};
        this.currentLoginStep = 'name';
        this.loginStepElements = {};
        this.nameErrorElement = null;
        this.elementErrorElement = null;
        this.pendingInitPayload = null;
        this.isAttemptingJoin = false;
        this.pendingPlayerId = null;
        this.isSpectator = false;
        
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
        this.oppositeDirections = {
            UP: 'DOWN',
            DOWN: 'UP',
            LEFT: 'RIGHT',
            RIGHT: 'LEFT'
        };
        this.arena = { width: 1600, height: 900 };
        this.cellSize = 64;
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

    loadElementImages() {
        // Load water images (multiple files)
        for (let i = 1; i <= 9; i++) {
            const img = new Image();
            img.src = `../elements/water/water${i}.png`;
            img.onload = () => {
                this.elementImages.water.push(img);
            };
            img.onerror = () => {
                console.warn(`Failed to load water texture: water${i}.png`);
            };
        }

        // Load other elements
        const otherElements = [
            { name: 'fung', folder: 'fung', file: 'fung.png' },
            { name: 'lavar', folder: 'lavar', file: 'lavar.png' },
            { name: 'desert', folder: 'Desert', file: 'desert.png' }
        ];

        otherElements.forEach(({ name, folder, file }) => {
            const img = new Image();
            img.src = `../elements/${folder}/${file}`;
            img.onload = () => {
                this.elementImages[name] = img;
            };
            img.onerror = () => {
                console.warn(`Failed to load texture for element: ${name}`);
            };
        });
    }

    loadDirtImages() {
        const dirtFiles = [
            'dirt1.png',
            'dirt2.png',
            'dirt3.png',
            'dirt4.png',
            'dirt5.png',
            'dirt6.png',
            'dirt7.png',
            'dirt8.png',
            'dirt9.png',
            'dirt10.png',
            'dirt11.png',
            'dirt12.png',
            'dirt13.png',
            'dirt14.png',
            'dirt15.png'
        ];
        
        dirtFiles.forEach((filename) => {
            const img = new Image();
            img.src = `../elements/Dirt/${filename}`;
            img.onload = () => {
                this.dirtImages.push(img);
            };
            img.onerror = () => {
                console.warn(`Failed to load dirt texture: ${filename}`);
            };
        });
    }

    showLoginScreen() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('gameContainer').style.display = 'none';
        
        this.setupLoginUI();
        this.switchLoginStep('name');
        this.setupElementSelection();
    }

    showGameScreen() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'block';
    }

    setupLoginUI() {
        if (this.loginUIInitialized) return;
        this.loginStepElements = {
            nameStep: document.getElementById('nameStep'),
            elementStep: document.getElementById('elementStep'),
            nameInput: document.getElementById('playerNameInput'),
            continueButton: document.getElementById('continueButton'),
            backButton: document.getElementById('backToNameButton'),
            startButton: document.getElementById('startButton'),
            spectateButton: document.getElementById('spectateButton'),
            spectateFromNameButton: document.getElementById('spectateFromNameButton')
        };
        this.nameErrorElement = document.getElementById('nameError');
        this.elementErrorElement = document.getElementById('elementError');

        this.loginStepElements.continueButton.addEventListener('click', () => this.handleNameSubmission());
        this.loginStepElements.backButton.addEventListener('click', () => this.switchLoginStep('name'));
        this.loginStepElements.startButton.addEventListener('click', () => this.handleJoinGame());
        this.loginStepElements.spectateButton.addEventListener('click', () => this.handleSpectate());
        if (this.loginStepElements.spectateFromNameButton) {
            this.loginStepElements.spectateFromNameButton.addEventListener('click', () => this.handleSpectateFromName());
        }
        this.loginStepElements.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleNameSubmission();
            }
        });
        this.loginUIInitialized = true;
    }

    handleNameSubmission() {
        const input = this.loginStepElements.nameInput;
        const sanitized = this.sanitizePlayerName(input.value);
        if (!sanitized) {
            this.showNameError('Please enter a valid name');
            return;
        }
        this.playerName = sanitized;
        input.value = sanitized;
        this.showNameError('');
        this.switchLoginStep('element');
        this.ensureConnection();
    }

    handleJoinGame() {
        if (!this.playerName) {
            this.showNameError('Please enter your name first.');
            this.switchLoginStep('name');
            return;
        }
        if (!this.selectedElement) {
            this.showElementError('Please choose an element');
            return;
        }

        if (this.elementAvailability[this.selectedElement] === false) {
            this.showElementError('This element is already taken');
            return;
        }

        this.showElementError('');
        this.isSpectator = false;
        this.setJoinLoading(true);
        this.pendingInitPayload = {
            name: this.playerName,
            element: this.selectedElement
        };
        this.ensureConnection();
        this.trySendInitPayload();
    }

    handleSpectateFromName() {
        const input = this.loginStepElements.nameInput;
        const sanitized = this.sanitizePlayerName(input.value);
        if (!sanitized) {
            this.showNameError('Please enter a valid name');
            return;
        }
        this.playerName = sanitized;
        input.value = sanitized;
        this.showNameError('');
        
        this.isSpectator = true;
        this.setJoinLoading(true);
        this.pendingInitPayload = {
            name: this.playerName,
            isSpectator: true
        };
        this.ensureConnection();
        this.trySendSpectatePayload();
    }

    handleSpectate() {
        if (!this.playerName) {
            this.showNameError('Please enter your name first.');
            this.switchLoginStep('name');
            return;
        }

        this.showElementError('');
        this.isSpectator = true;
        this.setJoinLoading(true);
        this.pendingInitPayload = {
            name: this.playerName,
            isSpectator: true
        };
        this.ensureConnection();
        this.trySendSpectatePayload();
    }

    setJoinLoading(isLoading) {
        this.isAttemptingJoin = isLoading;
        this.updateJoinButtonState();
        const startButton = this.loginStepElements.startButton;
        const spectateButton = this.loginStepElements.spectateButton;
        const spectateFromNameButton = this.loginStepElements.spectateFromNameButton;
        const continueButton = this.loginStepElements.continueButton;
        
        if (startButton) {
            startButton.textContent = isLoading ? 'Joining...' : 'Join Match';
        }
        if (spectateButton) {
            spectateButton.disabled = isLoading;
            spectateButton.textContent = isLoading ? 'Joining...' : 'Spectate';
        }
        if (spectateFromNameButton) {
            spectateFromNameButton.disabled = isLoading;
            spectateFromNameButton.textContent = isLoading ? 'Joining...' : 'Spectate';
        }
        if (continueButton) {
            continueButton.disabled = isLoading;
        }
    }

    updateJoinButtonState() {
        const startButton = this.loginStepElements.startButton;
        if (!startButton) return;
        const isDisabled = this.isAttemptingJoin ||
            !this.selectedElement ||
            this.elementAvailability[this.selectedElement] === false;
        startButton.disabled = isDisabled;
    }

    showNameError(message) {
        if (this.nameErrorElement) {
            this.nameErrorElement.textContent = message || '';
        }
    }

    showElementError(message) {
        if (this.elementErrorElement) {
            this.elementErrorElement.textContent = message || '';
        }
    }

    switchLoginStep(step) {
        this.currentLoginStep = step;
        if (!this.loginStepElements.nameStep || !this.loginStepElements.elementStep) return;
        this.loginStepElements.nameStep.classList.toggle('active', step === 'name');
        this.loginStepElements.elementStep.classList.toggle('active', step === 'element');
        if (step === 'name') {
            this.setJoinLoading(false);
            this.showElementError('');
        } else {
            this.updateJoinButtonState();
            this.showElementError('');
        }
    }

    handleElementAvailability(availableElements = {}, playerIdHint = null) {
        if (this.playerId) return;
        if (playerIdHint) {
            this.pendingPlayerId = playerIdHint;
        }
        this.updateElementOptionsAvailability(availableElements);
        this.updateJoinButtonState();
    }

    handleElementSelectionError(reason, availability) {
        this.pendingInitPayload = null;
        this.setJoinLoading(false);
        this.showElementError(this.translateElementError(reason));
        if (availability) {
            this.updateElementOptionsAvailability(availability);
        }
    }

    translateElementError(reason) {
        switch (reason) {
            case 'ELEMENT_TAKEN':
                return 'This element is already being used.';
            case 'INVALID_ELEMENT':
                return 'Invalid element.';
            case 'ELEMENT_REQUIRED':
                return 'Please select an element.';
            default:
                return 'Unable to select element. Please try again.';
        }
    }

    setupElementSelection() {
        if (this.elementSelectionInitialized) {
            this.updateElementOptionsAvailability();
            this.selectElement(this.selectedElement);
            return;
        }

        const optionButtons = document.querySelectorAll('.element-option');
        if (!optionButtons.length) return;
        optionButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const element = button.dataset.element;
                if (element) {
                    this.selectElement(element);
                }
            });
        });

        const initialElement = this.selectedElement || optionButtons[0].dataset.element;
        if (initialElement) {
            this.selectElement(initialElement);
        }
        this.elementSelectionInitialized = true;
        this.updateElementOptionsAvailability();
    }

    selectElement(element) {
        if (!this.availableElements.includes(element)) return;
        if (this.elementAvailability[element] === false) return;
        this.selectedElement = element;
        const optionButtons = document.querySelectorAll('.element-option');
        optionButtons.forEach((button) => {
            const isSelected = button.dataset.element === element;
            button.classList.toggle('selected', isSelected);
        });
        this.updateJoinButtonState();
    }

    updateElementOptionsAvailability(availabilityUpdate = null) {
        if (availabilityUpdate) {
            this.elementAvailability = {
                ...this.elementAvailability,
                ...availabilityUpdate
            };
        }

        const optionButtons = document.querySelectorAll('.element-option');
        if (!optionButtons.length) return;
        optionButtons.forEach((button) => {
            const element = button.dataset.element;
            const isAvailable = this.elementAvailability[element] !== false;
            button.disabled = !isAvailable;
            button.classList.toggle('disabled', !isAvailable);
        });

        if (this.selectedElement && this.elementAvailability[this.selectedElement] === false) {
            this.selectedElement = null;
        }

        if (!this.selectedElement) {
            const firstAvailable = this.availableElements.find(el => this.elementAvailability[el] !== false);
            if (firstAvailable) {
                this.selectElement(firstAvailable);
            }
        } else {
            this.updateJoinButtonState();
        }
    }

    ensureConnection() {
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.trySendInitPayload();
                return;
            }
            if (this.ws.readyState === WebSocket.CONNECTING) {
                return;
            }
        }
        this.createWebSocket();
    }

    createWebSocket() {
        this.ws = new WebSocket('ws://localhost:8080');
        
        this.ws.onopen = () => {
            console.log('Connected to game server');
            if (this.isSpectator) {
                this.trySendSpectatePayload();
            } else {
                this.trySendInitPayload();
            }
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            if (this.playerId) {
                this.addChatMessage('system', 'Disconnected from server');
            } else if (this.currentLoginStep === 'element') {
                this.showElementError('Lost connection to the server. Please try again.');
                this.setJoinLoading(false);
            }
            this.ws = null;
            this.pendingInitPayload = null;
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (!this.playerId && this.currentLoginStep === 'element') {
                this.showElementError('Unable to connect to the server. Please try again.');
                this.setJoinLoading(false);
            }
        };
    }

    trySendInitPayload() {
        if (!this.pendingInitPayload) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            type: 'INIT_PLAYER',
            name: this.pendingInitPayload.name,
            element: this.pendingInitPayload.element
        }));
    }

    trySendSpectatePayload() {
        if (!this.pendingInitPayload) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            type: 'SPECTATE',
            name: this.pendingInitPayload.name
        }));
    }

    handleServerMessage(message) {
        switch (message.type) {
            case 'PLAYER_CONFIG':
                this.handleElementAvailability(message.availableElements, message.playerId);
                return;
            case 'ELEMENT_SELECTION_ERROR':
                this.handleElementSelectionError(message.reason, message.availableElements);
                return;
            case 'ROOM_FULL':
                this.setJoinLoading(false);
                this.showElementError('Room is full (max 4 players). Please choose spectator mode.');
                return;
        }

        if (!this.playerId && message.type !== 'INIT') {
            return;
        }

        switch (message.type) {
            case 'INIT':
                this.playerId = message.playerId;
                this.arena = message.arena;
                this.gameState.players[message.playerId] = message.player;
                this.playerName = message.player.name || this.playerName;
                this.pendingInitPayload = null;
                this.setJoinLoading(false);
                this.showGameScreen();
                this.updateHUD();
                break;
                
            case 'SPECTATE_INIT':
                this.playerId = message.playerId;
                this.arena = message.arena;
                this.isSpectator = true;
                this.pendingInitPayload = null;
                this.setJoinLoading(false);
                this.showGameScreen();
                this.updateHUD();
                this.addChatMessage('system', 'You are in spectator mode');
                break;
                
            case 'GAME_STATE_UPDATE':
                this.gameState = message.gameState;
                this.syncTimer(message.gameState?.timeRemaining, message.timestamp);
                this.updateHUD();
                break;
                
            case 'PLAYER_JOINED':
                this.gameState.players[message.player.id] = message.player;
                this.addChatMessage('system', `${message.player.name || message.player.id.substr(0, 8)} joined`);
                break;
                
            case 'PLAYER_LEFT':
                const departingPlayer = this.gameState.players[message.playerId];
                const departingName = departingPlayer ? (departingPlayer.name || departingPlayer.id.substr(0, 8)) : message.playerId.substr(0, 8);
                delete this.gameState.players[message.playerId];
                this.addChatMessage('system', `${departingName} left`);
                break;
                
            case 'SPECTATOR_JOINED':
                this.addChatMessage('system', `${message.name || message.playerId.substr(0, 8)} joined as spectator`);
                break;
                
            case 'SPECTATOR_LEFT':
                this.addChatMessage('system', `Spectator left`);
                break;
                
            case 'CHAT_MESSAGE':
                const player = this.gameState.players[message.playerId];
                const playerName = player ? (player.name || player.id.substr(0, 8)) : 'Unknown';
                this.addChatMessage('player', `${playerName}: ${message.message}`);
                break;
            case 'PLAYER_RENAMED':
                this.handlePlayerRenamed(message.playerId, message.name);
                break;
            case 'PLAYER_ELEMENT_CHANGED':
                this.handlePlayerElementChanged(message.playerId, message.element, message.color);
                break;
        }
    }

    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            const activeTag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || e.target?.isContentEditable;
            if (isTyping) {
                return;
            }
            // Chat input
            if (e.key === 'Enter') {
                this.focusChatInput();
                return;
            }

            if (e.code === 'Space') {
                this.setDirection('NONE');
                e.preventDefault();
                return;
            }

            const direction = this.directionMap[e.key];
            if (direction && direction !== this.currentDirection && !this.isOppositeDirection(direction, this.currentDirection)) {
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

        // Draw background dirt tiles
        this.drawBackgroundDirt();

        // Draw claimed cells (on top of dirt)
        this.drawClaimedCells();

        // Draw players
        Object.values(this.gameState.players).forEach(player => {
            this.drawPlayer(player);
        });
    }

    getDirtColorGroup(index) {
        // Groups: 1-5, 6-10, 11-15 (0-indexed: 0-4, 5-9, 10-14)
        if (index < 5) return 0; // Group 1-5
        if (index < 10) return 1; // Group 6-10
        return 2; // Group 11-15
    }

    getDirtIndexForCell(row, col) {
        const key = `${row}_${col}`;
        
        // Check cache first
        if (this.dirtIndexCache.has(key)) {
            return this.dirtIndexCache.get(key);
        }

        // Get base index from hash
        const hash = this.simpleHash(row, col, 'dirt');
        let dirtIndex = Math.abs(hash) % this.dirtImages.length;
        const baseGroup = this.getDirtColorGroup(dirtIndex);

        // Check neighboring cells to avoid too many same-color tiles
        const neighbors = [
            { r: row - 1, c: col }, // top
            { r: row + 1, c: col }, // bottom
            { r: row, c: col - 1 }, // left
            { r: row, c: col + 1 }  // right
        ];

        const neighborGroups = new Map();
        neighbors.forEach(n => {
            const nKey = `${n.r}_${n.c}`;
            if (this.dirtIndexCache.has(nKey)) {
                const nIndex = this.dirtIndexCache.get(nKey);
                const nGroup = this.getDirtColorGroup(nIndex);
                neighborGroups.set(nGroup, (neighborGroups.get(nGroup) || 0) + 1);
            }
        });

        // If too many neighbors have the same color group, try different groups
        const sameGroupCount = neighborGroups.get(baseGroup) || 0;
        if (sameGroupCount >= 2) {
            // Try to find a different group
            const availableGroups = [0, 1, 2].filter(g => g !== baseGroup);
            let bestGroup = baseGroup;
            let minCount = sameGroupCount;

            for (const group of availableGroups) {
                const count = neighborGroups.get(group) || 0;
                if (count < minCount) {
                    minCount = count;
                    bestGroup = group;
                }
            }

            // Select random index from the best group
            if (bestGroup !== baseGroup) {
                const groupStart = bestGroup * 5;
                const groupEnd = groupStart + 5;
                const groupHash = this.simpleHash(row, col, `dirt_group_${bestGroup}`);
                dirtIndex = groupStart + (Math.abs(groupHash) % 5);
            }
        }

        // Cache the result
        this.dirtIndexCache.set(key, dirtIndex);
        return dirtIndex;
    }

    drawBackgroundDirt() {
        if (this.dirtImages.length === 0) return;

        const startCol = Math.max(0, Math.floor(this.camera.x / this.cellSize));
        const endCol = Math.ceil((this.camera.x + this.camera.width) / this.cellSize);
        const startRow = Math.max(0, Math.floor(this.camera.y / this.cellSize));
        const endRow = Math.ceil((this.camera.y + this.camera.height) / this.cellSize);

        for (let row = startRow; row < endRow; row++) {
            for (let col = startCol; col < endCol; col++) {
                // Check if this cell is claimed
                const isClaimed = this.isCellClaimed(row, col);
                if (isClaimed) continue;

                // Get dirt index with color group avoidance
                const dirtIndex = this.getDirtIndexForCell(row, col);
                const dirtImg = this.dirtImages[dirtIndex];

                if (dirtImg) {
                    const x = col * this.cellSize - this.camera.x;
                    const y = row * this.cellSize - this.camera.y;
                    this.ctx.drawImage(dirtImg, x, y, this.cellSize, this.cellSize);
                }
            }
        }
    }

    isCellClaimed(row, col) {
        if (!Array.isArray(this.gameState.cells) || this.gameState.cells.length === 0) return false;
        const rowData = this.gameState.cells[row];
        if (!rowData) return false;
        const cell = rowData[col];
        return cell !== null && cell !== undefined;
    }

    simpleHash(row, col, ownerId) {
        // Simple hash function for consistent random selection
        let hash = 0;
        const str = `${row}_${col}_${ownerId}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
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
                this.drawCellWithStyle(cell, x, y, row, col);
            }
        }
    }

    drawCellWithStyle(cell, x, y, row, col) {
        const player = this.gameState.players[cell.ownerId];
        let img = null;

        if (player && player.element) {
            const elementData = this.elementImages[player.element];
            if (player.element === 'water' && Array.isArray(elementData) && elementData.length > 0) {
                // Random water image (using hash of cell position + ownerId for consistency)
                const hash = this.simpleHash(row, col, cell.ownerId);
                const waterIndex = Math.abs(hash) % elementData.length;
                img = elementData[waterIndex];
            } else if (elementData) {
                img = elementData;
            }
        }

        if (img && !cell.isTrail) {
            this.ctx.globalAlpha = 1;
            this.ctx.drawImage(img, x, y, this.cellSize, this.cellSize);
        } else {
            this.ctx.fillStyle = cell.color;
            this.ctx.globalAlpha = cell.isTrail ? 0.5 : 1;
            this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
            this.ctx.globalAlpha = 1;
        }

        if (cell.isTrail) {
            this.ctx.strokeStyle = '#ffffff55';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
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

        const displayName = this.getPlayerDisplayName(player);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.fillText(displayName, screenX, screenY - 10);
        this.ctx.fillText(`${player.area || 0} cells`, screenX, screenY + this.playerSize + 15);
    }

    setDirection(direction) {
        if (this.isSpectator) return; // Spectators cannot move
        if (!this.ws || direction === this.currentDirection || this.gameState.gameOver) return;
        if (this.isOppositeDirection(direction, this.currentDirection)) return;
        this.currentDirection = direction;
        this.ws.send(JSON.stringify({
            type: 'MOVEMENT',
            direction
        }));
    }

    updateHUD() {
        if (!this.playerId) return;
        
        if (this.isSpectator) {
            // Spectator HUD: show player count and scoreboard
            document.getElementById('territory').textContent = '-';
            document.getElementById('cellsCaptured').textContent = '-';
            document.getElementById('playerCount').textContent = Object.keys(this.gameState.players).length;
        } else {
            const player = this.gameState.players[this.playerId];
            if (player) {
                document.getElementById('territory').textContent = player.area || 0;
                document.getElementById('cellsCaptured').textContent = player.area || 0;
                document.getElementById('playerCount').textContent = Object.keys(this.gameState.players).length;
            }
        }

        this.updateScoreboard();
        this.updateTimerStatus();
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
            const displayName = this.getPlayerDisplayName(player);
            nameSpan.textContent = `${index + 1}. ${displayName}`;

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
        
        if (this.isSpectator) {
            // Spectator camera: center on arena or follow first player
            const players = Object.values(this.gameState.players);
            if (players.length > 0) {
                // Follow the first player (or could be changed to follow leader)
                const targetPlayer = players[0];
                const centerX = targetPlayer.x + this.playerSize / 2;
                const centerY = targetPlayer.y + this.playerSize / 2;

                const maxX = Math.max(0, this.arena.width - this.camera.width);
                const maxY = Math.max(0, this.arena.height - this.camera.height);

                this.camera.x = Math.min(maxX, Math.max(0, centerX - this.camera.width / 2));
                this.camera.y = Math.min(maxY, Math.max(0, centerY - this.camera.height / 2));
            } else {
                // Center on arena if no players
                this.camera.x = (this.arena.width - this.camera.width) / 2;
                this.camera.y = (this.arena.height - this.camera.height) / 2;
            }
            return;
        }
        
        const player = this.gameState.players[this.playerId];
        if (!player) return;

        const centerX = player.x + this.playerSize / 2;
        const centerY = player.y + this.playerSize / 2;

        const maxX = Math.max(0, this.arena.width - this.camera.width);
        const maxY = Math.max(0, this.arena.height - this.camera.height);

        this.camera.x = Math.min(maxX, Math.max(0, centerX - this.camera.width / 2));
        this.camera.y = Math.min(maxY, Math.max(0, centerY - this.camera.height / 2));
    }

    sanitizePlayerName(name) {
        const trimmed = (name || '').trim().substring(0, 9);
        const cleaned = trimmed.replace(/[<>]/g, '').replace(/[^\p{L}\p{N}\s_\-]/gu, '');
        if (cleaned) {
            return cleaned;
        }
        return '';
    }

    getPlayerDisplayName(player) {
        if (!player) return 'Unknown';
        return player.name || player.id?.substr(0, 4) || 'Player';
    }

    isOppositeDirection(dirA, dirB) {
        if (!dirA || !dirB) return false;
        if (dirA === 'NONE' || dirB === 'NONE') return false;
        return this.oppositeDirections[dirA] === dirB || this.oppositeDirections[dirB] === dirA;
    }

    updateTimerStatus() {
        if (!this.timerElement) return;
        const defaultTime = 3 * 60 * 1000;
        let timeRemaining = (typeof this.gameState.timeRemaining === 'number')
            ? this.gameState.timeRemaining
            : defaultTime;

        if (this.timerSync && typeof this.timerSync.remainingMs === 'number') {
            const elapsed = performance.now() - this.timerSync.syncedAt;
            timeRemaining = Math.max(0, this.timerSync.remainingMs - elapsed);
        }

        this.timerElement.textContent = this.formatTime(timeRemaining);

        if (!this.statusMessageElement) return;
        if (this.gameState.gameOver) {
            const winnerName = this.gameState.winnerName;
            this.statusMessageElement.textContent = winnerName ? `${winnerName} wins!` : 'Match ended';
            this.statusMessageElement.classList.add('game-over');
        } else {
            this.statusMessageElement.textContent = '';
            this.statusMessageElement.classList.remove('game-over');
        }
    }

    formatTime(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    syncTimer(timeRemaining, serverTimestamp) {
        if (typeof timeRemaining !== 'number') {
            this.timerSync = null;
            return;
        }
        this.timerSync = {
            remainingMs: timeRemaining,
            syncedAt: performance.now(),
            serverTimestamp: serverTimestamp || Date.now()
        };
    }

    handlePlayerRenamed(playerId, name) {
        if (!playerId || !name) return;
        const player = this.gameState.players[playerId];
        if (player) {
            player.name = name;
        }
        if (playerId === this.playerId) {
            this.playerName = name;
        }
        this.updateHUD();
    }

    handlePlayerElementChanged(playerId, element, color) {
        if (!playerId || !element) return;
        const player = this.gameState.players[playerId];
        if (player) {
            player.element = element;
            if (color) {
                player.color = color;
            }
        }

        if (playerId === this.playerId && this.availableElements.includes(element)) {
            this.selectedElement = element;
            this.selectElement(element);
        }

        this.updateHUD();
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

// Start the game once the page finishes loading
window.addEventListener('load', () => {
    const game = new GameClient();
    requestAnimationFrame((timestamp) => game.gameLoop(timestamp));
});