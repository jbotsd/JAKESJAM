import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { colorToNumber } from "../render/colorToNumber.js";
import { VesselCreatorOverlay } from "../ui/VesselCreatorOverlay";
import { readStoredCosmetics, writeStoredCosmetics } from "../cosmetics/vesselCosmeticsStore.js";
import type { VesselCosmetics } from "../../sim/types.js";

const DEFAULT_PREVIEW_ACCENT = 0x8ff8ff;

export class MainMenuScene extends Phaser.Scene {
  private previewRig?: ProceduralPlayerRig;
  private elapsedMs = 0;
  private creator?: VesselCreatorOverlay;
  private savedCosmetics: VesselCosmetics = {};

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

    this.savedCosmetics = readStoredCosmetics() ?? {};
    this.rebuildPreviewRig(this.savedCosmetics);
    this.createSignatureButton();

    this.creator = new VesselCreatorOverlay({
      onPreview: (cosmetics) => this.rebuildPreviewRig(cosmetics),
      onSave: (cosmetics) => {
        this.savedCosmetics = cosmetics;
        writeStoredCosmetics(cosmetics);
        this.rebuildPreviewRig(cosmetics);
      },
      onCancel: (revertTo) => this.rebuildPreviewRig(revertTo),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.creator?.destroy();
      this.creator = undefined;
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

  /**
   * Vessel Creator's live-preview contract: cheapest correct option given
   * ProceduralPlayerRig's readonly color options (no post-construction color
   * setter) — destroy and recreate on every swatch pick. This rig is a
   * decorative idle preview, not a gameplay entity, so the recreate cost is
   * negligible against a raw pointer click.
   */
  private rebuildPreviewRig(cosmetics: VesselCosmetics): void {
    this.previewRig?.destroy();
    this.previewRig = new ProceduralPlayerRig(this, {
      color: 0x50e3c2,
      name: "vessel",
      scale: 0.92,
      accentColor: cosmetics.accentColor ? colorToNumber(cosmetics.accentColor) : DEFAULT_PREVIEW_ACCENT,
      visorColor: cosmetics.visorColor ? colorToNumber(cosmetics.visorColor) : undefined,
      palmColor: cosmetics.palmColor ? colorToNumber(cosmetics.palmColor) : undefined,
      jointColor: cosmetics.jointColor ? colorToNumber(cosmetics.jointColor) : undefined,
      auraColor: cosmetics.auraColor ? colorToNumber(cosmetics.auraColor) : undefined,
    });
  }

  /** Short, plain, undramatic label per visual-language doc's naming
   *  protocol rule 4 (high-frequency UI names lean invented/plain) — avoids
   *  colliding with the lobby form's existing "Vessel" field (the character
   *  class dropdown). */
  private createSignatureButton(): void {
    const { height } = this.scale;
    const x = 230;
    const y = height - 58;
    const w = 140;
    const h = 30;

    const frame = this.add.rectangle(x, y, w, h, 0x000000, 0);
    frame.setStrokeStyle(1, 0xc9a84c, 0.55);
    this.add
      .text(x, y, "SIGNATURE", {
        color: "#e8c992",
        fontFamily: "'Space Mono', monospace",
        fontSize: "11px",
        fontStyle: "700",
        letterSpacing: 2,
      })
      .setOrigin(0.5);

    frame.setInteractive({ useHandCursor: true });
    frame.on("pointerover", () => frame.setStrokeStyle(1, 0xc9a84c, 0.95));
    frame.on("pointerout", () => frame.setStrokeStyle(1, 0xc9a84c, 0.55));
    frame.on("pointerdown", () => this.creator?.show(this.savedCosmetics));
  }
}
