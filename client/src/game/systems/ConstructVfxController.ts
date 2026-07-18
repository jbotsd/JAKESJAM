// Sim-authoritative construct VFX driver — the Syzygist entanglement read plus
// the melee weapon swings (Interstice twin daggers / Kindred crystal edge).
// Thin painter: each frame it asks the pure planner (render/entanglementPlan)
// WHAT to draw from the snapshot state, then paints it via LightConstruct. No
// decision logic and no sim-logic import live here — the render layer only reads
// state + is handed a class resolver (north-star §5). Sibling of
// StatusVfxController.
//
// BOTH the continuous tether AND the melee swings are drawn into dedicated
// off-pool Graphics this controller owns and redraws every frame — NOT emitted
// as pooled or tween-driven transients. The live-Phaser harness proved (a) the
// churn model exhausted the shared 4-bolt pool and starved every other effect,
// and (b) a short-lived alpha-tween transient did not paint AT ALL in-engine
// (the frame never showed it). The per-frame redraw of a persistent layer is the
// path that renders reliably (same as the tether + ward slab). A swing is just a
// progress clock (elapsed/duration) advanced by deltaMs and painted at that t.
//
// Wiring in OnlineMatchScene:
//     this.constructVfx = new ConstructVfxController(this, this.particlePool);
//     ...each frame:
//     this.constructVfx.update(state, events, deltaMs, resolvePos,
//                              classIdForArchetype, resolveHand);

import Phaser from "phaser";
import { ParticlePool } from "./ParticlePool";
import {
  drawTether,
  spawnTetherMote,
  spawnBindBurst,
  drawBladeSwing,
  drawKindledSwing,
  BLADE_SWING_MS,
  EDGE_SWING_MS,
  SYZYGIST_TINT,
  INTERSTICE_TINT,
  KINDRED_TINT,
  ENTANGLE_SHAPE,
} from "../render/LightConstruct";
import {
  makeEntanglementMemo,
  planEntanglement,
  type EntanglementMemo,
} from "../render/entanglementPlan";
import type { CharacterArchetype, PlayerId, SimEvent, Vec2, WorldState } from "../../sim";

// Interstice twin-blade reach / Kindred Kindled Edge reach (px), from the
// harness-dialed values.
const BLADE_REACH = 64;
const EDGE_REACH = 72;
// Interstice flicks fast + tight; the paladin commits to a wider heavier arc.
const BLADE_SWEEP = 1.8;
const EDGE_SWEEP = 1.6;
// Fallback hand height above the sim (feet) position when no rig hand is known —
// roughly torso/hand height so the swing reads at the body, not the ground ring.
const HAND_RAISE = 34;
// Rapid successive slashes within this many ticks alternate the sweep direction,
// so a flurry reads as a left-right-left COMBO instead of the same arc repeated.
const SLASH_COMBO_WINDOW_TICKS = 28;

// Under the fighters so they stay the loudest read (A18). Provisional — tune to
// the live scene's depth scheme when wired.
const TETHER_DEPTH = 6;
// The swung blade sits just IN FRONT of the fighter body (rig graphics = 12).
const SWING_DEPTH = 13;

type SwingKind = "ninja" | "paladin";
type Swing = {
  kind: SwingKind;
  pivot: Vec2;
  aim: number;
  reach: number;
  sweep: number;
  dir: number;
  elapsedMs: number;
  durMs: number;
};

export class ConstructVfxController {
  private readonly pool: ParticlePool;
  private readonly memo: EntanglementMemo = makeEntanglementMemo();
  /** Per-player slash combo state — last slash tick + last sweep direction. */
  private readonly slashCombo: Map<string, { tick: number; dir: number }> = new Map();
  // One dedicated off-pool Graphics for ALL live tethers, redrawn each frame.
  private readonly tetherLayer: Phaser.GameObjects.Graphics;
  // One dedicated off-pool Graphics for ALL live weapon swings, redrawn each
  // frame from the swings' progress clocks (the reliable persistent path).
  private readonly swingLayer: Phaser.GameObjects.Graphics;
  private readonly swings: Swing[] = [];

  constructor(scene: Phaser.Scene, pool: ParticlePool) {
    this.pool = pool;
    this.tetherLayer = scene.add.graphics();
    this.tetherLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.tetherLayer.setDepth(TETHER_DEPTH);
    this.swingLayer = scene.add.graphics();
    this.swingLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.swingLayer.setDepth(SWING_DEPTH);
  }

  /** Start a weapon swing — the render half of a `slash-started`. Public so the
   *  live-Phaser harness can drive a swing directly (no sim events there). */
  triggerSwing(kind: SwingKind, pivot: Vec2, aim: number, dir = 1): void {
    this.swings.push({
      kind,
      pivot: { x: pivot.x, y: pivot.y },
      aim,
      reach: kind === "ninja" ? BLADE_REACH : EDGE_REACH,
      sweep: kind === "ninja" ? BLADE_SWEEP : EDGE_SWEEP,
      dir,
      elapsedMs: 0,
      durMs: kind === "ninja" ? BLADE_SWING_MS : EDGE_SWING_MS,
    });
  }

  update(
    state: WorldState,
    events: readonly SimEvent[],
    deltaMs: number,
    getPosition: (id: PlayerId) => Vec2 | undefined,
    resolveClassId: (characterId: CharacterArchetype) => string,
    // Live world position of a fighter's swinging hand (from the rig). The blade
    // pivots HERE, not at the feet — a slash sweeping around the ground ring read
    // as an incoherent projectile (Jake, 2026-07-18). Falls back to a hand-height
    // raise above the sim position when a rig isn't available (bots pre-spawn).
    resolveHand?: (id: PlayerId) => Vec2 | undefined,
  ): void {
    const plan = planEntanglement(state, deltaMs, getPosition, resolveClassId, this.memo);

    // hold — redraw every live tether into the one dedicated layer.
    this.tetherLayer.clear();
    for (const t of plan.tethers) {
      drawTether(this.tetherLayer, t.from, t.to, SYZYGIST_TINT, ENTANGLE_SHAPE, t.phaseSec);
    }

    // bind / snap / feed — occasional, pooled transients.
    for (const s of plan.snaps) spawnBindBurst(this.pool, s, SYZYGIST_TINT, true);
    for (const b of plan.binds) spawnBindBurst(this.pool, b, SYZYGIST_TINT, false);
    for (const m of plan.motes) spawnTetherMote(this.pool, m.from, m.to, SYZYGIST_TINT, ENTANGLE_SHAPE);

    // Melee constructs — `slash-started` is emitted by BOTH the ninja (Interstice)
    // and the paladin's Kindled Edge (World.ts reuses the event). Dispatch by
    // class: cyan twin-blade vs gold crystal sword.
    for (const ev of events) {
      if (ev.t !== "slash-started") continue;
      const caster = state.players[ev.playerId];
      if (!caster) continue;
      const cls = resolveClassId(caster.characterId);
      if (cls !== "ninja" && cls !== "paladin") continue;
      // aimX/aimY on the entity is an absolute cursor POINT (World.ts swing FSM),
      // NOT a unit vector — the swing direction is player -> cursor. (Using it as
      // a raw direction pointed the blade at a garbage angle = "incoherent".)
      const aim = Math.atan2(caster.aimY - caster.y, caster.aimX - caster.x);
      // Pivot the swing at the HAND (rig) — falls back to a hand-height raise
      // above the sim position so the blade never sweeps around the feet.
      const hand = resolveHand?.(ev.playerId);
      const pivot = hand ?? { x: ev.x, y: ev.y - HAND_RAISE };
      // Combo: a slash close after the previous one flips the sweep direction.
      const key = ev.playerId as string;
      const prev = this.slashCombo.get(key);
      const dir = prev && state.tick - prev.tick < SLASH_COMBO_WINDOW_TICKS ? -prev.dir : 1;
      this.slashCombo.set(key, { tick: state.tick, dir });
      this.triggerSwing(cls, pivot, aim, dir);
    }

    // Advance + repaint all live swings into the one persistent layer.
    this.swingLayer.clear();
    for (let i = this.swings.length - 1; i >= 0; i--) {
      const s = this.swings[i]!;
      s.elapsedMs += deltaMs;
      const t = s.elapsedMs / s.durMs;
      if (t >= 1) {
        this.swings.splice(i, 1);
        continue;
      }
      const tint = s.kind === "ninja" ? INTERSTICE_TINT : KINDRED_TINT;
      if (s.kind === "ninja") {
        drawBladeSwing(this.swingLayer, s.pivot, s.aim, s.reach, tint, s.sweep, s.dir, t);
      } else {
        drawKindledSwing(this.swingLayer, s.pivot, s.aim, s.reach, tint, s.sweep, s.dir, t);
      }
    }
  }

  destroy(): void {
    this.tetherLayer.destroy();
    this.swingLayer.destroy();
    this.swings.length = 0;
    this.slashCombo.clear();
    this.memo.moteCadence.clear();
    this.memo.lastVictimPos.clear();
    this.memo.active.clear();
  }
}
