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
let player;
let cursors; 
let keys;
let socket;
let otherPlayers = {};

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
}

function create() {
    const self = this;
    socket = io();

    try { this.cameras.main.setPostPipeline('CRTPipeline'); } catch (e) {}

    // 1. MAP
    let map = this.add.image(0, 0, 'island').setOrigin(0, 0);
    map.setScale(4); 
    const mapCenterX = map.displayWidth / 2;
    const mapCenterY = map.displayHeight / 2;

    // --- 2. PLACEHOLDER HOUSE (MOVED LEFT) ---
    // Changed x to 395
    let house = this.add.rectangle(395, 300, 100, 100, 0x8b4513); 
    this.physics.add.existing(house, true); 
    this.add.rectangle(395, 340, 30, 20, 0x000000); // Door

    // 3. PLAYER
    player = this.physics.add.sprite(mapCenterX, mapCenterY, 'player');
    player.setScale(4); 
    player.safeX = player.x;
    player.safeY = player.y;
    player.currentSkin = 'player'; // Set default skin immediately

    // 4. CAMERA
    this.physics.world.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.startFollow(player);
    this.cameras.main.setZoom(1);
    player.setCollideWorldBounds(true); 

    // 5. HOUSE INTERACTION
    this.input.keyboard.on('keydown-SPACE', () => {
        if (Phaser.Math.Distance.Between(player.x, player.y, house.x, house.y) < 150) {
            openSkinMenu(this);
        }
    });

    // 6. SKIN MENU UI
    this.skinMenu = this.add.container(0, 0);
    this.skinMenu.setScrollFactor(0);
    this.skinMenu.setDepth(200);
    this.skinMenu.visible = false;

    let menuBg = this.add.rectangle(window.innerWidth/2, window.innerHeight/2, 600, 400, 0x000000, 0.9);
    this.skinMenu.add(menuBg);

    let title = this.add.text(window.innerWidth/2, window.innerHeight/2 - 150, 'CHOOSE SKIN', { fontSize: '30px', color: '#ffffff' }).setOrigin(0.5);
    this.skinMenu.add(title);

    let xStart = window.innerWidth/2 - 200;
    let yStart = window.innerHeight/2 - 50;
    let col = 0;

    this.skinList.forEach((skinName) => {
        let btn = this.add.sprite(xStart + (col * 100), yStart, skinName).setScale(3).setInteractive();
        btn.on('pointerdown', () => { changeSkin(self, skinName); });
        this.skinMenu.add(btn);
        col++;
        if (col >= 5) { col = 0; xStart = window.innerWidth/2 - 200; yStart += 100; }
    });

    let closeBtn = this.add.text(window.innerWidth/2, window.innerHeight/2 + 150, '[ CLOSE ]', { fontSize: '20px', color: '#ff0000' })
        .setOrigin(0.5).setInteractive().on('pointerdown', () => { this.skinMenu.visible = false; });
    this.skinMenu.add(closeBtn);

    // 7. INPUTS
    cursors = this.input.keyboard.createCursorKeys();
    keys = this.input.keyboard.addKeys({ up: Phaser.Input.Keyboard.KeyCodes.W, down: Phaser.Input.Keyboard.KeyCodes.S, left: Phaser.Input.Keyboard.KeyCodes.A, right: Phaser.Input.Keyboard.KeyCodes.D });

    // --- 8. DYNAMIC ANIMATIONS (CRITICAL FIX) ---
    // We create a unique set of animations for EVERY skin color.
    this.skinList.forEach((skinName) => {
        this.anims.create({
            key: 'down_' + skinName, // e.g. down_player_red
            frames: this.anims.generateFrameNumbers(skinName, { start: 0, end: 3 }),
            frameRate: 10,
            repeat: -1
        });
        this.anims.create({
            key: 'left_' + skinName,
            frames: this.anims.generateFrameNumbers(skinName, { start: 4, end: 7 }),
            frameRate: 10,
            repeat: -1
        });
        this.anims.create({
            key: 'right_' + skinName,
            frames: this.anims.generateFrameNumbers(skinName, { start: 8, end: 11 }),
            frameRate: 10,
            repeat: -1
        });
        this.anims.create({
            key: 'up_' + skinName,
            frames: this.anims.generateFrameNumbers(skinName, { start: 12, end: 15 }),
            frameRate: 10,
            repeat: -1
        });
    });

    // 9. MULTIPLAYER LISTENERS
    socket.on('playerMoved', function (playerInfo) {
        if (!otherPlayers[playerInfo.playerId]) {
            let skinKey = playerInfo.skin || 'player';
            otherPlayers[playerInfo.playerId] = self.add.sprite(playerInfo.x, playerInfo.y, skinKey);
            otherPlayers[playerInfo.playerId].setScale(4); 
            otherPlayers[playerInfo.playerId].skinKey = skinKey; // Remember their skin!
        } else {
            otherPlayers[playerInfo.playerId].setPosition(playerInfo.x, playerInfo.y);
            
            // --- ANIMATION SYNC FIX ---
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
            otherPlayers[data.playerId].skinKey = data.skin; // Update stored skin key
        }
    });

    socket.on('playerDisconnected', function (playerId) {
        if (otherPlayers[playerId]) {
            otherPlayers[playerId].destroy();
            delete otherPlayers[playerId];
        }
    });

    // --- 10. CRT TOGGLE BUTTON (Top Right) ---
    let isCRTEnabled = true;

    // Position at: (Game Width - 20px, Top + 20px)
    // .setOrigin(1, 0) means the "Anchor" is the top-right corner of the text
    const crtBtn = this.add.text(this.scale.width - 20, 20, 'CRT: ON', { 
        fontSize: '16px', 
        fontFamily: 'monospace',
        fill: '#ffffff', 
        backgroundColor: '#000000',
        padding: { x: 8, y: 5 }
    })
    .setOrigin(1, 0)      // IMPORTANT: Anchors text to the right
    .setScrollFactor(0)   // IMPORTANT: Sticks to screen (HUD)
    .setDepth(300)        // Stay on top of menu
    .setInteractive({ useHandCursor: true });

    crtBtn.on('pointerdown', () => {
        isCRTEnabled = !isCRTEnabled;

        if (isCRTEnabled) {
            this.cameras.main.setPostPipeline('CRTPipeline');
            crtBtn.setText('CRT: ON');
            crtBtn.setStyle({ fill: '#ffffff', backgroundColor: '#000000' });
        } else {
            this.cameras.main.removePostPipeline('CRTPipeline');
            crtBtn.setText('CRT: OFF');
            crtBtn.setStyle({ fill: '#888888', backgroundColor: '#222222' });
        }
    });
}

function update() {
    const speed = 200;
    let moved = false;
    let animDirection = 'down'; 
    
    // Collision
    if (!isLand(player.x, player.y + 60, this)) {
        if (player.safeX !== undefined) { player.x = player.safeX; player.y = player.safeY; }
        player.setVelocity(0); return; 
    }
    player.safeX = player.x; player.safeY = player.y;

    // Movement
    player.setVelocity(0);
    
    // Get current skin (e.g., 'player_red')
    let currentSkin = player.currentSkin || 'player';

    if (keys.left.isDown || cursors.left.isDown) { 
        player.setVelocityX(-speed); 
        player.anims.play('left_' + currentSkin, true); // Play 'left_player_red'
        animDirection = 'left';
        moved = true; 
    } 
    else if (keys.right.isDown || cursors.right.isDown) { 
        player.setVelocityX(speed); 
        player.anims.play('right_' + currentSkin, true); 
        animDirection = 'right';
        moved = true; 
    }
    else if (keys.up.isDown || cursors.up.isDown) { 
        player.setVelocityY(-speed); 
        player.anims.play('up_' + currentSkin, true); 
        animDirection = 'up';
        moved = true; 
    } 
    else if (keys.down.isDown || cursors.down.isDown) { 
        player.setVelocityY(speed); 
        player.anims.play('down_' + currentSkin, true); 
        animDirection = 'down';
        moved = true; 
    }
    else { 
        player.anims.stop(); 
    }

    if (moved) {
        socket.emit('playerMovement', { 
            x: player.x, 
            y: player.y, 
            playerId: socket.id, 
            anim: animDirection, // Send 'left'
            skin: currentSkin    // Send 'player_red'
        });
    }
}

// Helpers
function isLand(x, y, scene) {
    const imageX = Math.floor(x / 4); const imageY = Math.floor(y / 4);
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
    scene.skinMenu.visible = false;
    socket.emit('skinChange', { skin: newSkinKey });
}

function openSkinMenu(scene) {
    scene.skinMenu.visible = true;
}