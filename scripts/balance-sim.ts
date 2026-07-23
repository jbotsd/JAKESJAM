// Headless, non-networked, non-Phaser balance-simulation harness.
//
// Drives `stepWithRuntime` (client/src/sim/World.ts) directly — the exact
// pure-sim function every `.test.ts` file under client/src/sim/__tests__
// already calls — with a cheap PER-CLASS-AWARE heuristic bot policy on BOTH
// sides. No MatchHost, no server, no networking, no draft/round FSM. This
// is a deliberately scoped FIRST PASS (see the "Scope limits" section of
// the printed report / JSON) — a coarse balance signal, not gospel.
//
// Run: `bun scripts/balance-sim.ts`
//
// Produces:
//   1. A win-rate matrix (row class over N trials vs every opponent class).
//   2. Per-class ability-usage / damage-source breakdown.
//   3. A time-to-kill (TTK) distribution.
//   4. A "possibly unimplemented / no-op in sim" ability flag list, built
//      from the same event stream (see "No-op detection" below).

import { createRuntime, stepWithRuntime } from "../client/src/sim/World.js";
import { boxworksMini } from "../client/src/sim/data/boxworks-mini.js";
import { resolvePlayerBuild } from "../client/src/sim/weapon.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  EntityId,
  type CharacterArchetype,
  type InputFrame,
  type PlayerEntity,
  type WorldState,
  type SimEvent,
} from "../client/src/sim/types.js";

// ── Constants ────────────────────────────────────────────────────────────

// Bit layout hardcoded here rather than importing client/src/net/protocol.ts
// (which pulls in @msgpack/msgpack + wire-format types this harness doesn't
// need) — mirrors client/src/sim/__tests__/*.test.ts's own established
// precedent of hardcoding these locally. Authoritative source: the
// `InputBitfield` doc comment in client/src/sim/types.ts + net/protocol.ts's
// `InputBit` const, cross-checked to agree.
const LEFT_BIT = 1 << 0;
const RIGHT_BIT = 1 << 1;
const FIRE_BIT = 1 << 6;
const DASH_BIT = 1 << 9;
const SLOT_BIT = [1 << 10, 1 << 11, 1 << 12] as const;

const DT_MS = 1000 / 60;
const MAX_TICKS = 30 * 60; // 30s hard safety cap (30s * 60 ticks/s).
const TRIALS_PER_PAIR = 150;

// Effect-detection window for the no-op pass: ~500ms after an
// `ability-activated` event. Documented, approximate — see "No-op
// detection" section below.
const EFFECT_WINDOW_TICKS = 30;
// Same-tick position/velocity jump thresholds used to detect a movement
// ability's signature displacement. Chosen well above ordinary per-tick
// ground movement (maxGroundSpeed 362px/s * DT_MS/1000 ≈ 6px/tick) and
// above the boosted per-tick delta a held Dash could produce (~15.7px/tick).
// The policy never presses Jump. It DOES now press Dash (per-class evasion/
// gap-close, 2026-07-23) — attribution is preserved by a hard mutual-
// exclusion guard: no slot bit is ever pressed on a dash tick, and slot
// presses stay suppressed for SLOT_QUIET_AFTER_DASH_TICKS after every dash
// (covers the dash's 210ms active burst + 200ms recovery decel, both of
// which can exceed VELOCITY_JUMP_PXPS within one tick), so a large jump on
// an activation tick is still attributable to the ability alone.
const MOVEMENT_JUMP_PX = 20;
const VELOCITY_JUMP_PXPS = 260;

// ── Class identity: fixed representative 3-ability loadouts ────────────
//
// There is no `classId` field on PlayerEntity — "class" is entirely
// implicit in which cards are in `player.cards` (cardTypes.ts). We bypass
// the live draft/offer-roll system entirely and construct each player with
// a fixed, representative loadout: one offense/single "does damage" verb,
// one aoe/mark "control" verb, one defense/buff "utility" verb, picked from
// each class's own v1 catalog (client/src/sim/data/cards.ts). A reasonable
// generalist pick, not an exhaustive kit — see docs/class-ability-catalogs-v1.md.
type ClassId = "wizard" | "ninja" | "paladin" | "priest";
const CLASSES: ClassId[] = ["wizard", "ninja", "paladin", "priest"];
// Dev-id → persona name (docs/classes-goal.md § Naming).
const PERSONA: Record<ClassId, string> = {
  wizard: "Geometrician",
  ninja: "Interstice",
  paladin: "Kindled",
  priest: "Syzygist",
};
const CHASSIS: Record<ClassId, CharacterArchetype> = {
  wizard: "balanced",
  ninja: "sprinter",
  paladin: "heavy",
  priest: "shielded",
};
const LOADOUTS: Record<ClassId, string[]> = {
  // sunlance (offense, self dmg-window) / prism-fan (aoe cone) / facet-break (single mark).
  wizard: ["sunlance", "prism-fan", "facet-break"],
  // sunspike (single high dmg) / judgment-line (single mark) / bastion-pulse (defense, shield tick).
  paladin: ["sunspike", "judgment-line", "bastion-pulse"],
  // bleed-tithe (offense, self-guiding dmg) / focus-hex (single mark) / glass-ward (defense, self-fallback).
  priest: ["bleed-tithe", "focus-hex", "glass-ward"],
  // needle (single, self-guiding gap-close dmg) / shard-ring (aoe) / read-mark (single mark).
  ninja: ["needle", "shard-ring", "read-mark"],
};
// All 12 loadout abilities above have a valid solo/1v1 target (self,
// enemy, or an explicit self-fallback per their own card description) —
// none structurally REQUIRE an ally to do anything, so this harness's
// 1v1-only match loop can exercise every one of them at least once. This
// was a deliberate pick constraint (see "No-op detection" section): the
// broader class catalogs contain other cards that WOULD be ally- or
// multi-enemy-starved in a 1v1 (e.g. Priest's Severance needs a
// pre-cursed target from Bleed Tithe landing first; Contagion needs a
// SECOND enemy to spread fire to) — deliberately not picked here.

// ── Kindled ability leaderboard: exercise all 12 catalog abilities ──────
//
// `LOADOUTS.paladin` above only tests 3/12 Kindled abilities. Jake wants to
// use this harness's per-ability data to cut Kindled's catalog from 12 to
// 10 (parity with the other 3 classes' 10-ability catalogs) — that needs
// comparable usage/damage/kill/no-effect data for ALL 12
// (client/src/sim/__tests__/kindledCatalog.test.ts's KINDLED_ABILITY_IDS
// is the authoritative full list). Three more 3-ability variant loadouts
// below cover the remaining 9; the grouping itself is arbitrary — a
// vehicle to get every ability activated at a comparable rate, not a
// design statement about which abilities belong together.
const KINDLED_VARIANTS: { label: string; cards: string[] }[] = [
  { label: "baseline", cards: LOADOUTS.paladin }, // sunspike / judgment-line / bastion-pulse
  { label: "variant-b", cards: ["unbroken-seal", "consecrated-field", "aegis-share"] },
  { label: "variant-c", cards: ["plant-charge", "retribution-edge", "shock-ring"] },
  { label: "variant-d", cards: ["rally-light", "kindled-resolve", "bulwark-step"] },
];

// ── mkPlayer / mkState (mirrors client/src/sim/__tests__/kindledCatalog.test.ts) ──

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  characterId: CharacterArchetype,
  cards: string[],
): PlayerEntity {
  return {
    id,
    characterId,
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards,
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

function mkState(players: PlayerEntity[], rngSeed: number): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0),
    rngState: rngSeed >>> 0,
    players: playerMap,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

// ── Bot policy: PER-CLASS-AWARE heuristic, both sides ───────────────────
//
// 2026-07-23 (convergence-goal.md Track B): the previous ONE-shared-policy
// design — every class holding the same 60-120px band — made the matrix a
// POLICY artifact, not a balance signal: Syzygist's homing tendrils can't
// miss a target that never dodges (~100% vs everyone), and Kindled — whose
// entire kit is the Kindled Edge melee arc, it never fires the gun — lost
// every cross-class cell 100% because the shared band only sometimes
// straddled its 84px reach and nothing ever protected its slow approach.
// Verified identical pre-/post-chassis-stats, so it was the policy.
//
// The policy is still deliberately cheap (a balance-signal bot, not a
// player-facing one), but now reads a per-class parameter row
// (CLASS_POLICY, prior art: server/src/worldBots.ts's isMeleeClass +
// meleeEngageRange/meleeFireRange split):
// - Class-aware engagement band: Geometrician keeps gun range, Syzygist
//   holds mid (tendrils have a 2.6s fuse), Kindled CLOSES to inside
//   EDGE_RANGE=84 and never backs off, Interstice alternates a mid-range
//   hold with periodic melee commit windows (seeded phase offset).
// - Class-aware Fire gate: melee classes only pulse Fire inside their own
//   blade reach (EDGE_RANGE=84 / SLASH_RANGE=78) instead of swinging air
//   from gun range; ranged classes keep FIRE_RANGE.
// - Homing evasion (the intended tendril counter): any inbound enemy
//   projectile slower than RUN_DODGE_MAX_PROJ_SPEED (tendrils fly
//   SYZ_TENDRIL_SPEED=320 < every chassis run speed except heavy's 318.6)
//   triggers a run-away dodge; Interstice spends its dash on evasion
//   (i-frames), Kindled spends its dash CLOSING (a dash is also a moving
//   shield + dash-bash, so the lunge is both its gap-closer and its
//   projectile answer).
// - Pulses Fire (press-one-tick, release-one-tick) when in range. A pulse
//   (not a hold) is required because World.ts routes Fire through a
//   RISING-EDGE melee FSM for ninja/paladin — holding it down only
//   triggers once. Wizard/priest's stepWeapon reads Fire as a level
//   trigger, so pulsing just fires slightly bursty; harmless.
// - Pulses each drafted ability slot (1/2/3) whenever it's off cooldown,
//   same press/release shape — World.ts's slot-activation loop is ALSO
//   strictly rising-edge. A "single" role ability (needs a live nearby
//   target — mirrors worldBots.ts's role-aware target gate) is only
//   pressed once the enemy is within SINGLE_ROLE_RANGE; every other role
//   fires on cooldown alone.
// - Never presses Jump/Shield/Crouch. Dash IS pressed now, but never on a
//   slot-press tick and with a quiet window after (see MOVEMENT_JUMP_PX's
//   comment) so the no-op detector's movement-jump attribution survives.
const FIRE_RANGE = 560;
const SINGLE_ROLE_RANGE = 620;

type ClassPolicy = {
  /** Preferred hold distance (px). */
  engage: number;
  /** Approach when dist > engage + outerSlack. */
  outerSlack: number;
  /** Back off when dist < engage - innerSlack (engage <= innerSlack ⇒ never
   *  backs off — Kindled's whole kit is at arm's length). */
  innerSlack: number;
  /** Pulse Fire only inside this (melee classes: just under blade reach). */
  fireWithin: number;
  /** Spend dash lunging AT the enemy (gap-close + moving-shield + bash). */
  dashToClose: boolean;
  /** Spend dash dodging inbound projectiles (dash i-frames). */
  dashToEvade: boolean;
  /** Interstice's hold↔melee-commit alternation (ticks); null = static band. */
  commit: { holdTicks: number; commitTicks: number; commitEngage: number } | null;
};

const CLASS_POLICY: Record<ClassId, ClassPolicy> = {
  // Geometrician: keep gun range (worldBots engageRange=380 prior art).
  wizard: { engage: 380, outerSlack: 20, innerSlack: 60, fireWithin: FIRE_RANGE, dashToClose: false, dashToEvade: false, commit: null },
  // Syzygist: mid-range — tendrils home with a long fuse, no need to crowd.
  priest: { engage: 300, outerSlack: 20, innerSlack: 60, fireWithin: FIRE_RANGE, dashToClose: false, dashToEvade: false, commit: null },
  // Kindled: close to inside EDGE_RANGE=84 and stay there; swing only in
  // reach (fireWithin 80 leaves a whisker of margin for aim jitter).
  paladin: { engage: 56, outerSlack: 14, innerSlack: 56, fireWithin: 80, dashToClose: true, dashToEvade: false, commit: null },
  // Interstice: mid-range hold with dash evasion, melee (SLASH_RANGE=78)
  // during periodic commit windows. commitTicks must be long enough to
  // actually CLOSE on a kiting target: sprinter 413px/s vs balanced 362
  // px/s only gains ~51px/s, so covering a ~150px band gap takes ~3s —
  // a 90-tick (1.5s) first draft never reached melee and lost 100% to
  // both ranged classes (verified run 1).
  ninja: { engage: 190, outerSlack: 30, innerSlack: 50, fireWithin: 72, dashToClose: false, dashToEvade: true, commit: { holdTicks: 110, commitTicks: 200, commitEngage: 52 } },
};

/** Per-tick chance to freeze movement keys for one tick (a micro-stutter).
 *  This is the harness's main TRAJECTORY de-correlator: aim jitter alone
 *  proved too weak up close (run 1: melee + priest MIRROR cells collapsed
 *  back to hard 0%/100% spawn-side artifacts — at 60px the scaled aim
 *  jitter stays inside both melee arcs, so two symmetric closers replay
 *  the same first-swing trade every trial). One hesitation roll per tick
 *  per side, drawn unconditionally so stream shapes stay uniform. */
const HESITATE_CHANCE = 0.08;

/** Uniform random delay (0..N-1 ticks, seeded per side) before the FIRST
 *  Fire press each time a side enters its own fire range. Range is mutual
 *  — in a mirror both sides cross the gate on the SAME tick, press Fire
 *  the same tick, and land contact the same tick, and stepWithRuntime
 *  resolves players in sorted-id order ("col" < "row"), so the col side
 *  won every simultaneous melee trade: run 2 still had INT/KIN mirror
 *  cells at a hard 0% for row (movement hesitation can't desync a SHARED
 *  distance). A per-side uniform entry delay makes first-contact order a
 *  seeded coin flip (same-tick residual ≈ 1/N); the ~tick-scale delay is
 *  negligible for ranged cadence. */
const FIRE_ENTRY_JITTER_TICKS = 9;

// Local dash bookkeeping (the sim's own cooldown lives in runtime-internal
// movement memory this harness can't read): DASH_COOLDOWN_MS 3000 + active
// 210 + recovery 200 ≈ 3410ms ≈ 205 ticks — slightly conservative is fine,
// a bot that dashes a beat late loses nothing measurable.
const DASH_LOCAL_COOLDOWN_TICKS = 205;
/** No slot presses for this long after a dash — see MOVEMENT_JUMP_PX. */
const SLOT_QUIET_AFTER_DASH_TICKS = 30;
/** Scan radius / alignment gate for inbound-projectile threat detection
 *  (same alignment-dot shape as worldBots.inboundThreat, wider radius —
 *  tendrils are slow, dodging early is the point). */
const THREAT_RADIUS_PX = 340;
const THREAT_ALIGN_MIN = 0.5;
/** Only run-dodge projectiles slow enough to plausibly outrun (tendrils
 *  320px/s; wizard bolts at 650 are not dodgeable on foot — don't turn
 *  ranged duels into permanent flight). */
const RUN_DODGE_MAX_PROJ_SPEED = 480;
/** Kindled lunge window: close enough to connect the follow-up melee,
 *  far enough that the ~197px dash travel isn't wasted overshoot. */
const DASH_CLOSE_MIN_PX = 150;
const DASH_CLOSE_MAX_PX = 460;

type PulseState = { fire: boolean; slot: [boolean, boolean, boolean] };
function freshPulse(): PulseState {
  return { fire: false, slot: [false, false, false] };
}

/** Per-side policy state for one trial (pulse edges + dash timers + the
 *  seeded commit-cycle phase). Drawing the phase offset from the side's own
 *  jitter stream keeps the harness fully seed-deterministic AND desyncs the
 *  two sides' commit windows in a ninja mirror (same reasoning as the
 *  independent jitter streams — see AIM_JITTER_PX's comment). The one
 *  rand() draw happens for every class (cycle=1 ⇒ offset 0) so all four
 *  classes consume identical stream shapes. */
type SideState = {
  classId: ClassId;
  pulse: PulseState;
  dashReadyAtTick: number;
  slotQuietUntilTick: number;
  commitPhase: number;
  /** Fire-range entry latch + first-press delay — see FIRE_ENTRY_JITTER_TICKS. */
  wasInFireRange: boolean;
  fireDelayUntilTick: number;
};
function mkSideState(classId: ClassId, rand: () => number): SideState {
  const pol = CLASS_POLICY[classId];
  const cycle = pol.commit ? pol.commit.holdTicks + pol.commit.commitTicks : 1;
  return {
    classId,
    pulse: freshPulse(),
    dashReadyAtTick: 0,
    slotQuietUntilTick: 0,
    commitPhase: Math.floor(rand() * cycle),
    wasInFireRange: false,
    fireDelayUntilTick: 0,
  };
}

/** Nearest inbound enemy-owned projectile (heading at us, within scan
 *  radius) — the evasion trigger. Deterministic: Record iteration order is
 *  insertion order, which is itself deterministic per seed. */
function inboundThreat(
  state: WorldState,
  self: PlayerEntity,
  enemyId: PlayerId,
): { x: number; y: number; vx: number; vy: number } | null {
  let best: { x: number; y: number; vx: number; vy: number } | null = null;
  let bestD = Infinity;
  for (const id in state.projectiles) {
    const pr = state.projectiles[id as unknown as EntityId]!;
    if (pr.ownerId !== enemyId) continue;
    const dx = self.x - pr.x;
    const dy = self.y - pr.y;
    const d = Math.hypot(dx, dy);
    if (d > THREAT_RADIUS_PX || d < 1e-3) continue;
    const speed = Math.hypot(pr.vx, pr.vy) || 1;
    const align = (pr.vx * dx + pr.vy * dy) / (speed * d);
    if (align < THREAT_ALIGN_MIN) continue;
    if (d < bestD) {
      bestD = d;
      best = pr;
    }
  }
  return best;
}

// Deterministic mulberry32 PRNG — same tiny generator shape as
// server/src/worldBots.ts's own `rng()` (reimplemented standalone here per
// the task's "crib the targeting math if useful, reimplement standalone"
// guidance; not imported since worldBots.ts is coupled to MatchHost).
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
// Small aim-error jitter, same motivating idea as worldBots.ts's own
// `aimErrorPx` ("deliberately sloppy so humans can out-aim them") — here
// it exists for a different reason: with a fully deterministic bot policy
// and zero randomness anywhere else in the decision loop, every trial of a
// given (rowClass, colClass, spawn-side) pairing produces the IDENTICAL
// tick-by-tick trajectory regardless of RNG seed, collapsing every matrix
// cell (including mirror matchups) to a hard 0% or 100% — verified: the
// first run of this harness (pre-jitter) showed EVERY cell in the 4×4
// matrix at exactly 0 or 60/60, including all four mirror matchups always
// going the same direction. A small jitter breaks that determinism so N
// trials actually sample a distribution instead of replaying one outcome
// N times.
const AIM_JITTER_PX = 60;

function decideInput(
  state: WorldState,
  selfId: PlayerId,
  enemyId: PlayerId,
  actives: { kind: string; role?: string }[],
  side: SideState,
  seq: number,
  rand: () => number,
): InputFrame {
  const self = state.players[selfId]!;
  const enemy = state.players[enemyId]!;
  const pol = CLASS_POLICY[side.classId];
  const pulse = side.pulse;
  const tick = state.tick as number;
  let keys = 0;
  let aimX = self.aimX;
  let aimY = self.aimY;

  if (self.alive && enemy.alive) {
    const dx = enemy.x - self.x;
    const dy = enemy.y - self.y;
    const dist = Math.hypot(dx, dy);
    // Aim jitter scaled down at close range: a flat ±30px at a 60px melee
    // distance is up to ~27° of arc-aim error — enough to swing the Edge's
    // 70° cone off a body the policy deliberately walked into. Same TWO
    // rand() draws per tick for every class at every range, so stream
    // shapes stay identical (see AIM_JITTER_PX's determinism comment).
    const jitter = AIM_JITTER_PX * Math.min(1, dist / 300);
    aimX = enemy.x + (rand() - 0.5) * jitter;
    aimY = enemy.y + (rand() - 0.5) * jitter;
    // Trajectory de-correlator — see HESITATE_CHANCE. Drawn every tick
    // regardless of outcome so both sides' streams stay shape-identical.
    const hesitate = rand() < HESITATE_CHANCE;

    // Engagement target — Interstice alternates hold ↔ melee commit.
    let engage = pol.engage;
    let inCommit = false;
    if (pol.commit) {
      const cycle = pol.commit.holdTicks + pol.commit.commitTicks;
      const phase = (tick + side.commitPhase) % cycle;
      if (phase >= pol.commit.holdTicks) {
        engage = pol.commit.commitEngage;
        inCommit = true;
      }
    }

    if (dist > engage + pol.outerSlack) {
      keys |= dx < 0 ? LEFT_BIT : RIGHT_BIT;
    } else if (dist < engage - pol.innerSlack) {
      keys |= dx < 0 ? RIGHT_BIT : LEFT_BIT;
    }

    // ── Evasion / dash layer ──────────────────────────────────────────
    const threat = inboundThreat(state, self, enemyId);
    const dashReady = tick >= side.dashReadyAtTick;
    let dashed = false;
    if (threat) {
      const projSpeed = Math.hypot(threat.vx, threat.vy);
      if (pol.dashToEvade && dashReady) {
        // Dash through/away from the projectile (dash direction = aim
        // vector, player.ts's DASH BASH block; kept flat — no air-dash
        // bookkeeping to reason about). Mid-commit the dash goes TOWARD
        // the enemy — i-frames through the tendril AND ~197px of gap
        // closed (dash-through is the ninja's own energy verb); on hold
        // it goes defensively away. One aimed-off tick costs one fire
        // opportunity; the i-frames are worth far more.
        const dir = inCommit
          ? ((Math.sign(dx) || 1) as -1 | 1)
          : Math.sign(self.x - threat.x) || (dx < 0 ? 1 : -1);
        aimX = self.x + dir * 100;
        aimY = self.y;
        keys = (keys & ~(LEFT_BIT | RIGHT_BIT)) | DASH_BIT | (dir < 0 ? LEFT_BIT : RIGHT_BIT);
        side.dashReadyAtTick = tick + DASH_LOCAL_COOLDOWN_TICKS;
        side.slotQuietUntilTick = tick + SLOT_QUIET_AFTER_DASH_TICKS;
        dashed = true;
      } else if (
        projSpeed < RUN_DODGE_MAX_PROJ_SPEED &&
        !inCommit &&
        (!pol.dashToClose || dist > 260)
      ) {
        // Outrun the slow homer. Two exceptions keep the closers honest:
        // Kindled inside 260px keeps pressing in — abandoning a nearly-
        // closed gap to jog from a tendril it can't outrun anyway (318.6
        // vs 320 px/s) re-creates the guaranteed-loss artifact this
        // rewrite exists to fix — and Interstice mid-commit stays
        // committed (run 1 showed dodge-running during commits cancels
        // its ~51px/s closing edge, so it never reached melee at all).
        const dir = Math.sign(self.x - threat.x) || (dx < 0 ? 1 : -1);
        keys = (keys & ~(LEFT_BIT | RIGHT_BIT)) | (dir < 0 ? LEFT_BIT : RIGHT_BIT);
      }
    }
    if (!dashed && pol.dashToClose && dashReady && dist > DASH_CLOSE_MIN_PX && dist < DASH_CLOSE_MAX_PX) {
      // Kindled lunge: aim dead at the enemy so the dash tracks the gap —
      // ~197px of travel, a moving shield the whole way, dash-bash on
      // body contact, and it exits inside Edge range.
      aimX = enemy.x;
      aimY = enemy.y;
      keys |= DASH_BIT | (dx < 0 ? LEFT_BIT : RIGHT_BIT);
      side.dashReadyAtTick = tick + DASH_LOCAL_COOLDOWN_TICKS;
      side.slotQuietUntilTick = tick + SLOT_QUIET_AFTER_DASH_TICKS;
      dashed = true;
    }

    // Micro-stutter (movement keys only — never eats a dash tick).
    if (hesitate && !dashed) {
      keys &= ~(LEFT_BIT | RIGHT_BIT);
    }

    // ── Fire pulse — class-aware range gate + entry-desync delay ──────
    if (dist < pol.fireWithin) {
      if (!side.wasInFireRange) {
        side.wasInFireRange = true;
        side.fireDelayUntilTick = tick + Math.floor(rand() * FIRE_ENTRY_JITTER_TICKS);
      }
      if (!dashed && tick >= side.fireDelayUntilTick) {
        if (!pulse.fire) {
          keys |= FIRE_BIT;
          pulse.fire = true;
        } else {
          pulse.fire = false;
        }
      } else {
        pulse.fire = false;
      }
    } else {
      side.wasInFireRange = false;
      pulse.fire = false;
    }

    // ── Drafted ability slots (suppressed around dashes — see
    //    MOVEMENT_JUMP_PX's attribution comment) ────────────────────────
    const slotsQuiet = dashed || tick < side.slotQuietUntilTick;
    for (let slot = 0; slot < actives.length && slot < 3; slot++) {
      const active = actives[slot]!;
      const cdUntil =
        slot === 0
          ? self.slot1CooldownUntilTick
          : slot === 1
            ? self.slot2CooldownUntilTick
            : self.slot3CooldownUntilTick;
      const ready = cdUntil === undefined || cdUntil <= state.tick;
      const needsTarget = active.role === "single";
      const want = !slotsQuiet && ready && (!needsTarget || dist < SINGLE_ROLE_RANGE);
      if (want) {
        if (!pulse.slot[slot]) {
          keys |= SLOT_BIT[slot]!;
          pulse.slot[slot] = true;
        } else {
          pulse.slot[slot] = false;
        }
      } else {
        pulse.slot[slot] = false;
      }
    }
  }

  return {
    seq: InputSeq(seq),
    tick: state.tick,
    keys,
    aimX,
    aimY,
    dtMs: DT_MS,
  };
}

// ── Trial data structures ───────────────────────────────────────────────

type AbilityStat = { activations: number; hits: number; damage: number; kills: number };
type ClassAggregate = {
  matches: number;
  wins: number;
  abilities: Map<string, AbilityStat>;
  basicFire: { hits: number; damage: number; kills: number };
};

type NoEffectObs = { activations: number; withEffect: number; allyStarved: boolean };

type TrialOutcome = {
  winner: "row" | "col" | null; // null = timeout or double-KO draw
  timedOut: boolean;
  doubleKO: boolean;
  ttkMs: number | null;
};

function newClassAggregate(): ClassAggregate {
  return { matches: 0, wins: 0, abilities: new Map(), basicFire: { hits: 0, damage: 0, kills: 0 } };
}
function getAbilityStat(agg: ClassAggregate, kind: string): AbilityStat {
  let s = agg.abilities.get(kind);
  if (!s) {
    s = { activations: 0, hits: 0, damage: 0, kills: 0 };
    agg.abilities.set(kind, s);
  }
  return s;
}

// Ignore-list for the no-op self-state diff: routine per-tick bookkeeping
// that changes on EVERY tick or EVERY activation regardless of whether the
// ability actually did anything, so including them would make every
// activation look "effective" (false positive) or every dead-press look
// "no effect" for the wrong reason. x/y/vx/vy are handled separately via
// the explicit movement-jump check instead of the generic diff, since for
// movement abilities they're the intended signal but for everything else
// they're just ordinary walking noise.
const IGNORE_SELF_KEYS = new Set<string>([
  "id",
  "characterId",
  "x",
  "y",
  "vx",
  "vy",
  "health",
  "weaponId",
  "cards",
  "fireCooldownMs",
  "ammo",
  "lastProcessedInputSeq",
  "crouching",
  "alive",
  "burnTickLastApplied",
  "regenTickLastApplied",
  "jetpackFuel",
  "abilityCharge", // separate Emission-charge system, unrelated to slot cards.
  "teamId",
]);
// Enemy diff is intentionally a NARROW curated list, not a generic diff —
// the enemy is running its OWN independent policy every tick (movement,
// its own ability presses, its own weapon cooldowns), so a generic diff
// would attribute the enemy's own actions to OUR player's ability. These
// are the fields World.ts's ability switch is known to write directly onto
// a victim's entity (status effects), per client/src/sim/types.ts's
// PlayerEntity doc comments.
const ENEMY_WATCH_KEYS = [
  "slowedUntilTick",
  "slowMultiplier",
  "burnUntilTick",
  "burnDps",
  "freezeUntilTick",
  "freezeMultiplier",
] as const;

type PendingObs = {
  playerId: PlayerId;
  classId: ClassId;
  kind: string;
  slot: number;
  deadlineTick: number;
  preSelf: PlayerEntity;
  preEnemy: PlayerEntity;
  ignoreKeys: Set<string>;
  effect: boolean;
};

// ── One trial: a single first-to-die 1v1 duel ───────────────────────────
//
// Scope choice (documented per the task): a full round/draft/target-score
// match (round.ts's FSM) is NOT wired up here — every trial is a single
// first-to-die duel, decided the instant either player's `alive` flips
// false. This is much simpler than the live match structure and is a
// material scope limit: no comeback-via-draft-pick dynamics, no multi-round
// score pressure, no card offer variance — see the final report's "Scope
// limits" section.
function runTrial(
  rowClass: ClassId,
  colClass: ClassId,
  seed: number,
  rowAgg: ClassAggregate,
  colAgg: ClassAggregate,
  noEffect: Map<string, NoEffectObs>,
  // Additive params for the Kindled ability-leaderboard extension below —
  // every existing call site omits these and gets EXACTLY the prior
  // behavior (LOADOUTS[rowClass]/LOADOUTS[colClass], both sides recorded).
  // rowCardsOverride/colCardsOverride let a caller swap in an arbitrary
  // loadout for a class's chassis without inventing a new ClassId (e.g.
  // testing a Kindled ability-variant kit that isn't `LOADOUTS.paladin`);
  // noEffectSides restricts which side's ability-activated observations
  // get finalized into `noEffect`, so a fixed "reference opponent" run
  // repeatedly against several row-side variants doesn't have the
  // opponent's own kit re-polluting the sample every single run.
  rowCardsOverride?: string[],
  colCardsOverride?: string[],
  noEffectSides: "both" | "row" | "col" = "both",
): TrialOutcome {
  const runtime = createRuntime(boxworksMini);
  const ROW = PlayerId("row");
  const COL = PlayerId("col");
  const spawnA = boxworksMini.spawns[0]!;
  const spawnB = boxworksMini.spawns[1]!;
  const rowCards = rowCardsOverride ?? LOADOUTS[rowClass];
  const colCards = colCardsOverride ?? LOADOUTS[colClass];

  let state = mkState(
    [
      mkPlayer(ROW, spawnA.x, spawnA.y, CHASSIS[rowClass], rowCards),
      mkPlayer(COL, spawnB.x, spawnB.y, CHASSIS[colClass], colCards),
    ],
    seed,
  );

  const rowBuild = resolvePlayerBuild(state.players[ROW]!);
  const colBuild = resolvePlayerBuild(state.players[COL]!);
  const rowActives = rowBuild.actives.map((a) => ({ kind: a.kind, role: a.role }));
  const colActives = colBuild.actives.map((a) => ({ kind: a.kind, role: a.role }));

  // Independent jitter streams per side (distinct seed offsets) so ROW and
  // COL don't draw identical jitter sequences even in a mirror matchup.
  const rowRand = mulberry32(seed * 2 + 1);
  const colRand = mulberry32(seed * 2 + 2);
  const rowSide = mkSideState(rowClass, rowRand);
  const colSide = mkSideState(colClass, colRand);

  // Projectile/firePatch id → ability kind tagging (per-player). Built by
  // diffing state.projectiles/state.firePatches for newly-appeared entries
  // owned by a player in the SAME tick (empirically confirmed reliable:
  // World.ts's slot-activation switch and its projectile/firePatch spawns
  // all happen synchronously within the one stepWithRuntime call that also
  // pushes the ability-activated event) — we also check the following tick
  // defensively, at negligible cost.
  const projectileTag = new Map<number, { classId: ClassId; kind: string; ownerId: PlayerId }>();
  const firePatchTag = new Map<number, { classId: ClassId; kind: string; ownerId: PlayerId }>();
  const recentActivation = new Map<PlayerId, { kind: string; tick: number }>();
  const KILL_ATTRIBUTION_LOOKBACK_MS = 2000;

  const classOf: Record<string, ClassId> = { [ROW]: rowClass, [COL]: colClass };
  const aggOf: Record<string, ClassAggregate> = { [ROW]: rowAgg, [COL]: colAgg };

  const openObs: PendingObs[] = [];
  const finalizeIfWanted = (obs: PendingObs): void => {
    if (noEffectSides === "both" || (noEffectSides === "row" && obs.playerId === ROW) || (noEffectSides === "col" && obs.playerId === COL)) {
      finalizeObservation(obs, noEffect);
    }
  };

  let winner: "row" | "col" | null = null;
  let timedOut = false;
  let doubleKO = false;
  let ttkMs: number | null = null;
  let seq = 1;

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    let rowDied = false;
    let colDied = false;
    const rowFrame = decideInput(state, ROW, COL, rowActives, rowSide, seq, rowRand);
    const colFrame = decideInput(state, COL, ROW, colActives, colSide, seq, colRand);
    seq += 1;

    const prevProjectiles = state.projectiles;
    const prevFirePatches = state.firePatches;
    const preSelfRow = state.players[ROW]!;
    const preSelfCol = state.players[COL]!;

    const res = stepWithRuntime(state, runtime, { [ROW]: rowFrame, [COL]: colFrame }, DT_MS);
    const next = res.state;

    // 1. ability-activated → open a no-op observation window + remember for
    //    kill-attribution lookback.
    for (const ev of res.events) {
      if (ev.t !== "ability-activated") continue;
      const cid = classOf[ev.playerId]!;
      const agg = aggOf[ev.playerId]!;
      getAbilityStat(agg, ev.kind).activations += 1;
      recentActivation.set(ev.playerId, { kind: ev.kind, tick });

      const preSelf = ev.playerId === ROW ? preSelfRow : preSelfCol;
      const preEnemy = ev.playerId === ROW ? preSelfCol : preSelfRow;
      const ignoreKeys = new Set(IGNORE_SELF_KEYS);
      ignoreKeys.add(
        ev.slot === 0 ? "slot1CooldownUntilTick" : ev.slot === 1 ? "slot2CooldownUntilTick" : "slot3CooldownUntilTick",
      );
      const obs: PendingObs = {
        playerId: ev.playerId,
        classId: cid,
        kind: ev.kind,
        slot: ev.slot,
        deadlineTick: tick + EFFECT_WINDOW_TICKS,
        preSelf,
        preEnemy,
        ignoreKeys,
        effect: false,
      };
      // Same-tick movement-jump + same-tick self/enemy field diff, checked
      // immediately against this step's result before the obs is even
      // pushed onto the open list (covers instant, single-tick effects).
      checkImmediateEffect(obs, next, ROW, COL);
      openObs.push(obs);
    }

    // 2. Tag newly-spawned projectiles/firePatches owned by whoever just
    //    activated an ability this tick (or the tick immediately prior).
    tagNewOwned(prevProjectiles, next.projectiles, recentActivation, tick, classOf, projectileTag);
    tagNewOwned(prevFirePatches, next.firePatches, recentActivation, tick, classOf, firePatchTag);

    // 3. Advance every open no-op observation with this tick's evidence,
    //    then close out (finalize into `noEffect`) any whose ~500ms deadline
    //    has passed — the window is a hard cap, not just a soft hint, so a
    //    kill/hit long after an activation never gets misattributed to it.
    if (openObs.length > 0) {
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < openObs.length; readIdx++) {
        const obs = openObs[readIdx]!;
        if (!obs.effect && tick <= obs.deadlineTick) {
          advanceObservation(obs, next, ROW, COL, projectileTag, firePatchTag, res.events);
        }
        if (obs.effect || tick >= obs.deadlineTick) {
          finalizeIfWanted(obs);
        } else {
          openObs[writeIdx] = obs;
          writeIdx += 1;
        }
      }
      openObs.length = writeIdx;
    }

    // 4. hit-confirmed → damage-source attribution (existing spec-baseline
    //    heuristic: sourceProjectileId tag lookup, else "basic-fire").
    for (const ev of res.events) {
      if (ev.t !== "hit-confirmed") continue;
      const attackerId = ev.attackerId;
      if (!attackerId) continue;
      const cid = classOf[attackerId];
      if (!cid) continue; // environmental / unattributed damage.
      const agg = aggOf[attackerId]!;
      const tag = ev.sourceProjectileId !== null ? projectileTag.get(ev.sourceProjectileId as unknown as number) : undefined;
      if (tag) {
        const stat = getAbilityStat(agg, tag.kind);
        stat.hits += 1;
        stat.damage += ev.damage;
      } else {
        agg.basicFire.hits += 1;
        agg.basicFire.damage += ev.damage;
      }
    }

    // 5. player-killed → win/loss + TTK + kill attribution (projectile tag
    //    if available, else the documented "most recent ability-activated
    //    by this killer within 2000ms" fallback for bash/aoe melee kills
    //    with no projectile to key off).
    for (const ev of res.events) {
      if (ev.t !== "player-killed") continue;
      const killerId = ev.killerId;
      if (killerId) {
        const cid = classOf[killerId];
        if (cid) {
          const agg = aggOf[killerId]!;
          if (ev.cause === "bash" || ev.cause === "aoe") {
            const recent = recentActivation.get(killerId);
            const withinLookback =
              recent && (tick - recent.tick) * DT_MS <= KILL_ATTRIBUTION_LOOKBACK_MS;
            if (withinLookback) {
              getAbilityStat(agg, recent!.kind).kills += 1;
            } else {
              agg.basicFire.kills += 1;
            }
          } else {
            agg.basicFire.kills += 1;
          }
        }
      }
      if (ev.victimId === ROW) rowDied = true;
      else if (ev.victimId === COL) colDied = true;
      ttkMs = (tick + 1) * DT_MS;
    }

    // Same-tick double-KO: both player-killed events fired this step (fully
    // plausible with two closely-matched, near-simultaneous attackers) — a
    // naive "last event wins" would silently and systematically credit
    // whichever side's kill event happens to be pushed later in World.ts's
    // internal processing order, which is exactly the kind of structural
    // bias that turned every 4 mirror-matchup cells into a hard 0%/100%
    // wall on an earlier run of this harness. Recorded as its own draw
    // category, not folded into `timedOut`.
    if (rowDied && colDied) {
      winner = null;
      doubleKO = true;
    } else if (rowDied) {
      winner = "col";
    } else if (colDied) {
      winner = "row";
    }

    state = next;
    if (winner !== null || doubleKO) break;
  }

  if (winner === null && !doubleKO) timedOut = true;

  // Finalize any observations still open when the match itself ended
  // (killed before their window closed) — whatever effect evidence was
  // found so far stands; a match-ending kill is itself strong evidence for
  // whichever ability's window it fell inside anyway (see step 3's
  // hit-confirmed/player-killed fallback).
  for (const obs of openObs) finalizeIfWanted(obs);

  rowAgg.matches += 1;
  colAgg.matches += 1;
  if (winner === "row") rowAgg.wins += 1;
  else if (winner === "col") colAgg.wins += 1;

  return { winner, timedOut, doubleKO, ttkMs };
}

function finalizeObservation(obs: PendingObs, noEffect: Map<string, NoEffectObs>): void {
  let s = noEffect.get(obs.kind);
  if (!s) {
    s = { activations: 0, withEffect: 0, allyStarved: false };
    noEffect.set(obs.kind, s);
  }
  s.activations += 1;
  if (obs.effect) s.withEffect += 1;
}

function tagNewOwned<T extends { ownerId: PlayerId | null }>(
  prevMap: Record<EntityId, T>,
  nextMap: Record<EntityId, T>,
  recentActivation: Map<PlayerId, { kind: string; tick: number }>,
  tick: number,
  classOf: Record<string, ClassId>,
  tagOut: Map<number, { classId: ClassId; kind: string; ownerId: PlayerId }>,
): void {
  for (const idStr of Object.keys(nextMap)) {
    if (idStr in prevMap) continue;
    const id = Number(idStr);
    const entity = nextMap[id as unknown as EntityId];
    const ownerId = entity?.ownerId;
    if (!ownerId) continue;
    const recent = recentActivation.get(ownerId);
    // "Same tick or the tick immediately prior" — see the trial-level
    // comment on projectileTag/firePatchTag above.
    if (recent && tick - recent.tick <= 1) {
      const cid = classOf[ownerId];
      if (cid) tagOut.set(id, { classId: cid, kind: recent.kind, ownerId });
    }
  }
}

function selfDiffEffect(preSelf: PlayerEntity, postSelf: PlayerEntity, ignoreKeys: Set<string>): boolean {
  const keys = new Set([...Object.keys(preSelf), ...Object.keys(postSelf)]);
  for (const k of keys) {
    if (ignoreKeys.has(k)) continue;
    const a = (preSelf as unknown as Record<string, unknown>)[k];
    const b = (postSelf as unknown as Record<string, unknown>)[k];
    if (a !== b) return true;
  }
  return false;
}

function enemyDiffEffect(preEnemy: PlayerEntity, postEnemy: PlayerEntity): boolean {
  for (const k of ENEMY_WATCH_KEYS) {
    const a = (preEnemy as unknown as Record<string, unknown>)[k];
    const b = (postEnemy as unknown as Record<string, unknown>)[k];
    if (a !== b) return true;
  }
  return false;
}

function movementJumpEffect(preSelf: PlayerEntity, postSelf: PlayerEntity): boolean {
  const posDelta = Math.hypot(postSelf.x - preSelf.x, postSelf.y - preSelf.y);
  const velDelta = Math.hypot(postSelf.vx - preSelf.vx, postSelf.vy - preSelf.vy);
  return posDelta > MOVEMENT_JUMP_PX || velDelta > VELOCITY_JUMP_PXPS;
}

function checkImmediateEffect(obs: PendingObs, next: WorldState, ROW: PlayerId, COL: PlayerId): void {
  const postSelf = next.players[obs.playerId]!;
  const enemyId = obs.playerId === ROW ? COL : ROW;
  const postEnemy = next.players[enemyId]!;
  if (
    selfDiffEffect(obs.preSelf, postSelf, obs.ignoreKeys) ||
    enemyDiffEffect(obs.preEnemy, postEnemy) ||
    movementJumpEffect(obs.preSelf, postSelf)
  ) {
    obs.effect = true;
  }
}

function advanceObservation(
  obs: PendingObs,
  next: WorldState,
  ROW: PlayerId,
  COL: PlayerId,
  projectileTag: Map<number, { classId: ClassId; kind: string; ownerId: PlayerId }>,
  firePatchTag: Map<number, { classId: ClassId; kind: string; ownerId: PlayerId }>,
  events: SimEvent[],
): void {
  const postSelf = next.players[obs.playerId]!;
  const enemyId = obs.playerId === ROW ? COL : ROW;
  const postEnemy = next.players[enemyId]!;
  if (selfDiffEffect(obs.preSelf, postSelf, obs.ignoreKeys) || enemyDiffEffect(obs.preEnemy, postEnemy)) {
    obs.effect = true;
    return;
  }
  // Any projectile/firePatch this activation is tagged as owning that's
  // still alive counts as ongoing evidence of "did something" (it may not
  // have hit yet, but it exists — a spawned entity is itself a measurable
  // effect distinct from a total no-op). Matched by ownerId (not just
  // kind+classId): a kind+classId-only match would cross-attribute in any
  // mirror matchup where both sides share BOTH class and ability kind
  // (e.g. a Kindled-baseline-vs-Kindled-baseline trial, which the ability
  // leaderboard's variant-1 run relies on) — obs.playerId's own projectile
  // is the only valid evidence for obs.playerId's own activation.
  for (const id in next.projectiles) {
    const tag = projectileTag.get(Number(id));
    if (tag && tag.ownerId === obs.playerId && tag.kind === obs.kind) {
      obs.effect = true;
      return;
    }
  }
  for (const id in next.firePatches) {
    const tag = firePatchTag.get(Number(id));
    if (tag && tag.ownerId === obs.playerId && tag.kind === obs.kind) {
      obs.effect = true;
      return;
    }
  }
  // Weak/supplementary evidence: any hit-confirmed or player-killed
  // attributable to this player within the window. Documented caveat:
  // this can NOT distinguish "this ability caused the hit" from "the bot's
  // basic weapon happened to land a hit in the same ~500ms window" — bots
  // fire near-continuously, so this signal alone is generous. It only
  // matters here as a fallback for the handful of no-projectile
  // melee/AoE abilities the state-diff and spawn-tag checks above can't
  // otherwise see; every OTHER ability kind is primarily judged by the
  // stronger state-diff/spawn-tag signals above.
  for (const ev of events) {
    if (ev.t === "hit-confirmed" && ev.attackerId === obs.playerId) {
      obs.effect = true;
      return;
    }
    if (ev.t === "player-killed" && ev.killerId === obs.playerId) {
      obs.effect = true;
      return;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = performance.now();

  // `decided` = trials that produced an actual winner (excludes timeouts
  // AND same-tick double-KOs) — the win-rate denominator, per the original
  // task spec's "[timeouts] excluded from win-rate ... but log how often".
  // `trials` is kept too, purely for the raw N shown alongside the rate.
  const winMatrix: Record<ClassId, Record<ClassId, { wins: number; trials: number; decided: number }>> = {
    wizard: { wizard: { wins: 0, trials: 0, decided: 0 }, ninja: { wins: 0, trials: 0, decided: 0 }, paladin: { wins: 0, trials: 0, decided: 0 }, priest: { wins: 0, trials: 0, decided: 0 } },
    ninja: { wizard: { wins: 0, trials: 0, decided: 0 }, ninja: { wins: 0, trials: 0, decided: 0 }, paladin: { wins: 0, trials: 0, decided: 0 }, priest: { wins: 0, trials: 0, decided: 0 } },
    paladin: { wizard: { wins: 0, trials: 0, decided: 0 }, ninja: { wins: 0, trials: 0, decided: 0 }, paladin: { wins: 0, trials: 0, decided: 0 }, priest: { wins: 0, trials: 0, decided: 0 } },
    priest: { wizard: { wins: 0, trials: 0, decided: 0 }, ninja: { wins: 0, trials: 0, decided: 0 }, paladin: { wins: 0, trials: 0, decided: 0 }, priest: { wins: 0, trials: 0, decided: 0 } },
  };

  const classAggregates: Record<ClassId, ClassAggregate> = {
    wizard: newClassAggregate(),
    ninja: newClassAggregate(),
    paladin: newClassAggregate(),
    priest: newClassAggregate(),
  };

  const noEffect = new Map<string, NoEffectObs>();
  const ttkSamples: number[] = [];
  let timeouts = 0;
  let doubleKOs = 0;
  let totalTrials = 0;

  let seed = 1;
  for (const rowClass of CLASSES) {
    for (const colClass of CLASSES) {
      for (let i = 0; i < TRIALS_PER_PAIR; i++) {
        seed += 1;
        const outcome = runTrial(
          rowClass,
          colClass,
          seed,
          classAggregates[rowClass],
          classAggregates[colClass],
          noEffect,
        );
        totalTrials += 1;
        winMatrix[rowClass]![colClass]!.trials += 1;
        if (outcome.timedOut) {
          timeouts += 1;
        } else if (outcome.doubleKO) {
          // Excluded from win-rate numerator/denominator (neither side
          // "won"), but still a real fight duration — counts toward TTK.
          doubleKOs += 1;
          if (outcome.ttkMs !== null) ttkSamples.push(outcome.ttkMs);
        } else {
          winMatrix[rowClass]![colClass]!.decided += 1;
          if (outcome.winner === "row") winMatrix[rowClass]![colClass]!.wins += 1;
          if (outcome.ttkMs !== null) ttkSamples.push(outcome.ttkMs);
        }
      }
    }
  }

  const elapsedMs = performance.now() - startedAt;

  // ── Kindled (Paladin) ability leaderboard ───────────────────────────────
  //
  // Additive phase, entirely separate from the main matrix above (which is
  // untouched — same seeds, same loop, same TRIALS_PER_PAIR). Runs the 3
  // extra 9-ability-covering variants (+ the already-defined baseline)
  // through the SAME runTrial/getAbilityStat/no-op machinery, each variant
  // against a FIXED reference opponent so every one of the 12 abilities is
  // judged under identical conditions.
  //
  // Opponent choice: the Kindled BASELINE loadout (sunspike/judgment-line/
  // bastion-pulse) for every variant, including the baseline variant
  // itself (a mirror). Rationale: the main matrix already characterizes
  // Kindled against 4 very different external kits (wizard/ninja/paladin/
  // priest) — that's the wrong reference for "does THIS specific ability
  // pull weight", since a landslide loss/win there is dominated by the
  // OPPONENT class's kit, not the ability being tested. A fixed,
  // already-characterized same-class reference isolates each variant's own
  // 3 abilities as the one thing that changes between runs.
  //
  // Only the ROW side's ability data is credited (`noEffectSides: "row"`,
  // colAgg is a throwaway sink) — the fixed opponent's own baseline-kit
  // activations are deliberately discarded every run so baseline abilities
  // don't end up with a 4x-larger sample than the other 9 just because
  // they're also cast by the reference opponent in variants b/c/d.
  const kindledStartedAt = performance.now();
  const kindledLeaderAgg = newClassAggregate();
  const kindledDiscardAgg = newClassAggregate();
  const kindledNoEffect = new Map<string, NoEffectObs>();
  const kindledVariantOutcomes: {
    label: string;
    cards: string[];
    wins: number;
    decided: number;
    timeouts: number;
    doubleKOs: number;
  }[] = [];
  const kindledKindToVariant = new Map<string, string>();

  let kSeed = 1_000_000; // separate seed space from the main matrix, purely tidy.
  for (const variant of KINDLED_VARIANTS) {
    for (const kind of variant.cards) kindledKindToVariant.set(kind, variant.label);
    let wins = 0;
    let decided = 0;
    let variantTimeouts = 0;
    let variantDoubleKOs = 0;
    for (let i = 0; i < TRIALS_PER_PAIR; i++) {
      kSeed += 1;
      const outcome = runTrial(
        "paladin",
        "paladin",
        kSeed,
        kindledLeaderAgg,
        kindledDiscardAgg,
        kindledNoEffect,
        variant.cards,
        LOADOUTS.paladin,
        "row",
      );
      if (outcome.timedOut) {
        variantTimeouts += 1;
      } else if (outcome.doubleKO) {
        variantDoubleKOs += 1;
      } else {
        decided += 1;
        if (outcome.winner === "row") wins += 1;
      }
    }
    kindledVariantOutcomes.push({
      label: variant.label,
      cards: variant.cards,
      wins,
      decided,
      timeouts: variantTimeouts,
      doubleKOs: variantDoubleKOs,
    });
  }
  const kindledElapsedMs = performance.now() - kindledStartedAt;
  const kindledTrials = KINDLED_VARIANTS.length * TRIALS_PER_PAIR;

  // Per-ability leaderboard row. "Impact score" = damage + kills×100 (a
  // kill is treated as worth one full health bar of damage, so a
  // kill-heavy but low-raw-damage ability doesn't read as weaker than it
  // is) — sorted ascending so the weakest-by-impact abilities sort first.
  // Carries the SAME caveat as the per-class damage table: a buff/mark/
  // defense-shaped ability can legitimately show 0 damage/kills here while
  // still being fully implemented (confirmed via its own noEffectRate) —
  // its real contribution shows up as amplified BASIC-FIRE damage this
  // harness's damage-attribution heuristic can't trace back to it. Do not
  // read "0 damage" alone as "cut this."
  // A ZERO-activation ability is a categorically different, more urgent
  // finding than a merely-low-impact one: it means the ability's own
  // activation precondition was never once satisfied (a genuine dead press
  // every attempt, matching World.ts's own "insufficient resource → no
  // window, no spend, no cooldown burn, no ability-activated event" design
  // — see e.g. kindled-resolve's KIN_KINDLED_RESOLVE_KINDLING_COST gate,
  // which only accrues Kindling via combat.ts's tryDeflectDamage Ward-block
  // branch — this harness's bot policy never presses Shield, by
  // design, so ANY Kindling-gated ability is structurally unreachable
  // here). That's a HARNESS BLIND SPOT specific to that one ability's
  // precondition, not evidence the ability itself is weak — auto-flagged
  // below (by activations===0, not hardcoded by name) so it can never be
  // silently read as "this is the ability to cut."
  const KILL_IMPACT_VALUE = 100;
  const kindledLeaderboard = KINDLED_VARIANTS.flatMap((v) => v.cards).map((kind) => {
    const stat = kindledLeaderAgg.abilities.get(kind) ?? { activations: 0, hits: 0, damage: 0, kills: 0 };
    const noEff = kindledNoEffect.get(kind) ?? { activations: 0, withEffect: 0, allyStarved: false };
    const noEffectRatePct = noEff.activations > 0 ? 100 * (1 - noEff.withEffect / noEff.activations) : null;
    return {
      kind,
      variant: kindledKindToVariant.get(kind) ?? "?",
      activations: stat.activations,
      activationsPerMatch: TRIALS_PER_PAIR > 0 ? stat.activations / TRIALS_PER_PAIR : 0,
      hits: stat.hits,
      damage: stat.damage,
      avgDamagePerActivation: stat.activations > 0 ? stat.damage / stat.activations : 0,
      kills: stat.kills,
      noEffectRatePct,
      noEffectSample: noEff.activations,
      dataGapWarning:
        stat.activations === 0
          ? "ZERO activations — its own activation precondition (resource cost / target requirement) was never satisfied by this harness's bot policy. NOT evidence of weakness; excluded from the impact ranking's implied ordering below — needs a different test setup (e.g. a policy that holds Shield to bank Kindling) before this ability can be judged at all."
          : null,
      impactScore: stat.damage + stat.kills * KILL_IMPACT_VALUE,
    };
  });
  // Data-gap entries sort FIRST regardless of impactScore — a 0-activation
  // ability is a "can't judge this yet" flag, not a legitimate last place
  // in the weakest-by-impact ordering, and burying it among the other
  // genuinely-tested 0-damage entries would defeat the point of flagging
  // it at all.
  kindledLeaderboard.sort((a, b) => {
    const aGap = a.dataGapWarning !== null;
    const bGap = b.dataGapWarning !== null;
    if (aGap !== bGap) return aGap ? -1 : 1;
    return a.impactScore - b.impactScore;
  });

  // ── Ally-starvation classification for the no-op report ────────────────
  // None of the 12 loadout abilities are structurally ally-required (see
  // the LOADOUTS comment above) — documented explicitly rather than
  // silently omitted.
  const ALLY_STARVED_KINDS = new Set<string>(); // intentionally empty — see above.

  // ── TTK stats ───────────────────────────────────────────────────────────
  ttkSamples.sort((a, b) => a - b);
  const pct = (p: number): number | null => {
    if (ttkSamples.length === 0) return null;
    const idx = Math.min(ttkSamples.length - 1, Math.floor(p * ttkSamples.length));
    return ttkSamples[idx]!;
  };
  const ttkStats = {
    n: ttkSamples.length,
    minMs: ttkSamples[0] ?? null,
    p25Ms: pct(0.25),
    medianMs: pct(0.5),
    p75Ms: pct(0.75),
    maxMs: ttkSamples[ttkSamples.length - 1] ?? null,
  };
  // Simple 10-bucket histogram across the observed range.
  const histogram: { rangeMs: string; count: number }[] = [];
  if (ttkSamples.length > 0) {
    const lo = ttkSamples[0]!;
    const hi = ttkSamples[ttkSamples.length - 1]!;
    const buckets = 10;
    const width = Math.max(1, (hi - lo) / buckets);
    const counts = new Array(buckets).fill(0);
    for (const t of ttkSamples) {
      const idx = Math.min(buckets - 1, Math.floor((t - lo) / width));
      counts[idx] += 1;
    }
    for (let i = 0; i < buckets; i++) {
      histogram.push({ rangeMs: `${Math.round(lo + i * width)}-${Math.round(lo + (i + 1) * width)}`, count: counts[i] });
    }
  }

  // ── No-op / possibly-unimplemented flagging ─────────────────────────────
  const NO_EFFECT_FLAG_THRESHOLD = 0.85; // >85% no-effect across activations.
  const MIN_SAMPLE_FOR_FLAG = 8;
  const noOpFlags: {
    kind: string;
    activations: number;
    withEffect: number;
    noEffectRate: number;
    allyStarved: boolean;
    flagged: boolean;
  }[] = [];
  for (const [kind, s] of noEffect) {
    const rate = s.activations > 0 ? 1 - s.withEffect / s.activations : 0;
    const allyStarved = ALLY_STARVED_KINDS.has(kind);
    noOpFlags.push({
      kind,
      activations: s.activations,
      withEffect: s.withEffect,
      noEffectRate: rate,
      allyStarved,
      flagged: !allyStarved && s.activations >= MIN_SAMPLE_FOR_FLAG && rate >= NO_EFFECT_FLAG_THRESHOLD,
    });
  }
  noOpFlags.sort((a, b) => b.noEffectRate - a.noEffectRate);

  // ── Damage-attribution reliability ──────────────────────────────────────
  let totalHits = 0;
  let taggedHits = 0;
  for (const agg of Object.values(classAggregates)) {
    totalHits += agg.basicFire.hits;
    for (const stat of agg.abilities.values()) {
      totalHits += stat.hits;
      taggedHits += stat.hits;
    }
  }

  // ── Report assembly ──────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    scope: {
      trialsPerOrderedPair: TRIALS_PER_PAIR,
      totalTrials,
      elapsedMs,
      maxTicksPerTrial: MAX_TICKS,
      dtMs: DT_MS,
      map: boxworksMini.id,
      notes: [
        "Single first-to-die 1v1 duel per trial — no round/draft/target-score FSM (round.ts/enterDrafting) wired up.",
        "Cheap per-class-aware heuristic bot policy on both sides (CLASS_POLICY: class engagement bands, melee-gated Fire, homing-projectile evasion, class dash use) — still not player-grade AI.",
        "Fixed representative 3-ability loadouts per class (see LOADOUTS in this script), not the live draft/offer-roll system.",
        "TTK measured tick-0 (fight start) to the single kill each trial produces (see 'Match loop' scope note).",
      ],
    },
    winRateMatrix: Object.fromEntries(
      CLASSES.map((row) => [
        row,
        Object.fromEntries(
          CLASSES.map((col) => {
            const cell = winMatrix[row]![col]!;
            return [
              col,
              {
                winRatePct: cell.decided > 0 ? (100 * cell.wins) / cell.decided : null,
                wins: cell.wins,
                decided: cell.decided,
                trials: cell.trials,
              },
            ];
          }),
        ),
      ]),
    ),
    timeouts: { count: timeouts, ratePct: totalTrials > 0 ? (100 * timeouts) / totalTrials : 0 },
    doubleKOs: { count: doubleKOs, ratePct: totalTrials > 0 ? (100 * doubleKOs) / totalTrials : 0 },
    abilityUsage: Object.fromEntries(
      CLASSES.map((c) => {
        const agg = classAggregates[c];
        return [
          c,
          {
            persona: PERSONA[c],
            matches: agg.matches,
            wins: agg.wins,
            basicFire: agg.basicFire,
            abilities: Object.fromEntries(agg.abilities.entries()),
          },
        ];
      }),
    ),
    ttk: { ...ttkStats, histogram },
    damageAttribution: {
      totalHits,
      taggedHits,
      taggedRatePct: totalHits > 0 ? (100 * taggedHits) / totalHits : 0,
      note: "hit-confirmed events whose sourceProjectileId matched a same-tick-tagged ability-spawned projectile; everything else (basic weapon fire, untagged melee/AoE damage) falls into each class's basicFire bucket.",
    },
    possiblyUnimplemented: {
      effectWindowTicks: EFFECT_WINDOW_TICKS,
      effectWindowMs: EFFECT_WINDOW_TICKS * DT_MS,
      noEffectFlagThreshold: NO_EFFECT_FLAG_THRESHOLD,
      minSampleForFlag: MIN_SAMPLE_FOR_FLAG,
      allyStarvedKindsInThisLoadoutSet: [...ALLY_STARVED_KINDS],
      candidates: noOpFlags,
      method: [
        "For every ability-activated event, open an observation window (same tick + next ~500ms/30 ticks).",
        "Effect = ANY of: (1) a self PlayerEntity field changed outside a routine-bookkeeping ignore-list (buff/mark/resource/window fields), (2) a curated set of enemy debuff fields changed (slow/burn/freeze), (3) a same-tick position/velocity jump beyond ordinary walk speed (movement-ability signature; bot never presses Jump, and slot presses are hard-suppressed on/around dash ticks, so this stays attributable), (4) a new projectile or fire-patch entity appeared, owned by the caster, tagged to this activation, (5) [weak/supplementary] a hit-confirmed or player-killed event attributable to the caster within the window.",
        "Signal (5) is generous/noisy (bots fire near-continuously) and is only load-bearing for the handful of no-projectile melee/AoE abilities signals 1-4 can't otherwise see — treat any candidate whose flag rests mainly on signal 5 with extra skepticism.",
      ],
    },
    // ADDITIVE to abilityUsage/damageAttribution above, not a replacement —
    // this is a Kindled(paladin)-only, catalog-cut-focused view covering
    // all 12 abilities (abilityUsage.paladin above only covers the 3 in
    // LOADOUTS.paladin) under a controlled, identical-opponent condition.
    kindledAbilityLeaderboard: {
      opponent: "Kindled baseline loadout (sunspike / judgment-line / bastion-pulse), fixed for every variant including the baseline-vs-baseline mirror — isolates each variant's own abilities rather than being confounded by a rotating cast of very different external class kits.",
      trialsPerVariant: TRIALS_PER_PAIR,
      totalTrials: kindledTrials,
      elapsedMs: kindledElapsedMs,
      variants: KINDLED_VARIANTS.map((v) => ({
        label: v.label,
        cards: v.cards,
        matchup: kindledVariantOutcomes.find((o) => o.label === v.label),
      })),
      killImpactValue: KILL_IMPACT_VALUE,
      note: "impactScore = damage + kills×100, sorted ascending (weakest-by-impact first). A 0-damage/0-kill entry is NOT necessarily a no-op — check its own noEffectRatePct: a buff/mark/defense ability can legitimately show real in-sim effect (a buff window opening, a mark landing) while crediting zero damage here, because its payoff shows up as amplified basic-fire damage this harness's projectile-tag heuristic can't trace back to it. Cross-reference both columns before recommending a cut.",
      leaderboard: kindledLeaderboard,
    },
  };

  // ── Write JSON artifact ───────────────────────────────────────────────
  const outPath = new URL("./.balance-sim-report.json", import.meta.url);
  await Bun.write(outPath, JSON.stringify(report, null, 2));

  // ── Print stdout report ─────────────────────────────────────────────────
  // Nested closure (rather than a top-level function taking `report` as a
  // parameter) so TypeScript infers the report's exact shape directly from
  // the object literal above — no need to hand-duplicate it as a named
  // interface just to give a top-level function a parameter type.
  printReport();
  console.log(`\nJSON artifact: ${outPath.pathname}`);

  function printReport(): void {
    const r = report;
    console.log("═".repeat(78));
  console.log("JAKESJAM BALANCE-SIM REPORT");
  console.log("═".repeat(78));
  console.log(
    `\n${r.scope.totalTrials} trials (${r.scope.trialsPerOrderedPair}/ordered-pair × 16 pairs) in ${(r.scope.elapsedMs / 1000).toFixed(2)}s`,
  );
  console.log(`Timeouts (30s, neither died): ${r.timeouts.count} (${r.timeouts.ratePct.toFixed(1)}%)`);
  console.log(`Same-tick double-KOs (excluded from win-rate, counted in TTK): ${r.doubleKOs.count} (${r.doubleKOs.ratePct.toFixed(1)}%)`);

  console.log("\n── Win-rate matrix (row's win% over column, N trials) ──");
  const header = ["ROW\\COL", ...CLASSES.map((c) => PERSONA[c])];
  console.log(header.map((h) => h.padEnd(14)).join(""));
  for (const row of CLASSES) {
    const cells = CLASSES.map((col) => {
      const cell = r.winRateMatrix[row]![col]!;
      return cell.winRatePct === null ? "  n/a  " : `${cell.winRatePct.toFixed(0)}% (${cell.wins}/${cell.decided})`;
    });
    console.log([PERSONA[row].padEnd(14), ...cells.map((c) => c.padEnd(14))].join(""));
  }

  console.log("\n── Ability usage / damage-source breakdown ──");
  for (const c of CLASSES) {
    const a = r.abilityUsage[c]!;
    console.log(`\n${PERSONA[c]} (${c}) — ${a.matches} matches, ${a.wins} wins`);
    console.log(
      `  basic-fire: ${a.basicFire.hits} hits, ${a.basicFire.damage.toFixed(0)} dmg, ${a.basicFire.kills} kills`,
    );
    const entries = Object.entries(a.abilities).sort((x, y) => y[1].activations - x[1].activations);
    for (const [kind, s] of entries) {
      console.log(
        `  ${kind.padEnd(20)} activations=${String(s.activations).padEnd(5)} hits=${String(s.hits).padEnd(5)} dmg=${s.damage.toFixed(0).padEnd(7)} kills=${s.kills}`,
      );
    }
  }

  console.log("\n── TTK distribution (fight-start → first kill, ms) ──");
  console.log(
    `  n=${r.ttk.n} min=${r.ttk.minMs?.toFixed(0)} p25=${r.ttk.p25Ms?.toFixed(0)} median=${r.ttk.medianMs?.toFixed(0)} p75=${r.ttk.p75Ms?.toFixed(0)} max=${r.ttk.maxMs?.toFixed(0)}`,
  );
  for (const b of r.ttk.histogram) {
    console.log(`  ${b.rangeMs.padEnd(16)} ${"█".repeat(Math.min(60, b.count))} (${b.count})`);
  }

  console.log("\n── Damage-attribution reliability ──");
  console.log(
    `  ${r.damageAttribution.taggedHits}/${r.damageAttribution.totalHits} hits tagged to a specific ability (${r.damageAttribution.taggedRatePct.toFixed(1)}%); rest → basic-fire bucket.`,
  );

  console.log("\n── Possibly unimplemented / no-op-in-sim candidates ──");
  console.log(
    `  (effect window ${r.possiblyUnimplemented.effectWindowMs}ms, flag threshold >${(r.possiblyUnimplemented.noEffectFlagThreshold * 100).toFixed(0)}% no-effect, min sample ${r.possiblyUnimplemented.minSampleForFlag})`,
  );
  const flagged = r.possiblyUnimplemented.candidates.filter((c) => c.flagged);
  if (flagged.length === 0) {
    console.log("  none flagged.");
  }
  for (const c of r.possiblyUnimplemented.candidates) {
    const marker = c.flagged ? "⚠ FLAGGED" : c.allyStarved ? "(ally-starved, untestable)" : "";
    console.log(
      `  ${c.kind.padEnd(20)} activations=${String(c.activations).padEnd(5)} no-effect-rate=${(c.noEffectRate * 100).toFixed(0).padEnd(4)}% ${marker}`,
    );
  }

  console.log("\n── Kindled (Paladin) 12-ability leaderboard — catalog-cut data ──");
  console.log(
    `  ${r.kindledAbilityLeaderboard.totalTrials} trials (${r.kindledAbilityLeaderboard.variants.length} variants × ${r.kindledAbilityLeaderboard.trialsPerVariant}) in ${(r.kindledAbilityLeaderboard.elapsedMs / 1000).toFixed(2)}s`,
  );
  console.log(`  Opponent: ${r.kindledAbilityLeaderboard.opponent}`);
  for (const v of r.kindledAbilityLeaderboard.variants) {
    const m = v.matchup;
    const rate = m && m.decided > 0 ? `${((100 * m.wins) / m.decided).toFixed(0)}% (${m.wins}/${m.decided})` : "n/a";
    console.log(
      `  ${v.label.padEnd(10)} [${v.cards.join(", ")}] — vs opponent: ${rate}, timeouts=${m?.timeouts ?? 0}, doubleKOs=${m?.doubleKOs ?? 0}`,
    );
  }
  console.log(`  sorted weakest-by-impact first (impactScore = damage + kills×${r.kindledAbilityLeaderboard.killImpactValue})`);
  console.log(
    "  " +
      ["kind", "variant", "acts/match", "hits", "damage", "avgDmg/act", "kills", "no-effect%", "impact"]
        .map((h, i) => h.padEnd([20, 11, 11, 6, 9, 11, 6, 11, 8][i]!))
        .join(""),
  );
  for (const e of r.kindledAbilityLeaderboard.leaderboard) {
    const marker = e.dataGapWarning !== null ? "  ⚠ DATA GAP — see below" : "";
    console.log(
      "  " +
        [
          e.kind.padEnd(20),
          e.variant.padEnd(11),
          e.activationsPerMatch.toFixed(2).padEnd(11),
          String(e.hits).padEnd(6),
          e.damage.toFixed(0).padEnd(9),
          e.avgDamagePerActivation.toFixed(1).padEnd(11),
          String(e.kills).padEnd(6),
          (e.noEffectRatePct === null ? "n/a" : `${e.noEffectRatePct.toFixed(0)}%`).padEnd(11),
          e.impactScore.toFixed(0).padEnd(8),
        ].join("") + marker,
    );
  }
  for (const e of r.kindledAbilityLeaderboard.leaderboard) {
    if (e.dataGapWarning !== null) console.log(`  ⚠ ${e.kind}: ${e.dataGapWarning}`);
  }
  console.log(`  ${r.kindledAbilityLeaderboard.note}`);

    console.log("\n── Scope limits (read before trusting these numbers) ──");
    for (const n of r.scope.notes) console.log(`  - ${n}`);
  }
}

await main();
