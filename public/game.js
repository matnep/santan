// --- 1. DEFINE CRT PIPELINE (Fixed Transparency) ---
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
                
                // 1. Get the Original Alpha (Transparency)
                // This is the most important fix!
                float alpha = texture2D(uMainSampler, uv).a;

                // If the pixel is transparent (The Water), don't mess with it!
                if (alpha == 0.0) {
                    discard; // Skip processing this pixel completely
                }

                // 2. RGB Split (Subtle)
                float r = texture2D(uMainSampler, uv + vec2(0.001, 0.0)).r;
                float g = texture2D(uMainSampler, uv).g;
                float b = texture2D(uMainSampler, uv - vec2(0.001, 0.0)).b;
                vec3 color = vec3(r, g, b);

                // 3. Scanlines (Lite)
                float scanline = sin(uv.y * 800.0) * 0.04; 
                color -= scanline;

                // 4. Vignette (Soft corners)
                float vig = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
                float vignette = pow(vig * 20.0, 0.25);
                color *= vignette;

                // 5. Brightness Boost (To counter the darkening)
                color *= 1.2;

                // 6. OUTPUT
                // Use the original 'alpha' so transparent pixels stay transparent!
                gl_FragColor = vec4(color, alpha);
            }`
        });
    }
}

// --- 2. GAME CONFIGURATION ---
const config = {
    type: Phaser.WEBGL, 
    scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    // The Blue Water will now show through again!
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
    this.load.spritesheet('player', 'assets/player.png', { frameWidth: 32, frameHeight: 32 });
    this.load.image('island', 'assets/santanisland.png');
}

function create() {
    const self = this;
    socket = io();

    // --- ACTIVATE CRT EFFECT ---
    try {
        this.cameras.main.setPostPipeline('CRTPipeline');
    } catch (e) {
        console.log("CRT Shader failed");
    }

    // 1. SETUP MAP
    let map = this.add.image(0, 0, 'island').setOrigin(0, 0);
    map.setScale(4); 

    const mapCenterX = map.displayWidth / 2;
    const mapCenterY = map.displayHeight / 2;

    // 2. SETUP PLAYER
    player = this.physics.add.sprite(mapCenterX, mapCenterY, 'player');
    player.setScale(4); 
    
    player.safeX = player.x;
    player.safeY = player.y;

    // 3. CAMERA & BOUNDS
    this.physics.world.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.setBounds(0, 0, map.displayWidth, map.displayHeight);
    this.cameras.main.startFollow(player);
    this.cameras.main.setZoom(1);

    player.setCollideWorldBounds(true); 

    // 4. INPUTS
    cursors = this.input.keyboard.createCursorKeys();
    keys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // 5. ANIMATIONS
    this.anims.create({
        key: 'down',
        frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
        frameRate: 10,
        repeat: -1 
    });
    this.anims.create({
        key: 'left',
        frames: this.anims.generateFrameNumbers('player', { start: 4, end: 7 }),
        frameRate: 10,
        repeat: -1
    });
    this.anims.create({
        key: 'right',
        frames: this.anims.generateFrameNumbers('player', { start: 8, end: 11 }),
        frameRate: 10,
        repeat: -1
    });
    this.anims.create({
        key: 'up',
        frames: this.anims.generateFrameNumbers('player', { start: 12, end: 15 }),
        frameRate: 10,
        repeat: -1
    });

    // 6. MULTIPLAYER LISTENERS
    socket.on('playerMoved', function (playerInfo) {
        if (!otherPlayers[playerInfo.playerId]) {
            otherPlayers[playerInfo.playerId] = self.add.sprite(playerInfo.x, playerInfo.y, 'player');
            otherPlayers[playerInfo.playerId].setScale(4); 
            otherPlayers[playerInfo.playerId].setTint(0xff0000); 
        } else {
            otherPlayers[playerInfo.playerId].setPosition(playerInfo.x, playerInfo.y);
            if (playerInfo.anim) {
                otherPlayers[playerInfo.playerId].anims.play(playerInfo.anim, true);
            }
        }
    });

    socket.on('disconnect', function (playerId) {
        if (otherPlayers[playerId]) {
            otherPlayers[playerId].destroy();
            delete otherPlayers[playerId];
        }
    });
}

function update() {
    const speed = 200;
    let moved = false;
    
    // --- COLLISION CHECK ---
    if (!isLand(player.x, player.y + 60, this)) {
        if (player.safeX !== undefined) {
            player.x = player.safeX;
            player.y = player.safeY;
        }
        player.setVelocity(0);
        return; 
    }

    player.safeX = player.x;
    player.safeY = player.y;

    // --- MOVEMENT ---
    player.setVelocity(0);

    if (keys.left.isDown || cursors.left.isDown) {
        player.setVelocityX(-speed);
        player.anims.play('left', true);
        moved = true;
    } 
    else if (keys.right.isDown || cursors.right.isDown) {
        player.setVelocityX(speed);
        player.anims.play('right', true);
        moved = true;
    }
    else if (keys.up.isDown || cursors.up.isDown) {
        player.setVelocityY(-speed);
        player.anims.play('up', true);
        moved = true;
    } 
    else if (keys.down.isDown || cursors.down.isDown) {
        player.setVelocityY(speed);
        player.anims.play('down', true);
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
            anim: player.anims.currentAnim ? player.anims.currentAnim.key : 'down'
        });
    }
}

// --- HELPER FUNCTION ---
function isLand(x, y, scene) {
    const imageX = Math.floor(x / 4);
    const imageY = Math.floor(y / 4);

    const texture = scene.textures.get('island').getSourceImage();
    if (!texture) return false;

    if (imageX < 0 || imageX >= texture.width || imageY < 0 || imageY >= texture.height) {
        return false;
    }

    const pixel = scene.textures.getPixel(imageX, imageY, 'island');

    if (pixel.a === 0) {
        return false; 
    }
    return true; 
}