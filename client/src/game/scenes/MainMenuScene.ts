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
    this.add.rectangle(this.leftClusterCenterX() - 40, height - 122, 180, 22, 0x161d2f);
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
    const x = this.leftClusterCenterX() + Math.sin(seconds * 1.15) * 64;
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
   * C2 mobile-QA fix (2026-07-28): this scene's decorative rig/pips are
   * honest world-camera content at zoom 1 (no installHudCamera, unlike
   * every combat HUD system) — `this.scale.width/height` here is therefore
   * the RAW backing-store extent (CSS px × current renderScale), which on
   * phone/potato quality tiers is meaningfully narrower than the CSS
   * viewport (measured live: 295px backing width for a 393px-wide phone).
   * A flat `230` assumed a backing store with enough room for that plus
   * the rig's own oscillation amplitude (±64) and sprite half-width;
   * on a narrow one the rig's max excursion (294) sat at the literal right
   * edge of a 295px-wide canvas, clipping almost the whole sprite. Clamped
   * to the same "up to 230, but never closer than 90px to the true right
   * edge" rule the SIGNATURE button and its backdrop panel now share too —
   * identical result on every desktop-width backing store tested so far
   * (>=320px), gracefully narrower only where it was actually overflowing.
   */
  private leftClusterCenterX(): number {
    return Math.max(80, Math.min(230, this.scale.width - 90));
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
    const x = this.leftClusterCenterX();
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
