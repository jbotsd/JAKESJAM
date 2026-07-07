import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import { PALETTE } from "../ui/palette.js";
import { type SpringState, springKick, springState, springTo } from "./spring";

/**
 * ProceduralPlayerRig - AAA-quality procedural character renderer.
 *
 * Renders a "gnostic vessel" — a ghost operating a lean biomechanical
 * frame — using filled polygons, not wireframe lines. Slimmer than a
 * true-armored build (a manufactured shell, not a tank), but stays
 * bipedal and readable at 30-60px: a visor-seam of light for a face,
 * a glowing spine conduit, crystal joint stubs, a crystal-tech arm cannon.
 *
 * Design references: Warframe (biomechanical-vessel silhouette, "a ghost
 * in a frame"), Hyper Light Drifter (crystal-tech glow), Nuclear Throne
 * (weight/impact, dialed back from "chunky" to "lean").
 *
 * `accentColor` (default crystal cyan) is the cosmetic-skin seam — swap it
 * per player to reskin the glow (visor/spine/cannon/crystal stubs) without
 * touching geometry. Purely visual; never read by the sim.
 *
 * Performance: ~0.3ms per character at 60fps. All procedural, no textures.
 */

type ProceduralPlayerRigOptions = {
  color: number;
  name: string;
  scale?: number;
  /** Cosmetic accent (visor/spine/cannon glow). Defaults to crystal cyan. */
  accentColor?: number;
};

type ProceduralPlayerPose = {
  position: Vec2;
  velocity: Vec2;
  aimTarget: Vec2;
  grounded: boolean;
  crouching: boolean;
  health?: number;
  maxHealth?: number;
  /** -1/0/+1: which side (if any) the player is gripping a wall on. */
  touchingWallDir?: number;
  /** True while a dash is active. */
  dashing?: boolean;
};

type LimbSolve = {
  joint: Vec2;
  end: Vec2;
};

// --- Colour Constants ---
const DARK = 0x07101c;
const DARK2 = 0x0f1a2e;
const WHITE = 0xf7fbff;
const ACCENT = 0x8ff8ff; // Crystal cyan glow

export class ProceduralPlayerRig {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly color: number;
  private readonly colorDark: number;
  private readonly accentColor: number;
  private readonly name: string;
  private readonly scale: number;
  private stepPhase = 0;
  private facing = 1;
  private firePulse = 0;
  // Visual-only knockback. Set by triggerHit(); decays over HIT_DECAY_MS.
  // Per game-feel-juice §5 — render layer overshoots authoritative position.
  private hitOffsetX = 0;
  private hitOffsetY = 0;
  private hitDecay = 0;
  private static readonly HIT_DECAY_MS = 90;
  private readonly trailPositions: { x: number; y: number; t: number }[] = [];
  private lastTrailSampleMs = 0;

  // Wobbly-leg secondary motion: each foot's IK target chases footPos()
  // through a spring instead of snapping to it, so plants/direction changes/
  // landings overshoot and settle. Pure render layer — solveTwoBone still
  // clamps reach, so an aggressive wobble just reads as the leg straining.
  private footSpringsReady = false;
  private footLSpringX: SpringState = springState(0);
  private footLSpringY: SpringState = springState(0);
  private footRSpringX: SpringState = springState(0);
  private footRSpringY: SpringState = springState(0);
  private wasGrounded = true;
  private prevVelY = 0;
  // Bumped 9→12Hz for a nimbler, snappier settle — a lean vessel should
  // recover from a plant/landing quicker than a heavier build would.
  private static readonly WOBBLE_FREQUENCY_HZ = 12;
  private static readonly WOBBLE_DAMPING = 0.38;
  // Landing converts stored fall speed into a foot-spring velocity kick —
  // the wobble's payoff moment: a hard landing (esp. off a wall-jump) makes
  // the legs visibly absorb and rebound instead of just stopping dead.
  private static readonly LANDING_KICK_SCALE = 0.35;
  private static readonly LANDING_KICK_MAX = 900;

  // Wall-jump kick-off: the instant the player leaves a wall while airborne,
  // both foot springs get a velocity kick away from the wall (and up), so the
  // legs visibly snap into the launch instead of just continuing whatever
  // stride phase they were in. Reuses the same foot-spring rig as the
  // landing kick — one wobble system serving both ends of a wall-jump.
  private wasWallDir = 0;
  private static readonly WALL_KICK_X = 520;
  private static readonly WALL_KICK_Y = -360;

  // Arms, rebuilt ground-up: BOTH arms are the exact same length (upper ==
  // lower, lead == back) and hang perfectly STRAIGHT by default — the
  // two-bone solve only bends when the hand target is placed closer than
  // the arm's full reach. Bending is reserved for two purposeful states:
  // gripping a wall, and the natural swing while running. Idle, airborne,
  // and dashing all keep both arms dead straight — an alien stillness that
  // breaks the instant the vessel actually moves or grabs something.
  private static readonly ARM_UPPER = 20;
  private static readonly ARM_LOWER = 20;
  private static readonly ARM_REACH = ProceduralPlayerRig.ARM_UPPER + ProceduralPlayerRig.ARM_LOWER;
  private leadHandSpringReady = false;
  private leadHandSpringX: SpringState = springState(0);
  private leadHandSpringY: SpringState = springState(0);
  private backHandSpringReady = false;
  private backHandSpringX: SpringState = springState(0);
  private backHandSpringY: SpringState = springState(0);
  private static readonly ARM_FREQUENCY_HZ = 7;
  private static readonly ARM_DAMPING = 0.55;

  // Hip drape (the "space wizard" sash) — a short cloth strip that trails
  // and flutters off the pelvis. Springed to velocity so it whips out on a
  // dash and settles with a lag on landing, instead of pinning rigidly to
  // the body like a plate.
  private drapeSpringReady = false;
  private drapeSpringX: SpringState = springState(0);
  private drapeSpringY: SpringState = springState(0);
  private static readonly DRAPE_FREQUENCY_HZ = 5;
  private static readonly DRAPE_DAMPING = 0.35;

  // Charge stance (the Kamehameha read): both hands converge on one shared
  // point near the hip instead of posing independently, with a growing orb
  // between them — the natural future spawn point for a projectile/ability
  // effect. Ramps while idle/running/airborne; resets on dash (the
  // "release") and while wall-gripping (one hand is busy holding on).
  private chargeMs = 0;
  private static readonly CHARGE_RAMP_MS = 1600;

  // "Mad aura" — a small turbulent halo of motes orbiting the vessel.
  // Per-instance phase/radius offsets (frozen at construction) so a lineup
  // of players doesn't all swirl in lockstep. Deliberately irregular
  // (three different frequencies summed) rather than a clean circular
  // orbit — reads as barely-contained energy, not a UI ring.
  private static readonly AURA_MOTE_COUNT = 6;
  private readonly auraSeed = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, options: ProceduralPlayerRigOptions) {
    // Depth 10: above pickups (2), destructibles (3), fire (4), atmospheric
    // backdrop (-10), and light beams (0.7); well below HUD (>=950).
    // Without this, light beams visually clip through the player rig and
    // read as "the player is inside the terrain."
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(10);
    this.nameText = scene.add
      .text(0, 0, options.name, {
        color: `#${PALETTE.textHi.toString(16).padStart(6, "0")}`,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: `${Math.round(10 * (options.scale ?? 1))}px`,
        fontStyle: "700",
      })
      .setOrigin(0.5, 1)
      .setDepth(11);
    this.color = options.color;
    this.colorDark = shadeColor(options.color, -0.4);
    this.accentColor = options.accentColor ?? ACCENT;
    this.name = options.name;
    this.scale = options.scale ?? 1;
  }

  private lastDrawX = 0;
  private lastDrawY = 0;

  update(deltaMs: number, pose: ProceduralPlayerPose) {
    this.lastDrawX = pose.position.x;
    this.lastDrawY = pose.position.y;
    if (!this.graphics.visible) return;

    const walkAmount = Phaser.Math.Clamp(Math.abs(pose.velocity.x) / 180, 0, 1);
    this.stepPhase += deltaMs * (0.006 + walkAmount * 0.01);
    this.firePulse = Math.max(0, this.firePulse - deltaMs * 0.004);
    this.hitDecay = Math.max(0, this.hitDecay - deltaMs / ProceduralPlayerRig.HIT_DECAY_MS);

    if (Math.abs(pose.velocity.x) > 8) {
      this.facing = Math.sign(pose.velocity.x);
    } else if (Math.abs(pose.aimTarget.x - pose.position.x) > 2) {
      this.facing = Math.sign(pose.aimTarget.x - pose.position.x);
    }

    // Trail sampling — wall-clock, purely visual feedback
    const now = Date.now();
    if (now - this.lastTrailSampleMs >= 40) {
      this.trailPositions.push({ x: pose.position.x, y: pose.position.y, t: now });
      if (this.trailPositions.length > 6) {
        this.trailPositions.shift();
      }
      this.lastTrailSampleMs = now;
    }

    // Landing impact: the frame grounded flips true, kick both foot springs'
    // vertical velocity from the fall speed carried in on the PREVIOUS frame
    // (this frame's velocity.y is typically already zeroed by the collision
    // resolve, so the pre-landing value is the one that reads as "impact").
    if (pose.grounded && !this.wasGrounded) {
      const kick = Phaser.Math.Clamp(
        this.prevVelY * ProceduralPlayerRig.LANDING_KICK_SCALE,
        -ProceduralPlayerRig.LANDING_KICK_MAX,
        ProceduralPlayerRig.LANDING_KICK_MAX,
      );
      this.footLSpringY = springKick(this.footLSpringY, kick);
      this.footRSpringY = springKick(this.footRSpringY, kick);
    }
    this.wasGrounded = pose.grounded;
    this.prevVelY = pose.velocity.y;

    // Wall-jump kick-off: the tick the player leaves a wall while still
    // airborne (a true wall-jump, or just sliding off the end of one — both
    // read correctly as "the legs just pushed off"), kick both feet away
    // from the wall and upward.
    const wallDir = pose.touchingWallDir ?? 0;
    if (this.wasWallDir !== 0 && wallDir === 0 && !pose.grounded) {
      const kickDir = -this.wasWallDir;
      this.footLSpringX = springKick(this.footLSpringX, kickDir * ProceduralPlayerRig.WALL_KICK_X);
      this.footRSpringX = springKick(this.footRSpringX, kickDir * ProceduralPlayerRig.WALL_KICK_X);
      this.footLSpringY = springKick(this.footLSpringY, ProceduralPlayerRig.WALL_KICK_Y);
      this.footRSpringY = springKick(this.footRSpringY, ProceduralPlayerRig.WALL_KICK_Y);
    }
    this.wasWallDir = wallDir;

    // Charge ramps whenever both hands are free to hold the stance (not
    // gripping a wall); dashing is the release, so it resets hard.
    if (pose.dashing) {
      this.chargeMs = 0;
    } else if (wallDir === 0) {
      this.chargeMs = Math.min(ProceduralPlayerRig.CHARGE_RAMP_MS, this.chargeMs + deltaMs);
    }

    this.draw(pose, walkAmount, deltaMs);
  }

  destroy() {
    this.graphics.destroy();
    this.nameText.destroy();
  }

  /** Renderer-truth snapshot for the __rigDebug probe hook: what this rig
   *  last drew and whether it's currently visible. */
  debugInfo(): { visible: boolean; x: number; y: number } {
    return {
      visible: this.graphics.visible,
      x: this.lastDrawX,
      y: this.lastDrawY,
    };
  }

  setVisible(visible: boolean) {
    this.graphics.setVisible(visible);
    this.nameText.setVisible(visible);
    if (!visible) this.graphics.clear();
  }

  /** Trigger muzzle flash pulse (call on fire). */
  triggerFire() {
    this.firePulse = 1;
  }

  /**
   * Trigger a visual knockback on hit. Direction is unit-ish; magnitude is
   * scaled internally. Pure render — does not affect the authoritative sim.
   * Per game-feel-juice §5.
   */
  triggerHit(dirX: number, dirY: number) {
    const MAG = 6;
    this.hitOffsetX = dirX * MAG;
    this.hitOffsetY = dirY * MAG;
    this.hitDecay = 1;
  }

  private draw(pose: ProceduralPlayerPose, walkAmount: number, deltaMs: number) {
    const g = this.graphics;
    const s = this.scale;
    // Quadratic ease-out — strong overshoot, fast snap-back. Visual only.
    const hitEased = this.hitDecay * this.hitDecay;
    const ground = pose.position.y + this.hitOffsetY * hitEased;
    const cr = pose.crouching ? 1 : 0;
    const bob =
      pose.grounded && !pose.crouching ? Math.abs(Math.sin(this.stepPhase)) * 2 * walkAmount : 0;

    // Squash & stretch (visual only): the body ELONGATES on a powerful launch
    // (strong upward velocity — a wall-jump reads as a real kick) and COMPRESSES
    // on a fast fall / impact. Sells the wall-jump's power without touching the
    // sim. Only airborne, so grounded walk/idle is unaffected.
    const stretchY = pose.grounded
      ? 1
      : 1 + Phaser.Math.Clamp(-pose.velocity.y / 2600, -0.14, 0.3);
    const sy = s * stretchY;

    // Wall-slide / dash read as full-body states, not just leg tricks: the
    // torso leans toward a gripped wall (bracing) or forward into a dash
    // (committed). Only chest/head shift — the pelvis stays anchored so the
    // stance doesn't wander. A ground sprint gets its own, smaller forward
    // lean too — "very nimble" means committing into a run, not staying
    // bolt upright at full speed.
    const wallDir = pose.touchingWallDir ?? 0;
    const wallSliding = wallDir !== 0 && !pose.grounded;
    const dashing = pose.dashing ?? false;
    const sprintLean = pose.grounded ? Phaser.Math.Clamp(pose.velocity.x / 330, -1, 1) * 2 * s : 0;
    const leanX =
      (wallSliding ? wallDir * 2.5 * s : 0) + (dashing ? this.facing * 4 * s : 0) + sprintLean;

    // Key positions
    const pelvisY = ground - Phaser.Math.Linear(52, 32, cr) * sy - bob;
    const chestY = ground - Phaser.Math.Linear(78, 56, cr) * sy - bob;
    const headY = ground - Phaser.Math.Linear(100, 76, cr) * sy - bob;
    const cx = pose.position.x + this.hitOffsetX * hitEased;

    const pelvis = vec(cx, pelvisY);
    const chest = vec(cx + leanX, chestY);
    const head = vec(cx + leanX + this.facing * 2 * s, headY);

    // Aim
    const aimAngle = Math.atan2(pose.aimTarget.y - chest.y, pose.aimTarget.x - chest.x);
    const aim = vec(Math.cos(aimAngle), Math.sin(aimAngle));
    const perp = vec(-aim.y, aim.x);

    // Joints
    const hipL = vec(pelvis.x - 7 * s, pelvis.y);
    const hipR = vec(pelvis.x + 7 * s, pelvis.y);
    const shoulderLead = vec(chest.x + perp.x * 7 * s, chest.y + perp.y * 7 * s);
    const shoulderBack = vec(chest.x - perp.x * 7 * s, chest.y - perp.y * 7 * s);

    // Hip drape: hangs straight down at rest, kicked backward by horizontal
    // speed (trails behind a sprint/dash) and by falling speed (streams up
    // behind a fast descent) — a springed target so it whips out and settles
    // rather than snapping. Range widened (was ±6) so a dash (780px/s) reads
    // as a real whip-out, clearly beyond a normal sprint's (330px/s) sway.
    const drapeTargetRaw = vec(
      pelvis.x - Phaser.Math.Clamp(pose.velocity.x / 45, -14, 14) * s,
      pelvis.y + 14 * s - Phaser.Math.Clamp(pose.velocity.y / 140, -3, 3) * s,
    );
    if (!this.drapeSpringReady) {
      this.drapeSpringX = springState(drapeTargetRaw.x);
      this.drapeSpringY = springState(drapeTargetRaw.y);
      this.drapeSpringReady = true;
    }
    this.drapeSpringX = springTo(
      this.drapeSpringX,
      drapeTargetRaw.x,
      deltaMs,
      ProceduralPlayerRig.DRAPE_FREQUENCY_HZ,
      ProceduralPlayerRig.DRAPE_DAMPING,
    );
    this.drapeSpringY = springTo(
      this.drapeSpringY,
      drapeTargetRaw.y,
      deltaMs,
      ProceduralPlayerRig.DRAPE_FREQUENCY_HZ,
      ProceduralPlayerRig.DRAPE_DAMPING,
    );
    const drapeTip = vec(this.drapeSpringX.value, this.drapeSpringY.value);

    // Both hands, one shared state machine (see computeArmTargets): a
    // two-handed charge stance by default (converged on one point, straight
    // arms), a wall-plant bend for the gripping hand, and a straight thrust
    // toward aim on dash (the "release"). Springed so state changes settle
    // instead of popping.
    const armTargets = this.computeArmTargets(
      shoulderLead,
      shoulderBack,
      pelvis,
      aim,
      walkAmount,
      wallDir,
      dashing,
      s,
    );

    if (!this.leadHandSpringReady) {
      this.leadHandSpringX = springState(armTargets.lead.x);
      this.leadHandSpringY = springState(armTargets.lead.y);
      this.leadHandSpringReady = true;
    }
    this.leadHandSpringX = springTo(
      this.leadHandSpringX,
      armTargets.lead.x,
      deltaMs,
      ProceduralPlayerRig.ARM_FREQUENCY_HZ,
      ProceduralPlayerRig.ARM_DAMPING,
    );
    this.leadHandSpringY = springTo(
      this.leadHandSpringY,
      armTargets.lead.y,
      deltaMs,
      ProceduralPlayerRig.ARM_FREQUENCY_HZ,
      ProceduralPlayerRig.ARM_DAMPING,
    );
    const handLead = vec(this.leadHandSpringX.value, this.leadHandSpringY.value);

    if (!this.backHandSpringReady) {
      this.backHandSpringX = springState(armTargets.back.x);
      this.backHandSpringY = springState(armTargets.back.y);
      this.backHandSpringReady = true;
    }
    this.backHandSpringX = springTo(
      this.backHandSpringX,
      armTargets.back.x,
      deltaMs,
      ProceduralPlayerRig.ARM_FREQUENCY_HZ,
      ProceduralPlayerRig.ARM_DAMPING,
    );
    this.backHandSpringY = springTo(
      this.backHandSpringY,
      armTargets.back.y,
      deltaMs,
      ProceduralPlayerRig.ARM_FREQUENCY_HZ,
      ProceduralPlayerRig.ARM_DAMPING,
    );
    const handBack = vec(this.backHandSpringX.value, this.backHandSpringY.value);

    // Feet — raw stepping targets (or a wall-plant target while gripping),
    // then run through a spring so the IK end effector chases the target
    // with lag/overshoot instead of snapping.
    const footLTarget =
      wallSliding && wallDir === -1
        ? this.wallPlantFoot(cx, wallDir, pelvis, s)
        : this.footPos(cx, -1, ground, walkAmount, pose.crouching, pose.grounded);
    const footRTarget =
      wallSliding && wallDir === 1
        ? this.wallPlantFoot(cx, wallDir, pelvis, s)
        : this.footPos(cx, 1, ground, walkAmount, pose.crouching, pose.grounded);

    if (!this.footSpringsReady) {
      this.footLSpringX = springState(footLTarget.x);
      this.footLSpringY = springState(footLTarget.y);
      this.footRSpringX = springState(footRTarget.x);
      this.footRSpringY = springState(footRTarget.y);
      this.footSpringsReady = true;
    }
    const freq = ProceduralPlayerRig.WOBBLE_FREQUENCY_HZ;
    const damping = ProceduralPlayerRig.WOBBLE_DAMPING;
    this.footLSpringX = springTo(this.footLSpringX, footLTarget.x, deltaMs, freq, damping);
    this.footLSpringY = springTo(this.footLSpringY, footLTarget.y, deltaMs, freq, damping);
    this.footRSpringX = springTo(this.footRSpringX, footRTarget.x, deltaMs, freq, damping);
    this.footRSpringY = springTo(this.footRSpringY, footRTarget.y, deltaMs, freq, damping);
    const footL = vec(this.footLSpringX.value, this.footLSpringY.value);
    const footR = vec(this.footRSpringX.value, this.footRSpringY.value);

    // IK
    const legLen1 = Phaser.Math.Linear(28, 22, cr) * s;
    const legLen2 = Phaser.Math.Linear(28, 22, cr) * s;
    const legL = solveTwoBone(hipL, footL, legLen1, legLen2, -this.facing);
    const legR = solveTwoBone(hipR, footR, legLen1, legLen2, -this.facing);
    const armUpper = ProceduralPlayerRig.ARM_UPPER * s;
    const armLower = ProceduralPlayerRig.ARM_LOWER * s;
    const armLead = solveTwoBone(shoulderLead, handLead, armUpper, armLower, -this.facing);
    const armBack = solveTwoBone(shoulderBack, handBack, armUpper, armLower, this.facing);

    const healthRatio = (pose.health ?? 100) / Math.max(1, pose.maxHealth ?? 100);

    g.clear();

    // --- TRAIL (drawn before body so it sits behind everything) ---
    this.drawTrail(g, pose.position, pose.velocity, s);

    // --- DRAW ORDER (back to front) ---

    // 0. Mad aura — an ambient field around the vessel, behind the body.
    this.drawAura(g, pelvis, chest, s);

    // 1. Nameplate + health bar (topmost layer visually but drawn first for z)
    this.drawNameplate(g, head.x, head.y - 24 * s, s, pose.health ?? 100, pose.maxHealth ?? 100);

    // 2. Back leg
    this.drawThickLimb(g, hipR, legR, 5.5 * s, 4 * s);
    this.drawBoot(g, footR, s);

    // 3. Back arm + hand — a bare glowing hand, not a gun: the "casting"
    // limb read the abilities/effects system can hook a spell VFX onto
    // later without touching the geometry.
    this.drawThickLimb(g, shoulderBack, armBack, 4.6 * s, 3.2 * s);
    this.drawShoulderArmor(g, shoulderBack, s);
    this.drawHandGlow(g, armBack.end, s, 0);

    // 3b. Hip drape (the wizard sash) — behind the torso so only its
    // trailing edge peeks out, same layering a real cloak would have.
    this.drawHipDrape(g, pelvis, drapeTip, s);

    // 4. Torso (filled polygon - the character's MASS)
    this.drawTorso(g, pelvis, chest, s);

    // 5. Spine energy lines — dims while gripping a wall (conserving, not
    // spending, energy) versus the normal health-driven brightness.
    this.drawSpineGlow(g, pelvis, chest, s, healthRatio, wallSliding);

    // 6. Front leg
    this.drawThickLimb(g, hipL, legL, 6.2 * s, 4.6 * s);
    this.drawBoot(g, footL, s);

    // 7. Front arm + hand — the "active" hand: brighter, pulses on
    // triggerFire() (kept as the ability/cast-trigger hook).
    this.drawThickLimb(g, shoulderLead, armLead, 5.4 * s, 3.8 * s);
    this.drawShoulderArmor(g, shoulderLead, s);
    this.drawHandGlow(g, armLead.end, s, this.firePulse);

    // 8. Charge orb — the shared point between the two hands, growing the
    // longer the vessel holds the stance. Skipped while wall-gripping (one
    // hand is busy) or dashing (the orb just fired).
    if (wallDir === 0 && !dashing) {
      this.drawChargeOrb(g, armLead.end, armBack.end, s);
    }

    // 10. Head + hood + visor
    this.drawHead(g, head, s, healthRatio);
  }

  // --- TRAIL: Fading body-color dots at past positions ---
  private drawTrail(
    g: Phaser.GameObjects.Graphics,
    currentPos: Vec2,
    velocity: Vec2,
    s: number,
  ): void {
    if (this.trailPositions.length < 2) return;

    // Velocity gate: compute speed from last 2 buffer entries
    const last = this.trailPositions[this.trailPositions.length - 1];
    const prev = this.trailPositions[this.trailPositions.length - 2];
    if (!last || !prev) return;

    const dt = Math.max(1, last.t - prev.t);
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const speed = Math.hypot(dx, dy) / (dt / 1000);

    // Also check live velocity as a fallback (covers the very first few frames)
    const liveSpeed = Math.hypot(velocity.x, velocity.y);
    const topSpeed = Math.max(speed, liveSpeed);
    if (topSpeed <= 60) return;

    // Intensity ramps with speed so a SPRINT card reads as a brighter streak
    // and a DASH (>~500 px/s, above the normal max) blazes white-hot after-
    // images. Card feedback with zero sim coupling — pure velocity read.
    const intensity = Phaser.Math.Clamp((topSpeed - 60) / 720, 0, 1);
    const dashing = topSpeed > 500;
    const col = dashing ? 0xffffff : this.color;

    const len = this.trailPositions.length;
    for (let i = 0; i < len; i++) {
      const entry = this.trailPositions[i];
      if (!entry) continue;

      // Skip dots too close to current position (avoids smear when near-stationary)
      const distToCurrent = Math.hypot(entry.x - currentPos.x, entry.y - currentPos.y);
      if (distToCurrent < 4) continue;

      // Older entries have lower index → lower alpha; boosted by speed.
      const alpha = ((i + 1) / len) * (0.4 + intensity * 0.5);
      const radius = (3 + intensity * 3) * s;
      g.fillStyle(col, alpha);
      g.fillCircle(entry.x, entry.y, radius);
    }
  }

  // --- TORSO: Filled armored body ---
  private drawTorso(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
    const w1 = 11 * s; // chest width — leaner vessel taper, not armored bulk
    const w2 = 7.5 * s; // pelvis width

    // Dark outline
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2 - 1, chest.y - 2 * s);
    g.lineTo(chest.x + w1 / 2 + 1, chest.y - 2 * s);
    g.lineTo(pelvis.x + w2 / 2 + 1, pelvis.y + 2 * s);
    g.lineTo(pelvis.x - w2 / 2 - 1, pelvis.y + 2 * s);
    g.closePath();
    g.fillPath();

    // Main body fill
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2, chest.y);
    g.lineTo(chest.x + w1 / 2, chest.y);
    g.lineTo(pelvis.x + w2 / 2, pelvis.y);
    g.lineTo(pelvis.x - w2 / 2, pelvis.y);
    g.closePath();
    g.fillPath();

    // Chest plate highlight
    g.fillStyle(this.color, 0.8);
    g.beginPath();
    g.moveTo(chest.x - w1 * 0.35, chest.y + 2 * s);
    g.lineTo(chest.x + w1 * 0.35, chest.y + 2 * s);
    g.lineTo(pelvis.x + w2 * 0.25, pelvis.y - 4 * s);
    g.lineTo(pelvis.x - w2 * 0.25, pelvis.y - 4 * s);
    g.closePath();
    g.fillPath();

    // Belt line
    g.fillStyle(DARK, 0.9);
    g.fillRect(pelvis.x - w2 / 2 + 1, pelvis.y - 3 * s, w2 - 2, 4 * s);

    // Upper-hemisphere rim arc — simulates directional light from above.
    // 200° → 340° (top arc), 2px, light warm color at alpha 0.20.
    g.lineStyle(2 * s, PALETTE.lightBeamWarm, 0.20);
    g.beginPath();
    g.arc(
      chest.x,
      chest.y,
      w1 / 2 + 1,
      Phaser.Math.DegToRad(200),
      Phaser.Math.DegToRad(340),
      false,
    );
    g.strokePath();
  }

  // --- SPINE GLOW: Energy filaments showing health ---
  private drawSpineGlow(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
    healthRatio: number,
    gripping: boolean,
  ) {
    const alpha = (0.3 + 0.6 * healthRatio) * (gripping ? 0.55 : 1);
    const color = healthRatio < 0.25 ? 0xfb7185 : this.accentColor;

    g.lineStyle(2 * s, color, alpha);
    g.beginPath();
    g.moveTo(pelvis.x, pelvis.y - 2 * s);
    g.lineTo(chest.x, chest.y + 2 * s);
    g.strokePath();

    // Rib filaments — two thinner, dimmer seams flanking the spine, angled
    // slightly outward. Sells "something alive glowing inside the vessel"
    // rather than a single wire down the middle.
    g.lineStyle(1 * s, color, alpha * 0.5);
    for (const side of [-1, 1] as const) {
      g.beginPath();
      g.moveTo(pelvis.x + side * 2.5 * s, pelvis.y - 4 * s);
      g.lineTo(chest.x + side * 4 * s, chest.y + 3 * s);
      g.strokePath();
    }

    // Centre glow dot
    const midY = (pelvis.y + chest.y) / 2;
    g.fillStyle(color, alpha * 0.6);
    g.fillCircle(pelvis.x, midY, 3 * s);
  }

  // --- MAD AURA: a turbulent halo of motes orbiting the vessel, each
  // trailing a short comet-tail. Three summed sine frequencies per mote
  // instead of a clean circular orbit — deliberately irregular, reads as
  // barely-contained energy rather than a decorative UI ring. Envelops the
  // whole body (pelvis to well above the head), not just the torso. ---
  private drawAura(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
    const cx = (pelvis.x + chest.x) / 2;
    const cy = (pelvis.y + chest.y) / 2 - 10 * s;
    const t = this.stepPhase + this.auraSeed;

    const motePos = (i: number, tt: number): { x: number; y: number } => {
      const off = (i / ProceduralPlayerRig.AURA_MOTE_COUNT) * Math.PI * 2;
      const radius = (20 + 7 * Math.sin(tt * 0.7 + off * 2)) * s;
      const angle = tt * (1.1 + i * 0.17) + off;
      const wobbleR = radius + 4 * s * Math.sin(tt * 2.3 + off);
      return {
        x: cx + Math.cos(angle) * wobbleR,
        y: cy + Math.sin(angle) * wobbleR * 0.8,
      };
    };

    for (let i = 0; i < ProceduralPlayerRig.AURA_MOTE_COUNT; i++) {
      const off = (i / ProceduralPlayerRig.AURA_MOTE_COUNT) * Math.PI * 2;
      const twinkle = 0.55 + 0.35 * Math.sin(t * 3.1 + off * 3);

      // Comet tail: three fading echoes sampled slightly earlier in time.
      for (let e = 3; e >= 1; e--) {
        const echo = motePos(i, t - e * 0.05);
        const tailAlpha = twinkle * (0.22 - e * 0.05);
        g.fillStyle(this.accentColor, Math.max(0, tailAlpha));
        g.fillCircle(echo.x, echo.y, (2.2 - e * 0.4) * s);
      }

      const p = motePos(i, t);
      g.fillStyle(this.accentColor, twinkle * 0.4);
      g.fillCircle(p.x, p.y, 4.5 * s);
      g.fillStyle(this.accentColor, twinkle * 0.85);
      g.fillCircle(p.x, p.y, 2.4 * s);
      g.fillStyle(WHITE, twinkle * 0.8);
      g.fillCircle(p.x, p.y, 1 * s);
    }
  }

  // --- HIP DRAPE: a short cloth strip trailing off the pelvis — the
  // "wizard sash" that keeps the vessel from reading as pure armor plate.
  private drawHipDrape(g: Phaser.GameObjects.Graphics, pelvis: Vec2, tip: Vec2, s: number) {
    const w = 5 * s;
    const nx = -(tip.y - pelvis.y);
    const ny = tip.x - pelvis.x;
    const len = Math.hypot(nx, ny) || 1;
    const px = (nx / len) * w;
    const py = (ny / len) * w;

    // Dark outline first (same outline-then-fill pattern as the limbs) so
    // the drape keeps a visible silhouette edge against the torso/legs
    // instead of blending into them.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(pelvis.x - px * 0.7 - 1, pelvis.y - py * 0.7 - 1);
    g.lineTo(pelvis.x + px * 0.7 + 1, pelvis.y + py * 0.7 + 1);
    g.lineTo(tip.x + px * 0.3, tip.y + py * 0.3);
    g.lineTo(tip.x - px * 0.3, tip.y - py * 0.3);
    g.closePath();
    g.fillPath();

    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(pelvis.x - px * 0.6, pelvis.y - py * 0.6);
    g.lineTo(pelvis.x + px * 0.6, pelvis.y + py * 0.6);
    g.lineTo(tip.x + px * 0.25, tip.y + py * 0.25);
    g.lineTo(tip.x - px * 0.25, tip.y - py * 0.25);
    g.closePath();
    g.fillPath();

    // Accent glow trim, bolder than the first pass, along both edges.
    g.lineStyle(1.2 * s, this.accentColor, 0.6);
    g.beginPath();
    g.moveTo(pelvis.x + px * 0.6, pelvis.y + py * 0.6);
    g.lineTo(tip.x + px * 0.25, tip.y + py * 0.25);
    g.strokePath();
  }

  // --- HEAD CREST: the swept blade/fin every Warframe silhouette shares —
  // the single strongest identity marker the vessel was missing. Drawn
  // BEHIND the hood so the hood's base overlaps its root and only the
  // swept blade reads clearly above/behind the skull. ---
  private drawHeadCrest(g: Phaser.GameObjects.Graphics, head: Vec2, s: number) {
    const f = this.facing;
    const rootX = head.x - f * 1 * s;
    const rootY = head.y - 8 * s;
    // Sweeps mostly BACKWARD (opposite facing) rather than steeply upward,
    // so the tip clears the nameplate/health-bar line drawn just above the
    // head instead of visually tangling with it.
    const tipX = head.x - f * 19 * s;
    const tipY = head.y - 19 * s;

    // Dark base — bigger swept silhouette than the first pass, so it reads
    // as a real fin/horn rather than a hood wrinkle.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(rootX - f * 3 * s, rootY + 3 * s);
    g.lineTo(tipX, tipY);
    g.lineTo(rootX + f * 4 * s, rootY - 1.5 * s);
    g.closePath();
    g.fillPath();

    // Bright plate fill — full player color (not the darkened body shade),
    // so the crest visually separates from the hood instead of blending
    // into it.
    g.fillStyle(this.color, 1);
    g.beginPath();
    g.moveTo(rootX - f * 1.5 * s, rootY + 1.5 * s);
    g.lineTo(tipX + f * 1.5 * s, tipY + 1.5 * s);
    g.lineTo(rootX + f * 3 * s, rootY - 1 * s);
    g.closePath();
    g.fillPath();

    // Accent glow edge along the leading (upper) side, plus a soft outer
    // halo so the crest reads as energized, matching the visor/spine.
    g.lineStyle(1.4 * s, this.accentColor, 0.8);
    g.beginPath();
    g.moveTo(rootX + f * 3 * s, rootY - 1 * s);
    g.lineTo(tipX + f * 1.5 * s, tipY + 1.5 * s);
    g.strokePath();
    g.fillStyle(this.accentColor, 0.35);
    g.fillCircle(tipX + f * 1.5 * s, tipY + 1.5 * s, 2 * s);
  }

  // --- HEAD: Hood + helmet + visor ---
  private drawHead(g: Phaser.GameObjects.Graphics, head: Vec2, s: number, healthRatio: number) {
    const f = this.facing;

    this.drawHeadCrest(g, head, s);

    // Hood shadow (larger dark shape behind head) — narrower than the old
    // helmet build, reads as a sealed vessel-hull rather than a hard helmet.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(head.x - 8.5 * s, head.y + 6 * s);
    g.lineTo(head.x + f * 2 * s - 6.5 * s, head.y - 14 * s);
    g.lineTo(head.x + f * 2 * s + 6.5 * s, head.y - 14 * s);
    g.lineTo(head.x + 8.5 * s, head.y + 6 * s);
    g.closePath();
    g.fillPath();

    // Hood main (player colored)
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(head.x - 6.5 * s, head.y + 4 * s);
    g.lineTo(head.x + f * 2 * s - 5 * s, head.y - 12 * s);
    g.lineTo(head.x + f * 2 * s + 5 * s, head.y - 12 * s);
    g.lineTo(head.x + 6.5 * s, head.y + 4 * s);
    g.closePath();
    g.fillPath();

    // Face plate (darker inset)
    g.fillStyle(DARK2, 0.9);
    g.fillRoundedRect(head.x + f * 2 * s - 5 * s, head.y - 6 * s, 10 * s, 9 * s, 2 * s);

    // VISOR SEAM — the vessel's "face" is a thin line of light, not a thick
    // eye-slit: longer and narrower than the old helmet visor.
    const visorColor = healthRatio < 0.25 ? 0xfb7185 : this.accentColor;
    const visorAlpha = 0.7 + 0.3 * Math.sin(this.stepPhase * 2);

    // Outer glow
    g.fillStyle(visorColor, visorAlpha * 0.35);
    g.fillRoundedRect(head.x + f * 3 * s - 7.5 * s, head.y - 2.6 * s, 15 * s, 3 * s, 1.5 * s);

    // Core seam
    g.fillStyle(visorColor, visorAlpha);
    g.fillRect(head.x + f * 3 * s - 6.25 * s, head.y - 1.8 * s, 12.5 * s, 1.8 * s);

    // Inner bright spot (represents eye direction)
    g.fillStyle(WHITE, visorAlpha * 0.8);
    g.fillRect(head.x + f * 5 * s - 2 * s, head.y - 1.4 * s, 4 * s, 1.1 * s);
  }

  // --- SHOULDER STUB: crystal joint seal, not a bulky pauldron ---
  private drawShoulderArmor(g: Phaser.GameObjects.Graphics, shoulder: Vec2, s: number) {
    g.fillStyle(DARK, 1);
    g.fillCircle(shoulder.x, shoulder.y, 4.5 * s);
    g.fillStyle(this.color, 0.9);
    g.fillCircle(shoulder.x, shoulder.y, 3.4 * s);

    // Crystal accent on shoulder
    g.fillStyle(this.accentColor, 0.7);
    g.fillCircle(shoulder.x, shoulder.y, 1.6 * s);
  }

  // --- HAND GLOW: a bare channeling hand, not a gun. Both hands get one —
  // the vessel doesn't hold a weapon, it channels straight from the palm.
  // `pulse` (0-1) is the ability/cast-trigger hook: triggerFire() drives
  // the lead hand's pulse today, but any future ability effect can drive
  // either hand's pulse the same way without touching this method. ---
  private drawHandGlow(g: Phaser.GameObjects.Graphics, hand: Vec2, s: number, pulse: number) {
    // Bare palm — small dark disc, no barrel/weapon geometry.
    g.fillStyle(DARK, 1);
    g.fillCircle(hand.x, hand.y, 2.6 * s);
    g.fillStyle(this.colorDark, 1);
    g.fillCircle(hand.x, hand.y, 1.8 * s);

    // Channeled energy point just past the fingertips — ambient even at
    // rest (a wizard's hand is never fully dark), brighter and pulsing
    // when an ability/cast triggers.
    const baseGlow = 0.35;
    const pulseSize = 1 + pulse * 0.9;
    const radius = 3 * s * pulseSize;

    g.fillStyle(this.accentColor, (baseGlow * 0.5 + pulse * 0.35));
    g.fillCircle(hand.x, hand.y, radius * 2.2);
    g.fillStyle(this.accentColor, (baseGlow + pulse * 0.4));
    g.fillCircle(hand.x, hand.y, radius * 1.2);
    g.fillStyle(WHITE, (baseGlow * 0.6 + pulse * 0.4));
    g.fillCircle(hand.x, hand.y, radius * 0.5);
  }

  // --- CHARGE ORB: the shared point between the two cupped hands — the
  // Kamehameha read, and the natural future spawn origin for a projectile
  // or ability effect. Grows and brightens with chargeMs, with a fast
  // turbulent flicker layered on top so it never reads as a static sprite.
  private drawChargeOrb(g: Phaser.GameObjects.Graphics, handLead: Vec2, handBack: Vec2, s: number) {
    const cx = (handLead.x + handBack.x) / 2;
    const cy = (handLead.y + handBack.y) / 2;
    const ratio = Phaser.Math.Clamp(this.chargeMs / ProceduralPlayerRig.CHARGE_RAMP_MS, 0, 1);
    if (ratio <= 0.02) return;

    const flicker = 0.85 + 0.15 * Math.sin(this.stepPhase * 5);
    const radius = (2 + ratio * 5) * s * flicker;

    g.fillStyle(this.accentColor, ratio * 0.25);
    g.fillCircle(cx, cy, radius * 2.4);
    g.fillStyle(this.accentColor, ratio * 0.6);
    g.fillCircle(cx, cy, radius * 1.3);
    g.fillStyle(WHITE, ratio * 0.75);
    g.fillCircle(cx, cy, radius * 0.6);
  }

  // --- THICK LIMB: Filled polygon instead of line ---
  private drawThickLimb(
    g: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    outerW: number,
    innerW: number,
  ) {
    // Dark outline limb
    g.lineStyle(outerW + 2, DARK, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Colored limb fill
    g.lineStyle(outerW, this.colorDark, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Inner highlight
    g.lineStyle(innerW * 0.5, this.color, 0.5);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.strokePath();

    // Joint circle
    g.fillStyle(DARK, 1);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.45);
    g.fillStyle(this.colorDark, 0.9);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.3);
  }

  // --- BOOT: Sleek greave, not a heavy armored boot ---
  // Anchor convention: `foot.y` = the platform-top contact point (i.e.
  // the bottom edge of the boot sole). All three rects sit ABOVE foot.y.
  // Pre-fix, the sole rect spanned [foot.y - 0.3*bh, foot.y + 0.7*bh] —
  // bottom 4 px below the contact, so even a perfectly-grounded rig
  // visibly sank into the platform top. Combined with the airborne
  // walk-cycle lift this drove the user-visible flicker between "feet
  // floating" (lift trough) and "feet inside platform" (no-lift, sink).
  // See commit 7027a82 for the matching footPos gate.
  private drawBoot(g: Phaser.GameObjects.Graphics, foot: Vec2, s: number) {
    const f = this.facing;
    const bw = 8 * s;
    const bh = 5 * s;

    // Boot sole — bottom edge at foot.y, full height bh above.
    g.fillStyle(DARK, 1);
    g.fillRoundedRect(foot.x - bw * 0.4 + f * 2 * s, foot.y - bh, bw, bh, 2 * s);

    // Boot upper — sits on top of the sole. Height 0.8*bh.
    g.fillStyle(this.colorDark, 1);
    g.fillRoundedRect(foot.x - bw * 0.35 + f * 2 * s, foot.y - bh - bh * 0.8, bw * 0.85, bh * 0.8, 2 * s);

    // Boot accent stripe — runs across the upper, ~half-height up.
    g.fillStyle(this.color, 0.6);
    g.fillRect(foot.x - bw * 0.2 + f * 2 * s, foot.y - bh - bh * 0.4, bw * 0.5, 2 * s);
  }

  // --- NAMEPLATE (plate-less) ---
  // No background rect. Name in textHi. Thin 2px hpLime underline as HP bar.
  private drawNameplate(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    s: number,
    health: number,
    maxHealth: number,
  ) {
    const nameWidth = Math.max(52, this.name.length * 6.5) * s;
    const healthRatio = Phaser.Math.Clamp(health / Math.max(1, maxHealth), 0, 1);

    // Name text — no background, no health suffix
    this.nameText.setText(this.name);
    this.nameText.setPosition(x, y - 6 * s);

    // 2px lime HP underline directly under name text
    const lineY = y - 4 * s;
    g.fillStyle(PALETTE.hpLime, 1);
    g.fillRect(x - nameWidth / 2, lineY, nameWidth * healthRatio, 2);
  }

  // --- WALL-PLANT FOOT: a tucked knee bracing flat against the gripped
  // wall — closer to the body than a straight-leg reach (was 42*s out at
  // pelvis+6, a long diagonal that combined with the wall-plant arm's own
  // diagonal read as a symmetric cross/pinwheel silhouette from some
  // angles). Doesn't need the wall's actual world-space position: pushing
  // the target this far toward it is enough for solveTwoBone's reach clamp
  // to read as "bracing against something in that direction."
  private wallPlantFoot(cx: number, wallDir: number, pelvis: Vec2, s: number): Vec2 {
    return vec(cx + wallDir * 22 * s, pelvis.y - 6 * s);
  }

  // --- ARM TARGETS: a two-handed Kamehameha-style charge stance, not two
  // independently-posed limbs. Both arms are IDENTICAL length
  // (ARM_UPPER/ARM_LOWER); "straight" is never a special-cased draw path,
  // it's just an IK hand target placed exactly at the edge of the reach
  // circle (see straightTarget()) — solveTwoBone's own reach clamp then
  // yields a joint angle of ~0. The only two states that place a target
  // CLOSER than full reach (and so actually bend) are the wall-plant and
  // the release thrust's back hand trailing a hair short of the lead.
  //
  // The first version of this gave each arm its own running-gait swing,
  // which read as tangled/broken (the two independently-bent limbs kept
  // crossing in front of the torso). Converging both hands on one shared
  // charge point removes that failure mode entirely: there's only ever
  // ONE bend geometry to solve for a moving/idle vessel, not two competing
  // ones. It also gives the "orb between the hands" a real anchor point —
  // the natural spawn origin for a future projectile/ability effect. ---
  private computeArmTargets(
    shoulderLead: Vec2,
    shoulderBack: Vec2,
    pelvis: Vec2,
    aim: Vec2,
    walkAmount: number,
    wallDir: number,
    dashing: boolean,
    s: number,
  ): { lead: Vec2; back: Vec2 } {
    const reach = ProceduralPlayerRig.ARM_REACH * s;

    if (wallDir !== 0) {
      // Back hand plants against the gripped wall — closer than full
      // reach, the one deliberate bend this state allows. Lead hand keeps
      // charging alone (one hand holds on, the other never stops working).
      return {
        lead: this.chargeHandTarget(pelvis, aim, s, 0),
        back: vec(shoulderBack.x + wallDir * 20 * s, shoulderBack.y + 2 * s),
      };
    }

    if (dashing) {
      // The release: both arms thrust straight out toward aim — the
      // charged blast firing as you commit to the dash. Back hand trails
      // a hair short of full reach so the two hands don't perfectly
      // overlap on the way out.
      return {
        lead: this.straightTarget(shoulderLead, aim, reach),
        back: this.straightTarget(shoulderBack, aim, reach * 0.94),
      };
    }

    // Idle, running, or airborne: both hands held at the SAME charging
    // point near the hip, one a hair further out than the other (cupped,
    // not overlapping). A synchronized bob while running — both hands
    // move together — instead of an opposite-phase swing.
    const bob = walkAmount > 0.05 ? Math.sin(this.stepPhase * 2) * 2 * s * walkAmount : 0;
    return {
      lead: this.chargeHandTarget(pelvis, aim, s, bob),
      back: this.chargeHandTarget(pelvis, aim, s, bob, 0.82),
    };
  }

  /** The shared charge-stance target: a point near the hip that ORBITS
   *  toward wherever aim is pointing — the charge visibly tracks the
   *  mouse/aim even while held, not just at the dash-release. This is a
   *  real world-space IK target (not forced onto a fixed-length line from
   *  the shoulder), so solveTwoBone bends each arm naturally to reach it
   *  rather than snapping to a straight facing-locked pose. `depth` (0-1)
   *  shrinks the orbit radius a hair for the back hand so the two hands
   *  don't perfectly overlap when cupped together. */
  private chargeHandTarget(pelvis: Vec2, aim: Vec2, s: number, bob: number, depth = 1): Vec2 {
    // Widened 15→26: at 15 the hands read as clamped in tight against the
    // body; this reads as an actual held charge out in front of the hip.
    // Keep in sync with MUZZLE_ANCHOR_OFFSET_Y/MUZZLE_REACH in
    // sim/weapon.ts — that's the ACTUAL projectile spawn point in combat,
    // and it should coincide with where this orb visually sits, not just
    // approximate an old arm-cannon geometry.
    const orbitRadius = 26 * s * depth;
    return vec(
      pelvis.x + aim.x * orbitRadius,
      pelvis.y + 8 * s + aim.y * orbitRadius + bob,
    );
  }

  /** A hand target at EXACTLY max arm reach in direction `dir` from
   *  `shoulder`. solveTwoBone's own dist clamp then yields a joint angle
   *  of ~0 — a dead-straight limb — with zero special-casing. */
  private straightTarget(shoulder: Vec2, dir: Vec2, reach: number): Vec2 {
    return vec(shoulder.x + dir.x * reach, shoulder.y + dir.y * reach);
  }

  // --- FOOT POSITION ---
  private footPos(
    cx: number,
    side: -1 | 1,
    ground: number,
    walk: number,
    crouch: boolean,
    grounded: boolean,
  ): Vec2 {
    const s = this.scale;
    const cycle = this.stepPhase + (side === -1 ? 0 : Math.PI);
    const stride = (crouch ? 10 : 18) * s * walk;
    // Lift only when actually walking on a surface. Without the grounded
    // gate, an airborne player with vx > 0 would still cycle feet up to
    // 12 px above the (irrelevant) ground anchor and the rig would look
    // like it's stomping mid-air — the user-visible "barely detects
    // standing on anything" symptom (commit ef365c7..669fe52 plumbed the
    // wire field that lets us know).
    const lift = grounded
      ? Math.max(0, Math.sin(cycle)) * (crouch ? 4 : 8) * s * walk
      : 0;
    const spread = (crouch ? 8 : 7) * s;
    return vec(cx + side * spread - Math.cos(cycle) * stride * this.facing, ground - lift);
  }
}

// --- Utility ---

function solveTwoBone(
  root: Vec2,
  target: Vec2,
  upper: number,
  lower: number,
  bend: number,
): LimbSolve {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dist = Phaser.Math.Clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const angle = Math.atan2(dy, dx);
  const jointAngle = Math.acos(
    Phaser.Math.Clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1),
  );
  const ua = angle + jointAngle * bend;
  return {
    joint: vec(root.x + Math.cos(ua) * upper, root.y + Math.sin(ua) * upper),
    end: target,
  };
}

function shadeColor(hex: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + Math.round(amount * 255)));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) + Math.round(amount * 255)));
  const b = Math.min(255, Math.max(0, (hex & 0xff) + Math.round(amount * 255)));
  return (r << 16) | (g << 8) | b;
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}
