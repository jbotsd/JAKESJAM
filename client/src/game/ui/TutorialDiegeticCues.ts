// Diegetic teaching + narrative VFX for the Pretennoia tutorial — NOT a
// text-toast component. Ground glyphs, ring pulses, and brief Coptic
// glyph-flashes instead of "A/D — MOVE" style captions: the ground itself
// lights up where the player should walk, a ledge pulses brighter to invite
// a jump, the wall-jump shaft's three landing heights ignite in sequence for
// "The Three Forms." Any words that appear are short, spoken-invocation-
// style flashes (Coptic terms from the source text), never a required-
// reading instruction gate. Reuses the seal's own gold/teal palette
// (client/src/main.ts's liqGold/liqTeal gradient stops) so this reads as
// the SAME light language as the boot-ident, not a new UI system.
//
// This is a SOLO scene — no networked players, no shared combat particle
// budget to conserve — so the particle count here is deliberately generous
// (uses the shared hot-core/soft-halo glow texture directly, not the small
// fixed-size ParticlePool sized for 10-player matches). The narrative is
// meant to be carried entirely by this visual language: no exposition, the
// story reads through what the light DOES.

import Phaser from "phaser";
import { GLOW_TEXTURE_KEY, ensureGlowTexture } from "../render/glowTexture.js";

const GOLD_CORE = 0xffedb0;
const GOLD = 0xc9a84c;
const TEAL_CORE = 0xd8fff6;
const TEAL = 0x50e3c2;
const EMBER = 0xff9a3d;

type MoteOptions = {
  x: number;
  y: number;
  color: number;
  scale?: number;
  alpha?: number;
  driftX?: number;
  driftY?: number;
  spread?: number;
  ms: number;
  ease?: string;
  depth?: number;
  blend?: Phaser.BlendModes;
};

export class TutorialDiegeticCues {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly ambientTweens: Phaser.Tweens.Tween[] = [];
  private readonly texAvailable: boolean;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0);
    this.layer.setDepth(40); // above arena geometry, below HUD
    this.texAvailable = ensureGlowTexture(scene);
  }

  /** One glow mote: acquire, tween a random drift + fade, self-destroy. This
   *  is the atomic unit every richer effect below is built from — a single
   *  mote reads as a spark; a few dozen fired together read as a shower. */
  private mote(opts: MoteOptions): void {
    if (!this.texAvailable) return;
    const img = this.scene.add.image(opts.x, opts.y, GLOW_TEXTURE_KEY);
    img.setTint(opts.color);
    img.setBlendMode(opts.blend ?? Phaser.BlendModes.ADD);
    img.setDepth(opts.depth ?? 39);
    img.setScale(opts.scale ?? 0.3);
    img.setAlpha(0);
    this.layer.add(img);
    const spread = opts.spread ?? 0;
    const targetX = opts.x + (opts.driftX ?? 0) + (Math.random() - 0.5) * spread;
    const targetY = opts.y + (opts.driftY ?? 0) + (Math.random() - 0.5) * spread;
    this.scene.tweens.add({
      targets: img,
      x: targetX,
      y: targetY,
      scale: { from: (opts.scale ?? 0.3) * 0.4, to: (opts.scale ?? 0.3) },
      alpha: { from: 0, to: opts.alpha ?? 0.85 },
      duration: opts.ms * 0.28,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.scene.tweens.add({
          targets: img,
          alpha: 0,
          duration: opts.ms * 0.72,
          ease: opts.ease ?? "Sine.easeIn",
          onComplete: () => img.destroy(),
        });
      },
    });
  }

  /** A radial shower of `count` motes from one origin — the workhorse for
   *  every "something ignites/breaks/dissolves here" beat. */
  private shower(x: number, y: number, count: number, color: number, radius: number, ms: number, opts?: { rising?: boolean; scale?: number }): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = radius * (0.4 + Math.random() * 0.6);
      const driftX = Math.cos(angle) * dist;
      const driftY = Math.sin(angle) * dist - (opts?.rising ? radius * 0.4 : 0);
      this.mote({
        x,
        y,
        color,
        driftX,
        driftY,
        scale: (opts?.scale ?? 0.28) * (0.6 + Math.random() * 0.8),
        alpha: 0.7 + Math.random() * 0.3,
        ms: ms * (0.7 + Math.random() * 0.6),
      });
    }
  }

  /** Continuous ambient field — the vessel breathing. A sparse, slow rain of
   *  motes drifting upward across the whole arena for the entire scene
   *  lifetime, alternating gold/teal. Self-looping tweens, no per-frame
   *  update() needed. Call once from TutorialScene after the arena size is
   *  known. */
  startAmbient(worldW: number, worldH: number, count = 46): void {
    if (!this.texAvailable) return;
    for (let i = 0; i < count; i++) {
      const x0 = Math.random() * worldW;
      const y0 = worldH * (0.3 + Math.random() * 0.65);
      const color = i % 5 === 0 ? TEAL : GOLD;
      const img = this.scene.add.image(x0, y0, GLOW_TEXTURE_KEY);
      img.setTint(color);
      img.setBlendMode(Phaser.BlendModes.ADD);
      img.setDepth(15); // well behind the seal/hero — ambient bed, not foreground
      const scale = 0.08 + Math.random() * 0.16;
      img.setScale(scale);
      img.setAlpha(0);
      this.layer.add(img);
      const rise = 260 + Math.random() * 420;
      const sway = (Math.random() - 0.5) * 160;
      const dur = 5200 + Math.random() * 5200;
      const delay = Math.random() * dur;
      const tween = this.scene.tweens.add({
        targets: img,
        y: y0 - rise,
        x: x0 + sway,
        alpha: { from: 0, to: 0.35 + Math.random() * 0.25 },
        scale: { from: scale * 0.3, to: scale },
        duration: dur,
        delay,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
      this.ambientTweens.push(tween);
    }
  }

  /** A soft glowing path-light from (fromX) to (toX) along the floor,
   *  inviting forward movement — now with a light trail of embers kicked up
   *  along the invited path, not just a flat glow ellipse. */
  moveInvite(fromX: number, toX: number, floorY: number): void {
    const g = this.scene.add.graphics();
    g.setDepth(40);
    const width = toX - fromX;
    const midX = fromX + width / 2;
    g.fillStyle(GOLD, 0.22);
    g.fillEllipse(midX, floorY, Math.abs(width) * 1.05, 46);
    g.fillStyle(GOLD_CORE, 0.35);
    g.fillEllipse(midX, floorY, Math.abs(width) * 0.6, 20);
    this.layer.add(g);
    this.scene.tweens.add({
      targets: g,
      alpha: { from: 0, to: 1 },
      duration: 900,
      yoyo: true,
      hold: 5200,
      onComplete: () => g.destroy(),
    });
    // Embers strung along the path, staggered so they light up left-to-right
    // — a visible current running the direction the player should walk.
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = fromX + width * t;
      this.scene.time.delayedCall(t * 900, () => {
        this.mote({ x, y: floorY, color: EMBER, driftY: -30, scale: 0.22, alpha: 0.6, ms: 1400 });
      });
    }
  }

  /** A brightening ring pulse on a ledge, inviting a jump toward it, plus a
   *  small standing flicker of motes so the ledge reads as genuinely lit. */
  jumpInvite(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, 10, GOLD_CORE, 0);
    ring.setStrokeStyle(3, GOLD, 0.9);
    ring.setDepth(40);
    this.layer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      radius: 34,
      alpha: { from: 0.9, to: 0 },
      duration: 1400,
      repeat: 3,
      onComplete: () => ring.destroy(),
    });
    this.shower(x, y, 8, GOLD_CORE, 34, 1200, { rising: true, scale: 0.2 });
  }

  /** Short, vibrant flash of a Coptic invocation — center-screen-fixed
   *  (scroll-factor 0), brief, never blocking input. Per
   *  docs/visual-language-gnostic-vessel.md §5 ("untranslatable charge"),
   *  Coptic NEVER appears bare — glyph + Latin transliteration + a one-word
   *  English gloss, all on screen together (`glyph · translit · gloss`),
   *  same line/stack, so the mark stays legible rather than decorative
   *  mystery. A few motes drift off the glyph as it settles, so even the
   *  text reads as spoken light rather than typography. */
  copticFlash(text: string, translit: string, gloss: string): void {
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height * 0.3;
    const label = this.scene.add.text(cx, cy, text, {
      fontFamily: '"Noto Serif Display", "Noto Serif", serif',
      fontSize: "44px",
      color: "#ffedb0",
      align: "center",
    });
    label.setOrigin(0.5);
    label.setScrollFactor(0);
    label.setDepth(90);
    label.setAlpha(0);
    label.setScale(0.85);
    label.setShadow(0, 0, "#c9a84c", 18, true, true);
    this.layer.add(label);
    const sub = this.scene.add.text(cx, cy + 40, `${translit}  ·  ${gloss}`, {
      fontFamily: '"Noto Serif", serif',
      fontSize: "18px",
      color: "#c9a84c",
      align: "center",
      fontStyle: "italic",
    });
    sub.setOrigin(0.5);
    sub.setScrollFactor(0);
    sub.setDepth(90);
    sub.setAlpha(0);
    this.layer.add(sub);
    this.scene.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.85, to: 1 },
      duration: 260,
      ease: "Sine.easeOut",
      yoyo: true,
      hold: 900,
      onComplete: () => label.destroy(),
    });
    this.scene.tweens.add({
      targets: sub,
      alpha: { from: 0, to: 0.85 },
      duration: 340,
      delay: 120,
      ease: "Sine.easeOut",
      yoyo: true,
      hold: 780,
      onComplete: () => sub.destroy(),
    });
    if (this.texAvailable) {
      for (let i = 0; i < 10; i++) {
        const dx = (Math.random() - 0.5) * label.width;
        const img = this.scene.add.image(cx + dx, cy, GLOW_TEXTURE_KEY);
        img.setTint(GOLD_CORE);
        img.setBlendMode(Phaser.BlendModes.ADD);
        img.setScrollFactor(0);
        img.setDepth(89);
        img.setScale(0.12);
        img.setAlpha(0);
        this.layer.add(img);
        this.scene.tweens.add({
          targets: img,
          y: cy - 30 - Math.random() * 40,
          alpha: { from: 0, to: 0.7 },
          duration: 500,
          delay: 200 + Math.random() * 500,
          yoyo: true,
          onComplete: () => img.destroy(),
        });
      }
    }
  }

  /** Intro bookend: the boundary ring ignites shut overhead, sealing the
   *  entrance behind the player — a real implosion of light converging
   *  inward along the ring, not just a shrinking outline. Mirrors the
   *  outro's sealBreak() visually (same ring, opposite motion) so the two
   *  read as one gesture reversed. */
  sealClosing(centerX: number, centerY: number): void {
    const ring = this.scene.add.circle(centerX, centerY, 620, GOLD, 0);
    ring.setStrokeStyle(10, GOLD, 0.85);
    ring.setDepth(38);
    this.layer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      radius: 420,
      alpha: { from: 0.85, to: 0 },
      duration: 1600,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });
    // 28 motes converging from the ring's circumference inward — the
    // implosion that reads as "the boundary is closing."
    const n = 28;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const startX = centerX + Math.cos(angle) * 560;
      const startY = centerY + Math.sin(angle) * 560;
      const img = this.texAvailable ? this.scene.add.image(startX, startY, GLOW_TEXTURE_KEY) : null;
      if (!img) continue;
      img.setTint(i % 4 === 0 ? TEAL_CORE : GOLD_CORE);
      img.setBlendMode(Phaser.BlendModes.ADD);
      img.setDepth(38);
      img.setScale(0.22);
      img.setAlpha(0.8);
      this.layer.add(img);
      this.scene.tweens.add({
        targets: img,
        x: centerX,
        y: centerY,
        scale: 0.05,
        alpha: 0,
        duration: 1500 + Math.random() * 300,
        ease: "Cubic.easeIn",
        onComplete: () => img.destroy(),
      });
    }
  }

  /** Finale escalation (stage 1/2/3): the vessel visibly straining/cracking
   *  as the fight builds — rising stakes, not just a harder dummy. Particle
   *  density scales WITH the stage so stage 3 genuinely reads as the worst
   *  of it, not a repeat of stage 1. */
  sealCollapse(centerX: number, centerY: number, stage: 1 | 2 | 3): void {
    const intensity = stage / 3;
    const g = this.scene.add.graphics();
    g.setDepth(38);
    const jaggedRadius = 700 - stage * 60;
    g.lineStyle(4 + stage * 2, GOLD, 0.55 + intensity * 0.3);
    g.strokeCircle(centerX, centerY, jaggedRadius);
    this.layer.add(g);
    this.scene.cameras.main.shake(220 + stage * 80, 0.006 * stage);
    this.scene.tweens.add({
      targets: g,
      alpha: { from: 1, to: 0 },
      duration: 900,
      onComplete: () => g.destroy(),
    });
    this.shower(centerX, centerY, 10 * stage, stage === 3 ? EMBER : GOLD, 260 + stage * 70, 900 + stage * 150, { scale: 0.22 + stage * 0.04 });
  }

  /** An entity bursting into light. Color IS the story (coherence rule):
   *  TEAL (default) = a death — the stolen light is LIBERATED, rising home;
   *  VIOLET = an arrival — the realm manifesting one of its own. Same
   *  gesture, opposite meanings, told entirely by hue. */
  dummyDissolve(x: number, y: number, arrival = false): void {
    const core = arrival ? 0xc4b5fd : TEAL_CORE;
    const soft = arrival ? 0x8b6cf0 : TEAL;
    const burst = this.scene.add.circle(x, y, 8, core, 0.95);
    burst.setDepth(41);
    this.layer.add(burst);
    this.scene.tweens.add({
      targets: burst,
      radius: 160,
      alpha: { from: 0.95, to: 0 },
      duration: 700,
      ease: "Cubic.easeOut",
      onComplete: () => burst.destroy(),
    });
    this.shower(x, y, 34, core, 220, 1300, { rising: !arrival, scale: 0.3 });
    // A slower, dimmer second wave so the dissolve has real duration and
    // doesn't read as a single flat pop.
    this.scene.time.delayedCall(180, () => this.shower(x, y, 18, soft, 320, 1600, { rising: !arrival, scale: 0.22 }));
  }

  /** One of the three wall-jump-shaft ignition points ("The Three Forms") —
   *  a swirling gather of motes around the point, not just an expanding
   *  ring, so each Form reads as a small localized awakening. */
  shaftIgnite(x: number, y: number, form: 1 | 2 | 3): void {
    const color = form === 2 ? TEAL : GOLD;
    const core = form === 2 ? TEAL_CORE : GOLD_CORE;
    const ring = this.scene.add.circle(x, y, 14, core, 0.9);
    ring.setStrokeStyle(3, color, 1);
    ring.setDepth(40);
    this.layer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      radius: 46,
      alpha: { from: 0.9, to: 0.25 },
      duration: 800,
      ease: "Sine.easeOut",
    });
    if (!this.texAvailable) return;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const orbitR = 30 + Math.random() * 20;
      const img = this.scene.add.image(x + Math.cos(angle) * orbitR, y + Math.sin(angle) * orbitR, GLOW_TEXTURE_KEY);
      img.setTint(core);
      img.setBlendMode(Phaser.BlendModes.ADD);
      img.setDepth(40);
      img.setScale(0.16);
      img.setAlpha(0);
      this.layer.add(img);
      this.scene.tweens.add({
        targets: img,
        alpha: { from: 0, to: 0.75 },
        angle: 220,
        duration: 900,
        ease: "Sine.easeOut",
        onComplete: () => {
          this.scene.tweens.add({ targets: img, alpha: 0, duration: 500, onComplete: () => img.destroy() });
        },
      });
    }
  }

  /** Outro bookend: the seal breaks OPEN — the extraction payoff. Bright,
   *  fast, bursting outward (opposite motion of sealClosing), with a full
   *  screen-wide shower — this is the single biggest particle moment in the
   *  whole scene, matching "we get out" energy. */
  sealBreak(centerX: number, centerY: number): void {
    const ring = this.scene.add.circle(centerX, centerY, 60, GOLD_CORE, 0.95);
    ring.setStrokeStyle(14, GOLD, 1);
    ring.setDepth(95);
    ring.setScrollFactor(0);
    this.layer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      radius: 900,
      alpha: { from: 0.95, to: 0 },
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
    this.shower(centerX, centerY, 48, GOLD_CORE, 700, 1300, { scale: 0.42 });
    this.scene.time.delayedCall(120, () => this.shower(centerX, centerY, 24, TEAL_CORE, 500, 1500, { scale: 0.3 }));
  }

  destroy(): void {
    for (const t of this.ambientTweens) t.stop();
    this.ambientTweens.length = 0;
    this.layer.destroy(true);
  }
}
