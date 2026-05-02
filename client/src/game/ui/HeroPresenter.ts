// HeroPresenter — parametric draft hero character.
// A Container holding a round body, stick limbs, dot eyes, angled eyebrows,
// and a mouth shape. Supports three expression states and an idle bob tween.
// Call leanToward(targetX) to tilt the whole body toward a card on hover.
// Call holdCard(container | null) to position a card container in the right hand.

import Phaser from "phaser";
import { PALETTE } from "./palette";

export type HeroExpression = "angry" | "neutral" | "smug";

export interface HeroPresenterOptions {
  bodyColor: number;
  shadeColor: number;
  /** If true, start in "angry" expression; otherwise "neutral". */
  playerBehind: boolean;
}

export class HeroPresenter extends Phaser.GameObjects.Container {
  private leftBrow: Phaser.GameObjects.Graphics;
  private rightBrow: Phaser.GameObjects.Graphics;
  private mouth: Phaser.GameObjects.Graphics;
  private rightArm: Phaser.GameObjects.Graphics;
  private cardAnchor: Phaser.GameObjects.Container;
  private idleTween: Phaser.Tweens.Tween;
  private leanTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    opts: HeroPresenterOptions,
  ) {
    super(scene, x, y);
    scene.add.existing(this);

    const R = 64; // body radius

    // ── Ground shadow — flat ellipse beneath hero feet ────────────────────
    const groundShadow = scene.add.ellipse(0, R + 40, 80, 16, 0x000000, 0.3);
    this.add(groundShadow);

    // ── Body ──────────────────────────────────────────────────────────────
    const body = scene.add.graphics();
    // Shadow facet (lower-right)
    body.fillStyle(opts.shadeColor, 1);
    body.fillCircle(6, 8, R);
    // Main body
    body.fillStyle(opts.bodyColor, 1);
    body.fillCircle(0, 0, R);
    this.add(body);

    // ── Upper-arc rim highlight — warm stroke on top hemisphere ──────────
    const rimArc = scene.add.graphics();
    rimArc.lineStyle(3, PALETTE.lightBeamWarm, 0.22);
    rimArc.beginPath();
    rimArc.arc(0, 0, R, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
    rimArc.strokePath();
    this.add(rimArc);

    // ── Legs ──────────────────────────────────────────────────────────────
    const legs = scene.add.graphics();
    legs.lineStyle(5, opts.shadeColor, 1);
    // Left leg
    legs.beginPath();
    legs.moveTo(-20, R - 8);
    legs.lineTo(-28, R + 32);
    legs.strokePath();
    // Right leg
    legs.beginPath();
    legs.moveTo(20, R - 8);
    legs.lineTo(28, R + 32);
    legs.strokePath();
    // Feet
    legs.fillStyle(opts.shadeColor, 1);
    legs.fillEllipse(-32, R + 38, 20, 10);
    legs.fillEllipse(32, R + 38, 20, 10);
    this.add(legs);

    // ── Left arm ──────────────────────────────────────────────────────────
    const leftArm = scene.add.graphics();
    leftArm.lineStyle(5, opts.shadeColor, 1);
    leftArm.beginPath();
    leftArm.moveTo(-R + 10, 10);
    leftArm.lineTo(-R - 22, 30);
    leftArm.strokePath();
    this.add(leftArm);

    // ── Right arm (holds card) ─────────────────────────────────────────────
    this.rightArm = scene.add.graphics();
    this.rightArm.lineStyle(5, opts.shadeColor, 1);
    this.rightArm.beginPath();
    this.rightArm.moveTo(R - 10, 10);
    this.rightArm.lineTo(R + 22, -20);
    this.rightArm.strokePath();
    this.add(this.rightArm);

    // Card anchor lives at the tip of the right arm
    this.cardAnchor = scene.add.container(R + 36, -36);
    this.add(this.cardAnchor);

    // ── Eyes ──────────────────────────────────────────────────────────────
    const eyes = scene.add.graphics();
    eyes.fillStyle(0xf5f8f8, 1);
    eyes.fillCircle(-22, -16, 8);
    eyes.fillCircle(22, -16, 8);
    // Pupils
    eyes.fillStyle(0x0a1418, 1);
    eyes.fillCircle(-20, -14, 4);
    eyes.fillCircle(24, -14, 4);
    this.add(eyes);

    // ── Eyebrows ──────────────────────────────────────────────────────────
    this.leftBrow = scene.add.graphics();
    this.rightBrow = scene.add.graphics();
    this.add(this.leftBrow);
    this.add(this.rightBrow);

    // ── Mouth ─────────────────────────────────────────────────────────────
    this.mouth = scene.add.graphics();
    this.add(this.mouth);

    // Set initial expression
    const startExpr: HeroExpression = opts.playerBehind ? "angry" : "neutral";
    this.applyExpression(startExpr);

    // ── Idle bob tween ────────────────────────────────────────────────────
    this.idleTween = scene.tweens.add({
      targets: this,
      y: y - 8,
      duration: 900,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setExpression(expr: HeroExpression): this {
    this.applyExpression(expr);
    return this;
  }

  leanToward(targetX: number): void {
    const dir = targetX > this.x ? 1 : -1;
    const targetAngle = dir * 0.12;
    if (this.leanTween) this.leanTween.stop();
    this.leanTween = this.scene.tweens.add({
      targets: this,
      rotation: targetAngle,
      duration: 220,
      ease: "Power2.Out",
    });
  }

  /**
   * Reparent a card container into the hero's right-hand anchor, or clear it.
   * Caller owns the container's lifecycle; holdCard(null) just removes it from
   * the anchor without destroying it.
   */
  holdCard(container: Phaser.GameObjects.Container | null): void {
    this.cardAnchor.removeAll(false);
    if (container) {
      this.cardAnchor.add(container);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private applyExpression(expr: HeroExpression): void {
    this.leftBrow.clear();
    this.rightBrow.clear();
    this.mouth.clear();

    const browColor = 0x0a1418;
    const mouthColor = 0x0a1418;

    switch (expr) {
      case "angry": {
        // Eyebrows angled inward-downward (furrowed)
        this.leftBrow.lineStyle(4, browColor, 1);
        this.leftBrow.beginPath();
        this.leftBrow.moveTo(-34, -30);
        this.leftBrow.lineTo(-12, -26);
        this.leftBrow.strokePath();

        this.rightBrow.lineStyle(4, browColor, 1);
        this.rightBrow.beginPath();
        this.rightBrow.moveTo(34, -30);
        this.rightBrow.lineTo(12, -26);
        this.rightBrow.strokePath();

        // Grimace / clenched teeth rectangle
        this.mouth.fillStyle(mouthColor, 1);
        this.mouth.fillRect(-18, 20, 36, 10);
        this.mouth.fillStyle(0xf5f8f8, 1);
        // Teeth lines
        for (let i = 0; i < 4; i++) {
          this.mouth.fillRect(-16 + i * 9, 21, 8, 8);
        }
        break;
      }
      case "smug": {
        // One eyebrow raised, one flat — cocky arch
        this.leftBrow.lineStyle(4, browColor, 1);
        this.leftBrow.beginPath();
        this.leftBrow.moveTo(-34, -32);
        this.leftBrow.lineTo(-12, -30);
        this.leftBrow.strokePath();

        this.rightBrow.lineStyle(4, browColor, 1);
        this.rightBrow.beginPath();
        this.rightBrow.moveTo(34, -36);
        this.rightBrow.lineTo(12, -28);
        this.rightBrow.strokePath();

        // Smirk — asymmetric arc
        this.mouth.lineStyle(4, mouthColor, 1);
        this.mouth.beginPath();
        this.mouth.moveTo(-14, 22);
        this.mouth.lineTo(6, 26);
        this.mouth.lineTo(18, 20);
        this.mouth.strokePath();
        break;
      }
      default: {
        // neutral — flat brows, simple curved smile
        this.leftBrow.lineStyle(4, browColor, 1);
        this.leftBrow.beginPath();
        this.leftBrow.moveTo(-32, -28);
        this.leftBrow.lineTo(-12, -28);
        this.leftBrow.strokePath();

        this.rightBrow.lineStyle(4, browColor, 1);
        this.rightBrow.beginPath();
        this.rightBrow.moveTo(12, -28);
        this.rightBrow.lineTo(32, -28);
        this.rightBrow.strokePath();

        // Gentle smile arc
        this.mouth.lineStyle(4, mouthColor, 1);
        this.mouth.beginPath();
        this.mouth.moveTo(-16, 22);
        this.mouth.lineTo(0, 30);
        this.mouth.lineTo(16, 22);
        this.mouth.strokePath();
        break;
      }
    }
  }

  override destroy(fromScene?: boolean): void {
    this.idleTween.stop();
    this.leanTween?.stop();
    super.destroy(fromScene);
  }
}
