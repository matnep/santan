// --- 1. DEFINE CRT PIPELINE (Lite Version) ---
class CRTPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor (game) {
        super({
            game: game,
            renderTarget: true,
            fragShader: `
            precision mediump float;
            uniform sampler2D uMainSampler;
            uniform float uTime;
            varying vec2 outTexCoord;
            void main () {
                vec2 uv = outTexCoord;
                float alpha = texture2D(uMainSampler, uv).a;
                if (alpha == 0.0) { discard; }

                float r = texture2D(uMainSampler, uv + vec2(0.001, 0.0)).r;
                float g = texture2D(uMainSampler, uv).g;
                float b = texture2D(uMainSampler, uv - vec2(0.001, 0.0)).b;
                vec3 color = vec3(r, g, b);

                float scanline = sin(uv.y * 800.0) * 0.04; 
                color -= scanline;

                float vig = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
                float vignette = pow(vig * 20.0, 0.25);
                color *= vignette;
                color *= 1.2;

                gl_FragColor = vec4(color, alpha);
            }`
        });
    }
}

// --- 2. GAME CONFIG ---
const config = {
    type: Phaser.WEBGL, 
    scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    backgroundColor: '#1485d0', 
    pixelArt: true,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    pipeline: { 'CRTPipeline': CRTPipeline },
    scene: { preload: preload, create: create, update: update }
};

const game = new Phaser.Game(config);

// Game Constants
const PLAYER_SPEED = 200;
const PLAYER_SCALE = 4;
const MAP_SCALE = 4;
const HOUSE_INTERACTION_DISTANCE = 150;
const PIXEL_CHECK_SCALE = 4; // Used in isLand function
const TREE_SPACING = 150; // Minimum distance between trees
const TREE_DENSITY = 0.15; // Probability of placing a tree (0-1)
const TREE_FRAME_WIDTH = 16; // Tree spritesheet frame width
const TREE_FRAME_HEIGHT = 16; // Tree spritesheet frame height

let player;
let cursors; 
let keys;
let socket;
let otherPlayers = {};
let lastAnim = 'down'; // Track last direction for Idle state

function preload() {
    // 1. YOUR SKIN LIST
    this.skinList = [
        'player', // Default
        'player_blue',
        'player_green',
        'player_lightblue',
        'player_lightgreen',
        'player_pink',
        'player_purple',
        'player_red',
        'player_white',
        'player_yellow'
    ];

    // Load all skins automatically
    this.skinList.forEach((skinName) => {
        this.load.spritesheet(skinName, 'assets/' + skinName + '.png', { 
            frameWidth: 32, frameHeight: 32 
        });
    });

    this.load.image('island', 'assets/santanisland.png');
    this.load.spritesheet('tree', 'assets/tree.png', {
        frameWidth: TREE_FRAME_WIDTH,
        frameHeight: TREE_FRAME_HEIGHT
    });
}

function create() {
    const self = this;
    socket = io();

    // Disable right-click context menu
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer) => {
        if (pointer.rightButtonDown()) {
            // Prevent default right-click behavior
            return false;
        }
    });

    // Handle connection errors
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });

    try { this.cameras.main.setPostPipeline('CRTPipeline'); } catch (e) {}

    // 1. MAP
    let map = this.add.image(0, 0, 'island').setOrigin(0, 0);
    map.setScale(MAP_SCALE); 
    const mapCenterX = map.displayWidth / 2;
    const mapCenterY = map.displayHeight / 2;

    // --- 2. PLACEHOLDER HOUSE (Positioned in a visible, accessible location) ---
    // Place house near the center but slightly offset for better visibility
    const houseX = mapCenterX - 50;
    const houseY = mapCenterY - 100;
    let house = this.add.rectangle(houseX, houseY, 100, 100, 0x8b4513); 
    this.physics.add.existing(house, true); 
    this.add.rectangle(houseX, houseY + 40, 30, 20, 0x000000); // Door
    
    // Store house position for interaction
    this.house = house;

    // --- 2.5. PLACE TREES ACROSS THE ISLAND ---
    this.trees = [];
    // Use setTimeout to prevent blocking the main thread
    setTimeout(() => {
        placeTrees(this, map);
        
        // Add collision between player and all trees after placement
        this.trees.forEach(tree => {
            this.physics.add.collider(player, tree);
        });
    }, 100);

    // 3. PLAYER
    player = this.physics.add.sprite(mapCenterX, mapCenterY, 'player');
    player.setScale(PLAYER_SCALE); 
    player.safeX = player.x;
    player.safeY = player.y;
    player.currentSkin = 'player'; 

    // 4. CAMERA
    this.physics.world.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.startFollow(player);
    this.cameras.main.setZoom(1);
    // Removed world bounds collision - player can only collide with house
    
    // Add collision between player and house (only collision)
    this.physics.add.collider(player, house); 

    // 5. HOUSE INTERACTION
    this.input.keyboard.on('keydown-SPACE', () => {
        if (this.house && Phaser.Math.Distance.Between(player.x, player.y, this.house.x, this.house.y) < HOUSE_INTERACTION_DISTANCE) {
            openSkinMenu(this);
        }
    });

    // Close menu with ESC key
    this.input.keyboard.on('keydown-ESC', () => {
        if (this.skinMenu && this.skinMenu.visible) {
            this.skinMenu.visible = false;
        }
    });

    // 6. SKIN MENU UI
    this.skinMenu = this.add.container(0, 0);
    this.skinMenu.setScrollFactor(0);
    this.skinMenu.setDepth(5000); // Very high depth to stay on top
    this.skinMenu.visible = false;
    this.skinMenuActive = false; // Track if menu is open

    // Helper function to format skin names
    function formatSkinName(skinName) {
        if (skinName === 'player') return 'Default';
        return skinName.replace('player_', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    let menuBg = this.add.rectangle(window.innerWidth/2, window.innerHeight/2, 700, 500, 0x000000, 0.95);
    menuBg.setScrollFactor(0).setDepth(5001).setInteractive();
    this.skinMenu.add(menuBg);

    let title = this.add.text(window.innerWidth/2, window.innerHeight/2 - 200, 'CHOOSE SKIN', { 
        fontSize: '30px', 
        color: '#ffffff',
        fontFamily: 'Arial'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(5002);
    this.skinMenu.add(title);

    let xStart = window.innerWidth/2 - 250;
    let yStart = window.innerHeight/2 - 80;
    let col = 0;
    const skinSpacing = 120;
    const skinLabelOffset = 50;

    this.skinMenuButtons = [];
    this.skinList.forEach((skinName) => {
        const btnX = xStart + (col * skinSpacing);
        const btnY = yStart;
        
        // Skin sprite button
        let btn = this.add.sprite(btnX, btnY, skinName).setScale(3);
        btn.setScrollFactor(0).setDepth(5002).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => { 
            changeSkin(self, skinName); 
        });
        this.skinMenu.add(btn);
        this.skinMenuButtons.push(btn);
        
        // Skin name label below the sprite
        let skinLabel = this.add.text(btnX, btnY + skinLabelOffset, formatSkinName(skinName), {
            fontSize: '14px',
            color: '#ffffff',
            fontFamily: 'Arial'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(5002);
        this.skinMenu.add(skinLabel);
        
        col++;
        if (col >= 5) { 
            col = 0; 
            xStart = window.innerWidth/2 - 250; 
            yStart += 140; 
        }
    });

    let closeBtn = this.add.text(window.innerWidth/2, window.innerHeight/2 + 180, '[ CLOSE ]', { 
        fontSize: '20px', 
        color: '#ff0000',
        fontFamily: 'Arial'
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(5002)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', () => { 
        this.skinMenu.visible = false;
        this.skinMenuActive = false;
    });
    this.skinMenu.add(closeBtn);

    // 7. INPUTS
    cursors = this.input.keyboard.createCursorKeys();
    keys = this.input.keyboard.addKeys({ up: Phaser.Input.Keyboard.KeyCodes.W, down: Phaser.Input.Keyboard.KeyCodes.S, left: Phaser.Input.Keyboard.KeyCodes.A, right: Phaser.Input.Keyboard.KeyCodes.D });

    // --- 8. DYNAMIC ANIMATIONS (WALK & IDLE) ---
    this.skinList.forEach((skinName) => {
        // WALK Animations
        this.anims.create({ key: 'down_' + skinName, frames: this.anims.generateFrameNumbers(skinName, { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: 'left_' + skinName, frames: this.anims.generateFrameNumbers(skinName, { start: 4, end: 7 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: 'right_' + skinName, frames: this.anims.generateFrameNumbers(skinName, { start: 8, end: 11 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: 'up_' + skinName, frames: this.anims.generateFrameNumbers(skinName, { start: 12, end: 15 }), frameRate: 10, repeat: -1 });

        // IDLE Animations (Single Frame)
        // This stops the player on the correct frame when they stop walking
        this.anims.create({ key: 'idle_down_' + skinName, frames: [ { key: skinName, frame: 0 } ], frameRate: 20 });
        this.anims.create({ key: 'idle_left_' + skinName, frames: [ { key: skinName, frame: 4 } ], frameRate: 20 });
        this.anims.create({ key: 'idle_right_' + skinName, frames: [ { key: skinName, frame: 8 } ], frameRate: 20 });
        this.anims.create({ key: 'idle_up_' + skinName, frames: [ { key: skinName, frame: 12 } ], frameRate: 20 });
    });

    // 9. MULTIPLAYER LISTENERS
    // Handle existing players when connecting
    socket.on('currentPlayers', function (players) {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id && !otherPlayers[id]) {
                const playerInfo = players[id];
                const skinKey = playerInfo.skin || 'player';
                otherPlayers[id] = self.add.sprite(playerInfo.x, playerInfo.y, skinKey);
                otherPlayers[id].setScale(4);
                otherPlayers[id].skinKey = skinKey;
                otherPlayers[id].setDepth(playerInfo.y);
            }
        });
    });

    // Handle new player joining
    socket.on('newPlayer', function (playerInfo) {
        if (playerInfo.playerId !== socket.id && !otherPlayers[playerInfo.playerId]) {
            const skinKey = playerInfo.skin || 'player';
            otherPlayers[playerInfo.playerId] = self.add.sprite(playerInfo.x, playerInfo.y, skinKey);
            otherPlayers[playerInfo.playerId].setScale(4);
            otherPlayers[playerInfo.playerId].skinKey = skinKey;
            otherPlayers[playerInfo.playerId].setDepth(playerInfo.y);
        }
    });

    socket.on('playerMoved', function (playerInfo) {
        if (!otherPlayers[playerInfo.playerId]) {
            let skinKey = playerInfo.skin || 'player';
            otherPlayers[playerInfo.playerId] = self.add.sprite(playerInfo.x, playerInfo.y, skinKey);
            otherPlayers[playerInfo.playerId].setScale(PLAYER_SCALE); 
            otherPlayers[playerInfo.playerId].skinKey = skinKey; 
        } else {
            otherPlayers[playerInfo.playerId].setPosition(playerInfo.x, playerInfo.y);
            
            // --- FIX DEPTH SORTING FOR OTHER PLAYERS ---
            otherPlayers[playerInfo.playerId].setDepth(otherPlayers[playerInfo.playerId].y);

            // --- ANIMATION SYNC ---
            if (playerInfo.anim) {
                let skinPrefix = otherPlayers[playerInfo.playerId].skinKey || 'player';
                let animKey = playerInfo.anim + '_' + skinPrefix;

                if (self.anims.exists(animKey)) {
                    otherPlayers[playerInfo.playerId].anims.play(animKey, true);
                }
            }
        }
    });

    socket.on('playerSkinChanged', function (data) {
        if (otherPlayers[data.playerId]) {
            otherPlayers[data.playerId].setTexture(data.skin);
            otherPlayers[data.playerId].skinKey = data.skin; 
        }
    });

    socket.on('playerDisconnected', function (playerId) {
        if (otherPlayers[playerId]) {
            otherPlayers[playerId].destroy();
            delete otherPlayers[playerId];
        }
    });

    // --- 10. CRT TOGGLE ---
    let isCRTEnabled = true;
    const crtBtn = this.add.text(this.scale.width - 20, 20, 'CRT: ON', { 
        fontSize: '16px', fontFamily: 'monospace', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 8, y: 5 }
    })
    .setOrigin(1, 0).setScrollFactor(0).setDepth(4000).setInteractive({ useHandCursor: true });

    crtBtn.on('pointerdown', () => {
        isCRTEnabled = !isCRTEnabled;
        if (isCRTEnabled) {
            this.cameras.main.setPostPipeline('CRTPipeline');
            crtBtn.setText('CRT: ON').setStyle({ fill: '#ffffff', backgroundColor: '#000000' });
        } else {
            this.cameras.main.removePostPipeline('CRTPipeline');
            crtBtn.setText('CRT: OFF').setStyle({ fill: '#888888', backgroundColor: '#222222' });
        }
    });
}

function update() {
    // Don't allow movement if skin menu is open
    if (this.skinMenu && this.skinMenu.visible) {
        player.setVelocity(0);
        return;
    }

    const speed = PLAYER_SPEED;
    let moved = false;
    let animToPlay = ''; // Store the animation we WANT to play

    // --- FIX DEPTH SORTING FOR LOCAL PLAYER ---
    // This ensures players overlap correctly based on Y position
    player.setDepth(player.y);

    // Collision
    if (!isLand(player.x, player.y + 60, this)) {
        if (player.safeX !== undefined) { player.x = player.safeX; player.y = player.safeY; }
        player.setVelocity(0); return; 
    }
    player.safeX = player.x; player.safeY = player.y;

    // Movement Logic
    player.setVelocity(0);
    let currentSkin = player.currentSkin || 'player';

    if (keys.left.isDown || cursors.left.isDown) { 
        player.setVelocityX(-speed); 
        animToPlay = 'left';
        lastAnim = 'left';
        moved = true; 
    } 
    else if (keys.right.isDown || cursors.right.isDown) { 
        player.setVelocityX(speed); 
        animToPlay = 'right';
        lastAnim = 'right';
        moved = true; 
    }
    else if (keys.up.isDown || cursors.up.isDown) { 
        player.setVelocityY(-speed); 
        animToPlay = 'up';
        lastAnim = 'up';
        moved = true; 
    } 
    else if (keys.down.isDown || cursors.down.isDown) { 
        player.setVelocityY(speed); 
        animToPlay = 'down';
        lastAnim = 'down';
        moved = true; 
    }
    else { 
        // --- IDLE LOGIC ---
        // If not moving, play the "idle" version of the last direction
        animToPlay = 'idle_' + lastAnim;
        moved = false;
    }

    // Play the animation locally
    player.anims.play(animToPlay + '_' + currentSkin, true);

    // Network Sync
    // We send data if we MOVED, OR if our animation state changed (so stop works)
    if (moved || (player.lastSentAnim !== animToPlay)) {
        socket.emit('playerMovement', { 
            x: player.x, 
            y: player.y, 
            playerId: socket.id, 
            anim: animToPlay, // Send 'left' or 'idle_left'
            skin: currentSkin
        });
        player.lastSentAnim = animToPlay; // Avoid spamming the same idle packet
    }
}

// Helpers
function placeTrees(scene, map) {
    try {
        const mapWidth = map.displayWidth;
        const mapHeight = map.displayHeight;
        const gridSize = TREE_SPACING;
        const houseX = scene.house.x;
        const houseY = scene.house.y;
        const houseRadius = 100; // Avoid placing trees near house
        
        // Simple noise function for natural distribution
        function simpleNoise(x, y) {
            return ((Math.sin(x * 0.1) + Math.cos(y * 0.1)) * 0.5 + 0.5);
        }
        
        // Limit iterations to prevent blocking
        let attempts = 0;
        const maxAttempts = 2000; // Maximum number of tree placement attempts
        
        // Try to place trees across the map with optimized sampling
        const stepSize = gridSize * 1.5; // Larger step to reduce iterations
        for (let x = gridSize; x < mapWidth - gridSize && attempts < maxAttempts; x += stepSize) {
            for (let y = gridSize; y < mapHeight - gridSize && attempts < maxAttempts; y += stepSize) {
                attempts++;
                
                // Add some randomness to position
                const offsetX = (Math.random() - 0.5) * gridSize * 0.6;
                const offsetY = (Math.random() - 0.5) * gridSize * 0.6;
                const treeX = x + offsetX;
                const treeY = y + offsetY;
                
                // Quick bounds check first
                if (treeX < 0 || treeX >= mapWidth || treeY < 0 || treeY >= mapHeight) continue;
                
                // Check distance from house first (cheaper than isLand)
                const distFromHouse = Phaser.Math.Distance.Between(treeX, treeY, houseX, houseY);
                if (distFromHouse < houseRadius + 50) continue;
                
                // Use noise to determine if we should place a tree here
                const noiseValue = simpleNoise(treeX, treeY);
                if (Math.random() > TREE_DENSITY * noiseValue) continue;
                
                // Check if position is on land (more expensive check, do it later)
                if (!isLand(treeX, treeY, scene)) continue;
                
                // Check if too close to other trees
                let tooClose = false;
                for (let existingTree of scene.trees) {
                    const dist = Phaser.Math.Distance.Between(treeX, treeY, existingTree.x, existingTree.y);
                    if (dist < TREE_SPACING * 0.8) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                
                // Create tree sprite with random frame from spritesheet
                const tree = scene.add.sprite(treeX, treeY, 'tree');
                // Get total number of frames in the spritesheet
                const totalFrames = scene.textures.get('tree').frameTotal;
                // Use random frame for variety (or frame 0 if only one frame)
                const frameIndex = totalFrames > 1 ? Math.floor(Math.random() * totalFrames) : 0;
                tree.setFrame(frameIndex);
                tree.setScale(MAP_SCALE); // Match map scale
                scene.physics.add.existing(tree, true); // Static physics body
                tree.setDepth(treeY); // Depth sorting
                
                scene.trees.push(tree);
            }
        }
        
        console.log(`Placed ${scene.trees.length} trees across the island`);
    } catch (error) {
        console.error('Error placing trees:', error);
        // Continue even if tree placement fails
    }
}

function isLand(x, y, scene) {
    const imageX = Math.floor(x / PIXEL_CHECK_SCALE);
    const imageY = Math.floor(y / PIXEL_CHECK_SCALE);
    const texture = scene.textures.get('island').getSourceImage();
    if (!texture) return false;
    if (imageX < 0 || imageX >= texture.width || imageY < 0 || imageY >= texture.height) return false;
    const pixel = scene.textures.getPixel(imageX, imageY, 'island');
    if (pixel.a === 0) return false; 
    return true; 
}

function changeSkin(scene, newSkinKey) {
    player.setTexture(newSkinKey);
    player.currentSkin = newSkinKey;
    if (scene.skinMenu) {
        scene.skinMenu.visible = false;
        scene.skinMenuActive = false;
    }
    socket.emit('skinChange', { skin: newSkinKey });
}

function openSkinMenu(scene) {
    if (scene.skinMenu) {
        scene.skinMenu.visible = true;
        scene.skinMenuActive = true;
        // Stop player movement
        player.setVelocity(0);
    }
}