import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";

/**
 * PreloadScene handles all asset loading before the game starts.
 * This ensures assets are loaded once and available throughout the game session.
 * 
 * Following Phaser 4 best practices:
 * - Load atlases instead of individual sprites
 * - Use audio sprites for SFX
 * - Pre-allocate resources to avoid GC stutter
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Preload);
  }

  preload() {
    // Display loading progress
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x2a3242, 0.8);
    progressBox.fillRect(240, 250, 480, 50);

    const loadingText = this.add.text(480, 220, "Loading...", {
      font: "20px Inter, Arial, sans-serif",
      color: "#f7fbff",
    });
    loadingText.setOrigin(0.5);

    // Progress bar events
    this.load.on("progress", (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x50e3c2, 1);
      progressBar.fillRect(250, 260, 460 * value, 30);
    });

    this.load.on("complete", () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // Load texture atlases when available
    // this.load.atlas("player", "/assets/atlas/player.png", "/assets/atlas/player.json");
    // this.load.atlas("projectiles", "/assets/atlas/projectiles.png", "/assets/atlas/projectiles.json");
    // this.load.atlas("vfx", "/assets/atlas/vfx.png", "/assets/atlas/vfx.json");

    // Load audio sprite when available
    // this.load.audioSprite("sfx", "/assets/audio/sfx.json", "/assets/audio/sfx.wav");

    // Load individual audio files for now
    // this.load.audio("shoot", "/assets/audio/shoot.wav");
    // this.load.audio("explosion", "/assets/audio/explosion.wav");
    // this.load.audio("jump", "/assets/audio/jump.wav");
    // this.load.audio("hit", "/assets/audio/hit.wav");
  }

  create() {
    // All assets loaded, start the main menu
    this.scene.start(SceneKeys.MainMenu);
  }
}
