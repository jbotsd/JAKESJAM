// Sim-authoritative construct VFX driver — the Syzygist entanglement read plus
// the melee weapon swings (Interstice twin daggers / Kindled crystal edge).
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
  spawnSlashMark,
  drawBladeSwing,
  drawKindledSwing,
  drawHeldDaggers,
  drawHeldEdges,
  drawWardSlab,
  spawnWardRaise,
  spawnWardAbsorb,
  spawnWardDrop,
  spawnLance,
  spawnCrystalShards,
  spawnEmpoweredHitFlourish,
  spawnAbilityCastTell,
  drawChannelCharge,
  spawnNovaBurst,
  drawBuffAura,
  spawnBlinkStreak,
  drawGroundField,
  spawnGhostGuardDodge,
  type ClassConstructStyle,
  swingEnv,
  BLADE_SWING_MS,
  EDGE_SWING_MS,
  SYZYGIST_TINT,
  INTERSTICE_TINT,
  KINDLED_TINT,
  GEOMETRICIAN_TINT,
  ENTANGLE_SHAPE,
} from "../render/LightConstruct";
import {
  makeEntanglementMemo,
  planEntanglement,
  type EntanglementMemo,
} from "../render/entanglementPlan";
import type { CharacterArchetype, PlayerId, SimEvent, Vec2, WorldState } from "../../sim";
import { meleeBladeAngle } from "../render/meleeTiming.js";
import { applyConstructGlow } from "../render/constructFilters.js";
import {
  GEO_CHANNEL_RAMP_MS,
  GEO_LATTICE_ZONE_RADIUS_PX,
  GEO_LATTICE_ZONE_DURATION_MS,
  NINJA_SHARD_RING_RADIUS_PX,
  NINJA_WALL_BLOOM_RADIUS_PX,
  NINJA_SECOND_WIND_BURST_RADIUS_PX,
  SYZ_FLOCK_PULSE_RADIUS_PX,
  SYZ_BORROWED_TIME_DEBT_BURST_RADIUS_PX,
  KIN_SHOCK_RING_RADIUS_PX,
  STEP_MS,
} from "../../sim/constants.js";

// Interstice twin-blade reach / Kindled Kindled Edge reach (px), from the
// harness-dialed values.
const BLADE_REACH = 82;
const EDGE_REACH = 88;
// Wide, body-spanning silhouettes. Interstice crosses nearly a half-circle in
// a short acceleration cliff; Kindled carries a broad greatsword diagonal.
const BLADE_SWEEP = 2.25;
const EDGE_SWEEP = 2.5;
// Fallback hand height above the sim (feet) position when no rig hand is known —
// roughly torso/hand height so the swing reads at the body, not the ground ring.
const HAND_RAISE = 34;
// Rapid successive slashes within this many ticks alternate the sweep
// direction (and, on the 3rd, combine both), so a flurry reads as a
// left-right-BOTH combo instead of the same arc repeated. Sized against the
// sim's OWN attack cycle, not guessed: at 60Hz (STEP_MS) the swing FSM's
// windup+active+recovery is 120+90+220=430ms, and the old 28-tick window
// (467ms) left only ~37ms of margin for a real player's next hit to land
// inside it — any input/network jitter blew past that, so the combo almost
// never actually chained ("doesn't work", Jake 2026-07-19). 60 ticks (1000ms)
// gives ~570ms of real slack after the swing cycle completes.
const SLASH_COMBO_WINDOW_TICKS = 60;
// Geometrician muzzle lance — modest on a plain shot (this fires on EVERY
// wizard trigger-pull, so it has to stay cheap/quick), longer + brighter while
// Sunlance's window is live (glass-cannon read: the crystal is under more
// tension, so it projects further — Jake, 2026-07-19 "glass canon" refinement;
// the fuller charge/crack/shatter treatment is Phase 3 scope).
const LANCE_REACH_BASE = 46;
const LANCE_REACH_SUNLANCE = 78;

// Under the fighters so they stay the loudest read (A18). Provisional — tune to
// the live scene's depth scheme when wired.
const TETHER_DEPTH = 6;
// The held weapon sits in the hands just above the body (rig graphics = 12); the
// swung blade one notch higher so an active swing reads over the resting grip.
const HELD_DEPTH = 12.5;
const SWING_DEPTH = 13;
// A ground field sits under everything — even under the tether — since it's a
// floor decal, not a held/worn construct.
const GROUND_FIELD_DEPTH = 3;
// The continuous buff-aura orbits/pulses around the body, above the tether but
// below the held weapon (it's ambient, not a wielded object).
const AURA_DEPTH = 9;

type SwingKind = "ninja" | "paladin";
type Swing = {
  kind: SwingKind;
  pivot: Vec2;
  backPivot: Vec2;
  aim: number;
  reach: number;
  sweep: number;
  dir: number;
  elapsedMs: number;
  durMs: number;
  tipHistory: Vec2[];
  pid?: string; // owner — held weapon is suppressed for a player mid-swing
  /** 1st/2nd/3rd+ hit within the current combo window (Jake, 2026-07-19:
   *  "first slash should look one way, second another direction, then both
   *  together on the third"). Cycles 1→2→3, then wraps back to 1 rather than
   *  climbing forever, so every third hit is the climax read. */
  comboCount: number;
};

/** Live world position of a fighter's hand (from the rig), 0 = lead, 1 = back. */
type HandResolver = (id: PlayerId, hand: 0 | 1) => Vec2 | undefined;

/** classId -> the class-specific construct SHAPE (Jake, 2026-07-19: "it
 *  should be class specific too" — a shared spine, four genuinely distinct
 *  lenses, never one shape re-tinted). */
function classConstructStyle(cls: string): ClassConstructStyle {
  if (cls === "ninja") return "slash";
  if (cls === "priest") return "ooze";
  if (cls === "paladin") return "seal";
  return "shatter"; // wizard
}

/** Clamp any counter to the fixed 1→2→3 cycle every variant-bearing construct
 *  in this file uses (Jake, 2026-07-19: "total 3 and they cycle through"). */
function toVariant(n: number | undefined): 1 | 2 | 3 {
  const m = ((((n ?? 1) - 1) % 3) + 3) % 3;
  return (m + 1) as 1 | 2 | 3;
}

export class ConstructVfxController {
  private readonly pool: ParticlePool;
  private readonly memo: EntanglementMemo = makeEntanglementMemo();
  /** Per-player slash combo state — last slash tick, last sweep direction,
   *  and position within the combo (1st/2nd/3rd, cycling). */
  private readonly slashCombo: Map<string, { tick: number; dir: number; count: number }> = new Map();
  // One dedicated off-pool Graphics for ALL live tethers, redrawn each frame.
  private readonly tetherLayer: Phaser.GameObjects.Graphics;
  // Weapon swings, redrawn each frame from the swings' progress clocks (the
  // reliable persistent path). Split per class — NOT one shared layer — so
  // each Graphics only ever holds one class's tint: a Phaser Filters Glow is
  // one fixed color per GameObject, so a layer mixing cyan (ninja) + gold
  // (paladin) draws can't be glow-filtered correctly (constructFilters.ts).
  private readonly swingLayerNinja: Phaser.GameObjects.Graphics;
  private readonly swingLayerPaladin: Phaser.GameObjects.Graphics;
  private readonly swings: Swing[] = [];
  // Held (resting) weapons — repainted every frame in the fighters' hands.
  // Same per-class split as the swing layers, same reason.
  private readonly heldLayerNinja: Phaser.GameObjects.Graphics;
  private readonly heldLayerPaladin: Phaser.GameObjects.Graphics;
  // Kindled Ward — the held circuit-board slab. Single-tint (gold only), so no
  // per-class split needed. Continuous while `shieldActive`; raise/absorb/drop
  // are one-shot pooled transients fired on the edges/events below.
  private readonly wardLayer: Phaser.GameObjects.Graphics;
  private wardPhaseSec = 0;
  /** 1→2→3→1 cycle position per player for constructs with no existing combo
   *  counter to reuse (the ranged classes' empowered-hit flourish, and every
   *  class's ability cast-tell) — same fixed-3-rotation rule as the melee
   *  swing combo, tracked separately since these fire independently of it. */
  private readonly castTellCombo: Map<string, number> = new Map();
  /** Previous-frame `shieldActive` per player — Ward isn't a drafted ability
   *  (no `ability-activated` event exists for it), it's the universal held-
   *  Shield boolean (`combat.ts`'s `tickShield()`), so raise/drop are detected
   *  by frame-diffing the live snapshot field the same way `entanglementPlan.ts`
   *  already watches `focusHexMarkUntilTick` — zero sim edits required. */
  private readonly wardWasHeld: Map<string, boolean> = new Map();
  // Geometrician wind-up — the basic-fire ramping channel made visible
  // (Jake, 2026-07-20: "think about the wind up mechanic too"). Single-tint
  // (wizard cyan only), continuous while `channelHoldMs` is live, same
  // persistent-redraw pattern as the Ward.
  private readonly channelLayer: Phaser.GameObjects.Graphics;
  private channelPhaseSec = 0;
  // Lattice ground-field — client-tracked zone list (NOT read off
  // state.firePatches; see LightConstruct.ts's drawGroundField header for
  // why), ticked locally from each cast's own elapsed/duration clock.
  private readonly latticeZones: Array<{
    x: number;
    y: number;
    radius: number;
    elapsedMs: number;
    durationMs: number;
  }> = [];
  private readonly latticeLayer: Phaser.GameObjects.Graphics;
  // Last-seen position per player, updated at the END of every update() —
  // the blink abilities (Slip Node/Drift Step/Plant Charge/Bulwark Step) are
  // instant position snaps, so ability-activated's own x/y IS the
  // destination; the origin has to come from the frame before (same
  // technique ProjectileVfx.ts's own `lastPos` map already proves).
  private readonly lastPos: Map<string, Vec2> = new Map();
  // Deferred-payoff detection — Ghost Guard's dodge, Shock Ring's landing
  // slam, and Wall Bloom's wall-kick burst all fire SILENTLY (no SimEvent;
  // see combat.ts/World.ts's own "nothing to apply or announce" comments).
  // Each field is only ever cleared to `undefined` by actual consumption —
  // never by natural timeout, which leaves the stale past tick in place —
  // so "was defined last frame, is undefined now" is an unambiguous tell
  // the payoff just happened THIS tick (see `consumedThisFrame`).
  private readonly ghostGuardWasArmed: Map<string, boolean> = new Map();
  private readonly shockRingWasArmed: Map<string, boolean> = new Map();
  private readonly wallBloomWasArmed: Map<string, boolean> = new Map();
  // Second Wind (2026-07-20 fast-follow) — joins the three above for the
  // IDENTICAL reason: its payoff (heal + energy on a landed hit within the
  // window) is consumed in the SAME tick as the `slash-hit` event that
  // would otherwise drive the empowered-hit flourish below, so a live
  // `secondWindUntilTick > tick` check always reads false by the time this
  // controller sees it — World.ts:5209 clears the field to `undefined` in
  // that exact write. This was a silent no-op flourish, not a missing
  // design; the fix is the same frame-diff technique, not a new mechanism.
  private readonly secondWindWasArmed: Map<string, boolean> = new Map();
  // Borrowed Time's debt (2026-07-20 fast-follow) — a DIFFERENT flavor of
  // the same gap: this one isn't racing a same-tick SimEvent, there simply
  // IS no SimEvent for the drain landing (World.ts's debt-resolution block
  // is a bare per-tick expiry check, not an emitted event) — frame-diff is
  // the only tell that exists, not a race to win. Fires on WHOEVER the
  // drain actually lands on (self-cast or the healed ally, per-player scan
  // below), matching debtUntilTick's own "never cleared by anything but
  // resolution" invariant `consumedThisFrame` requires.
  private readonly debtWasArmed: Map<string, boolean> = new Map();
  // Continuous buff-aura pulse — Overclock (wizard), Rally Light/Aegis
  // Share/Kindled Resolve (paladin), Haste Gift/Self-Lattice (priest). Split
  // per class for the same Filters-Glow-is-one-tint-per-layer reason the
  // swing/held layers are split.
  private readonly auraLayerWizard: Phaser.GameObjects.Graphics;
  private readonly auraLayerPaladin: Phaser.GameObjects.Graphics;
  private readonly auraLayerPriest: Phaser.GameObjects.Graphics;
  private auraPhaseSec = 0;

  constructor(scene: Phaser.Scene, pool: ParticlePool) {
    this.pool = pool;
    this.swingLayerNinja = scene.add.graphics();
    this.swingLayerNinja.setBlendMode(Phaser.BlendModes.ADD);
    this.swingLayerNinja.setDepth(SWING_DEPTH);
    applyConstructGlow(this.swingLayerNinja, INTERSTICE_TINT.glow);
    this.swingLayerPaladin = scene.add.graphics();
    this.swingLayerPaladin.setBlendMode(Phaser.BlendModes.ADD);
    this.swingLayerPaladin.setDepth(SWING_DEPTH);
    applyConstructGlow(this.swingLayerPaladin, KINDLED_TINT.glow);
    this.heldLayerNinja = scene.add.graphics();
    this.heldLayerNinja.setBlendMode(Phaser.BlendModes.ADD);
    this.heldLayerNinja.setDepth(HELD_DEPTH);
    applyConstructGlow(this.heldLayerNinja, INTERSTICE_TINT.glow);
    this.heldLayerPaladin = scene.add.graphics();
    this.heldLayerPaladin.setBlendMode(Phaser.BlendModes.ADD);
    this.heldLayerPaladin.setDepth(HELD_DEPTH);
    applyConstructGlow(this.heldLayerPaladin, KINDLED_TINT.glow);
    this.tetherLayer = scene.add.graphics();
    this.tetherLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.tetherLayer.setDepth(TETHER_DEPTH);
    applyConstructGlow(this.tetherLayer, SYZYGIST_TINT.glow);
    this.wardLayer = scene.add.graphics();
    this.wardLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.wardLayer.setDepth(HELD_DEPTH);
    applyConstructGlow(this.wardLayer, KINDLED_TINT.glow);
    this.channelLayer = scene.add.graphics();
    this.channelLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.channelLayer.setDepth(HELD_DEPTH);
    applyConstructGlow(this.channelLayer, GEOMETRICIAN_TINT.glow);
    this.latticeLayer = scene.add.graphics();
    this.latticeLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.latticeLayer.setDepth(GROUND_FIELD_DEPTH);
    applyConstructGlow(this.latticeLayer, GEOMETRICIAN_TINT.glow);
    this.auraLayerWizard = scene.add.graphics();
    this.auraLayerWizard.setBlendMode(Phaser.BlendModes.ADD);
    this.auraLayerWizard.setDepth(AURA_DEPTH);
    applyConstructGlow(this.auraLayerWizard, GEOMETRICIAN_TINT.glow);
    this.auraLayerPaladin = scene.add.graphics();
    this.auraLayerPaladin.setBlendMode(Phaser.BlendModes.ADD);
    this.auraLayerPaladin.setDepth(AURA_DEPTH);
    applyConstructGlow(this.auraLayerPaladin, KINDLED_TINT.glow);
    this.auraLayerPriest = scene.add.graphics();
    this.auraLayerPriest.setBlendMode(Phaser.BlendModes.ADD);
    this.auraLayerPriest.setDepth(AURA_DEPTH);
    applyConstructGlow(this.auraLayerPriest, SYZYGIST_TINT.glow);
  }

  /** Start a weapon swing — the render half of a `slash-started`. Public so the
   *  live-Phaser harness can drive a swing directly (no sim events there). */
  triggerSwing(
    kind: SwingKind,
    pivot: Vec2,
    backPivot: Vec2,
    aim: number,
    dir = 1,
    pid?: string,
    comboCount = 1,
  ): void {
    this.swings.push({
      kind,
      pivot: { x: pivot.x, y: pivot.y },
      backPivot: { x: backPivot.x, y: backPivot.y },
      aim,
      reach: kind === "ninja" ? BLADE_REACH : EDGE_REACH,
      sweep: kind === "ninja" ? BLADE_SWEEP : EDGE_SWEEP,
      dir,
      elapsedMs: 0,
      durMs: kind === "ninja" ? BLADE_SWING_MS : EDGE_SWING_MS,
      tipHistory: [],
      pid,
      comboCount,
    });
  }

  update(
    state: WorldState,
    events: readonly SimEvent[],
    deltaMs: number,
    getPosition: (id: PlayerId) => Vec2 | undefined,
    resolveClassId: (characterId: CharacterArchetype) => string,
    // Live world position of a fighter's hand (from the rig), 0 = lead, 1 = back.
    // The blade pivots at the hand, NOT the feet — a slash sweeping around the
    // ground ring read as an incoherent projectile (Jake, 2026-07-18). Falls back
    // to a hand-height raise above the sim position when a rig isn't available.
    resolveHand?: HandResolver,
    triggerMeleePose?: (
      id: PlayerId,
      style: "interstice" | "kindled",
      dir: number,
    ) => void,
    // Shock Ring's landing slam and Wall Bloom's wall-kick burst fire
    // SILENTLY (no SimEvent — see combat.ts/World.ts's own "nothing to
    // apply or announce" comments), so SimEventRouter can never react to
    // them: today they land with a visual construct but ZERO camera
    // shake/hit-stop weight (Jake, 2026-07-20: "every single factor where
    // game feel matters"). This controller already detects the exact tick
    // each one actually fires (`consumedThisFrame`, below) — that's the
    // one place the "did it just happen" answer exists — so it's the
    // natural owner of the callback, while the scene keeps owning the
    // actual camera/hit-stop call (same split SimEventRouter's `d.safeShake`
    // dependency-injection already uses).
    onDeferredNovaImpact?: (playerId: PlayerId, kind: "shock-ring" | "wall-bloom") => void,
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
      const hand = resolveHand?.(ev.playerId, 0);
      const backHand = resolveHand?.(ev.playerId, 1);
      const pivot = hand ?? { x: ev.x, y: ev.y - HAND_RAISE };
      const backPivot = backHand ?? {
        x: ev.x - Math.cos(aim) * 8,
        y: ev.y - HAND_RAISE,
      };
      // Combo: a slash close after the previous one flips the sweep direction
      // and advances the combo count. 1st hit = one direction, 2nd = the
      // mirror, 3rd = the climax (rendered as both together below), then it
      // cycles back to 1 rather than climbing forever.
      const key = ev.playerId as string;
      const prev = this.slashCombo.get(key);
      const inCombo = prev && state.tick - prev.tick < SLASH_COMBO_WINDOW_TICKS;
      const dir = inCombo ? -prev.dir : 1;
      const comboCount = inCombo ? (prev.count % 3) + 1 : 1;
      this.slashCombo.set(key, { tick: state.tick, dir, count: comboCount });
      triggerMeleePose?.(ev.playerId, cls === "ninja" ? "interstice" : "kindled", dir);
      this.triggerSwing(cls, pivot, backPivot, aim, dir, key, comboCount);
    }

    // Advance + repaint all live swings into the one persistent layer. Each
    // pid's suppression factor tracks the swing's OWN fade envelope (1 = swing
    // fully opaque, held weapon fully suppressed; 0 = swing fully faded, held
    // weapon fully back) so the held layer below can crossfade in at the exact
    // complementary rate. A hard boolean here previously left both the swing
    // (fading through its last ~22%) and the held weapon (still suppressed
    // until t>=1) nearly invisible for a real, visible beat — caught on tape,
    // not just in review (Jake, 2026-07-19).
    this.swingLayerNinja.clear();
    this.swingLayerPaladin.clear();
    const swingSuppression = new Map<string, number>();
    // The live blade angle per attacker, captured off the SAME swing the hit
    // came from — not a generic attacker-to-victim line. A hit stamp aimed at
    // "where the victim happens to be" reads as a random flash; one aimed at
    // "where this exact swing's edge was pointing" reads as the swing's own
    // force landing (Jake, 2026-07-19: "the player initiated the swing and
    // is the force behind its impact").
    const attackerBladeAngle = new Map<string, number>();
    for (let i = this.swings.length - 1; i >= 0; i--) {
      const s = this.swings[i]!;
      s.elapsedMs += deltaMs;
      const t = s.elapsedMs / s.durMs;
      if (t >= 1) {
        this.swings.splice(i, 1);
        continue;
      }
      if (s.pid) swingSuppression.set(s.pid, Math.max(swingSuppression.get(s.pid) ?? 0, swingEnv(t)));
      if (s.pid && resolveHand) {
        s.pivot = resolveHand(s.pid as PlayerId, 0) ?? s.pivot;
        s.backPivot = resolveHand(s.pid as PlayerId, 1) ?? s.backPivot;
      }
      const style = s.kind === "ninja" ? "interstice" : "kindled";
      const activePivot = s.kind === "ninja" && s.dir < 0 ? s.backPivot : s.pivot;
      const bladeAngle = meleeBladeAngle(s.aim, s.sweep, s.dir, t, style);
      if (s.pid) attackerBladeAngle.set(s.pid, bladeAngle);
      const trailStarts = style === "interstice" ? 0.32 : 0.38;
      const trailEnds = style === "interstice" ? 0.84 : 0.88;
      if (t < trailStarts) {
        s.tipHistory.length = 0;
      } else if (t <= trailEnds) {
        s.tipHistory.push({
          x: activePivot.x + Math.cos(bladeAngle) * s.reach,
          y: activePivot.y + Math.sin(bladeAngle) * s.reach,
        });
      }
      if (s.tipHistory.length > 14) s.tipHistory.shift();
      const tint = s.kind === "ninja" ? INTERSTICE_TINT : KINDLED_TINT;
      if (s.kind === "ninja") {
        drawBladeSwing(
          this.swingLayerNinja,
          s.pivot,
          s.backPivot,
          s.aim,
          s.reach,
          tint,
          s.sweep,
          s.dir,
          t,
          s.comboCount,
        );
      } else {
        drawKindledSwing(
          this.swingLayerPaladin,
          s.pivot,
          s.backPivot,
          s.aim,
          s.reach,
          tint,
          s.sweep,
          s.dir,
          t,
          s.tipHistory,
        );
      }
    }

    // Slash mark — a small, bold blade symbol + spark burst stamped at the
    // point of contact, ninja-exclusive (Kindled's chassis contract is
    // "commits", not flourish — A17 keeps the two classes' hit reads
    // distinct). This is the class-specific hit read that `hit-confirmed`'s
    // shared, class-agnostic blast doesn't carry on its own. Angled off the
    // ACTUAL live swing (attackerBladeAngle, captured above), not a generic
    // attacker-to-victim line, so it reads as this swing's force landing —
    // not an unrelated flash that happens to appear near the target.
    // One-shot, spawned straight into the pool; never redrawn after cast.
    for (const ev of events) {
      if (ev.t !== "slash-hit") continue;
      const attacker = state.players[ev.attackerId];
      if (!attacker) continue;
      const cls = resolveClassId(attacker.characterId);
      if (cls !== "ninja") continue;
      const victimPos = getPosition(ev.victimId);
      if (!victimPos) continue;
      const attackerPos = getPosition(ev.attackerId);
      const angle = attackerBladeAngle.get(ev.attackerId as string) ??
        (attackerPos ? Math.atan2(victimPos.y - attackerPos.y, victimPos.x - attackerPos.x) : 0);
      // Same 1→2→3 cycle as the swing itself — this hit landed FROM that
      // swing, so its stamp variant matches the swing's own combo position.
      const variant = toVariant(this.slashCombo.get(ev.attackerId as string)?.count);
      spawnSlashMark(this.pool, victimPos, angle, INTERSTICE_TINT, variant);
    }

    // Empowered-hit flourish — "the next hit should look like a spell took
    // place" (Jake, 2026-07-19): every window/mark ability whose actual
    // payoff lands on a LATER hit, not at cast time. Checked directly off the
    // live snapshot (zero sim edits) at the moment the payoff hit's own event
    // fires. Melee payoffs ride slash-hit (both classes fire it, unlike the
    // ninja-only slash-mark above); ranged/status payoffs ride hit-confirmed
    // below. Layered ON TOP of the existing hit read, never replacing it.
    for (const ev of events) {
      if (ev.t !== "slash-hit") continue;
      const attacker = state.players[ev.attackerId];
      if (!attacker) continue;
      const cls = resolveClassId(attacker.characterId);
      const tick = state.tick;
      let empowered = false;
      if (cls === "ninja") {
        // Second Wind is deliberately NOT checked here — its window clears
        // in the SAME tick it's consumed (a same-tick-clear race this
        // victim-directed live-check can never win), unlike Undercut/Read
        // Mark's non-consuming windows below. Its own payoff is handled
        // separately, self-directed, via the deferred-payoff frame-diff
        // loop (`secondWindWasArmed`, below) — see that block's comment.
        empowered =
          (attacker.undercutUntilTick !== undefined && attacker.undercutUntilTick > tick) ||
          (attacker.readTargetId === ev.victimId &&
            attacker.readMarkUntilTick !== undefined &&
            attacker.readMarkUntilTick > tick);
      } else if (cls === "paladin") {
        empowered =
          (attacker.sealUntilTick !== undefined && attacker.sealUntilTick > tick) ||
          (attacker.judgmentTargetId === ev.victimId &&
            attacker.judgmentMarkUntilTick !== undefined &&
            attacker.judgmentMarkUntilTick > tick);
      }
      if (!empowered) continue;
      const victimPos = getPosition(ev.victimId);
      if (!victimPos) continue;
      const variant = toVariant(this.slashCombo.get(ev.attackerId as string)?.count);
      spawnEmpoweredHitFlourish(
        this.pool,
        victimPos,
        cls === "ninja" ? INTERSTICE_TINT : KINDLED_TINT,
        classConstructStyle(cls),
        variant,
      );
    }
    for (const ev of events) {
      if (ev.t !== "hit-confirmed" || !ev.attackerId) continue;
      const attacker = state.players[ev.attackerId];
      if (!attacker) continue;
      const cls = resolveClassId(attacker.characterId);
      // Ninja/paladin melee payoffs are already covered by the slash-hit pass
      // above (hit-confirmed fires alongside it, same tick) — only check the
      // ranged classes here so a melee hit doesn't get the flourish twice.
      let empowered = false;
      let tint = GEOMETRICIAN_TINT;
      const tick = state.tick;
      if (cls === "wizard") {
        empowered =
          attacker.facetTargetId === ev.victimId &&
          attacker.facetMarkUntilTick !== undefined &&
          attacker.facetMarkUntilTick > tick;
        tint = GEOMETRICIAN_TINT;
      } else if (cls === "priest") {
        empowered =
          attacker.focusHexTargetId === ev.victimId &&
          attacker.focusHexMarkUntilTick !== undefined &&
          attacker.focusHexMarkUntilTick > tick;
        tint = SYZYGIST_TINT;
      }
      if (!empowered) continue;
      const victimPos = getPosition(ev.victimId);
      if (!victimPos) continue;
      const variant = this.nextCastTellVariant(ev.attackerId as string);
      spawnEmpoweredHitFlourish(this.pool, victimPos, tint, classConstructStyle(cls), variant);
    }

    // Cast tell — the floor for "even a pure cooldown/window ability should
    // show something" (Jake, 2026-07-19). Every drafted ability already gets
    // a rig gesture (SimEventRouter's ability-activated case); abilities with
    // NO other dedicated world-space read (the ~30 pure window/buff casts —
    // Undercut, Read Mark, Second Wind, Overclock, Rally Light, etc.) were
    // showing nothing else at all. Fired for every ability-activated — for
    // the handful that ALSO get a dedicated read (Prism Fan's shard fan,
    // Sunlance's lance) this reads as "gather then release," not a double-up.
    for (const ev of events) {
      if (ev.t !== "ability-activated") continue;
      const caster = state.players[ev.playerId];
      if (!caster) continue;
      const cls = resolveClassId(caster.characterId);
      const tint =
        cls === "ninja" ? INTERSTICE_TINT
        : cls === "paladin" ? KINDLED_TINT
        : cls === "priest" ? SYZYGIST_TINT
        : GEOMETRICIAN_TINT;
      const variant = this.nextCastTellVariant(ev.playerId as string);
      spawnAbilityCastTell(this.pool, { x: ev.x, y: ev.y }, tint, classConstructStyle(cls), variant);
    }

    // HELD weapons — the resting/ready construct in every melee fighter's hands
    // (the goal's "a construct present during the animation" for the idle+move
    // states). Repainted every frame; crossfaded in against the swing's own
    // fade-out via swingSuppression, not hard-cut at swing end. Needs the rig's
    // live hands, so it no-ops for a player without a rig (resolveHand returns
    // undefined).
    this.heldLayerNinja.clear();
    this.heldLayerPaladin.clear();
    if (resolveHand) {
      for (const pidKey of Object.keys(state.players)) {
        const p = state.players[pidKey as PlayerId];
        if (!p || !p.alive) continue;
        const heldAlpha = 1 - (swingSuppression.get(pidKey) ?? 0);
        if (heldAlpha <= 0.01) continue;
        const cls = resolveClassId(p.characterId);
        if (cls !== "ninja" && cls !== "paladin") continue;
        const aim = Math.atan2(p.aimY - p.y, p.aimX - p.x);
        const lead = resolveHand(pidKey as PlayerId, 0);
        const back = resolveHand(pidKey as PlayerId, 1);
        if (cls === "ninja") {
          if (lead && back) drawHeldDaggers(this.heldLayerNinja, lead, back, aim, INTERSTICE_TINT, heldAlpha);
        } else if (lead && back) {
          drawHeldEdges(this.heldLayerPaladin, lead, back, aim, KINDLED_TINT, heldAlpha);
        }
      }
    }

    // Kindled Ward — the held circuit-board slab. NOT a drafted ability (no
    // `ability-activated` event for it): the universal held-Shield boolean,
    // `player.shieldActive`, ticked every frame by combat.ts's tickShield().
    // Raise/drop are the false→true / true→false edges of that field, read
    // straight off the live snapshot — the same frame-diff technique
    // entanglementPlan.ts already proves for Syzygist's mark field.
    this.wardPhaseSec += deltaMs / 1000;
    this.wardLayer.clear();
    for (const pidKey of Object.keys(state.players)) {
      const p = state.players[pidKey as PlayerId];
      if (!p || !p.alive) continue;
      if (resolveClassId(p.characterId) !== "paladin") continue;
      const held = p.shieldActive === true;
      const wasHeld = this.wardWasHeld.get(pidKey) ?? false;
      // Board anchor: off-hand (shield arm), mirroring the sword-and-board
      // pairing drawKindledSwing already braces during a swing. Falls back to
      // a fixed offset from the body when no rig hand is known.
      const boardHand = resolveHand?.(pidKey as PlayerId, 1);
      const board = boardHand ?? { x: p.x - 14, y: p.y - HAND_RAISE };
      if (held && !wasHeld) {
        spawnWardRaise(this.pool, board, KINDLED_TINT);
      } else if (!held && wasHeld) {
        spawnWardDrop(this.pool, board, KINDLED_TINT);
      }
      this.wardWasHeld.set(pidKey, held);
      if (held) {
        drawWardSlab(this.wardLayer, board, KINDLED_TINT, this.wardPhaseSec);
      }
    }

    // Ward absorb — a real hit lands on a held Ward (self or peeling for an
    // ally). No sim edit needed: `ward-absorbed`/`team-peel-absorbed` already
    // fire (combat.ts); they carry no hit x/y, so the impact point is
    // approximated along the warder's own aim (a directionally-plausible
    // "the blow landed on the shield's facing side" read, not an exact site —
    // acceptable since the shield itself is the read, not a decal). The flash
    // lands at the WARDER for a peel (matches the pre-existing
    // spawnWardAbsorbFlash behavior this replaces: "that Paladin just saved
    // their teammate" reads at the saver, not the saved).
    for (const ev of events) {
      let warderId: string | undefined;
      if (ev.t === "ward-absorbed") warderId = ev.playerId as string;
      else if (ev.t === "team-peel-absorbed") warderId = ev.warderId as string;
      else continue;
      const warder = state.players[warderId as PlayerId];
      if (!warder || resolveClassId(warder.characterId) !== "paladin") continue;
      const boardHand = resolveHand?.(warderId as PlayerId, 1);
      const board = boardHand ?? { x: warder.x - 14, y: warder.y - HAND_RAISE };
      const aim = Math.atan2(warder.aimY - warder.y, warder.aimX - warder.x);
      const hit = { x: board.x + Math.cos(aim) * 22, y: board.y + Math.sin(aim) * 22 };
      spawnWardAbsorb(this.pool, board, hit, KINDLED_TINT);
    }

    // Geometrician — the projected crystal lance flourish at the muzzle on
    // every wizard shot (already-built `spawnLance`, previously coded but
    // never wired). Reach grows both with Sunlance's window (binary) AND with
    // the live basic-fire channel ramp fraction (continuous, 2026-07-20) — a
    // shot fired after 2s of holding visibly projects further/brighter than
    // the cold first shot, so the wind-up mechanic pays off at the muzzle,
    // not just in the fire-rate number. Glass-cannon: more charge, more
    // projected tension, not more mass.
    for (const ev of events) {
      if (ev.t !== "shot-fired") continue;
      const caster = state.players[ev.playerId];
      if (!caster) continue;
      if (resolveClassId(caster.characterId) !== "wizard") continue;
      const aim = Math.atan2(caster.aimY - caster.y, caster.aimX - caster.x);
      const sunlanceLive =
        caster.sunlanceUntilTick !== undefined && caster.sunlanceUntilTick > state.tick;
      const channelFrac = Math.min(1, (caster.channelHoldMs ?? 0) / GEO_CHANNEL_RAMP_MS);
      const base = sunlanceLive ? LANCE_REACH_SUNLANCE : LANCE_REACH_BASE;
      // Anchor at the rig's actual firing hand — NOT the raw sim entity
      // position (`ev.x/ev.y`), which sits at roughly hip/pelvis height.
      // Every other muzzle/hand-anchored construct in this file (melee
      // pivot, held weapons, Ward) resolves the rig hand first and only
      // falls back to a raised offset; this one skipped that step, so the
      // lance's tapered-crystal "stick" shape flashed at the hip instead of
      // the muzzle — reading as an unrelated stray particle rather than the
      // shot's own muzzle flourish (Jake, 2026-07-20: "a stick... coming
      // from the hip or pelvis... doesn't move, just appears then
      // disappears").
      const hand = resolveHand?.(ev.playerId, 0);
      const origin = hand ?? { x: ev.x, y: ev.y - HAND_RAISE };
      // True hitscan (2026-07-20): `hitscanHits` carries the shot's REAL
      // resolved endpoint (player hit / wall block / clean-miss max range —
      // see World.ts's `resolveHitscanShot`). Stretch the SAME tapered-
      // crystal lance shape all the way out to it instead of the short
      // fixed muzzle-flourish reach — `spawnLance`'s taper/chevrons are all
      // proportional to `length`, so it reads as a solid instant beam at
      // any distance, not just at the muzzle. Falls back to the old fixed
      // flourish reach for any non-hitscan delivery (a card could still
      // resolve the wizard's build to a traveling projectile).
      const hitPoint = ev.hitscanHits?.[0];
      const reach = hitPoint
        ? Math.hypot(hitPoint.x - origin.x, hitPoint.y - origin.y)
        : base * (1 + channelFrac * 0.35);
      spawnLance(this.pool, origin, aim, reach, GEOMETRICIAN_TINT);
      // Wall impact — a real bullet hitting terrain leaves a mark, not
      // silence (2026-07-20, bullet-feel juice pass). Reuses the SAME
      // crystal-shatter shape Prism Fan's cast-tell already established
      // (spawnCrystalShards is a generic burst-from-point primitive, not
      // Prism-Fan-exclusive) — the wizard's own crystal bolt breaking apart
      // against a wall, oriented along the shot's own travel direction so
      // the shards scatter forward past the impact point.
      if (hitPoint?.blockedByWall) {
        spawnCrystalShards(this.pool, { x: hitPoint.x, y: hitPoint.y }, aim, GEOMETRICIAN_TINT);
      }
    }

    // Geometrician wind-up glow — the ramping channel itself, drawn
    // continuously while a wizard holds Fire (2026-07-20: "think about the
    // wind up mechanic too" — the mechanic had NO visual before this at all).
    // Read straight off the live snapshot field (`channelHoldMs`) — zero sim
    // edit, same technique as the Ward's `shieldActive` read above.
    this.channelPhaseSec += deltaMs / 1000;
    this.channelLayer.clear();
    for (const pidKey of Object.keys(state.players)) {
      const p = state.players[pidKey as PlayerId];
      if (!p || !p.alive) continue;
      if (resolveClassId(p.characterId) !== "wizard") continue;
      if (p.channelHoldMs === undefined) continue;
      const frac = Math.min(1, p.channelHoldMs / GEO_CHANNEL_RAMP_MS);
      const lead = resolveHand?.(pidKey as PlayerId, 0);
      const at = lead ?? { x: p.x, y: p.y - HAND_RAISE };
      drawChannelCharge(this.channelLayer, at, GEOMETRICIAN_TINT, frac, this.channelPhaseSec);
    }

    // Prism Fan — a cone of faceted crystal shards from the open palm
    // (already-built `spawnCrystalShards`, previously coded but never wired).
    for (const ev of events) {
      if (ev.t !== "ability-activated" || ev.kind !== "prism-fan") continue;
      const caster = state.players[ev.playerId];
      if (!caster) continue;
      const aim = Math.atan2(caster.aimY - caster.y, caster.aimX - caster.x);
      spawnCrystalShards(this.pool, { x: ev.x, y: ev.y }, aim, GEOMETRICIAN_TINT);
    }

    // Instant nova/radius — Shard Ring (ninja) / Flock Pulse (priest). Both
    // are cast-synchronized: the ability-activated event's own x/y IS the
    // epicenter every time (World.ts pushes pendingInstantAoe + the generic
    // event from the SAME nextEntity.x/y in the same switch-case iteration),
    // unlike Shock Ring/Wall Bloom below.
    for (const ev of events) {
      if (ev.t !== "ability-activated") continue;
      if (ev.kind === "shard-ring") {
        spawnNovaBurst(this.pool, { x: ev.x, y: ev.y }, NINJA_SHARD_RING_RADIUS_PX, INTERSTICE_TINT, "slash");
      } else if (ev.kind === "flock-pulse") {
        spawnNovaBurst(this.pool, { x: ev.x, y: ev.y }, SYZ_FLOCK_PULSE_RADIUS_PX, SYZYGIST_TINT, "ooze");
      }
    }

    // Lattice — the wizard's crystal ground-field. Client-tracked zone list
    // (see LightConstruct.ts's drawGroundField header for why this doesn't
    // read state.firePatches), spawned from the cast event and ticked
    // locally so it never needs to know which FireEntity id is "its" zone.
    for (const ev of events) {
      if (ev.t !== "ability-activated" || ev.kind !== "lattice") continue;
      this.latticeZones.push({
        x: ev.x,
        y: ev.y,
        radius: GEO_LATTICE_ZONE_RADIUS_PX,
        elapsedMs: 0,
        durationMs: GEO_LATTICE_ZONE_DURATION_MS,
      });
    }
    this.latticeLayer.clear();
    for (let i = this.latticeZones.length - 1; i >= 0; i--) {
      const zone = this.latticeZones[i]!;
      zone.elapsedMs += deltaMs;
      if (zone.elapsedMs >= zone.durationMs) {
        this.latticeZones.splice(i, 1);
        continue;
      }
      const lifeFrac = 1 - zone.elapsedMs / zone.durationMs;
      drawGroundField(
        this.latticeLayer,
        { x: zone.x, y: zone.y },
        zone.radius,
        GEOMETRICIAN_TINT,
        "shatter",
        lifeFrac,
        this.channelPhaseSec,
      );
    }

    // Blink/teleport streak — Slip Node (wizard), Drift Step (priest), Plant
    // Charge + Bulwark Step (paladin). All four are instant position snaps
    // (World.ts hard-sets x/y — no velocity dash), so the event's x/y is the
    // DESTINATION; the origin comes from last frame's cached position
    // (`lastPos`, updated at the very end of this method). Only Drift Step
    // (priest) draws a connecting trail body — chassis-design-axioms.md CA5
    // reserves the tether/echo afterimage register for Interstice + Syzygist
    // alone, and none of these four abilities happen to be a ninja one, so
    // `spawnBlinkStreak`'s own style-gating (slash/ooze only) already
    // resolves this correctly with no per-ability special-casing needed.
    for (const ev of events) {
      if (ev.t !== "ability-activated") continue;
      if (
        ev.kind !== "slip-node" &&
        ev.kind !== "drift-step" &&
        ev.kind !== "plant-charge" &&
        ev.kind !== "bulwark-step"
      ) {
        continue;
      }
      const caster = state.players[ev.playerId];
      if (!caster) continue;
      const cls = resolveClassId(caster.characterId);
      const tint =
        cls === "ninja" ? INTERSTICE_TINT
        : cls === "paladin" ? KINDLED_TINT
        : cls === "priest" ? SYZYGIST_TINT
        : GEOMETRICIAN_TINT;
      const from = this.lastPos.get(ev.playerId as string) ?? { x: ev.x, y: ev.y };
      spawnBlinkStreak(this.pool, from, { x: ev.x, y: ev.y }, tint, classConstructStyle(cls));
    }

    // Deferred-payoff detection — Ghost Guard's dodge (ninja), Shock Ring's
    // landing slam (paladin), Wall Bloom's wall-kick burst (ninja), Second
    // Wind's heal/energy payoff (ninja), Borrowed Time's debt landing
    // (priest). None of these have a dedicated SimEvent (all five fire
    // silently in combat.ts/World.ts); "the *UntilTick field was defined
    // last frame and is undefined now" is the only tell, and is
    // unambiguous because none of the five fields are ever reset by
    // natural timeout (see `consumedThisFrame`'s doc comment).
    this.auraPhaseSec += deltaMs / 1000; // (also drives the buff-aura scan below)
    for (const pidKey of Object.keys(state.players)) {
      const p = state.players[pidKey as PlayerId];
      if (!p) continue;
      const pos = getPosition(pidKey as PlayerId);
      if (this.consumedThisFrame(this.ghostGuardWasArmed, pidKey, p.ghostGuardChargeUntilTick)) {
        if (pos) spawnGhostGuardDodge(this.pool, pos, INTERSTICE_TINT);
      }
      // Second Wind — self-directed (the caster heals/energizes themself,
      // there's no victim to flourish), so this rides the SAME deferred-
      // payoff shape as Ghost Guard immediately above rather than the
      // victim-positioned empowered-hit flourish Undercut/Read Mark use.
      if (this.consumedThisFrame(this.secondWindWasArmed, pidKey, p.secondWindUntilTick)) {
        if (pos) spawnNovaBurst(this.pool, pos, NINJA_SECOND_WIND_BURST_RADIUS_PX, INTERSTICE_TINT, "slash");
      }
      if (this.consumedThisFrame(this.shockRingWasArmed, pidKey, p.shockRingArmedUntilTick)) {
        if (pos) spawnNovaBurst(this.pool, pos, KIN_SHOCK_RING_RADIUS_PX, KINDLED_TINT, "seal");
        onDeferredNovaImpact?.(pidKey as PlayerId, "shock-ring");
      }
      if (this.consumedThisFrame(this.wallBloomWasArmed, pidKey, p.wallBloomUntilTick)) {
        if (pos) spawnNovaBurst(this.pool, pos, NINJA_WALL_BLOOM_RADIUS_PX, INTERSTICE_TINT, "slash");
        onDeferredNovaImpact?.(pidKey as PlayerId, "wall-bloom");
      }
      // Borrowed Time — self-directed on WHOEVER the drain actually lands
      // on (the caster on a self-cast, or the healed ally on the ally
      // branch — this per-player scan covers both with no extra plumbing,
      // same "an ally needs their own tell" shape the buff-aura block
      // below already relies on for Haste Gift). Priest cool-white/"ooze"
      // style, not Interstice's — this is a Syzygist mechanic.
      if (this.consumedThisFrame(this.debtWasArmed, pidKey, p.debtUntilTick)) {
        if (pos) spawnNovaBurst(this.pool, pos, SYZ_BORROWED_TIME_DEBT_BURST_RADIUS_PX, SYZYGIST_TINT, "ooze");
      }
    }

    // Continuous buff-aura pulse — Overclock (wizard), Rally Light/Aegis
    // Share/Kindled Resolve (paladin), Haste Gift/Self-Lattice (priest).
    // Read straight off each player's own *UntilTick field every frame (the
    // Ward/channel-charge's own persistent-redraw technique) — scanning
    // EVERY player's own field, not just casters from events, is what makes
    // Haste Gift's ally-targeted case (applyHasteToAlly writes onto a
    // DIFFERENT player than the caster) read correctly with no extra
    // plumbing. Fades out over the final 300ms of the window; pops in at
    // full intensity (a fast pop-in is far less noticeable than a pop-out —
    // the Ward's own smooth-crossfade lesson doesn't block on that nuance
    // here).
    this.auraLayerWizard.clear();
    this.auraLayerPaladin.clear();
    this.auraLayerPriest.clear();
    const FADE_MS = 300;
    for (const pidKey of Object.keys(state.players)) {
      const p = state.players[pidKey as PlayerId];
      if (!p || !p.alive) continue;
      const cls = resolveClassId(p.characterId);
      const pos = getPosition(pidKey as PlayerId);
      if (!pos) continue;
      const at = { x: pos.x, y: pos.y - HAND_RAISE * 0.7 };
      const tick = state.tick;
      if (cls === "wizard") {
        if (p.overclockUntilTick !== undefined && p.overclockUntilTick > tick) {
          const intensity = Math.min(1, ((p.overclockUntilTick - tick) * STEP_MS) / FADE_MS);
          drawBuffAura(this.auraLayerWizard, at, GEOMETRICIAN_TINT, "shatter", this.auraPhaseSec, 22, intensity);
        }
      } else if (cls === "paladin") {
        let intensity = 0;
        let radius = 22;
        if (p.rallyLightUntilTick !== undefined && p.rallyLightUntilTick > tick) {
          intensity = Math.max(intensity, Math.min(1, ((p.rallyLightUntilTick - tick) * STEP_MS) / FADE_MS));
          radius = 30; // a shared-radius buff reads bigger than a personal one
        }
        if (p.aegisShareUntilTick !== undefined && p.aegisShareUntilTick > tick) {
          intensity = Math.max(intensity, Math.min(1, ((p.aegisShareUntilTick - tick) * STEP_MS) / FADE_MS));
        }
        if (p.kindledResolveUntilTick !== undefined && p.kindledResolveUntilTick > tick) {
          intensity = Math.max(intensity, Math.min(1, ((p.kindledResolveUntilTick - tick) * STEP_MS) / FADE_MS));
        }
        if (intensity > 0) {
          drawBuffAura(this.auraLayerPaladin, at, KINDLED_TINT, "seal", this.auraPhaseSec, radius, intensity);
        }
      } else if (cls === "priest") {
        let intensity = 0;
        if (p.hasteUntilTick !== undefined && p.hasteUntilTick > tick) {
          intensity = Math.max(intensity, Math.min(1, ((p.hasteUntilTick - tick) * STEP_MS) / FADE_MS));
        }
        if (p.wardAbsorbUntilTick !== undefined && p.wardAbsorbUntilTick > tick) {
          intensity = Math.max(intensity, Math.min(1, ((p.wardAbsorbUntilTick - tick) * STEP_MS) / FADE_MS));
        }
        if (intensity > 0) {
          drawBuffAura(this.auraLayerPriest, at, SYZYGIST_TINT, "ooze", this.auraPhaseSec, 22, intensity);
        }
      }
    }

    // Last-seen position cache — MUST update after every read above (the
    // blink-streak block needs the PRE-move position from THIS pass).
    for (const pidKey of Object.keys(state.players)) {
      const p = state.players[pidKey as PlayerId];
      if (!p || !p.alive) continue;
      this.lastPos.set(pidKey, { x: p.x, y: p.y });
    }
  }

  /** Advance and return this player's 1→2→3→1 cast-tell/ranged-flourish cycle
   *  position (the fixed-3-rotation rule, tracked independently of the melee
   *  swing combo above since these fire on a different cadence). */
  private nextCastTellVariant(key: string): 1 | 2 | 3 {
    const next = toVariant((this.castTellCombo.get(key) ?? 0) + 1);
    this.castTellCombo.set(key, next);
    return next;
  }

  /** Frame-diff helper for a *UntilTick field that's only ever cleared to
   *  `undefined` by actual consumption, never by natural timeout (which
   *  leaves the stale past tick in place) — Ghost Guard's dodge, Shock
   *  Ring's landing slam, and Wall Bloom's wall-kick burst all rely on this
   *  guarantee (see each field's own doc comment in World.ts/combat.ts). A
   *  naive ">tick" comparison would false-positive on ordinary timeout;
   *  this checks definedness instead, which only flips on real consumption. */
  private consumedThisFrame(
    wasDefinedMap: Map<string, boolean>,
    key: string,
    currentValue: number | undefined,
  ): boolean {
    const wasDefined = wasDefinedMap.get(key) ?? false;
    const isDefined = currentValue !== undefined;
    wasDefinedMap.set(key, isDefined);
    return wasDefined && !isDefined;
  }

  destroy(): void {
    this.tetherLayer.destroy();
    this.swingLayerNinja.destroy();
    this.swingLayerPaladin.destroy();
    this.heldLayerNinja.destroy();
    this.heldLayerPaladin.destroy();
    this.wardLayer.destroy();
    this.wardWasHeld.clear();
    this.channelLayer.destroy();
    this.latticeLayer.destroy();
    this.latticeZones.length = 0;
    this.lastPos.clear();
    this.ghostGuardWasArmed.clear();
    this.shockRingWasArmed.clear();
    this.wallBloomWasArmed.clear();
    this.auraLayerWizard.destroy();
    this.auraLayerPaladin.destroy();
    this.auraLayerPriest.destroy();
    this.swings.length = 0;
    this.slashCombo.clear();
    this.castTellCombo.clear();
    this.memo.moteCadence.clear();
    this.memo.lastVictimPos.clear();
    this.memo.active.clear();
  }
}
