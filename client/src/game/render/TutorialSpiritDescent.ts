// The opening beat, properly staged: the player doesn't just spawn already
// standing there — they arrive AS the spirit that becomes the vessel, and
// the vessel takes its TIME assembling. The full arc now owns the whole
// Silence zone (0:00–0:19, the a-cappella chant + gathering drums):
//
//   0.3–7.1s   DESCENT — a mote of living light dives with the camera
//              (same Sine.easeIn the scripted camera pan uses, so spirit
//              and camera read as one motion), comet tail, sparks peeling.
//   7.1–8.2s   LANDING — the mote settles to a hover, ground ripple,
//              the spell-circle arcs ignite around it.
//   8.2–15.6s  GATHERING — the long, slow build: dozens of motes drift in
//              from the surrounding dark on inward spirals (staggered, so
//              light arrives CONTINUOUSLY for seven seconds), rotating
//              arc-segments orbit like an incantation circle, ground
//              ripples pulse, and a faint luminous silhouette of the
//              vessel gradually traces itself into focus.
//   15.6–17.0s COALESCENCE — everything tightens: rings contract, motes
//              accelerate home, the light pillar rises.
//   17.0–17.8s FLASH — impact bloom, final inward burst, and the solid
//              hero rig takes over (~17.4s, just before the First Word
//              zone at 19s — the move-invite glyph fires right after).
//
// Time-driven off the SONG's own clock (this.songAudio.currentTime),
// never accumulated deltaMs — same governing rule every other beat-synced
// system in this scene follows (see SongDirector's own header): scrubbing
// via ?t= must show the correct descent/assembly/idle state immediately,
// forward OR backward. No cue table entry needed — this derives its whole
// state purely from "where in absolute song-time are we right now."
//
// TutorialScene also gates HERO INPUT on hasMaterialized() — a spirit
// mid-assembly can't run off; control arrives the same instant the body
// does, which is itself a diegetic "you may move now" cue.

import Phaser from "phaser";
import { SEAL_WORLD_X, SEAL_WORLD_Y, SEAL_PARALLAX } from "./TutorialVesselShader.js";

const DESCENT_START_SEC = 0.3; // matches tutorial-song.ts's "descent-plunge"
const LAND_SEC = 7.1; // matches "descent-arrive" — the camera lands here too
const ASSEMBLE_END_SEC = 17.8; // full assembly; materialized slightly before
const GATHER_MOTES = 46;

const GOLD_HAIR = 0xffedb0;
const GOLD_CORE = 0xfff2d0;
const TEAL = 0x6fe0d8;
const VIOLET = 0x8b6cf0;

function hash01(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Ease-in (accelerating fall) — matches the camera's own Sine.easeIn on
// the same dive, so the spirit and the camera read as ONE motion.
function easeInSine(t: number): number {
  return 1 - Math.cos((t * Math.PI) / 2);
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

type TrailPoint = { x: number; y: number; age: number };

type GatherMote = {
  startAngle: number;
  startR: number;
  /** When (0..1 of the gather window) this mote begins its inward drift. */
  delay: number;
  /** How much of the window its journey takes once started. */
  span: number;
  /** Total spiral rotation over the journey — alternating direction. */
  spiral: number;
  tint: number;
};

export class TutorialSpiritDescent {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly targetX: number;
  private readonly targetY: number;
  private readonly trail: TrailPoint[] = [];
  private readonly motes: GatherMote[] = [];
  private materialized = false;
  private burstParticles: { angle: number; startR: number }[] = [];

  constructor(scene: Phaser.Scene, targetX: number, targetY: number) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.g = scene.add.graphics();
    this.g.setDepth(12); // same layer as the hero/thrall rigs
    for (let i = 0; i < 14; i++) {
      this.burstParticles.push({ angle: (i / 14) * Math.PI * 2 + hash01(i) * 0.3, startR: 46 + hash01(i + 50) * 30 });
    }
    // Gathering motes: staggered delays + spans so arrivals stay
    // CONTINUOUS across the whole seven-second gather — the sky keeps
    // answering, not one synchronized swarm.
    for (let i = 0; i < GATHER_MOTES; i++) {
      this.motes.push({
        startAngle: hash01(i * 3.1) * Math.PI * 2,
        startR: 130 + hash01(i * 7.7) * 430,
        delay: hash01(i * 5.3) * 0.62,
        span: 0.3 + hash01(i * 9.1) * 0.34,
        spiral: (hash01(i * 11.7) > 0.5 ? 1 : -1) * (0.8 + hash01(i * 13.3) * 1.6),
        tint: i % 3 === 0 ? TEAL : i % 3 === 1 ? GOLD_HAIR : VIOLET,
      });
    }
  }

  /** Returns true once the vessel has (mostly) assembled — TutorialScene
   *  gates the real hero rig's visibility AND hero input on this, so the
   *  solid, controllable body only exists once the light resolves. */
  hasMaterialized(): boolean {
    return this.materialized;
  }

  /** The seal quad renders at SEAL_PARALLAX, so where it APPEARS in
   *  scrollFactor-1 world space shifts with the camera: a world object at
   *  wx overlaps a parallax object at px when wx = px + scroll·(1−f).
   *  Re-projected fresh every frame — during the opening dive the camera
   *  itself is moving, and the soul must stay pinned to the monad (the
   *  seal's own center point) until the moment it departs. */
  private sealApparent(cam: Phaser.Cameras.Scene2D.Camera): { x: number; y: number } {
    return {
      x: SEAL_WORLD_X + cam.scrollX * (1 - SEAL_PARALLAX),
      y: SEAL_WORLD_Y + cam.scrollY * (1 - SEAL_PARALLAX),
    };
  }

  update(currentSongTimeSec: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const g = this.g;
    g.clear();

    // Recomputed FRESH from song time every frame, never latched — the
    // ?t= scrub tool can jump backward as well as forward, and a stale
    // `materialized = true` left over from a forward seek would show the
    // solid hero rig AND the descent visual at once the moment someone
    // scrubs back into the pre-arrival window.
    if (currentSongTimeSec < DESCENT_START_SEC) {
      this.materialized = false;
      return; // held at the very first instant — nothing to show yet
    }
    if (currentSongTimeSec >= ASSEMBLE_END_SEC) {
      this.materialized = true;
      return; // long since resolved — the real hero rig owns this spot now
    }

    if (currentSongTimeSec < LAND_SEC) {
      this.materialized = false;
      this.drawDescent(g, currentSongTimeSec, cam);
    } else {
      this.drawAssembly(g, currentSongTimeSec);
    }
  }

  private posAt(progress: number, origin: { x: number; y: number }): { x: number; y: number } {
    const e = easeInSine(Phaser.Math.Clamp(progress, 0, 1));
    // A slight curve, not a straight line: lerp X with a touch of
    // overshoot-then-settle via a sine bow, Y with the eased fall.
    // Origin is the seal's LIVE apparent position (it drifts as the
    // camera dives, parallax) — at progress 0 the soul is glued to the
    // monad; the eased blend hands it over to its own trajectory.
    const bow = Math.sin(progress * Math.PI) * 60;
    return {
      x: origin.x + (this.targetX - origin.x) * e + bow,
      y: origin.y + (this.targetY - origin.y) * e,
    };
  }

  private drawDescent(g: Phaser.GameObjects.Graphics, timeSec: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const progress = (timeSec - DESCENT_START_SEC) / (LAND_SEC - DESCENT_START_SEC);
    const origin = this.sealApparent(cam);
    const pos = this.posAt(progress, origin);

    // EMERGENCE — the first beat: the monad brightens, a birth-ring
    // expands from the seal's core, and the soul pulls free of it. Reads
    // as the deity EXHALING the spirit, not a comet arriving from
    // nowhere off-screen.
    const emergence = 1 - Phaser.Math.Clamp((timeSec - DESCENT_START_SEC) / 1.4, 0, 1);
    if (emergence > 0) {
      g.setBlendMode(Phaser.BlendModes.ADD);
      const birth = 1 - emergence;
      g.fillStyle(GOLD_CORE, emergence * 0.5);
      g.fillCircle(origin.x, origin.y, 10 + birth * 26);
      g.fillStyle(0xffffff, emergence * 0.7);
      g.fillCircle(origin.x, origin.y, 4 + birth * 6);
      g.lineStyle(1.6, GOLD_HAIR, emergence * 0.7);
      g.strokeCircle(origin.x, origin.y, 8 + birth * 90);
      g.lineStyle(1, TEAL, emergence * 0.45);
      g.strokeCircle(origin.x, origin.y, 8 + birth * 140);
      // An umbilical thread of light between monad and soul, thinning as
      // the soul commits to its fall.
      g.lineStyle(1.2, GOLD_HAIR, emergence * 0.55);
      g.lineBetween(origin.x, origin.y, pos.x, pos.y);
    }

    // Maintain a short trail buffer of recent positions for the comet tail.
    this.trail.push({ x: pos.x, y: pos.y, age: 0 });
    for (const p of this.trail) p.age += 1 / 60;
    while (this.trail.length > 26) this.trail.shift();

    g.setBlendMode(Phaser.BlendModes.ADD);

    // Comet tail: fading circles, older = smaller + dimmer.
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i]!;
      const life = 1 - Phaser.Math.Clamp(p.age / 0.45, 0, 1);
      if (life <= 0) continue;
      g.fillStyle(i % 2 === 0 ? TEAL : GOLD_HAIR, life * 0.42);
      g.fillCircle(p.x, p.y, 3.2 + life * 6);
    }

    // Sparks peeling off perpendicular to the fall — cheap, per-frame,
    // deterministic scatter keyed off song time (not a persistent particle
    // system — this is a short beat, not worth an emitter's bookkeeping).
    const fallAngle = Math.atan2(this.targetY - origin.y, this.targetX - origin.x);
    const perp = fallAngle + Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const seed = i * 3.7 + Math.floor(timeSec * 4);
      const spread = (hash01(seed) - 0.5) * 46;
      const back = hash01(seed + 1) * 22;
      const sx = pos.x + Math.cos(perp) * spread - Math.cos(fallAngle) * back;
      const sy = pos.y + Math.sin(perp) * spread - Math.sin(fallAngle) * back;
      g.fillStyle(GOLD_HAIR, 0.65 * hash01(seed + 2));
      g.fillCircle(sx, sy, 1.9);
    }

    // The soul itself: hot core + soft halo + a tiny version of the
    // seal's own aura (two thin counter-rotating rings) — it's already
    // carrying the geometry it's about to become.
    g.fillStyle(GOLD_CORE, 0.18);
    g.fillCircle(pos.x, pos.y, 16);
    g.fillStyle(GOLD_CORE, 0.4);
    g.fillCircle(pos.x, pos.y, 7);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(pos.x, pos.y, 3);

    g.setBlendMode(Phaser.BlendModes.NORMAL);
    g.lineStyle(1, GOLD_HAIR, 0.5);
    g.strokeCircle(pos.x, pos.y, 11 + Math.sin(timeSec * 5) * 1.5);
    g.lineStyle(0.8, TEAL, 0.35);
    g.strokeCircle(pos.x, pos.y, 15 - Math.sin(timeSec * 4.3) * 1.5);
  }

  /** The long, slow assembly — LAND_SEC → ASSEMBLE_END_SEC (~10.7s).
   *  `at` is 0..1 across that whole window; sub-phases key off it. */
  private drawAssembly(g: Phaser.GameObjects.Graphics, timeSec: number): void {
    const at = Phaser.Math.Clamp((timeSec - LAND_SEC) / (ASSEMBLE_END_SEC - LAND_SEC), 0, 1);
    const cx = this.targetX;
    const cy = this.targetY - 14; // roughly chest-height on the rig about to appear
    const groundY = this.targetY + 36;
    this.materialized = at >= 0.94;

    // Sub-phase envelopes.
    const settle = Phaser.Math.Clamp(at / 0.1, 0, 1); // landing hover-in
    const coalesce = Phaser.Math.Clamp((at - 0.8) / 0.14, 0, 1); // everything tightens
    const flash = Phaser.Math.Clamp((at - 0.9) / 0.1, 0, 1); // the final bloom

    g.setBlendMode(Phaser.BlendModes.ADD);

    // Ground ripples: a slow expanding ellipse every ~2.4s of the gather —
    // the floor acknowledging what's arriving. Keyed to song time so a
    // scrub lands mid-ripple correctly.
    for (let k = 0; k < 2; k++) {
      const ripplePhase = ((timeSec - LAND_SEC) / 2.4 + k * 0.5) % 1;
      if (ripplePhase < 0 || at > 0.92) continue;
      const rippleR = 14 + ripplePhase * 90;
      const rippleA = (1 - ripplePhase) * 0.5;
      g.lineStyle(2, TEAL, rippleA);
      g.strokeEllipse(cx, groundY, rippleR * 2, rippleR * 0.55);
    }

    // The incantation circle: rotating arc-segments at three radii,
    // alternating directions — the spell being spoken around the vessel.
    // Radii contract hard during coalescence (the circle closing its fist).
    const contract = 1 - coalesce * 0.62;
    for (let ring = 0; ring < 3; ring++) {
      const baseR = (26 + ring * 14) * contract * settle;
      if (baseR < 2) continue;
      const dir = ring % 2 === 0 ? 1 : -1;
      const spin = timeSec * (0.5 + ring * 0.22) * dir;
      const segs = 2 + ring;
      const ringAlpha = (0.5 + ring * 0.1) * settle * (1 - flash);
      for (let s = 0; s < segs; s++) {
        const a0 = spin + (s / segs) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / segs * 0.55; // 55% arc, 45% gap
        g.lineStyle(1.8, ring === 1 ? TEAL : GOLD_HAIR, ringAlpha);
        g.beginPath();
        g.arc(cx, cy, baseR, a0, a1);
        g.strokePath();
      }
    }

    // Gathering motes: each spirals in from the surrounding dark on its
    // own staggered schedule. Position derived purely from `at` — fully
    // scrub-stable. A tiny arrival spark pops as each one lands.
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!;
      const local = Phaser.Math.Clamp((at - m.delay * 0.78) / (m.span * 0.78), 0, 1);
      if (local <= 0 || local >= 1) {
        if (local >= 1 && local < 1.001) continue; // consumed — its light lives in the core now
        if (local <= 0) continue;
      }
      const eased = easeInOutSine(local);
      // Coalescence yanks every straggler home fast.
      const pull = Math.max(eased, coalesce);
      const r = m.startR * (1 - pull);
      const ang = m.startAngle + m.spiral * eased;
      const mx = cx + Math.cos(ang) * r;
      const my = cy + Math.sin(ang) * r * 0.8; // slight vertical squash — the field leans toward the ground plane
      const fadeIn = Phaser.Math.Clamp(local / 0.15, 0, 1);
      const alpha = fadeIn * (1 - Phaser.Math.Clamp((local - 0.9) / 0.1, 0, 1));
      if (alpha <= 0.01) continue;
      // Short motion streak pointing back along the spiral — inward
      // motion stays legible even in a still frame.
      const tailAng = ang - m.spiral * 0.06;
      const tailR = r + 7 + (1 - local) * 6;
      g.lineStyle(1.6, m.tint, alpha * 0.8);
      g.lineBetween(mx, my, cx + Math.cos(tailAng) * tailR, cy + Math.sin(tailAng) * tailR * 0.8);
      // Soft glow halo under the hot point — under ADD blend this is what
      // makes a mote read as EMITTING light, not just a colored dot.
      const moteR = 2.4 + hash01(i * 2.2) * 1.8;
      g.fillStyle(m.tint, alpha * 0.3);
      g.fillCircle(mx, my, moteR * 2.6);
      g.fillStyle(m.tint, alpha);
      g.fillCircle(mx, my, moteR);
      g.fillStyle(0xffffff, alpha * 0.7);
      g.fillCircle(mx, my, moteR * 0.45);
      // Arrival spark.
      if (local > 0.93) {
        g.fillStyle(0xffffff, (1 - (local - 0.93) / 0.07) * 0.9);
        g.fillCircle(mx, my, 4.2);
      }
    }

    // The core: the landed soul, hovering at chest height, breathing —
    // and steadily BRIGHTENING as it absorbs the gathered light. Its slow
    // vertical bob damps toward stillness as the body forms around it.
    const bob = Math.sin(timeSec * 1.7) * 3 * (1 - at);
    const coreY = cy + bob;
    const charge = 0.35 + at * 0.65; // how much light it has absorbed
    g.fillStyle(GOLD_CORE, 0.14 * charge * (1 - flash * 0.5));
    g.fillCircle(cx, coreY, 18 + charge * 8);
    g.fillStyle(GOLD_CORE, 0.38 * charge);
    g.fillCircle(cx, coreY, 6.5 + charge * 2.5);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(cx, coreY, 2.6 + charge * 1.2);

    // The silhouette tracing itself into focus: from ~45% onward, a
    // luminous sketch of the vessel condenses — spine first, then
    // shoulders and legs, each line steadying (less jitter) as `at`
    // climbs. Deliberately a light-drawing, not an early copy of the rig:
    // the body is being PROPOSED by the light before it becomes solid.
    const figure = Phaser.Math.Clamp((at - 0.45) / 0.45, 0, 1);
    if (figure > 0) {
      const jitter = (1 - figure) * 3;
      const jx = (hash01(Math.floor(timeSec * 13)) - 0.5) * jitter;
      const jy = (hash01(Math.floor(timeSec * 13) + 7) - 0.5) * jitter;
      const headY = this.targetY - 32 + jy;
      const hipY = this.targetY + 6 + jy;
      const footY = this.targetY + 34;
      const figA = figure * 0.75 * (1 - flash * 0.6);
      // Spine + head halo.
      g.lineStyle(2, GOLD_HAIR, figA);
      g.lineBetween(cx + jx, headY + 6, cx + jx, hipY);
      g.fillStyle(GOLD_CORE, figA * 0.8);
      g.fillCircle(cx + jx, headY, 4.5);
      // Shoulders + arms arrive at 65%.
      if (figure > 0.45) {
        const limbA = Phaser.Math.Clamp((figure - 0.45) / 0.4, 0, 1) * figA;
        const shY = headY + 12;
        g.lineStyle(1.5, GOLD_HAIR, limbA);
        g.lineBetween(cx + jx, shY, cx + jx - 9, shY + 16);
        g.lineBetween(cx + jx, shY, cx + jx + 9, shY + 16);
      }
      // Legs arrive last — the vessel stands.
      if (figure > 0.65) {
        const legA = Phaser.Math.Clamp((figure - 0.65) / 0.3, 0, 1) * figA;
        g.lineStyle(1.5, GOLD_HAIR, legA);
        g.lineBetween(cx + jx, hipY, cx + jx - 6, footY);
        g.lineBetween(cx + jx, hipY, cx + jx + 6, footY);
      }
    }

    // Coalescence pillar — rises as everything tightens, thins as the
    // flash takes over. Classic "power arrives from above" tell, saved
    // for the END of the long build so it reads as the climax of the
    // gather, not scenery.
    if (coalesce > 0) {
      const pillarLife = coalesce * (1 - flash);
      const pillarH = 260 * coalesce;
      const pillarW = 9 * (1 - flash * 0.7) + 2;
      g.fillStyle(GOLD_HAIR, pillarLife * 0.26);
      g.fillRect(cx - pillarW / 2, cy - pillarH, pillarW, pillarH);
      g.fillStyle(0xffffff, pillarLife * 0.38);
      g.fillRect(cx - pillarW * 0.25, cy - pillarH, pillarW * 0.5, pillarH);
    }

    // The final flash + inward burst — the instant of embodiment.
    if (flash > 0) {
      const bloom = 1 - flash; // brightest the instant it starts
      g.fillStyle(0xffffff, bloom * 0.55);
      g.fillCircle(cx, cy, 30 + flash * 70);
      g.fillStyle(GOLD_CORE, bloom * 0.35);
      g.fillCircle(cx, cy, 60 + flash * 110);
      for (const p of this.burstParticles) {
        const r = p.startR * (1 - easeInSine(flash));
        const px = cx + Math.cos(p.angle) * r;
        const py = cy + Math.sin(p.angle) * r * 0.7;
        const alpha = (1 - flash) * 0.85;
        if (alpha <= 0) continue;
        const tailR = r + 9;
        g.lineStyle(1.4, VIOLET, alpha * 0.6);
        g.lineBetween(px, py, cx + Math.cos(p.angle) * tailR, cy + Math.sin(p.angle) * tailR * 0.7);
        g.fillStyle(GOLD_HAIR, alpha);
        g.fillCircle(px, py, 1.8);
      }
    }

    g.setBlendMode(Phaser.BlendModes.NORMAL);
  }

  destroy(): void {
    this.g.destroy();
  }
}
