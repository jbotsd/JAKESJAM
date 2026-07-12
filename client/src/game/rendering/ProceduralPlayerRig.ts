import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import { PALETTE } from "../ui/palette.js";
import { getRenderScale } from "../render/renderResolution.js";
import { type SpringState, springKick, springState, springTo } from "./spring";

/** The minimal surface SimEventRouter drives on ANY on-screen combatant —
 *  hero, boss, or a non-humanoid thrall (see TutorialShardThrall.ts). Kept
 *  separate from the full ProceduralPlayerRig class so enemy races that
 *  don't share its humanoid skeleton (and shouldn't — a recolored player
 *  rig reads as a clone army, not a distinct enemy) can still receive the
 *  same hit/fire/parry feedback without pretending to be a player. */
export interface CombatRig {
  setVisible(visible: boolean): void;
  triggerFire(hand?: 0 | 1): void;
  triggerHit(dirX: number, dirY: number): void;
  triggerParryFlash(): void;
  destroy(): void;
}

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
  /**
   * `full` = local / hero (aura + trail + full secondary motion).
   * `lite` = remotes/bots — fewer path ops so multi-player frames stay smooth.
   */
  detail?: "full" | "lite";
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
  /** Wide Parry: multiplies the 120° dash-bash cone (1 = base, 1.28 = one stack). */
  shieldArcScale?: number;
  /** Crystal Plating stacks: draw a hex shell outline on the body. */
  platingGlow?: number;
};

export type LimbSolve = {
  joint: Vec2;
  end: Vec2;
};

// --- Colour Constants ---
const DARK = 0x07101c;
const DARK2 = 0x0f1a2e;
const WHITE = 0xf7fbff;
const ACCENT = 0x8ff8ff; // Crystal cyan glow

export class ProceduralPlayerRig implements CombatRig {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  protected readonly color: number;
  protected readonly colorDark: number;
  protected readonly accentColor: number;
  private readonly name: string;
  protected readonly scale: number;
  private readonly detail: "full" | "lite";
  private stepPhase = 0;
  /** Continuous facing −1..+1 (eases flips — no whole-body IK flip pop). */
  private facingSmooth = 1;
  private facing = 1;
  /** Smoothed crouch 0..1 — eases pelvis height so crouch/uncrouch doesn't pop. */
  private crouchBlend = 0;
  private static readonly CROUCH_BLEND_TAU_MS = 70;
  /** Smoothed |vx| walk weight — kills step-phase stutter from sim velocity steps. */
  private walkBlend = 0;
  /** Smoothed SPRINT weight: 0 through walk speeds, 1 approaching max ground
   *  speed (330). Drives the run-cycle restyle studied from stick-figure run
   *  reference footage (5-key sprint cycle: drive → flight → reach → contact
   *  → gather-squash): an upright jog at low speed becomes a deep-lean
   *  attack sprint at full tilt, instead of one gait scaled by volume. */
  private sprintBlend = 0;
  /** Previous-frame vx — reversal detection for the stumble kick. */
  private prevVelX = 0;
  /** Smoothed horizontal acceleration (px/s²) — drives the Disney layer:
   *  anticipation lean on launch (slow-out) and brake lean on deceleration
   *  (slow-in). Velocity says how fast; acceleration says what the body is
   *  TRYING to do — that intent is what reads as personality. */
  private accelSmooth = 0;
  /** Landing/launch cushion spring (px, +down on the body chain): kicked by
   *  impacts and launches, settles underdamped — the dip-and-rebound that
   *  makes weight read (Disney: squash on contact, cushion the recovery). */
  private landCushion: SpringState = springState(0);
  /** Idle life clock — breathing + weight-shift phases (appeal: the vessel
   *  is alive even when nothing is happening). */
  private idlePhase = Math.random() * Math.PI * 2;
  /** Smoothed airborne pose axis: +1 rising (legs TUCK, knees up), -1
   *  falling (lead leg REACHES for the landing, back leg folds). Replaces
   *  the old airborne behavior of feet dangling at full extension and
   *  swinging with the (meaningless mid-air) stride cycle — the "silly
   *  jump." */
  private airPose = 0;
  /** ms remaining in the combat stance after the last shot — outside this
   *  window the arms are ARMS (hang at rest, swing while walking), not a
   *  permanent shuriken-cocked pose. Set by triggerFire, decays in update. */
  private combatHoldMs = 0;
  /** One-shot: the next draw() velocity-kicks the throwing hand's spring
   *  along aim, so a shot from ANY stance (hang, walk, sweep) pops as one
   *  crisp whip instead of a spring easing across the whole journey. */
  private pendingThrowKick = false;
  /** ms remaining in the outro's victory/induction pose — arms raised wide
   *  overhead, the physical beat of the recognition being SEALED (see
   *  tutorial-song.ts's hero:victory-pose cue). Highest priority in the
   *  arm ladder: overrides combat/sprint/idle entirely while active. */
  private victoryPoseMs = 0;
  private static readonly WALK_BLEND_TAU_MS = 55;
  private static readonly FACING_TAU_MS = 90;
  private firePulse = 0;
  // ALTERNATING SHURIKEN THROW. The two hands throw independently and take
  // turns: each shot flicks ONE hand out toward aim (a fast shuriken snap)
  // while the other stays ready, then alternates. `throwHand` is whose turn
  // it is; `leadThrow`/`backThrow` (0-1) are each hand's own flick progress,
  // set to 1 on that hand's shot and decaying over FIRE_RECOIL_MS. The
  // projectile leaves from the throwing hand at the peak of its flick.
  private throwHand: 0 | 1 = 0;
  private leadThrow = 0;
  private backThrow = 0;
  private static readonly FIRE_RECOIL_MS = 200;
  // Spin phase for the held/thrown shuriken shards (wall-clock, visual only).
  private shurikenSpin = 0;
  // Visual-only knockback. Set by triggerHit(); decays over HIT_DECAY_MS.
  // Per game-feel-juice §5 — render layer overshoots authoritative position.
  private hitOffsetX = 0;
  private hitOffsetY = 0;
  private hitDecay = 0;
  private static readonly HIT_DECAY_MS = 90;
  private readonly trailPositions: { x: number; y: number; t: number }[] = [];
  private lastTrailSampleMs = 0;
  // Parry flash — the dash-bash guard just turned an attack (slide-parry reflect,
  // timed parry, or a bash clash). Set by triggerParryFlash(); while active
  // the shield arc overdrives to white and an impact ring expands outward.
  private parryFlashMs = 0;
  private static readonly PARRY_FLASH_MS = 240;

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
  // Drunken-master legs: underdamped chase so plants overshoot and settle
  // (floppy) while root motion is α-smoothed so we don't ring every sim tick.
  private static readonly WOBBLE_FREQUENCY_HZ = 7.5;
  private static readonly WOBBLE_DAMPING = 0.48;
  private static readonly LANDING_KICK_SCALE = 0.42;
  private static readonly LANDING_KICK_MAX = 820;

  // Wall-jump kick-off: the instant the player leaves a wall while airborne,
  // both foot springs get a velocity kick away from the wall (and up).
  private wasWallDir = 0;
  private static readonly WALL_KICK_X = 480;
  private static readonly WALL_KICK_Y = -320;

  // Torso chain lag (drunken master): lean / chest / head spring behind the
  // hip so the body reads as loose segments, not a rigid plate.
  private leanSpring: SpringState = springState(0);
  private chestLagX: SpringState = springState(0);
  private chestLagY: SpringState = springState(0);
  private headLagX: SpringState = springState(0);
  private headLagY: SpringState = springState(0);
  private static readonly TORSO_FREQ = 4.2;
  private static readonly TORSO_DAMP = 0.42;
  private static readonly HEAD_FREQ = 5.5;
  private static readonly HEAD_DAMP = 0.38;

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
  // Floppy arms — hang late, overshoot on throw, settle soft (drunken master).
  private static readonly ARM_FREQUENCY_HZ = 5.2;
  private static readonly ARM_DAMPING = 0.52;

  // Hip drape — cloth whip, very underdamped.
  private drapeSpringReady = false;
  private drapeSpringX: SpringState = springState(0);
  private drapeSpringY: SpringState = springState(0);
  private static readonly DRAPE_FREQUENCY_HZ = 3.8;
  private static readonly DRAPE_DAMPING = 0.28;

  // "Mad aura" — fewer motes on lite; full still irregular (not a UI ring).
  private static readonly AURA_MOTE_COUNT = 8;
  private static readonly AURA_MOTE_LITE = 3;
  private readonly auraSeed = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, options: ProceduralPlayerRigOptions) {
    // Depth 12: above arena near-layer (~-4), platforms, pickups, fire, beams.
    // Players must own the mid-frame silhouette over cosmic vault chrome.
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(12);
    // Space Mono + a warm gold tint — the house font used everywhere else
    // in the game's own HUD/numerics (index.html's font stack). Generic
    // "Inter, Arial" here was a real seam: everything around it is
    // stylized sacred-geometry gold/cyan, and the nameplate was plain
    // default web text with zero relationship to that language.
    this.nameText = scene.add
      .text(0, 0, options.name, {
        color: "#e8c992",
        fontFamily: '"Space Mono", monospace',
        // Touch screens sit further from the eye per CSS px — 11px plates
        // were illegible on phones (cosmetic only; no pose/draw change).
        fontSize: `${Math.round((window.matchMedia?.("(pointer: coarse)")?.matches ? 14 : 11) * (options.scale ?? 1))}px`,
        fontStyle: "700",
        // Glyph texture density must match the DPR-aware backing store or
        // names blur on phones (crispness only — no pose/draw change).
        resolution: Math.max(1, getRenderScale()),
      })
      .setOrigin(0.5, 1)
      .setDepth(13)
      .setStroke("#05080f", 3)
      .setShadow(0, 0, "#ffd76b", 6, false, true);
    this.color = options.color;
    this.colorDark = shadeColor(options.color, -0.4);
    this.accentColor = options.accentColor ?? ACCENT;
    this.name = options.name;
    this.scale = options.scale ?? 1;
    this.detail = options.detail ?? "full";
  }

  private lastDrawX = 0;
  private lastDrawY = 0;

  update(deltaMs: number, pose: ProceduralPlayerPose) {
    this.lastDrawX = pose.position.x;
    this.lastDrawY = pose.position.y;
    if (!this.graphics.visible) return;

    const walkTarget = Phaser.Math.Clamp(Math.abs(pose.velocity.x) / 180, 0, 1);
    if (deltaMs > 0) {
      const wk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.WALK_BLEND_TAU_MS);
      this.walkBlend += (walkTarget - this.walkBlend) * wk;
    } else {
      this.walkBlend = walkTarget;
    }
    const walkAmount = this.walkBlend;
    const sprintTarget = Phaser.Math.Clamp((Math.abs(pose.velocity.x) - 140) / 170, 0, 1);
    if (deltaMs > 0) {
      const sk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.WALK_BLEND_TAU_MS);
      this.sprintBlend += (sprintTarget - this.sprintBlend) * sk;
    } else {
      this.sprintBlend = sprintTarget;
    }
    // Cadence rises with sprint on top of the walk rate — a sprint is a
    // faster cycle, not just a bigger one. A slow ±5% drift on the rate
    // keeps the cycle from ever being metronome-perfect (perfectly even
    // timing is the single biggest "robot" tell).
    this.stepPhase +=
      deltaMs *
      (0.006 + walkAmount * 0.01 + this.sprintBlend * 0.0045) *
      (1 + Math.sin(this.stepPhase * 0.37) * 0.05);
    this.firePulse = Math.max(0, this.firePulse - deltaMs * 0.004);
    this.leadThrow = Math.max(0, this.leadThrow - deltaMs / ProceduralPlayerRig.FIRE_RECOIL_MS);
    this.backThrow = Math.max(0, this.backThrow - deltaMs / ProceduralPlayerRig.FIRE_RECOIL_MS);
    this.shurikenSpin += deltaMs * 0.02;
    this.hitDecay = Math.max(0, this.hitDecay - deltaMs / ProceduralPlayerRig.HIT_DECAY_MS);
    this.parryFlashMs = Math.max(0, this.parryFlashMs - deltaMs);
    this.combatHoldMs = Math.max(0, this.combatHoldMs - deltaMs);
    this.victoryPoseMs = Math.max(0, this.victoryPoseMs - deltaMs);

    // Facing target with hysteresis, then smooth ease so IK bend doesn't pop.
    let facingTarget = this.facingSmooth >= 0 ? 1 : -1;
    if (Math.abs(pose.velocity.x) > 18) {
      facingTarget = Math.sign(pose.velocity.x);
    } else if (
      Math.abs(pose.velocity.x) < 6 &&
      Math.abs(pose.aimTarget.x - pose.position.x) > 28
    ) {
      facingTarget = Math.sign(pose.aimTarget.x - pose.position.x);
    }
    if (deltaMs > 0) {
      const fk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.FACING_TAU_MS);
      this.facingSmooth += (facingTarget - this.facingSmooth) * fk;
    }
    this.facing = this.facingSmooth >= 0 ? 1 : -1;

    // Ease crouch so half-height / pelvis drop isn't a hard step.
    const crouchTarget = pose.crouching ? 1 : 0;
    if (deltaMs > 0) {
      const k = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.CROUCH_BLEND_TAU_MS);
      this.crouchBlend += (crouchTarget - this.crouchBlend) * k;
      if (Math.abs(this.crouchBlend - crouchTarget) < 0.001) {
        this.crouchBlend = crouchTarget;
      }
    }

    // Trail sampling — local/full only (remotes skip for CPU).
    if (this.detail === "full") {
      const now = Date.now();
      if (now - this.lastTrailSampleMs >= 48) {
        this.trailPositions.push({ x: pose.position.x, y: pose.position.y, t: now });
        if (this.trailPositions.length > 5) {
          this.trailPositions.shift();
        }
        this.lastTrailSampleMs = now;
      }
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
      // Landing cushion (Disney: squash the contact, cushion the recovery):
      // the body chain dips with the impact and rebounds underdamped —
      // kicked HERE because prevVelY still holds the true fall speed (it's
      // overwritten just below).
      this.landCushion = springKick(
        this.landCushion,
        Phaser.Math.Clamp(Math.abs(this.prevVelY) * 0.28, 0, 420),
      );
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

    // ── The Disney layer: transitions are where personality lives. ──────
    // Smoothed acceleration = what the body INTENDS (velocity only says
    // what it's doing). Computed against last frame's vx before updating it.
    if (deltaMs > 0) {
      const rawAccel = (pose.velocity.x - this.prevVelX) / (deltaMs / 1000);
      this.accelSmooth += (rawAccel - this.accelSmooth) * (1 - Math.exp(-deltaMs / 90));
    }
    this.idlePhase += deltaMs * 0.0012;
    // Airborne pose axis: rising tucks the legs, falling reaches for the
    // landing (see airPose docblock). Smoothed so apex transitions arc.
    const airTarget = pose.grounded ? 0 : Phaser.Math.Clamp(-pose.velocity.y / 650, -1, 1);
    if (deltaMs > 0) {
      this.airPose += (airTarget - this.airPose) * (1 - Math.exp(-deltaMs / 70));
    }

    if (pose.grounded && Math.abs(this.prevVelX) > 200 && pose.velocity.x * this.prevVelX < 0) {
      // STUMBLE (reversal): the torso keeps traveling the way the momentum
      // was going (the legs stop first) — kick the lean spring toward the
      // OLD direction and let its underdamped overshoot-and-recover BE the
      // stumble; the feet get a splayed kick (one thrown ahead, one
      // dragging) for the scramble-step read. Pure secondary motion.
      const dir = Math.sign(this.prevVelX);
      this.leanSpring = springKick(this.leanSpring, dir * 240);
      this.footLSpringX = springKick(this.footLSpringX, dir * 260);
      this.footRSpringX = springKick(this.footRSpringX, -dir * 140);
      this.landCushion = springKick(this.landCushion, 120);
    } else if (pose.grounded && Math.abs(this.prevVelX) < 40 && Math.abs(pose.velocity.x) > 70) {
      // ANTICIPATION (launch): the body coils OPPOSITE the new direction
      // for a beat before the drive-lean whips it forward — the classic
      // wind-up. One backward kick on the underdamped lean spring gives
      // dip-back → whip-forward for free; the cushion kick adds the
      // crouch-coil dip under it.
      this.leanSpring = springKick(this.leanSpring, -Math.sign(pose.velocity.x) * 210);
      this.landCushion = springKick(this.landCushion, 150);
    } else if (pose.grounded && Math.abs(this.prevVelX) > 220 && Math.abs(pose.velocity.x) < 40) {
      // FOLLOW-THROUGH (hard stop): parts settle at different rates — the
      // torso pitches past the stop and recovers, one foot skids ahead,
      // the body sinks into the brake and rises out of it.
      const dir = Math.sign(this.prevVelX);
      this.leanSpring = springKick(this.leanSpring, dir * 300);
      this.footLSpringX = springKick(this.footLSpringX, dir * 230);
      this.landCushion = springKick(this.landCushion, 160);
    }
    this.prevVelX = pose.velocity.x;

    // Cushion always settles toward zero, underdamped — every kick above
    // (landing, launch coil, stop brake, stumble) dips and rebounds.
    this.landCushion = springTo(this.landCushion, 0, deltaMs, 3.4, 0.5);

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

  /** Call on every shot fired. Flicks the throwing hand out toward aim (a
   *  shuriken snap) and flashes the muzzle glow. `hand` is the sim's
   *  authoritative throwing hand (0 = lead, 1 = back) from the shot-fired
   *  event — using it keeps the rig's hand in lock-step with where the sim
   *  spawned the projectile (the shard leaves the exact hand). Falls back to
   *  local alternation if omitted. */
  triggerFire(hand?: 0 | 1) {
    this.firePulse = 1;
    this.combatHoldMs = 1600; // stay in the cocked combat stance ~1.6s after the last shot
    this.pendingThrowKick = true; // consumed in draw(): velocity-kick the throwing hand along aim
    this.throwHand = hand ?? (this.throwHand === 0 ? 1 : 0);
    if (this.throwHand === 0) this.leadThrow = 1;
    else this.backThrow = 1;
  }

  /** Which hand is throwing right now (for the muzzle/spawn point). 0 = lead,
   *  1 = back. Whichever hand's flick is furthest along is the active one. */
  activeThrowHandIndex(): 0 | 1 {
    return this.leadThrow >= this.backThrow ? 0 : 1;
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

  /** The guard just TURNED an attack — slide-parry reflect, timed parry, or a
   *  bash clash. Overdrives the dash-bash arc to white and fires an expanding
   *  impact ring. Pure render; driven by the parry-deflected sim event. */
  triggerParryFlash() {
    this.parryFlashMs = ProceduralPlayerRig.PARRY_FLASH_MS;
  }

  /** The outro's induction beat — both arms raised wide overhead, held.
   *  Not a combat animation; the physical moment the recognition (Sephia's
   *  gasp, the self-authorship realized) gets SEALED. `holdMs` lets the
   *  caller match it to however long the outro's hold actually is. */
  triggerVictoryPose(holdMs = 2600) {
    this.victoryPoseMs = holdMs;
  }

  private draw(pose: ProceduralPlayerPose, walkAmount: number, deltaMs: number) {
    const g = this.graphics;
    const s = this.scale;
    // Quadratic ease-out — strong overshoot, fast snap-back. Visual only.
    const hitEased = this.hitDecay * this.hitDecay;
    const ground = pose.position.y + this.hitOffsetY * hitEased;
    // Smoothed crouch (0..1) — geometric crouch only; pose.crouching still
    // gates locomotion (bob) so we don't bob mid-duck.
    const cr = this.crouchBlend;
    const sprint = this.sprintBlend;
    // Soft sine bob (less hard plant) + drunk side-sway on the hip. Bob
    // amplitude more than doubles at sprint — the flight phase genuinely rises.
    const bob =
      pose.grounded && cr < 0.35
        ? Math.pow(Math.abs(Math.sin(this.stepPhase)), 1.2) *
          Phaser.Math.Linear(2.4, 5.4, sprint) *
          walkAmount *
          (1 - cr)
        : 0;
    // GATHER-SQUASH (run-reference keyframe 5): at the instant both feet
    // pass under the body the whole figure compresses — the coiled frame
    // between strides that makes a run read hand-animated instead of
    // floating. Peaks exactly where bob bottoms out (they share the phase),
    // so the pelvis path becomes rise-fall-DIP, not a pure sine.
    const gather =
      pose.grounded && cr < 0.35
        ? Math.pow(1 - Math.abs(Math.sin(this.stepPhase)), 2) * 3.4 * sprint * walkAmount
        : 0;
    const drunkSway =
      pose.grounded && walkAmount > 0.08
        ? Math.sin(this.stepPhase * 0.5) * 3.2 * s * walkAmount
        : Math.sin(this.stepPhase * 0.35) * 0.8 * s;

    // Squash & stretch (visual only): the body ELONGATES on a powerful launch
    // and COMPRESSES on a fast fall (airborne), and now also compresses on
    // the grounded gather frame at sprint.
    const stretchY = pose.grounded
      ? 1 + Math.sin(this.stepPhase * 2) * 0.015 * walkAmount - gather * 0.012
      : 1 + Phaser.Math.Clamp(-pose.velocity.y / 2600, -0.14, 0.3);
    const sy = s * stretchY;

    const wallDir = pose.touchingWallDir ?? 0;
    const wallSliding = wallDir !== 0 && !pose.grounded;
    const dashing = pose.dashing ?? false;
    // Forward lean scales hard with sprint (run reference: the sprint torso
    // pitches 30-45°; the old flat 3.2px cap read as a stroll at any speed).
    const sprintLean =
      pose.grounded
        ? Phaser.Math.Clamp(pose.velocity.x / 300, -1, 1) *
          Phaser.Math.Linear(3.2, 13, sprint) *
          s
        : 0;
    const throwEnglish = Math.max(this.leadThrow, this.backThrow);
    const throwDrop = throwEnglish * 3.2 * s;
    // Drive lean (slow-in/slow-out): acceleration pitches the body INTO the
    // effort — accelerating hard leans further forward than steady-state
    // (the wind-up), braking leans back against momentum. Velocity says how
    // fast; this says how hard it's trying, which is what reads as intent.
    const driveLean =
      Phaser.Math.Clamp(this.accelSmooth / 900, -1, 1) * 5.5 * s * (pose.grounded ? 1 : 0.35);
    // Target lean — springed so direction changes read as drunk recovery.
    const leanTarget =
      (wallSliding ? wallDir * 2.5 * s : 0) +
      (dashing ? this.facingSmooth * 5 * s : 0) +
      sprintLean +
      driveLean +
      this.facingSmooth * throwEnglish * 10 * s +
      drunkSway;
    this.leanSpring = springTo(
      this.leanSpring,
      leanTarget,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    const leanX = this.leanSpring.value;

    // Landing/launch/brake cushion — px of body-chain dip from the spring;
    // clamped so a catastrophic fall can't fold the rig into the floor.
    const cushion = Phaser.Math.Clamp(this.landCushion.value * 0.05, 0, 9) * s;
    // Idle life (appeal): breathing + a slow side-to-side weight shift when
    // still — the vessel never reads as a paused animation. Fades out the
    // moment real movement starts (walkAmount gate), grounded only.
    const idleLife = pose.grounded ? 1 - Math.min(1, walkAmount * 3) : 0;
    const breathe = Math.sin(this.idlePhase * 2.1) * 1.1 * s * idleLife;
    const weightShift = Math.sin(this.idlePhase) * 2.2 * s * idleLife;
    // Key positions — head/chest lag hip for floppy chain.
    // gather dips the whole chain, slightly harder toward the head — the
    // upper body rounds over the coil, not a rigid elevator drop. cushion
    // rides the same shape (impacts dip the body, spring rebounds it).
    const pelvisY =
      ground - Phaser.Math.Linear(52, 32, cr) * sy - bob + gather * s + cushion + breathe * 0.4 + throwDrop;
    const chestYTarget =
      ground - Phaser.Math.Linear(78, 56, cr) * sy - bob + gather * 1.2 * s + cushion * 1.15 + breathe + throwDrop * 0.5;
    const headYTarget =
      ground - Phaser.Math.Linear(100, 76, cr) * sy - bob + gather * 1.4 * s + cushion * 1.25 + breathe * 1.4 + throwDrop * 0.3;
    const cx = pose.position.x + this.hitOffsetX * hitEased + drunkSway * 0.35;
    // Forward CENTRE OF MASS: the whole body chain (pelvis up) rides ahead
    // of the feet while moving — the falling-forward posture that makes a
    // run feel committed rather than upright-with-busy-legs. Feet keep
    // planting at the sim position (footPos still uses raw cx), so the legs
    // visibly drive from BEHIND the mass — the sprinter silhouette. Present
    // even at walk speed (a touch), strong at sprint, half-kept airborne so
    // a leap carries the attitude through the air.
    const comShift =
      Phaser.Math.Clamp(pose.velocity.x / 300, -1, 1) *
      (1.5 + sprint * 5.5) *
      (pose.grounded ? 1 : 0.55) *
      s;
    const bodyCx = cx + comShift + weightShift;

    this.chestLagX = springTo(
      this.chestLagX,
      leanX * 0.85,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    this.chestLagY = springTo(
      this.chestLagY,
      chestYTarget,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ * 1.1,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    this.headLagX = springTo(
      this.headLagX,
      // Head punches further ahead of the chest at sprint — the reference
      // run leads with the head/chin, not an upright bob on a leaning body.
      this.chestLagX.value + this.facingSmooth * (2.4 + sprint * 4.5) * s,
      deltaMs,
      ProceduralPlayerRig.HEAD_FREQ,
      ProceduralPlayerRig.HEAD_DAMP,
    );
    this.headLagY = springTo(
      this.headLagY,
      headYTarget,
      deltaMs,
      ProceduralPlayerRig.HEAD_FREQ,
      ProceduralPlayerRig.HEAD_DAMP,
    );

    const pelvis = vec(bodyCx, pelvisY);
    const chest = vec(bodyCx + this.chestLagX.value, this.chestLagY.value);
    const head = vec(bodyCx + this.headLagX.value, this.headLagY.value);

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

    // Two INDEPENDENT hands (see computeArmTargets): each rests at its own
    // ready position and flicks out toward aim on its own throw
    // (leadThrow/backThrow), alternating per shot. Wall-plant bends the
    // gripping hand; dash braces both forward (the dash-bash guard). Springed so
    // state changes settle instead of popping.
    const armTargets = this.computeArmTargets(
      shoulderLead,
      shoulderBack,
      aim,
      walkAmount,
      wallDir,
      dashing,
      this.leadThrow,
      this.backThrow,
      s,
      sprint,
      this.victoryPoseMs,
    );

    if (!this.leadHandSpringReady) {
      this.leadHandSpringX = springState(armTargets.lead.x);
      this.leadHandSpringY = springState(armTargets.lead.y);
      this.leadHandSpringReady = true;
    }
    // Throw pop: the instant a shot fires, velocity-kick the throwing
    // hand's spring along aim — the whip reads crisp from ANY stance
    // (hang/walk/sweep) instead of the spring easing across the whole
    // draw distance. One-shot, set by triggerFire.
    if (this.pendingThrowKick && this.backHandSpringReady) {
      this.pendingThrowKick = false;
      const kick = 1100;
      if (this.throwHand === 0) {
        this.leadHandSpringX = springKick(this.leadHandSpringX, aim.x * kick);
        this.leadHandSpringY = springKick(this.leadHandSpringY, aim.y * kick);
      } else {
        this.backHandSpringX = springKick(this.backHandSpringX, aim.x * kick);
        this.backHandSpringY = springKick(this.backHandSpringY, aim.y * kick);
      }
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
        : this.footPos(cx, -1, ground, walkAmount, sprint, pose.crouching, pose.grounded);
    const footRTarget =
      wallSliding && wallDir === 1
        ? this.wallPlantFoot(cx, wallDir, pelvis, s)
        : this.footPos(cx, 1, ground, walkAmount, sprint, pose.crouching, pose.grounded);

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
    const full = this.detail === "full";

    g.clear();

    // --- TRAIL / dash streaks — full detail only ---
    if (full) {
      this.drawTrail(g, pose.position, pose.velocity, s);
      if (dashing) {
        this.drawDashStreaks(g, pose.position, pose.velocity, s);
      }
    }

    // --- DRAW ORDER (back to front) ---

    // 0a. Contact shadow
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(pelvis.x, ground + 2 * s, 22 * s, 7 * s);
    if (full) {
      g.fillStyle(0x000000, 0.12);
      g.fillEllipse(pelvis.x, ground + 2 * s, 30 * s, 10 * s);
    }

    // 0b. Soft under-glow
    g.fillStyle(this.color, full ? 0.12 : 0.08);
    g.fillCircle(chest.x, chest.y, 28 * s);
    if (full) {
      g.fillStyle(this.accentColor, 0.1);
      g.fillCircle(chest.x, chest.y, 18 * s);
    }

    // 0c. Mad aura — full only (or reduced for lite)
    this.drawAura(g, pelvis, chest, s);

    // 1. Nameplate + health bar (topmost layer visually but drawn first for z)
    this.drawNameplate(g, head.x, head.y - 24 * s, s, pose.health ?? 100, pose.maxHealth ?? 100);

    // 1b. Silhouette backing — a dark halo drawn BEHIND the whole figure
    // (audit finding: the hero is a mid-gray value that nearly vanishes
    // against a mid-gray/black backdrop — near-zero silhouette contrast,
    // the cardinal sin of character readability). A few overlapping dark
    // ellipses at torso/head/limb positions guarantee the rig pops against
    // ANY background brightness, the same trick outline shaders achieve
    // for sprites, done cheaply in Graphics without a second draw pass.
    this.drawSilhouetteBacking(g, pelvis, chest, head, hipL, hipR, footL, footR, s);

    // 2. Back leg
    this.drawThickLimb(g, hipR, legR, 5.5 * s, 4 * s);
    this.drawBoot(g, footR, s);

    // 3. Back arm + hand — an independent throwing hand holding a cocked
    // shuriken; it flashes and streaks on its OWN throw (backThrow).
    this.drawThickLimb(g, shoulderBack, armBack, 4.6 * s, 3.2 * s);
    this.drawShoulderArmor(g, shoulderBack, s);
    this.drawHandGlow(g, armBack.end, s, this.backThrow);
    this.drawShuriken(g, armBack.end, aim, s, this.backThrow);

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

    // 7. Front arm + hand — the other independent throwing hand + its
    // shuriken; flashes and streaks on its own throw (leadThrow).
    this.drawThickLimb(g, shoulderLead, armLead, 5.4 * s, 3.8 * s);
    this.drawShoulderArmor(g, shoulderLead, s);
    this.drawHandGlow(g, armLead.end, s, this.leadThrow);
    this.drawShuriken(g, armLead.end, aim, s, this.leadThrow);

    // 10. Head + hood + visor
    this.drawHead(g, head, s, healthRatio);

    // 11. Dash-bash shield — deployed only while dashing: a bright energy arc in
    // the lunge direction, the directional block made visible (matches the
    // 120° front-arc shield-dash block + bash in combat/World). Drawn last so
    // it reads as a shell out in front of the braced arms. Wide Parry widens
    // the cone (shieldArcScale).
    if (dashing) {
      this.drawAegisShield(g, chest, aim, s, pose.shieldArcScale ?? 1);
    }

    // 11b. Crystal Plating — hex shell outline so "more HP" reads on the body.
    if ((pose.platingGlow ?? 0) > 0) {
      const p = Math.min(1, pose.platingGlow ?? 0);
      g.lineStyle(2 * s, 0x86efac, 0.35 + p * 0.4);
      g.strokeCircle(chest.x, chest.y, 22 * s * (1 + p * 0.08));
      g.lineStyle(1 * s, 0xf0abfc, 0.25 + p * 0.3);
      g.strokeCircle(chest.x, chest.y, 26 * s * (1 + p * 0.1));
    }

    // 12. Parry flash — the guard just turned an attack. Drawn over
    // everything: the moment must be unmissable at a glance.
    if (this.parryFlashMs > 0) {
      this.drawParryFlash(g, chest, aim, s, dashing);
    }
  }

  /** The reflect moment: an impact ring expanding from the chest + (while
   *  sliding) the dash-bash arc overdriven to solid white. Progress eases out —
   *  violent at the instant of the turn, gone in a quarter second. */
  protected drawParryFlash(
    g: Phaser.GameObjects.Graphics,
    chest: Vec2,
    aim: Vec2,
    s: number,
    dashing: boolean,
  ) {
    const p = 1 - this.parryFlashMs / ProceduralPlayerRig.PARRY_FLASH_MS; // 0→1
    const fade = (1 - p) * (1 - p); // ease-out: bright birth, quick death
    // Birth flash — a filled white pop at the guard the first ~80ms. This is
    // what makes the turn UNMISSABLE; the ring alone read too faint.
    if (p < 0.34) {
      const pop = 1 - p / 0.34;
      g.fillStyle(WHITE, 0.55 * pop);
      g.fillCircle(chest.x, chest.y, 30 * s * (0.7 + 0.3 * pop));
    }
    // Expanding impact ring — white leading edge over an accent underlay.
    const ringR = (26 + p * 52) * s;
    g.lineStyle(9 * s * (1 - p), this.accentColor, 0.7 * fade);
    g.strokeCircle(chest.x, chest.y, ringR);
    g.lineStyle(3.5 * s, WHITE, fade);
    g.strokeCircle(chest.x, chest.y, ringR);
    // While sliding, the arc itself goes solid white — the shield "rings".
    if (dashing) {
      const aimAngle = Math.atan2(aim.y, aim.x);
      const halfArc = Math.PI / 3;
      g.lineStyle(7 * s, WHITE, 0.85 * fade);
      g.beginPath();
      g.arc(chest.x, chest.y, 42 * s, aimAngle - halfArc, aimAngle + halfArc);
      g.strokePath();
    }
  }

  /** The deployed shield-dash shell: a curved energy arc centred on the chest,
   *  spanning the 120° block cone around the lunge (aim) direction, with a
   *  bright shimmering leading rim and a faint field behind it. */
  protected drawAegisShield(
    g: Phaser.GameObjects.Graphics,
    chest: Vec2,
    aim: Vec2,
    s: number,
    arcScale = 1,
  ) {
    const aimAngle = Math.atan2(aim.y, aim.x);
    // Base 120° cone; Wide Parry multiplies coverage (clamped so it never wraps).
    const halfArc = Math.min(Math.PI * 0.92, (Math.PI / 3) * Math.max(0.5, arcScale));
    const r = 42 * s; // just past the braced hands
    const a0 = aimAngle - halfArc;
    const a1 = aimAngle + halfArc;
    const shimmer = 0.7 + 0.3 * Math.sin(this.stepPhase * 6);

    // Faint field emanating from the chest out to the shell.
    g.fillStyle(this.accentColor, 0.1 * shimmer);
    g.beginPath();
    g.moveTo(chest.x, chest.y);
    g.arc(chest.x, chest.y, r, a0, a1);
    g.closePath();
    g.fillPath();

    // Shell rim — an accent underlay + a bright white leading edge.
    g.lineStyle(5 * s, this.accentColor, 0.45 * shimmer);
    g.beginPath();
    g.arc(chest.x, chest.y, r, a0, a1);
    g.strokePath();
    g.lineStyle(2 * s, WHITE, 0.7 * shimmer);
    g.beginPath();
    g.arc(chest.x, chest.y, r, a0, a1);
    g.strokePath();
  }

  // --- TRAIL: Fading body-color dots at past positions ---
  protected drawTrail(
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

  // --- SPEED-STREAKS: tapered motion lines during the dash-bash slide ---
  /** Three staggered lines trailing opposite the launch vector, longest in the
   *  middle — the classic anime speed-line read. Length/alpha scale with
   *  speed so the tail end of the slide relaxes instead of cutting off. */
  protected drawDashStreaks(
    g: Phaser.GameObjects.Graphics,
    pos: Vec2,
    velocity: Vec2,
    s: number,
  ): void {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed < 200) return;
    const ux = -velocity.x / speed; // unit vector opposite travel
    const uy = -velocity.y / speed;
    const px = -uy; // perpendicular for the stagger
    const py = ux;
    const boost = Phaser.Math.Clamp(speed / 940, 0, 1);
    // [perp offset, length multiplier] — middle streak longest.
    const STREAKS: [number, number][] = [
      [-14, 0.72],
      [0, 1],
      [13, 0.62],
    ];
    for (const [off, lenMul] of STREAKS) {
      const ox = pos.x + px * off * s;
      const oy = pos.y - 28 * s + py * off * s; // originate near the torso
      const len = 46 * lenMul * boost * s;
      // Tapered: a wide accent base under a thin white core, both fading
      // along their length via three shrinking segments.
      for (let seg = 0; seg < 3; seg++) {
        const t0 = seg / 3;
        const t1 = (seg + 1) / 3;
        const a = 0.4 * boost * (1 - t0);
        g.lineStyle((3.4 - seg) * s, this.accentColor, a);
        g.beginPath();
        g.moveTo(ox + ux * len * t0, oy + uy * len * t0);
        g.lineTo(ox + ux * len * t1, oy + uy * len * t1);
        g.strokePath();
      }
      g.lineStyle(1.4 * s, WHITE, 0.5 * boost);
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + ux * len * 0.55, oy + uy * len * 0.55);
      g.strokePath();
    }
  }

  // --- SILHOUETTE BACKING: guarantees contrast against ANY backdrop ---
  /** A dark halo behind the whole figure — existing per-limb outlines
   *  (see drawTorso's own 1-2px dark edge) are too thin to read as a
   *  silhouette at normal on-screen scale; this is broader and covers
   *  the full pose extent so the rig pops regardless of what's behind it. */
  protected drawSilhouetteBacking(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    head: Vec2,
    hipL: Vec2,
    hipR: Vec2,
    footL: Vec2,
    footR: Vec2,
    s: number,
  ) {
    g.fillStyle(DARK, 0.62);
    g.fillEllipse(chest.x, chest.y, 15 * s, 19 * s);
    g.fillEllipse(pelvis.x, pelvis.y, 12 * s, 12 * s);
    g.fillEllipse(head.x, head.y, 11 * s, 13 * s);
    g.fillEllipse((hipL.x + footL.x) / 2, (hipL.y + footL.y) / 2, 6 * s, (footL.y - hipL.y) / 2 + 4 * s);
    g.fillEllipse((hipR.x + footR.x) / 2, (hipR.y + footR.y) / 2, 6 * s, (footR.y - hipR.y) / 2 + 4 * s);
  }

  // --- TORSO: Filled armored body ---
  protected drawTorso(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
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
  protected drawSpineGlow(
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
  protected drawAura(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
    const n =
      this.detail === "full"
        ? ProceduralPlayerRig.AURA_MOTE_COUNT
        : ProceduralPlayerRig.AURA_MOTE_LITE;
    if (n <= 0) return;
    const cx = (pelvis.x + chest.x) / 2;
    const cy = (pelvis.y + chest.y) / 2 - 10 * s;
    const t = this.stepPhase + this.auraSeed;
    const tails = this.detail === "full" ? 3 : 0;

    const motePos = (i: number, tt: number): { x: number; y: number } => {
      const off = (i / n) * Math.PI * 2;
      const radius = (20 + 7 * Math.sin(tt * 0.7 + off * 2)) * s;
      const angle = tt * (1.1 + i * 0.17) + off;
      const wobbleR = radius + 4 * s * Math.sin(tt * 2.3 + off);
      return {
        x: cx + Math.cos(angle) * wobbleR,
        y: cy + Math.sin(angle) * wobbleR * 0.8,
      };
    };

    for (let i = 0; i < n; i++) {
      const off = (i / n) * Math.PI * 2;
      const twinkle = 0.6 + 0.4 * Math.sin(t * 3.1 + off * 3);

      for (let e = tails; e >= 1; e--) {
        const echo = motePos(i, t - e * 0.05);
        const tailAlpha = twinkle * (0.28 - e * 0.05);
        g.fillStyle(this.accentColor, Math.max(0, tailAlpha));
        g.fillCircle(echo.x, echo.y, (2.5 - e * 0.4) * s);
      }

      const p = motePos(i, t);
      g.fillStyle(this.accentColor, twinkle * 0.5);
      g.fillCircle(p.x, p.y, 5 * s);
      g.fillStyle(this.accentColor, twinkle * 0.95);
      g.fillCircle(p.x, p.y, 2.7 * s);
      if (this.detail === "full") {
        g.fillStyle(WHITE, twinkle * 0.9);
        g.fillCircle(p.x, p.y, 1.15 * s);
      }
    }
  }

  // --- HIP DRAPE: a short cloth strip trailing off the pelvis — the
  // "wizard sash" that keeps the vessel from reading as pure armor plate.
  protected drawHipDrape(g: Phaser.GameObjects.Graphics, pelvis: Vec2, tip: Vec2, s: number) {
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
  protected drawHeadCrest(g: Phaser.GameObjects.Graphics, head: Vec2, s: number) {
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
  protected drawHead(g: Phaser.GameObjects.Graphics, head: Vec2, s: number, healthRatio: number) {
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
  protected drawShoulderArmor(g: Phaser.GameObjects.Graphics, shoulder: Vec2, s: number) {
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
  protected drawHandGlow(g: Phaser.GameObjects.Graphics, hand: Vec2, s: number, pulse: number) {
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

  // --- SHURIKEN: a small 4-point spinning star cocked in each hand, the
  // projectile-in-waiting. Always spinning (idle read); on that hand's throw
  // (`throwAmount` 0-1) it brightens and stretches a motion streak along aim
  // — the shuriken leaving the hand. The shard spawn point IS this hand, so
  // a shot visibly launches from the exact hand mid-flick.
  protected drawShuriken(
    g: Phaser.GameObjects.Graphics,
    hand: Vec2,
    aim: Vec2,
    s: number,
    throwAmount: number,
  ) {
    const spin = this.shurikenSpin + (hand.x + hand.y) * 0.02; // desync L/R
    const size = (3.2 + throwAmount * 1.6) * s;
    const bright = 0.55 + throwAmount * 0.45;

    // Motion streak along aim as it's flung.
    if (throwAmount > 0.15) {
      const streak = throwAmount * 16 * s;
      g.lineStyle(2.2 * s, WHITE, throwAmount * 0.7);
      g.beginPath();
      g.moveTo(hand.x - aim.x * streak * 0.3, hand.y - aim.y * streak * 0.3);
      g.lineTo(hand.x + aim.x * streak, hand.y + aim.y * streak);
      g.strokePath();
    }

    // 4-point star (two crossed blades) spinning.
    g.lineStyle(1.8 * s, this.accentColor, bright);
    for (let i = 0; i < 2; i++) {
      const a = spin + (i * Math.PI) / 2;
      const dx = Math.cos(a) * size;
      const dy = Math.sin(a) * size;
      g.beginPath();
      g.moveTo(hand.x - dx, hand.y - dy);
      g.lineTo(hand.x + dx, hand.y + dy);
      g.strokePath();
    }
    // Bright core.
    g.fillStyle(WHITE, bright);
    g.fillCircle(hand.x, hand.y, 1.4 * s);
  }

  // --- THICK LIMB: Filled polygon instead of line ---
  protected drawThickLimb(
    g: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    outerW: number,
    innerW: number,
  ) {
    // Dark outline limb — thicker so vessel reads over dense vault geometry
    g.lineStyle(outerW + 3.5, DARK, 1);
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
  protected drawBoot(g: Phaser.GameObjects.Graphics, foot: Vec2, s: number) {
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

    // Gold instrument-rule underline (dim track + live gold fill) instead
    // of a flat lime bar — matches the platform hull-chrome's own
    // gold-rule language (PlatformPainter's drawRimHighlight) rather than
    // a disconnected default-HUD health-bar color.
    const lineY = y - 4 * s;
    g.fillStyle(0x3a3020, 0.7);
    g.fillRect(x - nameWidth / 2, lineY, nameWidth, 2);
    g.fillStyle(0xffd76b, 1);
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
    aim: Vec2,
    walkAmount: number,
    wallDir: number,
    dashing: boolean,
    leadThrow: number,
    backThrow: number,
    s: number,
    sprint = 0,
    victoryPoseMs = 0,
  ): { lead: Vec2; back: Vec2 } {
    const reach = ProceduralPlayerRig.ARM_REACH * s;

    if (victoryPoseMs > 0) {
      // The induction pose: both arms raised wide overhead, a fixed target
      // (springs settle into it, so it arrives with weight, not a snap).
      // Highest priority — overrides combat/dash/sprint entirely.
      return {
        lead: vec(shoulderLead.x + this.facing * 14 * s, shoulderLead.y - 46 * s),
        back: vec(shoulderBack.x - this.facing * 14 * s, shoulderBack.y - 46 * s),
      };
    }

    if (dashing) {
      // DASH-BASH guard: both arms brace forward along the lunge — the shield
      // deployed in the travel direction.
      return {
        lead: this.straightTarget(shoulderLead, aim, reach),
        back: this.straightTarget(shoulderBack, aim, reach * 0.94),
      };
    }

    if (wallDir !== 0) {
      // Back hand plants against the gripped wall; the FREE (lead) hand still
      // throws — route whichever throw is live to it so a shot off the wall
      // always reads on the working hand.
      return {
        lead: this.recoilTarget(
          this.readyHandTarget(shoulderLead, aim, s),
          shoulderLead,
          aim,
          reach,
          Math.max(leadThrow, backThrow),
        ),
        back: vec(shoulderBack.x + wallDir * 20 * s, shoulderBack.y + 2 * s),
      };
    }

    // SPRINT ARM PUMP (run reference: fists pump counter-phase, the forward
    // fist rising toward the face, the rear arm driving back) — only while
    // genuinely sprinting and NOT actively shooting: any live throw or
    // recent fire falls through to the ready/recoil stance below, so
    // run-and-gun always reads the shot first and resumes pumping ~a second
    // after the last shot. Tangle-safe by construction: the two targets are
    // mirror-symmetric along the facing axis (they can only meet at the
    // crossover instant, where their heights differ), unlike the old
    // independent-gait arms that could cross mid-torso.
    // The arm behavior LADDER — arms are ARMS first, weapons second:
    //   combat (shot in the last ~1.6s) → cocked ready/throw stance
    //   top-speed sprint                → ninja sweep (both trail back)
    //   mid-speed run                   → counter-phase pump
    //   walking                        → natural low arm swing
    //   still                          → hang at the sides, breathing
    // The permanent shuriken-by-the-ear pose was the "don't behave like
    // arms" bug: it's a combat stance, so now it only appears in combat.
    const firingNow = leadThrow > 0.01 || backThrow > 0.01 || this.firePulse > 0.04;
    const inCombat = firingNow || this.combatHoldMs > 0;

    if (!inCombat && sprint <= 0.35) {
      // LOW-KEY READY: relaxed is never limp — the LEAD hand rides
      // half-cocked at the front hip (a gunslinger's rest, shuriken
      // palmed), so the draw-to-throw is one short whip, not a full
      // hip-to-ear-to-extend journey. Only the back arm truly hangs.
      const f = this.facing;
      if (walkAmount > 0.15) {
        // NATURAL WALK SWING: back hand swings low counter-phase like a
        // person walking; lead hand keeps its half-cock with a soft echo
        // of the swing.
        const swingL = Math.sin(this.stepPhase + Math.PI) * 3 * s * walkAmount;
        const swingB = Math.sin(this.stepPhase) * 5 * s * walkAmount;
        return {
          lead: vec(shoulderLead.x + f * (4 * s + swingL * 0.5), shoulderLead.y + 9 * s),
          back: vec(shoulderBack.x + f * swingB, shoulderBack.y + 15 * s - Math.abs(swingB) * 0.2),
        };
      }
      // HANG (idle): lead half-cocked at the hip, back arm resting,
      // both drifting with the breath.
      const sway = Math.sin(this.idlePhase * 2.1) * 0.8 * s;
      return {
        lead: vec(shoulderLead.x + f * 4 * s, shoulderLead.y + 9 * s + sway),
        back: vec(shoulderBack.x - f * 1.5 * s, shoulderBack.y + 16 * s + sway * 0.7),
      };
    }

    // NINJA SWEEP (top speed): past ~¾ sprint both arms stream BACK behind
    // the torso, low, with a small counter-phase flutter — the anime-ninja
    // full-commitment silhouette (run-reference style #2, torso near
    // horizontal, arms trailing). Any shot still snaps straight to the
    // throw stance below — run-and-gun overrides the sweep instantly.
    if (!firingNow && sprint > 0.72) {
      const n = (sprint - 0.72) / 0.28;
      const f = this.facing;
      const flutterL = Math.sin(this.stepPhase + Math.PI) * 2.5 * s;
      const flutterB = Math.sin(this.stepPhase) * 2.5 * s;
      return {
        lead: vec(
          shoulderLead.x - f * (14 + n * 6) * s,
          shoulderLead.y + (4 + n * 4) * s + flutterL,
        ),
        back: vec(
          shoulderBack.x - f * (12 + n * 6) * s,
          shoulderBack.y + (6 + n * 4) * s + flutterB,
        ),
      };
    }
    if (!firingNow && sprint > 0.35) {
      const pump = (sprint - 0.35) / 0.65;
      const f = this.facing;
      const amp = Phaser.Math.Linear(4, 12, pump) * s;
      const swingLead = Math.sin(this.stepPhase + Math.PI); // counter-phase to its own-side leg
      const swingBack = Math.sin(this.stepPhase);
      return {
        lead: vec(
          shoulderLead.x + f * swingLead * amp - f * 2 * s,
          shoulderLead.y - 3 * s - Math.max(0, swingLead) * 6 * s * pump + Math.max(0, -swingLead) * 3 * s,
        ),
        back: vec(
          shoulderBack.x + f * swingBack * amp - f * 2 * s,
          shoulderBack.y - 3 * s - Math.max(0, swingBack) * 6 * s * pump + Math.max(0, -swingBack) * 3 * s,
        ),
      };
    }

    // Idle / running / airborne: each hand rests INDEPENDENTLY at its own
    // ready position (a shuriken cocked at each hip) and flicks out toward
    // aim only on ITS OWN throw — the alternation means only one hand is
    // extended at a time, so the two limbs never cross (the old failure mode
    // the converged charge-stance was avoiding). A gentle opposite-phase bob
    // keeps the idle/run read alive.
    const leadBob = walkAmount > 0.05 ? Math.sin(this.stepPhase * 2) * 2 * s * walkAmount : 0;
    const backBob = walkAmount > 0.05 ? Math.sin(this.stepPhase * 2 + Math.PI) * 2 * s * walkAmount : 0;
    return {
      lead: this.recoilTarget(
        this.readyHandTarget(shoulderLead, aim, s, leadBob),
        shoulderLead,
        aim,
        reach,
        leadThrow,
      ),
      back: this.recoilTarget(
        this.readyHandTarget(shoulderBack, aim, s, backBob),
        shoulderBack,
        aim,
        reach,
        backThrow,
      ),
    };
  }

  /** The COCKED ready pose for one hand: shuriken held up and slightly
   *  BEHIND its own shoulder (by the ear), a pitcher's set position. The
   *  throw whips from here forward toward aim, so the arm travels UP-and-OVER
   *  the top — an overhand/baseball pitch, not a side-arm lob. Independent
   *  per hand (keys off its own shoulder). `bob` adds the idle/run rhythm.
   *  `aim` is unused for the rest pose but kept for signature symmetry. */
  private readyHandTarget(shoulder: Vec2, _aim: Vec2, s: number, bob = 0): Vec2 {
    return vec(
      shoulder.x - this.facing * 7 * s, // cocked slightly BEHIND the shoulder
      shoulder.y - 11 * s + bob, // and UP, above the shoulder (by the ear)
    );
  }

  /** Blend a resting (charge-hold) hand target toward a full thrust along
   *  `aim` by `fireRecoil` (0-1). The hand spring lags the blend, so a shot
   *  reads as a snap-out toward the target and a settle back — the throw
   *  motion — rather than the arm just teleporting to the extended pose. */
  private recoilTarget(
    hold: Vec2,
    shoulder: Vec2,
    aim: Vec2,
    reach: number,
    fireRecoil: number,
  ): Vec2 {
    if (fireRecoil <= 0) return hold;
    const thrust = this.straightTarget(shoulder, aim, reach);
    return vec(
      hold.x + (thrust.x - hold.x) * fireRecoil,
      hold.y + (thrust.y - hold.y) * fireRecoil,
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
    sprint: number,
    _crouch: boolean,
    grounded: boolean,
  ): Vec2 {
    const s = this.scale;
    // Use continuous crouch blend so stride/lift ease with duck/stand.
    const cr = this.crouchBlend;
    const cycle = this.stepPhase + (side === -1 ? 0 : Math.PI);
    // Stride lengthens hard at sprint (run reference keyframe 2: the flight
    // pose is a near-full split, not a shuffle) and lift rises with it —
    // higher exponent at sprint = snappier plant, longer float.
    const stride = Phaser.Math.Linear(20, 11, cr) * (1 + sprint * 0.75) * s * walk;
    const liftRaw = Math.max(0, Math.sin(cycle));
    const lift = grounded
      ? Math.pow(liftRaw, Phaser.Math.Linear(1.55, 2.1, sprint)) *
        Phaser.Math.Linear(9, 4.5, cr) *
        (1 + sprint * 0.9) *
        s *
        walk
      : 0;
    const spread = Phaser.Math.Linear(7.5, 8.5, cr) * s;

    // AIRBORNE POSE (fixes the "silly jump"): rising = both legs TUCK
    // (knees up under the body, lead knee higher), falling = the lead leg
    // REACHES down-and-forward for the landing while the back leg folds up
    // behind. Replaces feet dangling at full extension and swinging with
    // the (meaningless mid-air) stride cycle.
    if (!grounded) {
      const isLead = side === -1;
      const up = Math.max(0, this.airPose);
      const down = Math.max(0, -this.airPose);
      const f = this.facing;
      const tuckLift = (isLead ? 24 * up + 2 * down : 15 * up + 12 * down) * s;
      const push = (isLead ? f * (3 * up + 8 * down) : f * (-6 * up - 5 * down)) * s;
      return vec(cx + side * spread + push, ground - tuckLift);
    }

    // Slight out-of-phase lateral wobble per foot for floppy gait.
    const drunkFoot = Math.sin(cycle * 0.5 + side) * 1.6 * s * walk;
    // KNEE DRIVE (run reference keyframe 1): the lifted recovery leg punches
    // FORWARD of the hip at sprint, not just up — this is what turns a
    // leg-swing into a sprinter's drive.
    const kneeDrive = liftRaw * sprint * 7 * s * this.facing * walk;
    return vec(
      cx + side * spread - Math.cos(cycle) * stride * this.facing + drunkFoot + kneeDrive,
      ground - lift,
    );
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
