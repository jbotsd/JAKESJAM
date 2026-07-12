// The Demiurge's brood — a canonical RACE with a hierarchy, not three
// unrelated enemy configs bolted together, and NOT a recolored player rig
// (the old wave minions were literally a violet ProceduralPlayerRig — same
// bipedal ninja skeleton as the hero, just tinted, reading as a clone army:
// "we don't want clones of the same looking ninja vessel").
//
// Every member shares ONE construction grammar (a dark malignant core
// wrapped in radiating crystal thorns), and RANK is legible from that same
// grammar rather than a re-skin: more thorns, denser/heavier composition,
// slower and more deliberate motion as you go up. Splinter → Facet →
// Estaphaios (the boss — TWO concentric thorn-rings, not just a bigger
// single ring) is meant to read as one bloodline at three sizes, the way a
// real enemy faction would.
//
// Tonally between two well-known enemy-design registers: a shared-kit,
// radially-symmetric geometric construct crossed with a corrupted/unstable
// edge (particles sloughing continuously off the silhouette, worse as
// health drops) — described here in our own terms, built entirely from
// this project's crystal/violet/copper/rose vocabulary, not copied art.
//
// MENACE, concretely: a soft symmetric diamond reads as a gem (pretty); an
// asymmetric barbed thorn reads as a weapon. A bright even glow reads as
// jewelry; a near-black core with hot cracks reads as something malignant
// holding heat in, not giving it off freely. Smooth uniform rotation reads
// as calm; a fast-snap-out/slow-settle per-limb "bristle" reads as a thing
// twitching with barely-restrained aggression. And it should always be
// visibly LOOKING at what it wants to hurt — one thorn stays locked long
// and sharp toward the aim target at all times, not just when firing.
//
// No limbs, no head, no torso: a cluster of thorns around a dark nucleus.
// That absence of a humanoid silhouette IS the point — it can't be
// mistaken for a player at a glance, at any distance, at any scale.

import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import type { CombatRig } from "../rendering/ProceduralPlayerRig.js";

const CORE_DARK = 0x241531;
const CORE_DEEPER = 0x120a1c;
const VIOLET = 0x8b6cf0;
const COPPER = 0xd08a5a;
const ROSE_HOT = 0xffd0c0;

export type ShardThrallTier = "splinter" | "facet" | "warder" | "estaphaios";

type ShardThrallPose = {
  position: Vec2;
  velocity: Vec2;
  aimTarget: Vec2;
  health?: number;
  maxHealth?: number;
  /** Directional-shield state (see tutorialDuel.ts's SHIELD_* constants) —
   *  undefined for non-shielded tiers. hitStacks/crackedMs drive the
   *  frontal-facet brightness and the crack/vulnerable flicker. */
  shield?: { hitStacks: number; crackedMs: number };
};

type TierConfig = {
  /** Thorns in the primary (inner) ring. */
  thorns: number;
  /** Thorns in a second, outer ring — 0 for anything below boss rank. */
  outerThorns: number;
  coreR: number;
  spin: number;
  /** Bristle cadence multiplier — HIGHER = more frantic/twitchy (low rank).
   *  Boss rank is slow and heavy on purpose: power reads as mass and
   *  control, not speed. */
  aggression: number;
  /** How far the whole cluster leans toward its aim target, in px — the
   *  "visibly wants to hurt you" tell. */
  lean: number;
};

const TIER_CONFIG: Record<ShardThrallTier, TierConfig> = {
  // Common swarm grunt — small, frantic, erratic: low rank reads as
  // desperate/skittish, not composed.
  splinter: { thorns: 4, outerThorns: 0, coreR: 11, spin: 2.2, aggression: 1.6, lean: 4 },
  // Heavier ranged type — steadier cadence, a more deliberate aim-lean.
  facet: { thorns: 6, outerThorns: 0, coreR: 17, spin: 1.3, aggression: 1.0, lean: 7 },
  // Directional-shield bearer — the squad-tactics piece (see tutorialDuel.ts's
  // SHIELD_* constants for the mitigation logic this visualizes). Barely
  // spins at all: a shield that's constantly rotating away from its own
  // facing would undercut the whole "read the facing, act on it" point.
  warder: { thorns: 5, outerThorns: 0, coreR: 20, spin: 0.35, aggression: 0.8, lean: 9 },
  // The boss — TWO concentric rings (a crown of blades, not a bigger
  // splinter), slow/heavy motion, the densest and most permanent
  // corruption. A different COMPOSITION at the top of the hierarchy, not
  // just bigger numbers.
  estaphaios: { thorns: 8, outerThorns: 6, coreR: 30, spin: 0.55, aggression: 0.55, lean: 12 },
};

/** Cheap deterministic per-index pseudo-random in [0,1) — staggers each
 *  thorn's bristle timing so a cluster never looks synchronized/mechanical. */
function hash01(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export class TutorialShardThrall implements CombatRig {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly cfg: TierConfig;
  private readonly tier: ShardThrallTier;
  private t = Math.random() * 100;
  private x = 0;
  private y = 0;
  private hitFlashMs = 0;
  private hitDirX = 0;
  private hitDirY = 0;
  private fireFlashMs = 0;
  private fireAngle = 0;
  private leanX = 0;
  private leanY = 0;
  private wobbleX = 0;
  private wobbleY = 0;
  private motePhase = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, tier: ShardThrallTier = "splinter") {
    this.tier = tier;
    this.cfg = TIER_CONFIG[tier];
    this.g = scene.add.graphics();
    // NORMAL, not ADD: the menace redesign's dark, malignant core fill is
    // nearly invisible under additive blending (dark + background ≈
    // background) — ADD is right for bright glowing energy, wrong for a
    // solid corrupted BODY. Under ADD this rendered as only the bright
    // thorn outlines/veins with no visible mass — a wireframe burst, not
    // an aberration. Normal blend makes the dark body actually opaque:
    // something with real presence, worth killing, not a ghost of lines.
    this.g.setDepth(12); // same layer as the humanoid rigs
  }

  setVisible(visible: boolean): void {
    this.g.setVisible(visible);
  }

  /** Fire tell: the thorn already locked toward the target flares bright
   *  then discharges — a blade striking, not a throwing arm. */
  triggerFire(): void {
    this.fireFlashMs = 220;
  }

  /** A directional crack: the whole cluster kicks away from the hit and
   *  flashes white-hot for a couple frames — brief, not a big animation,
   *  low-rank thralls die in a hit or two by design. */
  triggerHit(dirX: number, dirY: number): void {
    this.hitFlashMs = 110;
    this.hitDirX = dirX;
    this.hitDirY = dirY;
    this.wobbleX += dirX * 14;
    this.wobbleY += dirY * 14;
  }

  /** Thralls never parry — no shield, no guard. No-op so it can share
   *  SimEventRouter's generic combatant path without special-casing. */
  triggerParryFlash(): void {}

  update(deltaMs: number, pose: ShardThrallPose): void {
    const dt = deltaMs / 1000;
    this.t += dt;
    this.x = pose.position.x;
    this.y = pose.position.y;
    this.hitFlashMs = Math.max(0, this.hitFlashMs - deltaMs);
    this.fireFlashMs = Math.max(0, this.fireFlashMs - deltaMs);
    this.wobbleX *= Math.max(0, 1 - dt * 6);
    this.wobbleY *= Math.max(0, 1 - dt * 6);
    this.motePhase += dt * 1.7;
    if (pose.aimTarget) {
      const ang = Math.atan2(pose.aimTarget.y - this.y, pose.aimTarget.x - this.x);
      this.fireAngle = ang;
      // Predatory lean toward whatever it's aiming at — a permanent,
      // slightly unsettling "it's looking at you" bias on the whole body.
      const targetLeanX = Math.cos(ang) * this.cfg.lean;
      const targetLeanY = Math.sin(ang) * this.cfg.lean;
      const k = 1 - Math.exp(-dt * 3);
      this.leanX += (targetLeanX - this.leanX) * k;
      this.leanY += (targetLeanY - this.leanY) * k;
    }
    this.draw(pose);
  }

  private draw(pose: ShardThrallPose): void {
    const g = this.g;
    g.clear();
    const cx = this.x + this.wobbleX + this.leanX;
    const cy = this.y + this.wobbleY + this.leanY;
    const hpFrac = Phaser.Math.Clamp((pose.health ?? 24) / (pose.maxHealth ?? 24), 0, 1);
    // Destabilization: the lower the health, the fewer thorns stay locked
    // in formation and the more they drift loose — "coming apart," not a
    // simple hit-flash palette swap.
    const cohesion = Phaser.Math.Linear(0.35, 1.0, hpFrac);
    const hitT = this.hitFlashMs / 110;
    const fireT = this.fireFlashMs / 220;

    this.drawRing(g, cx, cy, this.cfg.thorns, 1.0, 0, cohesion, hitT, fireT);
    if (this.cfg.outerThorns > 0) {
      this.drawRing(g, cx, cy, this.cfg.outerThorns, 1.85, Math.PI / this.cfg.outerThorns, cohesion, hitT, fireT);
    }

    // Core: near-black nucleus with hot cracks — malignant, not jeweled.
    // Two overlapping dark polygons for a faceted-but-heavy silhouette,
    // then thin hot veins traced across it (never a filled glow).
    const coreSize = this.cfg.coreR * (1 + hitT * 0.35 + fireT * 0.2);
    this.thornSpike(g, cx, cy, coreSize, coreSize * 0.85, this.t * 0.4, CORE_DEEPER, CORE_DEEPER, 0.92);
    this.thornSpike(g, cx, cy, coreSize * 0.8, coreSize * 0.68, -this.t * 0.55 + Math.PI / 5, CORE_DARK, CORE_DARK, 0.85);
    const veinColor = hitT > 0 ? ROSE_HOT : COPPER;
    const veinN = 3;
    for (let i = 0; i < veinN; i++) {
      const a0 = this.t * 0.3 + (i / veinN) * Math.PI * 2;
      const a1 = a0 + 0.9 + hash01(i) * 0.6;
      g.lineStyle(1.4, veinColor, 0.55 + hitT * 0.4);
      g.lineBetween(
        cx + Math.cos(a0) * coreSize * 0.2,
        cy + Math.sin(a0) * coreSize * 0.2,
        cx + Math.cos(a1) * coreSize * 0.75,
        cy + Math.sin(a1) * coreSize * 0.75,
      );
    }
    if (hitT > 0) {
      g.fillStyle(ROSE_HOT, hitT * 0.6);
      g.fillCircle(cx, cy, coreSize * 0.4);
    }

    // The shield: a facet arc facing the aim direction (SHIELD_FRONTAL_ARC
    // in tutorialDuel.ts — this MUST visually match that arc, since the
    // whole design point is the player reading the geometry, not a UI
    // meter). Sealed = a bright, continuous crystal wall. Cracked = it
    // visibly comes apart into a scattered flicker for the vulnerable
    // window, then re-seals. No separate health-bar-style indicator by
    // design — per the Vex/Hydra research this is built from, the shield's
    // own state IS the readable information.
    if (pose.shield) {
      const cracked = pose.shield.crackedMs > 0;
      const arcHalf = (65 * Math.PI) / 180; // matches SHIELD_FRONTAL_ARC_RAD/2
      const shieldR = coreSize * 2.1;
      const segN = 7;
      for (let i = 0; i < segN; i++) {
        const segT = i / (segN - 1) - 0.5; // -0.5..0.5
        const ang = this.fireAngle + segT * arcHalf * 2;
        const flicker = cracked ? hash01(i + Math.floor(this.t * 12)) : 1;
        if (cracked && flicker < 0.5) continue; // scattered gaps while cracked
        const px = cx + Math.cos(ang) * shieldR;
        const py = cy + Math.sin(ang) * shieldR;
        const segSize = coreSize * 0.32 * (cracked ? 0.7 : 1);
        const alpha = cracked ? 0.35 : 0.75 + (pose.shield.hitStacks / 3) * 0.2;
        this.thornSpike(g, px, py, segSize * 1.6, segSize * 0.9, ang, ROSE_HOT, VIOLET, alpha);
      }
    }

    // The crack: a short hot line punched OUT along the hit direction —
    // the cluster visibly took the hit from a specific side.
    if (hitT > 0) {
      const len = coreSize * (2.4 + hitT * 1.4);
      g.lineStyle(2 * hitT, ROSE_HOT, hitT * 0.9);
      g.lineBetween(cx, cy, cx + this.hitDirX * len, cy + this.hitDirY * len);
    }

    // Sloughing motes: faint particles drifting off the silhouette, more
    // of them (and more of the time, for the boss rank) as cohesion drops
    // — the corrupted/unstable edge that never fully resolves.
    const moteN = Math.round(Phaser.Math.Linear(2, 8, 1 - cohesion) * (this.cfg.outerThorns > 0 ? 1.6 : 1));
    for (let i = 0; i < moteN; i++) {
      const ang = this.motePhase + (i / Math.max(1, moteN)) * Math.PI * 2;
      const dist = this.cfg.coreR * (2.6 + Math.sin(this.motePhase * 0.7 + i) * 0.6);
      const mx = cx + Math.cos(ang) * dist;
      const my = cy + Math.sin(ang) * dist - (1 - cohesion) * 6;
      g.fillStyle(VIOLET, 0.32 * (1 - cohesion) + 0.07);
      g.fillCircle(mx, my, 2.2);
    }

    // A real HP bar, on every rank — the cohesion-crumble above still
    // carries the moment-to-moment "I'm hurting it" read, but a fast fight
    // against several thorn-clusters at once needs an at-a-glance number
    // too. Estaphaios skips this: it already owns the big screen-space
    // boss bar (TutorialScene.drawBossHealthBar), and drawing both would
    // just be visual noise stacked on the same information.
    if (this.tier !== "estaphaios" && pose.health !== undefined && pose.maxHealth) {
      const barW = this.cfg.coreR * 2.6;
      const barH = 3.5;
      const barY = cy - this.cfg.coreR * (this.cfg.outerThorns > 0 ? 3.6 : 2.9);
      const barX = cx - barW / 2;
      g.fillStyle(0x0a0612, 0.7);
      g.fillRect(barX - 1.5, barY - 1.5, barW + 3, barH + 3);
      g.fillStyle(0x3a2a52, 0.85);
      g.fillRect(barX, barY, barW, barH);
      g.fillStyle(hpFrac > 0.35 ? COPPER : ROSE_HOT, 0.95);
      g.fillRect(barX, barY, barW * hpFrac, barH);
    }
  }

  /** One ring of thorns. Each thorn bristles independently — a fast
   *  snap-out then a slow settle, staggered per-index so the cluster reads
   *  as agitated rather than a synchronized machine. The thorn nearest the
   *  current aim angle is always drawn longer and sharper (the "it's
   *  looking at you" blade), brightest of all mid-discharge. */
  private drawRing(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    n: number,
    radiusMul: number,
    angleOffset: number,
    cohesion: number,
    hitT: number,
    fireT: number,
  ): void {
    for (let i = 0; i < n; i++) {
      const seed = hash01(i * 7 + radiusMul);
      const base = angleOffset + (i / n) * Math.PI * 2 + this.t * this.cfg.spin * (radiusMul > 1 ? -1 : 1);
      const drift = (1 - cohesion) * (Math.sin(this.t * 1.3 + i * 2.7) * 10);
      // Bristle envelope: fast rise (attack), slow exponential settle —
      // the actual motion signature of a flinch/strike, not a sine wave.
      const rate = this.cfg.aggression * (0.7 + seed * 0.6);
      const phase = ((this.t * rate + seed * 5) % 1 + 1) % 1;
      const bristle = phase < 0.12 ? phase / 0.12 : Math.exp(-(phase - 0.12) * 5.5);

      const r = this.cfg.coreR * (1.9 * radiusMul + drift * 0.05 + bristle * 0.9) + drift;
      const px = cx + Math.cos(base) * r;
      const py = cy + Math.sin(base) * r;

      const angDelta = Phaser.Math.Angle.Wrap(base - this.fireAngle);
      const isMaw = Math.abs(angDelta) < (Math.PI / n) * 1.05;
      const flare = isMaw ? fireT : 0;
      // The maw thorn stays visibly longer/sharper at all times, not just
      // on discharge — a permanent "raised blade toward the target" tell.
      const mawLen = isMaw ? 1.45 : 1;
      const size = this.cfg.coreR * (0.5 + bristle * 0.25) * mawLen * (1 + flare * 0.7);
      const spikeLen = size * (2.4 + bristle * 0.8 + flare * 1.2);
      this.thornSpike(
        g,
        px,
        py,
        spikeLen,
        size * 0.42,
        base + Math.PI,
        hitT > 0 || isMaw ? ROSE_HOT : COPPER,
        CORE_DARK,
        0.6 + hitT * 0.35 + flare * 0.4 + bristle * 0.15,
      );
    }
  }

  /** An asymmetric barbed spike — wide base tapering to a sharp point,
   *  slightly hooked — reads as a claw/thorn/weapon, not a gem facet. Used
   *  for both the radiating thorns AND (at a stubby aspect ratio) the
   *  core's own dark faceting, so the whole silhouette is one consistent
   *  vocabulary of sharp edges rather than a soft body with spiky bits
   *  stuck on. */
  private thornSpike(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    len: number,
    baseW: number,
    rot: number,
    edge: number,
    fill: number,
    alpha: number,
  ): void {
    const tip = { x: x + Math.cos(rot) * len, y: y + Math.sin(rot) * len };
    // Base is offset perpendicular to the spike axis, and asymmetric
    // (one side wider than the other) — a symmetric kite still reads as a
    // gem; the asymmetry is what breaks it into "claw."
    const perp = rot + Math.PI / 2;
    const b1 = { x: x + Math.cos(perp) * baseW, y: y + Math.sin(perp) * baseW };
    const b2 = { x: x - Math.cos(perp) * baseW * 0.62, y: y - Math.sin(perp) * baseW * 0.62 };
    // A slight hook: the tip is nudged off-axis toward the wider side.
    const hookedTip = {
      x: tip.x + Math.cos(perp) * baseW * 0.18,
      y: tip.y + Math.sin(perp) * baseW * 0.18,
    };
    g.fillStyle(fill, alpha * 0.85);
    g.beginPath();
    g.moveTo(hookedTip.x, hookedTip.y);
    g.lineTo(b1.x, b1.y);
    g.lineTo(x - Math.cos(rot) * baseW * 0.3, y - Math.sin(rot) * baseW * 0.3);
    g.lineTo(b2.x, b2.y);
    g.closePath();
    g.fillPath();
    g.lineStyle(1.4, edge, alpha);
    g.strokePath();
  }

  destroy(): void {
    this.g.destroy();
  }
}
