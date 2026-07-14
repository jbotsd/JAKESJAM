// HeroPresenter — draft-screen vessel presenter.
//
// REDESIGNED 2026-07-15 (UI-axioms severe-violation fix). The previous
// version drew a literal cartoon mascot — round body/head circle, thin
// stick-limb strokes, and a fully articulated face (two dot-pupil eyes,
// three sets of angled eyebrows, three mouth shapes) driven by an
// "angry"/"neutral"/"smug" state switch. That directly contradicted the
// game's own doctrine (docs/ui-axioms.md anti-pattern #2: "Big anime eyes,
// chibi proportions, cel-shaded faces, any face at all besides the visor
// seam" — a HARD rule) and diverged from the established vessel identity
// the real player character (`ProceduralPlayerRig.ts`) already follows: a
// manufactured hull with a ghost in it, faced only by a thin seam of light.
//
// This version draws a small, static, front-facing faceted vessel — the
// SAME visual vocabulary `ProceduralPlayerRig.ts` uses (visor seam, spine
// energy conduit, crystal joint stubs, chamfered flat-polygon hull, dark
// outline + colored fill + highlight/shadow edge per plane), just without
// that file's full two-bone IK/locomotion system, which this single static
// draft-screen presenter has no use for.
//
// Mood is no longer a face swap. It reads through the visor seam's colour
// + brightness + pulse-rate (matching ProceduralPlayerRig's own "warning
// red below 25% health" convention) plus a small head-tilt at the neck —
// same principle the project's own HUD research draws from Destiny 2's
// ability icons: state shown via animation/colour on a FIXED shape, never
// by swapping to a different shape or face.
//
// Call setExpression(mood) to change the visor/tilt read. Call
// leanToward(targetX) to tilt the whole vessel toward a card on hover
// (unchanged — already doctrine-compliant, untouched here). Call
// holdCard(container | null) to position a card container at the vessel's
// raised hand.

import Phaser from "phaser";
import { PALETTE } from "./palette";
import { shadeColor as tint } from "../render/portraitBadge";

export type HeroExpression = "angry" | "neutral" | "smug";

export interface HeroPresenterOptions {
  bodyColor: number;
  shadeColor: number;
  /** If true, start in "angry" expression; otherwise "neutral". */
  playerBehind: boolean;
}

type Pt = readonly [number, number];

type MoodProfile = {
  /** Visor seam colour at rest (Destiny-icon principle: colour is the
   *  primary state channel, not a shape swap). */
  visorColor: number;
  visorBaseAlpha: number;
  visorPulseAmplitude: number;
  /** Full pulse cycle duration — faster = more agitated. */
  pulseMs: number;
  spineColor: number;
  spineBaseAlpha: number;
  /** Small head-tilt at the neck, radians. Secondary posture cue, not a
   *  face — matches the "subtle body-tilt per mood" precedent already set
   *  by leanToward()'s hover tilt. */
  headTilt: number;
};

// Warmer/redder + fast pulse (agitated) → brighter/steadier cyan-white
// (confident) → calm default cyan (neutral). No hue is invented outside
// the established combat-cyan / HP-danger tokens (ui-axioms.md C4/C6).
const MOOD_PROFILES: Record<HeroExpression, MoodProfile> = {
  angry: {
    visorColor: PALETTE.hpDanger,
    visorBaseAlpha: 0.5,
    visorPulseAmplitude: 0.5,
    pulseMs: 420,
    spineColor: PALETTE.hpDanger,
    spineBaseAlpha: 0.75,
    headTilt: 0.1,
  },
  smug: {
    visorColor: tint(PALETTE.lightBeamCyan, 0.25),
    visorBaseAlpha: 0.85,
    visorPulseAmplitude: 0.1,
    pulseMs: 1500,
    spineColor: tint(PALETTE.lightBeamCyan, 0.15),
    spineBaseAlpha: 0.95,
    headTilt: -0.08,
  },
  neutral: {
    visorColor: PALETTE.lightBeamCyan,
    visorBaseAlpha: 0.55,
    visorPulseAmplitude: 0.28,
    pulseMs: 900,
    spineColor: PALETTE.lightBeamCyan,
    spineBaseAlpha: 0.6,
    headTilt: 0,
  },
};

// ── Faceted-panel drawing helpers ────────────────────────────────────────
// Flat polygon fill + darker outline stroke + a lightened top-edge line and
// a darkened bottom-edge line — the "1px highlight on the upper edge, 1px
// shadow on the lower, never curved/soft shading" read (ui-axioms.md G5),
// applied consistently to every hull plane instead of one-off soft fills.

/** Traces `points` as a moveTo + lineTo* path onto whatever style (fill or
 *  stroke) the caller already set on `g`. Callers always pass a literal
 *  4-8 point tuple (the panel shapes below), so the bounds are safe. */
function tracePath(g: Phaser.GameObjects.Graphics, points: readonly Pt[]) {
  const first = points[0] as Pt;
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Pt;
    g.lineTo(p[0], p[1]);
  }
  g.closePath();
}

function fillFacet(g: Phaser.GameObjects.Graphics, points: readonly Pt[], color: number) {
  g.fillStyle(color, 1);
  tracePath(g, points);
  g.fillPath();
}

function strokeFacetOutline(
  g: Phaser.GameObjects.Graphics,
  points: readonly Pt[],
  color: number,
  alpha = 0.9,
  width = 1.5,
) {
  g.lineStyle(width, color, alpha);
  tracePath(g, points);
  g.strokePath();
}

function strokeEdge(
  g: Phaser.GameObjects.Graphics,
  a: Pt,
  b: Pt,
  color: number,
  alpha: number,
  width = 1.5,
) {
  g.lineStyle(width, color, alpha);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.strokePath();
}

/** Draws one flat hull plane: fill, outline, lightened highlight on its
 *  first edge, darkened shadow on a later edge — the repeated G5 recipe. */
function drawPlane(
  g: Phaser.GameObjects.Graphics,
  points: readonly Pt[],
  fillColor: number,
  highlightEdge: readonly [Pt, Pt],
  shadowEdge: readonly [Pt, Pt],
) {
  fillFacet(g, points, fillColor);
  strokeFacetOutline(g, points, tint(fillColor, -0.4), 0.85, 1.5);
  strokeEdge(g, highlightEdge[0], highlightEdge[1], tint(fillColor, 0.3), 0.55, 1.5);
  strokeEdge(g, shadowEdge[0], shadowEdge[1], tint(fillColor, -0.45), 0.5, 1.5);
}

export class HeroPresenter extends Phaser.GameObjects.Container {
  private headGroup: Phaser.GameObjects.Container;
  private visorGlow: Phaser.GameObjects.Rectangle;
  private visorCore: Phaser.GameObjects.Rectangle;
  private spineConduit: Phaser.GameObjects.Rectangle;
  private cardAnchor: Phaser.GameObjects.Container;
  private idleTween: Phaser.Tweens.Tween;
  private leanTween: Phaser.Tweens.Tween | null = null;
  private moodPulseTween: Phaser.Tweens.Tween | null = null;
  private headTiltTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    opts: HeroPresenterOptions,
  ) {
    super(scene, x, y);
    scene.add.existing(this);

    // ── Ground shadow — flat contact shadow beneath the feet ──────────────
    const groundShadow = scene.add.ellipse(0, 100, 76, 14, 0x000000, 0.3);
    this.add(groundShadow);

    // ── Hull graphics — torso, hip, legs, arms, shoulder stubs ────────────
    // One Graphics pass, drawn once (this presenter is static aside from
    // the lean/tilt tweens and the visor/spine pulse — no per-frame redraw
    // needed, unlike ProceduralPlayerRig's live-posed rig).
    const hull = scene.add.graphics();
    this.add(hull);

    const bodyColor = opts.bodyColor;
    const shadeColor = opts.shadeColor;

    // Torso hull — chamfered 8-point trapezoid, shoulders down to waist.
    const torso: Pt[] = [
      [-46, -70], [-38, -76], [38, -76], [46, -70],
      [28, 4], [22, 10], [-22, 10], [-28, 4],
    ];
    drawPlane(hull, torso, bodyColor, [[-38, -76], [38, -76]], [[22, 10], [-22, 10]]);

    // Hip skirt — flares from waist toward the leg line.
    const hip: Pt[] = [[-24, 10], [24, 10], [32, 26], [-32, 26]];
    drawPlane(hull, hip, shadeColor, [[-24, 10], [24, 10]], [[32, 26], [-32, 26]]);

    // Legs — tapered blade quads + a small chamfered foot facet each.
    const legL: Pt[] = [[-32, 26], [-18, 26], [-15, 82], [-25, 82]];
    const footL: Pt[] = [[-27, 82], [-11, 82], [-8, 94], [-30, 94]];
    const legR: Pt[] = [[18, 26], [32, 26], [25, 82], [15, 82]];
    const footR: Pt[] = [[11, 82], [27, 82], [30, 94], [8, 94]];
    drawPlane(hull, legL, shadeColor, [[-32, 26], [-18, 26]], [[-15, 82], [-25, 82]]);
    drawPlane(hull, footL, tint(shadeColor, -0.15), [[-27, 82], [-11, 82]], [[-8, 94], [-30, 94]]);
    drawPlane(hull, legR, shadeColor, [[18, 26], [32, 26]], [[25, 82], [15, 82]]);
    drawPlane(hull, footR, tint(shadeColor, -0.15), [[11, 82], [27, 82]], [[30, 94], [8, 94]]);

    // Left arm — relaxed, hangs slightly outward from the shoulder.
    const armL: Pt[] = [[-46, -72], [-40, -68], [-60, -8], [-68, -4]];
    drawPlane(hull, armL, shadeColor, [[-46, -72], [-40, -68]], [[-60, -8], [-68, -4]]);

    // Right arm — bent at the elbow, raised to hold the drafted card.
    const armRUpper: Pt[] = [[44, -74], [52, -70], [74, -46], [66, -42]];
    const armRFore: Pt[] = [[66, -46], [74, -50], [92, -66], [84, -70]];
    drawPlane(hull, armRUpper, shadeColor, [[44, -74], [52, -70]], [[74, -46], [66, -42]]);
    drawPlane(hull, armRFore, shadeColor, [[66, -46], [74, -50]], [[92, -66], [84, -70]]);

    // Shoulder stubs — small faceted crystal joint accents (matches
    // ProceduralPlayerRig's jointColor language: dark base diamond behind
    // a bright cyan diamond, no curves).
    this.drawJointStub(hull, -46, -71);
    this.drawJointStub(hull, 46, -71);

    // Card anchor lives at the tip of the raised right hand.
    this.cardAnchor = scene.add.container(94, -70);
    this.add(this.cardAnchor);

    // ── Spine energy conduit — the "alive" signal, mood-tinted ────────────
    this.spineConduit = scene.add.rectangle(0, -33, 3, 74, PALETTE.lightBeamCyan, 0.6);
    this.add(this.spineConduit);

    // ── Head group — hood + visor seam, pivoted at the neck for the mood
    // tilt so it never fights leanToward()'s whole-body hover rotation. ────
    this.headGroup = scene.add.container(0, -72);
    this.add(this.headGroup);

    const headGraphics = scene.add.graphics();
    this.headGroup.add(headGraphics);
    const hood: Pt[] = [[-14, 0], [-16, -20], [-9, -42], [9, -42], [16, -20], [14, 0]];
    drawPlane(headGraphics, hood, tint(bodyColor, -0.12), [[-9, -42], [9, -42]], [[-14, 0], [14, 0]]);

    // Visor seam — the ONE facial element this game's doctrine allows
    // anywhere: a thin glowing line, no eyes/brows/mouth. Two rectangles
    // (soft glow behind, bright core in front) so mood pulsing is a plain
    // alpha tween, not a per-frame Graphics redraw.
    this.visorGlow = scene.add.rectangle(0, -26, 22, 6, PALETTE.lightBeamCyan, 0.3);
    this.visorCore = scene.add.rectangle(0, -26, 15, 2, PALETTE.lightBeamCyan, 0.6);
    this.headGroup.add(this.visorGlow);
    this.headGroup.add(this.visorCore);

    // Set initial mood.
    const startExpr: HeroExpression = opts.playerBehind ? "angry" : "neutral";
    this.applyExpression(startExpr);

    // ── Idle bob tween — unchanged, already doctrine-compliant ────────────
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

  private drawJointStub(g: Phaser.GameObjects.Graphics, jx: number, jy: number) {
    const dark: Pt[] = [[jx - 5, jy], [jx, jy - 5], [jx + 5, jy], [jx, jy + 5]];
    const bright: Pt[] = [[jx - 3, jy], [jx, jy - 3], [jx + 3, jy], [jx, jy + 3]];
    fillFacet(g, dark, 0x07101c);
    fillFacet(g, bright, PALETTE.lightBeamCyan);
  }

  /**
   * Applies a mood. No face is swapped — only the visor seam's colour,
   * brightness, and pulse-rate change, plus a small head-tilt at the neck.
   * Same shape, every mood; state lives in animation/colour (Destiny-icon
   * principle, matches ProceduralPlayerRig's health-driven visor colour).
   */
  private applyExpression(expr: HeroExpression): void {
    const mood = MOOD_PROFILES[expr];

    this.visorGlow.setFillStyle(mood.visorColor, 1);
    this.visorCore.setFillStyle(mood.visorColor, 1);
    this.spineConduit.setFillStyle(mood.spineColor, 1);

    if (this.moodPulseTween) this.moodPulseTween.stop();
    const pulse = { t: 0 };
    this.moodPulseTween = this.scene.tweens.add({
      targets: pulse,
      t: 1,
      duration: mood.pulseMs,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        const visorAlpha = mood.visorBaseAlpha + mood.visorPulseAmplitude * pulse.t;
        this.visorCore.setAlpha(visorAlpha);
        this.visorGlow.setAlpha(visorAlpha * 0.5);
        this.spineConduit.setAlpha(mood.spineBaseAlpha * (0.75 + 0.25 * pulse.t));
      },
    });

    if (this.headTiltTween) this.headTiltTween.stop();
    this.headTiltTween = this.scene.tweens.add({
      targets: this.headGroup,
      rotation: mood.headTilt,
      duration: 260,
      ease: "Power2.Out",
    });
  }

  override destroy(fromScene?: boolean): void {
    this.idleTween.stop();
    this.leanTween?.stop();
    this.moodPulseTween?.stop();
    this.headTiltTween?.stop();
    super.destroy(fromScene);
  }
}
