import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";

export class MainMenuScene extends Phaser.Scene {
  private previewRig?: ProceduralPlayerRig;
  private elapsedMs = 0;

  constructor() {
    super(SceneKeys.MainMenu);
  }

  create() {
    // Atmosphere-only backdrop for the DOM shell HOME (sci-fi gnostic void).
    // Product CTAs live exclusively in the DOM shell — no Join/Host/Practice here.
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0e1a);
    this.add.rectangle(width / 2, height - 58, width - 96, 30, 0x141b2d);
    this.add.rectangle(190, height - 122, 180, 22, 0x161d2f);
    this.add.rectangle(width - 210, height - 172, 220, 22, 0x161d2f);

    this.add.circle(width - 260, height - 190, 7, 0xc9a84c);
    this.add.circle(width - 235, height - 190, 7, 0xc9a84c);
    this.add.circle(width - 210, height - 190, 7, 0x8ff8ff);
    this.previewRig = new ProceduralPlayerRig(this, {
      color: 0x50e3c2,
      name: "vessel",
      scale: 0.92,
      accentColor: 0x8ff8ff,
    });
  }

  update(_time: number, delta: number) {
    this.elapsedMs += delta;
    const { width, height } = this.scale;
    const seconds = this.elapsedMs / 1000;
    const x = 230 + Math.sin(seconds * 1.15) * 64;
    const velocityX = Math.cos(seconds * 1.15) * 74;

    this.previewRig?.update(delta, {
      position: { x, y: height - 122 },
      velocity: { x: velocityX, y: 0 },
      aimTarget: { x: width - 230, y: height - 190 },
      grounded: true,
      crouching: false,
    });
  }
}
