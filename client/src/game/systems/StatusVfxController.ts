// Sim-authoritative status VFX driver. Reads burnUntilTick / freezeUntilTick
// / wardShellUntilTick / veilUntilTick from each player in the snapshot
// WorldState and spawns fire sparks / freeze shards / frost rings / ward
// rings / veil shrouds via a shared ParticlePool; hostile mark windows
// (facet/judgment/read — render/markReadPlan.ts) draw their hunter's
// instrument on the MARKED body; self-windows (counter/seal/tithe/measure/
// surge/vuln/jam/fooled/aegis/fangs — render/statusWindowPlan.ts) read at
// the fighter's own body for their whole duration. Lightning chain arcs come
// from `chain-hit` SimEvents; crimson leech threads from `emission-leech`
// (six-axes Drain — same arc language, re-tinted); the stride-refund feet
// sweep from `stride-refunded`. Wall-clock cadence is per-player so tab
// focus changes don't all spawn together. Legibility law (six-axes-goal.md):
// every axis effect gets a world-space read at its site.

import Phaser from "phaser";
import { ParticlePool, STATUS_VFX } from "./ParticlePool";
import { transientVfx } from "../render/TransientVfx";
import {
  makeVeilReadMemo,
  planVeilRead,
} from "../render/veilReadPlan";
import { planMarkReads, type MarkRead } from "../render/markReadPlan";
import { planStatusWindows, type WindowRead } from "../render/statusWindowPlan";
import { WARD_PEEL_RADIUS_PX } from "../../sim/combat.js";
import { KIN_AEGIS_SHARE_RADIUS_MULTIPLIER } from "../../sim/constants.js";
import type { PlayerId, SimEvent, Vec2, WorldState } from "../../sim";

const BURN_SPARK_INTERVAL_MS = 80;
const FREEZE_SHARD_INTERVAL_MS = 160;
const WARD_RING_INTERVAL_MS = 130;
const SLOW_RING_INTERVAL_MS = 220;
// Veil is stealth: the slowest cadence of the family — legible to a watching
// enemy without spotlighting the position beyond what fairness demands
// (six-axes doctrine #10; the audit's explicit design intent).
const VEIL_SHROUD_INTERVAL_MS = 300;

// Ward shell sapphire — the shield/EMIT resource family (matches the
// nameplate WARD chip in OnlineMatchScene's BUFF_DESCRIPTORS).
const WARD_COLOR = 0x38bdf8;
const SLOW_COLOR = 0x7dd3fc;
// Stride refund cyan — conjured-movement register (chassis color law: cyan =
// conjured combat), deliberately hotter than slow's pale drag-wake blue so
// the two feet-level reads never blur.
const STRIDE_COLOR = 0x67e8f9;
// Veil of Nought — white/negative-space register (the vessel "unmade", not a
// glow): a desaturated near-white outline, NOT any element or class tint.
const VEIL_COLOR = 0xe2e8f0;
const VEIL_SEAM_COLOR = 0xf8fafc;
const VEIL_SEAM_DURATION_MS = 170;
// Drain thread crimson — vampire register, deliberately NOT an element color.
const LEECH_COLOR = 0xdc2626;
const LEECH_GLOW = 0x7f1d1d;
const LEECH_THREAD_DURATION_MS = 260;

// Mark-window reads (Track L, render/markReadPlan.ts): the marked BODY
// wears its hunter's register for the whole window. Chassis color law
// (docs/chassis-design-axioms.md CA2): Geometrician and Interstice share
// conjured-cyan and are distinguished by SHAPE — facet = flat crystal
// chords, read = 45° blade slashes — while Kindled is gold (partial seal
// arc: an instrument orbiting the quarry, never a full halo ring —
// instrument-vs-icon test). Values mirror LightConstruct's canon tints
// (GEOMETRICIAN_TINT.glow / KINDLED_TINT.glow) and the read chip's cyan.
const MARK_FACET_COLOR = 0x35d6ff;
const MARK_JUDGMENT_COLOR = 0xffc24d;
const MARK_READ_COLOR = 0x67e8f9;
const MARK_READ_INTERVAL_MS = 240;
const MARK_ORBIT_RADIUS_PX = 17;
/** Slow precession so the mark reads as a held instrument, not a blast. */
const MARK_ORBIT_RAD_PER_MS = 0.0012;

// Self-window body reads (Track L, render/statusWindowPlan.ts). Colors
// follow each window's established register: chip colors for the debuff
// family (the chip becomes the supplement to the SAME hue in-world),
// class glows for class windows, the movement cyan for surge, drain
// crimson for tithe/fangs.
/** Void pierce streaks — ProjectileVfx's void core (pale violet), so the
 *  pass-through wears the element that did it. */
const PIERCE_COLOR = 0xd9c8ff;
const WINDOW_COUNTER_COLOR = 0xf59e0b; // amber — the armed answer
const WINDOW_SEAL_COLOR = 0xeab308; // gold — Kindled seal charge
const WINDOW_MEASURE_COLOR = 0x35d6ff; // GEO cyan — calibration
const WINDOW_VULN_COLOR = 0xfca5a5; // rose — cracked guard
const WINDOW_JAM_COLOR = 0xc084fc; // violet — jammed shield electronics
const WINDOW_FOOLED_COLOR = 0xff6ec7; // pink — the double's lie
const WINDOW_AEGIS_COLOR = 0xffc24d; // Kindled gold — shared ward reach
/** Resonance — PALETTE.sapphirePulse hand-copied (ui/palette.ts), the same
 *  class-agnostic "ability system" accent the RES chip and the action-bar
 *  ready-ping already use. Deliberately NOT a class color. */
const RESONANCE_COLOR = 0x6b98f4;
/** Aegis Share's painter draws the TRUE widened peel radius so the
 *  mechanic itself is the read (the audit's named gap: "the widened peel
 *  radius is never drawn"). */
const AEGIS_TRUE_RADIUS_PX = WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER;
const WINDOW_INTERVALS_MS: Record<WindowRead["kind"], number> = {
  counter: 90, // ~500ms window — must read instantly
  seal: 260,
  tithe: 220,
  measure: 240,
  surge: 150,
  vuln: 300,
  jam: 280,
  fooled: 320,
  aegis: 400, // big quiet instrument — slowest beat of the family
  fangs: 300,
  resonance: 350, // every cast opens one — must stay near-subliminal
};

const SPARK_DURATION_MS = 420;
const SHARD_DURATION_MS = 520;
const RING_DURATION_MS = 320;
const BOLT_DURATION_MS = 130;

const SPARK_HOT_CHANCE = 0.35;

export class StatusVfxController {
  private readonly pool: ParticlePool;
  private readonly burnCadence: Map<string, number> = new Map();
  private readonly freezeCadence: Map<string, number> = new Map();
  private readonly wardCadence: Map<string, number> = new Map();
  private readonly slowCadence: Map<string, number> = new Map();
  private readonly veilCadence: Map<string, number> = new Map();
  // Keyed `${targetId}:${kind}` — one cadence per mark on a body, so a
  // double-marked target keeps both instruments beating independently.
  private readonly markCadence: Map<string, number> = new Map();
  // Keyed `${playerId}:${kind}` — self-window reads (statusWindowPlan.ts).
  private readonly windowCadence: Map<string, number> = new Map();
  /** Accumulated wall-clock for orbit phase — marks precess with time. */
  private clockMs = 0;
  // Frame-diff memory for the veil break (planner-owned semantics —
  // render/veilReadPlan.ts documents why the definedness edge is sound).
  private readonly veilMemo = makeVeilReadMemo();

  constructor(_scene: Phaser.Scene, pool: ParticlePool) {
    // Scene is no longer held — transientVfx owns scene routing now.
    // Constructor signature preserved so callers don't need to
    // change. Remove the param + bump callers in a follow-up.
    this.pool = pool;
  }

  update(
    state: WorldState,
    events: readonly SimEvent[],
    deltaMs: number,
    getPosition: (id: PlayerId) => Vec2 | undefined,
  ): void {
    const seenBurn = new Set<string>();
    const seenFreeze = new Set<string>();
    const seenWard = new Set<string>();
    const seenSlow = new Set<string>();

    for (const [pidStr, player] of Object.entries(state.players)) {
      if (!player.alive) continue;
      const pid = pidStr as PlayerId;
      const pos = getPosition(pid);
      if (!pos) continue;

      if (player.burnUntilTick !== undefined && player.burnUntilTick > state.tick) {
        seenBurn.add(pidStr);
        const next = (this.burnCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= BURN_SPARK_INTERVAL_MS) {
          this.burnCadence.set(pidStr, 0);
          this.spawnBurnSpark(pos);
        } else {
          this.burnCadence.set(pidStr, next);
        }
      }

      if (player.freezeUntilTick !== undefined && player.freezeUntilTick > state.tick) {
        seenFreeze.add(pidStr);
        const next = (this.freezeCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= FREEZE_SHARD_INTERVAL_MS) {
          this.freezeCadence.set(pidStr, 0);
          this.spawnFreezeShard(pos);
          this.spawnFreezeShard(pos);
          this.spawnFrostRing(pos);
        } else {
          this.freezeCadence.set(pidStr, next);
        }
      }

      // Ward shell (six-axes Drain sibling — the Ward axis' post-cast damage
      // gate). Sapphire rings pulse around the vessel while the shell lives
      // so attackers can SEE why their damage halved.
      if (
        player.wardShellUntilTick !== undefined &&
        player.wardShellUntilTick > state.tick
      ) {
        seenWard.add(pidStr);
        const next = (this.wardCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= WARD_RING_INTERVAL_MS) {
          this.wardCadence.set(pidStr, 0);
          this.spawnWardRing(pos);
        } else {
          this.wardCadence.set(pidStr, next);
        }
      }

      // Slow is a movement-state change, so its world read hugs the feet.
      // Paired contracting rings form a non-colour-only "drag wake"; the HUD
      // chip and actual gait reduction supply the other feedback channels.
      if (player.slowedUntilTick !== undefined && player.slowedUntilTick > state.tick) {
        seenSlow.add(pidStr);
        const next = (this.slowCadence.get(pidStr) ?? SLOW_RING_INTERVAL_MS) + deltaMs;
        if (next >= SLOW_RING_INTERVAL_MS) {
          this.slowCadence.set(pidStr, 0);
          this.spawnSlowDragRing(pos, 0);
          this.spawnSlowDragRing(pos, Math.PI);
        } else {
          this.slowCadence.set(pidStr, next);
        }
      }
    }

    // Veil of Nought — the 1.5s unmade window and its break-on-firing
    // (Track L: was nameplate-only). While veiled: a quiet desaturated
    // outline-shroud at the body (white/negative-space register — the
    // vessel is unmade, so its EDGE goes ghostly; deliberately not a glow
    // and quieter than the ward rings, Veil is stealth). On break (the
    // sim clears veilUntilTick when the veiled player fires — no SimEvent
    // exists, so the pure planner frame-diffs the definedness edge): a
    // brief seam-snap dissolve as the vessel re-makes itself.
    const veilPlan = planVeilRead(state, getPosition, this.veilMemo);
    const seenVeil = new Set<string>();
    for (const shroud of veilPlan.shrouds) {
      seenVeil.add(shroud.id);
      const next = (this.veilCadence.get(shroud.id) ?? VEIL_SHROUD_INTERVAL_MS) + deltaMs;
      if (next >= VEIL_SHROUD_INTERVAL_MS) {
        this.veilCadence.set(shroud.id, 0);
        this.spawnVeilShroud(shroud.pos, shroud.intensity);
      } else {
        this.veilCadence.set(shroud.id, next);
      }
    }
    for (const brk of veilPlan.breaks) {
      this.spawnVeilBreakSeam(brk.pos);
    }

    // Mark windows (Track L, render/markReadPlan.ts): the marked body wears
    // its hunter's instrument for the whole window — facet chords /
    // judgment arc / read slashes — so a watching enemy can see who is
    // primed for amplified punishment BEFORE the payoff hit lands
    // (doctrine #10; the payoff flourish already reads via
    // ConstructVfxController's empowered-hit pass).
    this.clockMs += deltaMs;
    const markPlan = planMarkReads(state, getPosition);
    const seenMark = new Set<string>();
    for (const mark of markPlan) {
      const key = `${mark.targetId}:${mark.kind}`;
      seenMark.add(key);
      const next = (this.markCadence.get(key) ?? MARK_READ_INTERVAL_MS) + deltaMs;
      if (next >= MARK_READ_INTERVAL_MS) {
        this.markCadence.set(key, 0);
        this.spawnMarkRead(mark);
      } else {
        this.markCadence.set(key, next);
      }
    }
    for (const key of this.markCadence.keys()) {
      if (!seenMark.has(key)) this.markCadence.delete(key);
    }

    // Self-window body reads (Track L, render/statusWindowPlan.ts): armed
    // stances, amp windows, and debuffs that were nameplate-chip-only (or
    // invisible everywhere, like Measure) now read at the fighter's body
    // for their whole window, with an expiry fade.
    const windowPlan = planStatusWindows(state, getPosition);
    const seenWindow = new Set<string>();
    for (const win of windowPlan) {
      const key = `${win.id}:${win.kind}`;
      seenWindow.add(key);
      const interval = WINDOW_INTERVALS_MS[win.kind];
      const next = (this.windowCadence.get(key) ?? interval) + deltaMs;
      if (next >= interval) {
        this.windowCadence.set(key, 0);
        this.spawnWindowRead(win);
      } else {
        this.windowCadence.set(key, next);
      }
    }
    for (const key of this.windowCadence.keys()) {
      if (!seenWindow.has(key)) this.windowCadence.delete(key);
    }

    // Drop cadence entries for players that no longer have an active status.
    for (const key of this.burnCadence.keys()) {
      if (!seenBurn.has(key)) this.burnCadence.delete(key);
    }
    for (const key of this.freezeCadence.keys()) {
      if (!seenFreeze.has(key)) this.freezeCadence.delete(key);
    }
    for (const key of this.wardCadence.keys()) {
      if (!seenWard.has(key)) this.wardCadence.delete(key);
    }
    for (const key of this.slowCadence.keys()) {
      if (!seenSlow.has(key)) this.slowCadence.delete(key);
    }
    for (const key of this.veilCadence.keys()) {
      if (!seenVeil.has(key)) this.veilCadence.delete(key);
    }

    for (const ev of events) {
      if (ev.t === "chain-hit") {
        this.spawnLightningChainArc(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
      if (ev.t === "emission-leech") {
        this.spawnLeechThread(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
      if (ev.t === "stride-refunded") {
        this.spawnStrideRefundSweep({ x: ev.x, y: ev.y });
      }
      if (ev.t === "shield-refunded") {
        this.spawnShieldRefundSnap({ x: ev.x, y: ev.y });
      }
      if (ev.t === "contagion-jump") {
        this.spawnContagionArc(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
      if (ev.t === "resonance-triggered") {
        this.spawnResonanceGlyph({ x: ev.x, y: ev.y });
      }
      if (ev.t === "hit-confirmed" && (ev.amped === true || ev.pierced === true)) {
        const pos = getPosition(ev.victimId);
        if (pos) {
          if (ev.amped === true) this.spawnAmpPunishBurst(pos);
          if (ev.pierced === true) this.spawnPierceSeam(pos);
        }
      }
    }
  }

  destroy(): void {
    this.burnCadence.clear();
    this.freezeCadence.clear();
    this.wardCadence.clear();
    this.slowCadence.clear();
    this.veilCadence.clear();
    this.markCadence.clear();
    this.windowCadence.clear();
    this.veilMemo.wasLive.clear();
  }

  /** One self-window beat at the fighter's own body. Every painter is a
   *  short-lived pooled transient (never per-frame pool churn), quiet by
   *  construction, and distinct by geometry + register, not hue alone. */
  private spawnWindowRead(win: WindowRead): void {
    switch (win.kind) {
      case "counter":
        this.spawnCounterStanceTicks(win.pos, win.intensity);
        break;
      case "seal":
        this.spawnSealDiamond(win.pos, win.intensity);
        break;
      case "tithe":
        this.spawnTitheHungerTicks(win.pos, win.intensity);
        break;
      case "measure":
        this.spawnMeasureCalipers(win.pos, win.intensity);
        break;
      case "surge":
        this.spawnSurgeStreaks(win.pos, win.intensity, win.vxSign);
        break;
      case "vuln":
        this.spawnVulnCrack(win.pos, win.intensity);
        break;
      case "jam":
        this.spawnJamSputter(win.pos, win.intensity);
        break;
      case "fooled":
        this.spawnFooledDouble(win.pos, win.intensity);
        break;
      case "aegis":
        this.spawnAegisReachRing(win.pos, win.intensity);
        break;
      case "fangs":
        this.spawnFangPips(win.pos, win.intensity, win.count);
        break;
      case "resonance":
        this.spawnResonanceWindowTick(win.pos, win.intensity);
        break;
    }
  }

  /** Resonance's 2s chain window (opened by EVERY cast, so it must be the
   *  quietest read of the family): a single small sapphire tick orbiting
   *  the body — "the system is listening for an unlike ability". */
  private spawnResonanceWindowTick(position: Vec2, intensity: number): void {
    const spark = this.pool.acquireSpark();
    if (!spark) return;
    const angle = this.clockMs * MARK_ORBIT_RAD_PER_MS * 1.6;
    const sx = position.x + Math.cos(angle) * 15;
    const sy = position.y - 6 + Math.sin(angle) * 15;
    spark.setPosition(sx, sy);
    spark.setFillStyle(RESONANCE_COLOR, 0.4 * intensity);
    spark.setRotation(angle); // tangent — orbiting, not radiating
    spark.setScale(0.5, 0.9);
    spark.setAlpha(0.4 * intensity);
    transientVfx.spawn({
      factory: () => spark,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 0.4 * intensity,
      ease: "Sine.easeOut",
      release: () => this.pool.release(spark),
    });
  }

  /** Resonance consumed (`resonance-triggered` — an UNLIKE ability cast
   *  inside the window): two linked sapphire rings expanding at the cast
   *  site — the chain, drawn. Closes the registry's own recorded gap
   *  ("audio/camera only, no draw call at the fighter"). */
  private spawnResonanceGlyph(position: Vec2): void {
    for (let i = 0; i < 2; i++) {
      const ring = this.pool.acquireRing();
      if (!ring) break;
      const side = i === 0 ? -1 : 1;
      ring.setPosition(position.x + side * 5, position.y - 8);
      ring.setFillStyle(RESONANCE_COLOR, 0);
      ring.setStrokeStyle(1.8, RESONANCE_COLOR, 0.7);
      ring.setScale(0.35);
      ring.setAlpha(1);
      transientVfx.spawn({
        factory: () => ring,
        lifetimeMs: 240,
        startAlpha: 1,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const r = obj as Phaser.GameObjects.Arc;
          const s = 0.35 + 0.45 * t;
          r.setScale(s, s);
          // The pair drifts slightly apart — two links, one chain.
          r.x = position.x + side * (5 + 3 * t);
        },
        release: () => this.pool.release(ring),
      });
    }
  }

  /** Contagion's jump (`contagion-jump` — the burn copying to its next
   *  host): a sagging fire-tinted thread from the burning source to the
   *  fresh target — the leech thread's drawn-curve geometry in the burn
   *  register (a curse crawling, NOT lightning's jitter strike), ending
   *  exactly where the state-driven burn sparks will begin. */
  private spawnContagionArc(from: Vec2, to: Vec2): void {
    const graphics = this.pool.acquireBolt();
    if (!graphics) return;
    graphics.setPosition(0, 0);
    graphics.setAlpha(1);
    graphics.setScale(1);
    graphics.setRotation(0);
    graphics.setBlendMode(Phaser.BlendModes.ADD);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    const sag = len * 0.14;
    const pts: Vec2[] = [
      from,
      { x: from.x + dx * 0.5 + px * sag, y: from.y + dy * 0.5 + py * sag },
      to,
    ];

    graphics.lineStyle(4, STATUS_VFX.fire.color, 0.3);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    graphics.lineStyle(1.5, STATUS_VFX.fire.hotColor, 0.9);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: LEECH_THREAD_DURATION_MS + 40,
      ease: "Sine.easeOut",
      release: () => this.pool.release(graphics),
    });
  }

  /** Severing Answer's armed stance: paired amber pincer ticks cocked
   *  INWARD at chest height — a trap set, visible to whoever is about to
   *  shoot into it. Fast cadence; the whole window is only ~500ms. */
  private spawnCounterStanceTicks(position: Vec2, intensity: number): void {
    const cy = position.y - 8;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const side = i === 0 ? -1 : 1;
      const startX = position.x + side * 15;
      spark.setPosition(startX, cy);
      spark.setFillStyle(WINDOW_COUNTER_COLOR, 0.75 * intensity);
      spark.setRotation(side * 0.6); // angled arms of the pincer
      spark.setScale(0.7, 1.3);
      spark.setAlpha(0.75 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: 160,
        startAlpha: 0.75 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.x = startX - side * 4 * t; // cocking inward — a closing trap
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Unbroken Seal's armed window: four gold ticks forming a diamond
   *  outline around the chest (crystal/diamond grammar — the Kindled
   *  identity shape), contracting slightly. The next Kindled Edge hit is
   *  amped; the enemy can see the seal charged on the vessel. */
  private spawnSealDiamond(position: Vec2, intensity: number): void {
    const cy = position.y - 8;
    const r = 15;
    for (let i = 0; i < 4; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const angle = (i * Math.PI) / 2; // N/E/S/W diamond vertices
      const sx = position.x + Math.cos(angle) * r;
      const sy = cy + Math.sin(angle) * r;
      spark.setPosition(sx, sy);
      spark.setFillStyle(WINDOW_SEAL_COLOR, 0.5 * intensity);
      // Lie along the diamond's edges, not point at the body — an outline,
      // not rays.
      spark.setRotation(angle + Math.PI / 4);
      spark.setScale(0.6, 1.2);
      spark.setAlpha(0.5 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.5 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          const contract = 1 - 0.18 * t; // the seal tightening, armed
          s.x = position.x + Math.cos(angle) * r * contract;
          s.y = cy + Math.sin(angle) * r * contract;
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Crimson Tithe's live window: paired crimson ticks spiralling INWARD
   *  into the body — hunger drawing matter in (drain register; the leech
   *  THREAD on each landed hit stays the payoff read). */
  private spawnTitheHungerTicks(position: Vec2, intensity: number): void {
    const cy = position.y - 6;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const angle = Math.random() * Math.PI * 2;
      const r0 = 20;
      spark.setPosition(position.x + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
      spark.setFillStyle(LEECH_COLOR, 0.6 * intensity);
      spark.setRotation(angle); // tangent — orbiting as it falls in
      spark.setScale(0.6, 1.1);
      spark.setAlpha(0.6 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.6 * intensity,
        ease: "Sine.easeIn", // accelerates into the body — a pull, not a drift
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          const r = r0 * (1 - 0.6 * t);
          const a = angle + 0.9 * t; // spiral, not a straight fall
          s.x = position.x + Math.cos(a) * r;
          s.y = cy + Math.sin(a) * r;
          s.setRotation(a);
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Measure's perfect-accuracy window (previously invisible to EVERYONE
   *  including the caster): two thin cyan caliper ticks at eye level
   *  converging toward the head — calibration closing to zero spread. */
  private spawnMeasureCalipers(position: Vec2, intensity: number): void {
    const cy = position.y - 12;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const side = i === 0 ? -1 : 1;
      const startX = position.x + side * 17;
      spark.setPosition(startX, cy);
      spark.setFillStyle(WINDOW_MEASURE_COLOR, 0.55 * intensity);
      spark.setRotation(Math.PI / 2); // long axis horizontal — a sight line
      spark.setScale(0.5, 1.1);
      spark.setAlpha(0.55 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.55 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.x = startX - side * 8 * t; // calipers closing on the mark
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Speed surge (stride surge / any speedBoostUntilTick): horizontal
   *  streaks trailing BEHIND the mover at body height — the movement
   *  register's hotter cyan (stride family), read distinct from the
   *  foot-level slow/stride rings. Stationary fighters streak both sides. */
  private spawnSurgeStreaks(position: Vec2, intensity: number, vxSign: -1 | 0 | 1): void {
    const sides: ReadonlyArray<-1 | 1> = vxSign === 0 ? [-1, 1] : [vxSign === 1 ? -1 : 1];
    for (const side of sides) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const startX = position.x + side * 10;
      const sy = position.y - 4 + (Math.random() - 0.5) * 10;
      spark.setPosition(startX, sy);
      spark.setFillStyle(STRIDE_COLOR, 0.5 * intensity);
      spark.setRotation(Math.PI / 2); // horizontal — motion lines
      spark.setScale(0.5, 1.6);
      spark.setAlpha(0.5 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: 220,
        startAlpha: 0.5 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.x = startX + side * 14 * t; // peeling off behind the mover
          s.setScale(0.5, 1.6 + 1.2 * t); // stretching as it sheds
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Vulnerability: a small rose CRACK — two crossed ticks at a point on
   *  the body's edge (the guard is split open; radiant amp will exploit
   *  it). Distinct from burn's rising sparks by being static + crossed. */
  private spawnVulnCrack(position: Vec2, intensity: number): void {
    const angle = Math.random() * Math.PI * 2;
    const cx = position.x + Math.cos(angle) * 13;
    const cy = position.y - 6 + Math.sin(angle) * 13;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      spark.setPosition(cx, cy);
      spark.setFillStyle(WINDOW_VULN_COLOR, 0.55 * intensity);
      spark.setRotation(i === 0 ? Math.PI / 4 : -Math.PI / 4); // the X of a crack
      spark.setScale(0.5, 1.0);
      spark.setAlpha(0.55 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.55 * intensity,
        ease: "Sine.easeOut",
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Block Jammer: violet sputter ticks fizzing at the body — the shield
   *  electronics shorting. Explains both the silently-popped shield and
   *  every dead block press while the jam lasts. */
  private spawnJamSputter(position: Vec2, intensity: number): void {
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const sx = position.x + (Math.random() - 0.5) * 24;
      const sy = position.y - 4 + (Math.random() - 0.5) * 18;
      spark.setPosition(sx, sy);
      spark.setFillStyle(WINDOW_JAM_COLOR, 0.6 * intensity);
      spark.setRotation(Math.random() * Math.PI); // sputter, no orientation
      spark.setScale(0.5, 0.8);
      spark.setAlpha(0.6 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: 150, // electrical — short, snappy pips
        startAlpha: 0.6 * intensity,
        ease: "Sine.easeIn",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.setScale(0.5 * (1 - 0.5 * t), 0.8 * (1 + 0.6 * t));
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Fooled: a pink offset "double" of the body's outline, displaced a few
   *  px to one side — the read on this fighter is a lie, and every hit on
   *  them is amped while it lasts. Alternates sides per beat. */
  private spawnFooledDouble(position: Vec2, intensity: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    ring.setPosition(position.x + side * 6, position.y - 6);
    ring.setFillStyle(WINDOW_FOOLED_COLOR, 0);
    ring.setStrokeStyle(1.4, WINDOW_FOOLED_COLOR, 0.3 * intensity);
    ring.setScale(0.95, 1.18); // the body-hugging silhouette (veil's ellipse)
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        r.x = position.x + side * (6 + 4 * t); // the double sliding away
      },
      release: () => this.pool.release(ring),
    });
  }

  /** Aegis Share: a thin gold ring at the TRUE widened peel radius — the
   *  mechanic drawn honestly, so allies know where protection reaches and
   *  enemies know which ground is contested (the audit's named gap). Very
   *  low alpha + slow beat: an instrument line, not a dome effect. */
  private spawnAegisReachRing(position: Vec2, intensity: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y - 6);
    ring.setFillStyle(WINDOW_AEGIS_COLOR, 0);
    ring.setStrokeStyle(1.2, WINDOW_AEGIS_COLOR, 0.16 * intensity);
    const scale = AEGIS_TRUE_RADIUS_PX / 18; // pool ring base radius is 18px
    ring.setScale(scale * 0.985);
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: 380,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = scale * (0.985 + 0.03 * t); // a breath at true radius
        r.setScale(s, s);
      },
      release: () => this.pool.release(ring),
    });
  }

  /** Shield charge instantly restored (`shield-refunded` — Return Glass /
   *  Bastion Pulse / Plant Charge's landing tick): a fast sapphire ring
   *  SNAPPING onto the body plus one rising charge tick. Same hue as the
   *  ward-shell family (it refills the same sapphire bar) but read-distinct
   *  by tempo — a single quick snap-in vs the shell's slow steady pulse. */
  private spawnShieldRefundSnap(position: Vec2): void {
    const ring = this.pool.acquireRing();
    if (ring) {
      ring.setPosition(position.x, position.y - 6);
      ring.setFillStyle(WARD_COLOR, 0);
      ring.setStrokeStyle(2.4, WARD_COLOR, 0.8);
      ring.setScale(1.7);
      ring.setAlpha(1);
      transientVfx.spawn({
        factory: () => ring,
        lifetimeMs: 200, // the snap — much faster than the shell pulse
        startAlpha: 1,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const r = obj as Phaser.GameObjects.Arc;
          const s = 1.7 - 0.75 * t;
          r.setScale(s, s);
        },
        release: () => this.pool.release(ring),
      });
    }
    const spark = this.pool.acquireSpark();
    if (!spark) return;
    const startY = position.y + 4;
    spark.setPosition(position.x, startY);
    spark.setFillStyle(WARD_COLOR, 0.85);
    spark.setRotation(0); // upright — charge climbing back into the bar
    spark.setScale(0.7, 1.2);
    spark.setAlpha(0.85);
    transientVfx.spawn({
      factory: () => spark,
      lifetimeMs: 260,
      startAlpha: 0.85,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.y = startY - 26 * t;
        s.setScale(0.7, 1.2 + 0.5 * t);
      },
      release: () => this.pool.release(spark),
    });
  }

  /** Victim-state amp consumed (`hit-confirmed` with `amped` — radiant
   *  punish vs a statused target, or the Fooled debuff): a rose crack-burst
   *  at the victim, four radial ticks splitting outward from the body —
   *  the cracked guard (vuln/fooled family hue) being exploited. Rides on
   *  top of the generic hit presentation, which stays the lead. */
  private spawnAmpPunishBurst(position: Vec2): void {
    const cy = position.y - 6;
    for (let i = 0; i < 4; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const angle = Math.PI / 4 + (i * Math.PI) / 2; // X arms, not a cross
      const r0 = 8;
      spark.setPosition(position.x + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
      spark.setFillStyle(WINDOW_VULN_COLOR, 0.8);
      spark.setRotation(angle - Math.PI / 2); // long axis radial — a split
      spark.setScale(0.6, 1.2);
      spark.setAlpha(0.8);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: 220,
        startAlpha: 0.8,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          const r = r0 + 14 * t;
          s.x = position.x + Math.cos(angle) * r;
          s.y = cy + Math.sin(angle) * r;
          s.setScale(0.6, 1.2 + 0.5 * t);
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Void pierce (`hit-confirmed` with `pierced` — the shard went straight
   *  THROUGH a held shield): pale-violet pass-through streaks crossing the
   *  body plus one sapphire tick dropping away — the shield visibly
   *  failing, so the counter-pick moment reads for both players instead of
   *  looking like a bug. */
  private spawnPierceSeam(position: Vec2): void {
    const cy = position.y - 6;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const startX = position.x - 16 + i * 6;
      const sy = cy + (i === 0 ? -3 : 3);
      spark.setPosition(startX, sy);
      spark.setFillStyle(PIERCE_COLOR, 0.85);
      spark.setRotation(Math.PI / 2); // horizontal — travel through the body
      spark.setScale(0.5, 1.6);
      spark.setAlpha(0.85);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: 180,
        startAlpha: 0.85,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.x = startX + 32 * t; // in one side, out the other
        },
        release: () => this.pool.release(spark),
      });
    }
    const tick = this.pool.acquireSpark();
    if (!tick) return;
    tick.setPosition(position.x + 6, cy);
    tick.setFillStyle(WARD_COLOR, 0.7);
    tick.setRotation(0.4);
    tick.setScale(0.6, 1.0);
    tick.setAlpha(0.7);
    transientVfx.spawn({
      factory: () => tick,
      lifetimeMs: 240,
      startAlpha: 0.7,
      ease: "Sine.easeIn",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.y = cy + 18 * t; // the guard falling away
        s.setRotation(0.4 + 0.8 * t);
      },
      release: () => this.pool.release(tick),
    });
  }

  /** Stolen Fangs' banked lock charges: one small crimson fang tick per
   *  charge hanging at the shoulders, pointed inward — the vampire lane's
   *  register (leech crimson), visibly counting 1 or 2. */
  private spawnFangPips(position: Vec2, intensity: number, count: number): void {
    const pips = Math.max(1, Math.min(2, count));
    for (let i = 0; i < pips; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const side = i === 0 ? -1 : 1;
      const sx = position.x + side * 13;
      const sy = position.y - 16;
      spark.setPosition(sx, sy);
      spark.setFillStyle(LEECH_COLOR, 0.7 * intensity);
      spark.setRotation(side * 0.35); // fangs angled toward the body
      spark.setScale(0.5, 1.0);
      spark.setAlpha(0.7 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.7 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.y = sy + 3 * t; // a slight sink — a fang settling in
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** One mark beat at the marked body. Stacked marks offset their orbit
   *  phase (stackIndex) so a double-marked target reads as two distinct
   *  instruments, not one smeared glow. */
  private spawnMarkRead(mark: MarkRead): void {
    const phase =
      this.clockMs * MARK_ORBIT_RAD_PER_MS + mark.stackIndex * (Math.PI / 3);
    switch (mark.kind) {
      case "facet":
        this.spawnFacetMarkChords(mark.pos, mark.intensity, phase);
        break;
      case "judgment":
        this.spawnJudgmentMarkArc(mark.pos, mark.intensity, phase);
        break;
      case "read":
        this.spawnReadMarkSlashes(mark.pos, mark.intensity, phase);
        break;
    }
  }

  /** Facet Break mark: three flat crystal CHORDS precessing around the
   *  body (crystal/diamond grammar — the target is being faceted for the
   *  break). Geometrician cyan; shape, not hue, separates it from the
   *  Interstice read slashes per CA2. */
  private spawnFacetMarkChords(position: Vec2, intensity: number, phase: number): void {
    const cy = position.y - 6;
    for (let i = 0; i < 3; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const angle = phase + (i * Math.PI * 2) / 3;
      const sx = position.x + Math.cos(angle) * MARK_ORBIT_RADIUS_PX;
      const sy = cy + Math.sin(angle) * MARK_ORBIT_RADIUS_PX;
      spark.setPosition(sx, sy);
      spark.setFillStyle(MARK_FACET_COLOR, 0.55 * intensity);
      // Long axis tangent to the orbit — a chord lying flat on the facet,
      // not a ray shooting off it (instrument, not blast).
      spark.setRotation(angle);
      spark.setScale(0.7, 1.5);
      spark.setAlpha(0.55 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.55 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          const drift = 1 + 0.12 * t; // a slight outward breath, then gone
          s.x = position.x + Math.cos(angle) * MARK_ORBIT_RADIUS_PX * drift;
          s.y = cy + Math.sin(angle) * MARK_ORBIT_RADIUS_PX * drift;
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Judgment Line mark: ONE partial gold arc orbiting the quarry,
   *  contracting slightly as it fades — a seal instrument closing, never a
   *  full halo ring (instrument-vs-icon hard line). Single pooled ring per
   *  beat keeps the ring budget honest. */
  private spawnJudgmentMarkArc(position: Vec2, intensity: number, phase: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    const startDeg = ((phase * 180) / Math.PI) % 360;
    ring.setPosition(position.x, position.y - 6);
    ring.setFillStyle(MARK_JUDGMENT_COLOR, 0);
    ring.setStrokeStyle(1.8, MARK_JUDGMENT_COLOR, 0.5 * intensity);
    ring.setStartAngle(startDeg);
    ring.setEndAngle(startDeg + 80);
    ring.setScale(1.22);
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1.22 - 0.17 * t; // the seal tightening on the marked body
        r.setScale(s, s);
      },
      release: () => {
        // The pool shares full-circle rings (ward/frost/veil) — restore the
        // arc before returning it so the next acquirer draws a whole ring.
        ring.setStartAngle(0);
        ring.setEndAngle(360);
        this.pool.release(ring);
      },
    });
  }

  /** Read Mark (and Razor Route's silent dash-cross tag — same fields):
   *  paired 45° blade slashes at opposite shoulders of the orbit, drifting
   *  up like a cut being read. Interstice cyan; the fixed slash angle is
   *  the blade grammar that separates it from facet's flat chords. */
  private spawnReadMarkSlashes(position: Vec2, intensity: number, phase: number): void {
    const cy = position.y - 6;
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const angle = phase + i * Math.PI;
      const sx = position.x + Math.cos(angle) * (MARK_ORBIT_RADIUS_PX - 1);
      const sy = cy + Math.sin(angle) * (MARK_ORBIT_RADIUS_PX - 1);
      spark.setPosition(sx, sy);
      spark.setFillStyle(MARK_READ_COLOR, 0.6 * intensity);
      spark.setRotation(-Math.PI / 4); // the slash angle, always
      spark.setScale(0.6, 1.3);
      spark.setAlpha(0.6 * intensity);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.6 * intensity,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.x = sx;
          s.y = sy - 6 * t; // reading upward along the body
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  /** Veil-of-Nought presence read: a thin desaturated near-white outline
   *  ellipse hugging the body's silhouette, easing slightly INWARD as it
   *  dissolves — the vessel's edge going ghostly, not an aura leaving it.
   *  Quieter than every other family member by construction: thinnest
   *  stroke, lowest alpha, slowest cadence (Veil is stealth; doctrine #10
   *  only demands an observer CAN tell, not a spotlight). `intensity`
   *  fades over the window's final 300ms so expiry reads too. */
  private spawnVeilShroud(position: Vec2, intensity: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y - 6);
    ring.setFillStyle(VEIL_COLOR, 0);
    ring.setStrokeStyle(1.4, VEIL_COLOR, 0.3 * intensity);
    // Body-hugging ellipse (vs the ward's larger circle): 18px pool ring
    // scaled to the vessel's rough silhouette.
    ring.setScale(0.95, 1.18);
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS + 120,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1 - 0.08 * t; // dissolve inward — unmade, not radiating
        r.setScale(0.95 * s, 1.18 * s);
      },
      release: () => this.pool.release(ring),
    });
  }

  /** Veil break (fired while unmade): a seam-snap dissolve — a crisp
   *  horizontal seam flashes across the body and parts by a couple px as
   *  the veil tears. One-shot pooled bolt (same one-shot budget as the
   *  leech thread / chain arc); brief and white, no glow bloom. */
  private spawnVeilBreakSeam(position: Vec2): void {
    const graphics = this.pool.acquireBolt();
    if (!graphics) return;
    graphics.setPosition(0, 0);
    graphics.setAlpha(1);
    graphics.setScale(1);
    graphics.setRotation(0);
    graphics.setBlendMode(Phaser.BlendModes.ADD);
    const cx = position.x;
    const cy = position.y - 6;
    const draw = (t: number): void => {
      graphics.clear();
      const fade = 1 - t;
      const reach = 8 + 16 * t; // snap outward from the center
      const part = 1.5 + 2.5 * t; // the two halves parting
      graphics.lineStyle(1.4, VEIL_SEAM_COLOR, 0.85 * fade);
      graphics.beginPath();
      graphics.moveTo(cx - reach, cy);
      graphics.lineTo(cx + reach, cy);
      graphics.strokePath();
      graphics.lineStyle(1, VEIL_COLOR, 0.4 * fade);
      graphics.beginPath();
      graphics.moveTo(cx - reach * 0.7, cy + part);
      graphics.lineTo(cx + reach * 0.7, cy + part);
      graphics.strokePath();
    };
    draw(0);
    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: VEIL_SEAM_DURATION_MS,
      ease: "Sine.easeOut",
      onTick: (_obj, t) => draw(t),
      release: () => this.pool.release(graphics),
    });
  }

  /** Stride-refund site read (six-axes Layer 1, `stride-refunded`): spent
   *  air movement just came back, so the read is MOVEMENT-registered — an
   *  upward-sweeping pair of flattened rings rising from the feet up the
   *  body (the exact inversion of slow's inward-dragging foot wake), plus
   *  two rising tick sparks. One-shot pooled transients; deliberately not
   *  the generic emission-cast seal flash, which is axis-blind. */
  private spawnStrideRefundSweep(position: Vec2): void {
    const feetY = position.y + 13;
    for (let i = 0; i < 2; i++) {
      const ring = this.pool.acquireRing();
      if (!ring) break;
      // Second ring starts tighter and rises further — a double-beat sweep.
      const startScale = i === 0 ? 0.95 : 0.7;
      const riseTo = i === 0 ? 30 : 44;
      ring.setPosition(position.x, feetY);
      ring.setFillStyle(STRIDE_COLOR, 0);
      ring.setStrokeStyle(2, STRIDE_COLOR, 0.7);
      ring.setScale(startScale, 0.34);
      ring.setAlpha(1);
      transientVfx.spawn({
        factory: () => ring,
        lifetimeMs: RING_DURATION_MS + i * 70,
        startAlpha: 1,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const r = obj as Phaser.GameObjects.Arc;
          r.y = feetY - riseTo * t;
          // Hug the body as it rises — a sweep along the vessel, not a blast.
          r.setScale(startScale * (1 - 0.35 * t), 0.34 * (1 - 0.3 * t));
        },
        release: () => this.pool.release(ring),
      });
    }
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const side = i === 0 ? -1 : 1;
      const startX = position.x + side * 10;
      spark.setPosition(startX, feetY);
      spark.setFillStyle(STRIDE_COLOR, 0.85);
      spark.setRotation(0); // upright tick — a rising line, not debris
      spark.setScale(1);
      spark.setAlpha(0.85);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.85,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.y = feetY - 36 * t;
          s.x = startX + side * 3 * t;
          s.setScale(1 - 0.4 * t, 1 + 0.5 * t);
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  private spawnSlowDragRing(position: Vec2, phase: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    const startX = position.x + Math.cos(phase) * 9;
    const startY = position.y + 13 + Math.sin(phase) * 3;
    ring.setPosition(startX, startY);
    ring.setFillStyle(SLOW_COLOR, 0);
    ring.setStrokeStyle(2, SLOW_COLOR, 0.62);
    ring.setScale(0.9, 0.34);
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        r.x = startX - Math.cos(phase) * 12 * t;
        r.setScale(0.9 + 0.45 * t, 0.34 + 0.08 * t);
      },
      release: () => this.pool.release(ring),
    });
  }

  private spawnBurnSpark(position: Vec2): void {
    const spark = this.pool.acquireSpark();
    if (!spark) return;
    const hot = Math.random() < SPARK_HOT_CHANCE;
    const color = hot ? STATUS_VFX.fire.hotColor : STATUS_VFX.fire.color;
    const ox = (Math.random() - 0.5) * 28;
    const startX = position.x + ox;
    const startY = position.y - 10;
    spark.setPosition(startX, startY);
    spark.setFillStyle(color, 0.9);
    spark.setRotation((Math.random() - 0.5) * 0.7);
    spark.setScale(1);
    spark.setAlpha(0.9);
    const targetX = startX + (Math.random() - 0.5) * 14;
    const targetY = startY - 26 - Math.random() * 20;
    transientVfx.spawn({
      factory: () => spark,
      lifetimeMs: SPARK_DURATION_MS + Math.random() * 200,
      startAlpha: 0.9,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.x = startX + (targetX - startX) * t;
        s.y = startY + (targetY - startY) * t;
        const sc = 1 - 0.6 * t;
        s.setScale(sc, sc);
      },
      release: () => this.pool.release(spark),
    });
  }

  private spawnFreezeShard(position: Vec2): void {
    const shard = this.pool.acquireShard();
    if (!shard) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 18;
    const startX = position.x + Math.cos(angle) * dist;
    const startY = position.y + Math.sin(angle) * dist;
    shard.setPosition(startX, startY);
    shard.setFillStyle(STATUS_VFX.ice.color, 0.72);
    shard.setRotation(angle + Math.PI / 2);
    shard.setScale(1);
    shard.setAlpha(0.72);
    const targetX = startX + Math.cos(angle) * 12;
    const targetY = startY + Math.sin(angle) * 12;
    transientVfx.spawn({
      factory: () => shard,
      lifetimeMs: SHARD_DURATION_MS,
      startAlpha: 0.72,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.x = startX + (targetX - startX) * t;
        s.y = startY + (targetY - startY) * t;
      },
      release: () => this.pool.release(shard),
    });
  }

  private spawnFrostRing(position: Vec2): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y);
    ring.setFillStyle(STATUS_VFX.ice.color, 0.0);
    ring.setStrokeStyle(2, STATUS_VFX.ice.color, 0.52);
    ring.setScale(1);
    ring.setAlpha(1);
    const finalScale = 32 / 18;
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1 + (finalScale - 1) * t;
        r.setScale(s, s);
      },
      release: () => this.pool.release(ring),
    });
  }

  private spawnWardRing(position: Vec2): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y - 6);
    ring.setFillStyle(WARD_COLOR, 0.0);
    ring.setStrokeStyle(2, WARD_COLOR, 0.45);
    ring.setScale(1.4);
    ring.setAlpha(1);
    // Contract inward — a shell holding, not a blast leaving (the frost
    // ring expands; inverting the motion keeps the two reads distinct).
    const finalScale = 0.9;
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1.4 + (finalScale - 1.4) * t;
        r.setScale(s, s);
      },
      release: () => this.pool.release(ring),
    });
  }

  /** Drain-axis read: the victim's stolen vitality travels to the caster as
   *  a crimson thread — the chain-arc geometry re-tinted, slower and softer
   *  (a siphon, not a strike). */
  private spawnLeechThread(from: Vec2, to: Vec2): void {
    const graphics = this.pool.acquireBolt();
    if (!graphics) return;
    graphics.setPosition(0, 0);
    graphics.setAlpha(1);
    graphics.setScale(1);
    graphics.setRotation(0);
    graphics.setBlendMode(Phaser.BlendModes.ADD);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    // One smooth sag (a drawn thread), not lightning jitter.
    const sag = len * 0.12;
    const pts: Vec2[] = [
      from,
      { x: from.x + dx * 0.5 + px * sag, y: from.y + dy * 0.5 + py * sag },
      to,
    ];

    graphics.lineStyle(4, LEECH_GLOW, 0.35);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    graphics.lineStyle(1.5, LEECH_COLOR, 0.9);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: LEECH_THREAD_DURATION_MS,
      ease: "Sine.easeOut",
      release: () => this.pool.release(graphics),
    });
  }

  private spawnLightningChainArc(from: Vec2, to: Vec2): void {
    const graphics = this.pool.acquireBolt();
    if (!graphics) return;
    graphics.setPosition(0, 0);
    graphics.setAlpha(1);
    graphics.setScale(1);
    graphics.setRotation(0);
    graphics.setBlendMode(Phaser.BlendModes.ADD);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;

    const offsets = [
      (Math.random() - 0.5) * len * 0.22,
      (Math.random() - 0.5) * len * 0.18,
      (Math.random() - 0.5) * len * 0.22,
    ];
    const pts: Vec2[] = [
      from,
      { x: from.x + dx * 0.25 + px * offsets[0]!, y: from.y + dy * 0.25 + py * offsets[0]! },
      { x: mx + px * offsets[1]!, y: my + py * offsets[1]! },
      { x: from.x + dx * 0.75 + px * offsets[2]!, y: from.y + dy * 0.75 + py * offsets[2]! },
      to,
    ];

    graphics.lineStyle(5, STATUS_VFX.lightning.glow, 0.3);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    graphics.lineStyle(2, STATUS_VFX.lightning.color, 0.92);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: BOLT_DURATION_MS,
      ease: "Sine.easeIn",
      release: () => this.pool.release(graphics),
    });
  }
}
