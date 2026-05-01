import Phaser from "phaser";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";

export class MainMenuScene extends Phaser.Scene {
  private previewRig?: ProceduralPlayerRig;
  private elapsedMs = 0;

  constructor() {
    super("MainMenuScene");
  }

  create() {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x0b0e14);
    this.add.rectangle(width / 2, height - 58, width - 96, 30, 0x2a3242);
    this.add.rectangle(190, height - 122, 180, 22, 0x2a3242);
    this.add.rectangle(width - 210, height - 172, 220, 22, 0x2a3242);

    this.add.circle(width - 260, height - 190, 7, 0xffd166);
    this.add.circle(width - 235, height - 190, 7, 0xffd166);
    this.add.circle(width - 210, height - 190, 7, 0xffd166);
    this.previewRig = new ProceduralPlayerRig(this, {
      color: 0x50e3c2,
      name: "jakesjam",
      scale: 0.92,
    });

    this.add
      .text(48, 42, "JAKESJAM", {
        color: "#f7fbff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "38px",
        fontStyle: "900",
      })
      .setShadow(0, 4, "#000000", 10);

    this.add.text(52, 94, "Pick character, chaos, and room on the right.", {
      color: "#9ba7b8",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "18px",
    });

    this.add.text(52, height - 42, "Practice starts locally. Host/join starts the room flow.", {
      color: "#50e3c2",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "14px",
      fontStyle: "700",
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
