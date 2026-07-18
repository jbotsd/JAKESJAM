// TEAM PEEL — Paladin/Kindred's team peel (class-overhaul-workboard.md
// chunk 2.4: "block for allies in ward shadow"). Depends on chunk 1.1
// (team identity, team.ts's `isAlly`) and chunks 2.1-2.3 (Kindled Edge/
// Ward/Kindling, already shipped this session).
//
// Geometry definition (combat.ts's `isAllyBodyInWardCone` — see its own
// header comment for the full reasoning): a warder W peels for a victim V
// when V's body sits within W's frontal Ward cone (WARD_ARC_RADIANS,
// anchored on W's own aim) AND V is within WARD_PEEL_RADIUS_PX of W. This
// is DELIBERATELY different from Ward's own self-cone test
// (`isSourceInWardCone`, "is the damage SOURCE within the cone") — peel
// tests the ALLY'S POSITION, not the attack's origin, per the task brief's
// explicit instruction that this is real-but-bounded new work, not a
// trivial reuse.
//
// Two layers, same split as kindledWard.test.ts:
//   - Pure geometry tests on `isAllyBodyInWardCone`/`computeTeamPeelMitigation`
//     (combat.ts) — fast, deterministic.
//   - `stepWithRuntime` integration tests (dash-bash into an ally standing
//     near a warding paladin teammate) proving the full wiring: team-peel-
//     absorbed event, mitigated damage on the VICTIM, Kindling granted to
//     the WARDER (not the victim) — and that solo/FFA/non-ally/out-of-
//     range/self-ward scenarios are all completely unaffected.

import { describe, expect, test } from "bun:test";
import {
  isAllyBodyInWardCone,
  computeTeamPeelMitigation,
  WARD_MITIGATION_FRACTION,
  WARD_PEEL_RADIUS_PX,
  KINDLING_PER_DAMAGE_BLOCKED,
} from "../combat.js";
import { createRuntime, stepWithRuntime } from "../World.js";
import { freshPlayerMovementMemory } from "../player.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const SHIELD_BIT = 1 << 8;

// ---------------------------------------------------------------------------
// Pure geometry — isAllyBodyInWardCone / computeTeamPeelMitigation
// ---------------------------------------------------------------------------

describe("isAllyBodyInWardCone — pure two-body geometry (no team/Ward-active checks)", () => {
  test("an ally's body directly in front, within radius, is covered", () => {
    const warder = { x: 0, y: 0, aimX: 100, aimY: 0 }; // facing +x
    const victim = { x: 60, y: 0 }; // 60px ahead, dead centre of the cone
    expect(isAllyBodyInWardCone(warder, victim)).toBe(true);
  });

  test("an ally directly behind the warder is NOT covered", () => {
    const warder = { x: 0, y: 0, aimX: 100, aimY: 0 }; // facing +x
    const victim = { x: -60, y: 0 }; // behind
    expect(isAllyBodyInWardCone(warder, victim)).toBe(false);
  });

  test("an ally in front but beyond WARD_PEEL_RADIUS_PX is NOT covered", () => {
    const warder = { x: 0, y: 0, aimX: 100, aimY: 0 };
    const victim = { x: WARD_PEEL_RADIUS_PX + 40, y: 0 };
    expect(isAllyBodyInWardCone(warder, victim)).toBe(false);
  });

  test("an ally in range but well off to the side (outside the cone) is NOT covered", () => {
    const warder = { x: 0, y: 0, aimX: 100, aimY: 0 }; // facing +x
    const victim = { x: 0, y: 100 }; // directly to the side, 90° off
    expect(isAllyBodyInWardCone(warder, victim)).toBe(false);
  });

  test("a custom radius (Aegis Share's widened check) covers further out", () => {
    const warder = { x: 0, y: 0, aimX: 100, aimY: 0 };
    const victim = { x: WARD_PEEL_RADIUS_PX + 40, y: 0 };
    expect(isAllyBodyInWardCone(warder, victim, WARD_PEEL_RADIUS_PX * 1.6)).toBe(true);
  });
});

describe("computeTeamPeelMitigation — same fraction/rate as self-ward", () => {
  test("mitigates by WARD_MITIGATION_FRACTION and grants Kindling at KINDLING_PER_DAMAGE_BLOCKED", () => {
    const result = computeTeamPeelMitigation(40);
    const expectedBlocked = 40 * WARD_MITIGATION_FRACTION;
    expect(result.damageBlocked).toBeCloseTo(expectedBlocked, 5);
    expect(result.mitigatedDamage).toBeCloseTo(40 - expectedBlocked, 5);
    expect(result.kindlingGranted).toBeCloseTo(expectedBlocked * KINDLING_PER_DAMAGE_BLOCKED, 5);
  });
});

// ---------------------------------------------------------------------------
// Integration — stepWithRuntime, dash-bash into an ally near a warding
// paladin teammate. Mirrors kindledWard.test.ts's own bash-integration
// harness exactly (same fixture shape, same dash-seed trick).
// ---------------------------------------------------------------------------

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
    { x: 900, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function mkWorldPlayer(id: PlayerId, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id, characterId: "balanced", x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: InputSeq(0), ...over,
  };
}

function mkWorldState(players: PlayerEntity[]): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0), rngState: 1234567 >>> 0, players: playerMap, projectiles: {},
    destructibles: {}, firePatches: {}, pickups: {}, satellites: {},
    round: {
      phase: "fighting", countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0, winnerPlayerId: null,
    },
  };
}

const A = PlayerId("a"); // enemy dash-basher (no team)
const B = PlayerId("b"); // victim: an ordinary ally, no Ward of their own
const C = PlayerId("c"); // warding paladin teammate, standing near B

/** Sets up the standard scene: A bashes B (contact range) while C (a
 *  paladin on B's team) stands near B, facing back toward B, holding
 *  Shield — the geometry `isAllyBodyInWardCone` should cover. Returns the
 *  step result for the caller to assert on; `victimOverrides`/
 *  `warderOverrides` let individual tests break one variable at a time. */
function runPeelScenario(
  victimOverrides: Partial<PlayerEntity> = {},
  warderOverrides: Partial<PlayerEntity> = {},
) {
  const attacker = mkWorldPlayer(A, 500, 300, {
    vx: 600, vy: 0, aimX: 900, aimY: 300,
  });
  const victim = mkWorldPlayer(B, 540, 300, { teamId: "t1", ...victimOverrides });
  const warder = mkWorldPlayer(C, 600, 300, {
    characterId: "heavy", // paladin
    teamId: "t1",
    aimX: 440, aimY: 300, // facing back toward B (which sits at -x from C)
    kindling: 0,
    ...warderOverrides,
  });
  const state = mkWorldState([attacker, victim, warder]);
  const runtime = createRuntime(flatMap);
  runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

  // The per-tick INPUT frame's aimX/aimY is what actually drives the
  // facing check this tick (World.ts overwrites the entity's aim from the
  // live input) — must mirror whatever `warderOverrides` set on the
  // constructed entity, not a hardcoded default, or an aim-direction
  // override on `warderOverrides` would silently get clobbered back to
  // the default facing the moment the tick runs.
  const inputs: Record<PlayerId, InputFrame | null> = {
    [A]: null,
    [B]: null,
    [C]: {
      seq: InputSeq(1), tick: Tick(1),
      keys: (warderOverrides.shieldActive === false ? 0 : SHIELD_BIT) as InputBitfield,
      aimX: warder.aimX, aimY: warder.aimY, dtMs: DT_MS,
    },
  };
  return stepWithRuntime(state, runtime, inputs, DT_MS);
}

describe("Team peel — integration (dash-bash into an ally standing in a warding paladin's shadow)", () => {
  test("a warding paladin teammate mitigates the hit on the ally AND banks the Kindling themselves", () => {
    const res = runPeelScenario();
    const peelEvent = res.events.find((e) => e.t === "team-peel-absorbed");
    expect(peelEvent).toBeDefined();
    if (peelEvent && peelEvent.t === "team-peel-absorbed") {
      expect(peelEvent.victimId).toBe(B);
      expect(peelEvent.warderId).toBe(C);
      expect(peelEvent.damageBlocked).toBeGreaterThan(0);
      expect(peelEvent.kindlingGranted).toBeGreaterThan(0);
    }
    // Victim took MITIGATED damage — dropped, but not the raw BASH_DAMAGE (34).
    expect(res.state.players[B]!.health).toBeLessThan(100);
    expect(res.state.players[B]!.health).toBeGreaterThan(100 - 34);
    // The WARDER banks the Kindling — the VICTIM does not.
    expect(res.state.players[C]!.kindling ?? 0).toBeGreaterThan(0);
    expect(res.state.players[B]!.kindling ?? 0).toBe(0);
    // Victim's own Ward never covered this (they aren't holding it) — this
    // is peel, not self-ward.
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(false);
  });

  test("solo/FFA: the identical geometry with NO teamId on either player never peels", () => {
    const res = runPeelScenario({ teamId: undefined }, { teamId: undefined });
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    // Full, unmitigated bash damage lands.
    expect(res.state.players[B]!.health).toBe(100 - 34);
    expect(res.state.players[C]!.kindling ?? 0).toBe(0);
  });

  test("opposing teams: the identical geometry with DIFFERENT teamIds never peels", () => {
    const res = runPeelScenario({ teamId: "t1" }, { teamId: "t2" });
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("a warding NON-paladin ally (wrong class) never peels, even in perfect position holding Shield", () => {
    const res = runPeelScenario({}, { characterId: "balanced" });
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("a paladin teammate who is NOT holding Ward never peels", () => {
    const res = runPeelScenario({}, { shieldActive: false });
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("a paladin teammate facing AWAY from the victim never peels (outside the cone)", () => {
    const res = runPeelScenario({}, { aimX: 760, aimY: 300 }); // facing +x, away from B
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("a warding paladin teammate positioned far away (outside WARD_PEEL_RADIUS_PX) never peels", () => {
    const res = runPeelScenario(
      {},
      { x: 540 + WARD_PEEL_RADIUS_PX + 100, y: 300, aimX: 0, aimY: 300 },
    );
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("if the victim holds their OWN Ward, self-ward wins and team peel never fires (no double-mitigation)", () => {
    const attacker = mkWorldPlayer(A, 500, 300, { vx: 600, vy: 0, aimX: 900, aimY: 300 });
    // Victim is ALSO a paladin, holding their own Ward, facing BACK toward
    // the attacker (who approaches from -x, same as every other scenario
    // in this file) — aimX must be LESS than the victim's own x for the
    // frontal cone to actually cover the incoming bash.
    const victim = mkWorldPlayer(B, 540, 300, {
      characterId: "heavy", teamId: "t1", aimX: 440, aimY: 300, kindling: 0,
    });
    const warder = mkWorldPlayer(C, 600, 300, {
      characterId: "heavy", teamId: "t1", aimX: 440, aimY: 300, kindling: 0,
    });
    const state = mkWorldState([attacker, victim, warder]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    const inputs: Record<PlayerId, InputFrame | null> = {
      [A]: null,
      [B]: { seq: InputSeq(1), tick: Tick(1), keys: SHIELD_BIT as InputBitfield, aimX: 440, aimY: 300, dtMs: DT_MS },
      [C]: { seq: InputSeq(1), tick: Tick(1), keys: SHIELD_BIT as InputBitfield, aimX: 440, aimY: 300, dtMs: DT_MS },
    };
    const res = stepWithRuntime(state, runtime, inputs, DT_MS);
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(true);
    expect(res.events.some((e) => e.t === "team-peel-absorbed")).toBe(false);
    // The VICTIM's own block banks their OWN Kindling, not the bystander's.
    expect(res.state.players[B]!.kindling ?? 0).toBeGreaterThan(0);
    expect(res.state.players[C]!.kindling ?? 0).toBe(0);
  });
});
