// Track L legibility — additive SimEvent surface (docs/legibility-audit.md):
//   - `shield-refunded` for the instant shield-charge refunds that previously
//     moved ONLY the HUD bar (Return Glass, Bastion Pulse; Plant Charge's
//     landing tick shares the same emission site shape).
//   - `hit-confirmed.amped` for victim-state damage amps that folded silently
//     into `damage` (radiant 1.4x vs a statused target, Fooled consumption).
//   - `hit-confirmed.pierced` for the void pass-through of a HELD shield
//     (the counter-pick moment that read as a bug).
// All additive: absent on every path that doesn't hit the specific mechanic.
// Deterministic — fixed seed, scripted inputs, no wall-clock reads.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import {
  GEO_RETURN_GLASS_SHIELD_REFUND,
  KIN_BASTION_PULSE_SHIELD_REFUND,
  KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER,
  SHIELD_MAX_CHARGE_DEFAULT,
} from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type ProjectileEntity,
  type SimEvent,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");
const B = PlayerId("b");
const DT_MS = 1000 / 60;
const SLOT1_BIT = 1 << 10;
const SHIELD_BIT = 1 << 8; // combat.ts InputBit.Shield — hold-to-block

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  characterId: PlayerEntity["characterId"] = "balanced",
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
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

function mkProjectile(
  idRaw: number,
  ownerId: PlayerId,
  x: number,
  y: number,
  element: string,
  damage = 20,
): ProjectileEntity {
  const id = EntityId(idRaw);
  return {
    id,
    ownerId,
    x,
    y,
    vx: 600,
    vy: 0,
    shape: "circle",
    radius: 8,
    damage,
    lifetimeMs: 1000,
    pathing: "straight",
    element,
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

function mkState(players: PlayerEntity[], projectiles: ProjectileEntity[] = []): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  const projMap: Record<EntityId, ProjectileEntity> = {};
  for (const pr of projectiles) projMap[pr.id] = pr;
  return {
    tick: Tick(0),
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: projMap,
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

function noInputs(players: PlayerEntity[]): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = null;
  return out;
}

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

type HitConfirmed = Extract<SimEvent, { t: "hit-confirmed" }>;
type ShieldRefunded = Extract<SimEvent, { t: "shield-refunded" }>;

describe("shield-refunded (Return Glass / Bastion Pulse)", () => {
  test("Return Glass emits shield-refunded with the real post-cap delta", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["return-glass"];
    caster.shieldCharge = 0;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const ev = res.events.find((e): e is ShieldRefunded => e.t === "shield-refunded");
    expect(ev).toBeDefined();
    expect(ev!.playerId).toBe(A);
    expect(ev!.amount).toBe(GEO_RETURN_GLASS_SHIELD_REFUND);
    expect(ev!.x).toBe(400);
  });

  test("Return Glass at a FULL bar stays silent (honest read — nothing came back)", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["return-glass"];
    caster.shieldCharge = SHIELD_MAX_CHARGE_DEFAULT; // balanced multiplier = 1
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    // The cast itself still happens (ability-activated); only the refund
    // read is suppressed.
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
    expect(res.events.some((e) => e.t === "shield-refunded")).toBe(false);
  });

  test("Bastion Pulse emits shield-refunded; ward held doubles the amount", () => {
    const held = mkPlayer(A, 400, 400, "heavy");
    held.cards = ["bastion-pulse"];
    held.shieldCharge = 0;
    held.shieldActive = true;
    const resHeld = stepWithRuntime(
      mkState([held]),
      createRuntime(flatMap),
      inputsWith([held], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const evHeld = resHeld.events.find((e): e is ShieldRefunded => e.t === "shield-refunded");
    expect(evHeld).toBeDefined();
    expect(evHeld!.amount).toBe(
      KIN_BASTION_PULSE_SHIELD_REFUND * KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER,
    );

    const unheld = mkPlayer(A, 400, 400, "heavy");
    unheld.cards = ["bastion-pulse"];
    unheld.shieldCharge = 0;
    const resUnheld = stepWithRuntime(
      mkState([unheld]),
      createRuntime(flatMap),
      inputsWith([unheld], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const evUnheld = resUnheld.events.find(
      (e): e is ShieldRefunded => e.t === "shield-refunded",
    );
    expect(evUnheld).toBeDefined();
    expect(evUnheld!.amount).toBe(KIN_BASTION_PULSE_SHIELD_REFUND);
  });
});

describe("hit-confirmed.amped (victim-state damage amps)", () => {
  test("radiant vs an already-statused victim carries amped: true", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim: PlayerEntity = {
      ...mkPlayer(B, 100, 400),
      burnUntilTick: Tick(9999),
      burnDps: 1,
      burnTickLastApplied: Tick(0),
    };
    const proj = mkProjectile(1, A, 95, 400, "radiant", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      noInputs([attacker, victim]),
      DT_MS,
    );
    const hit = res.events.find(
      (e): e is HitConfirmed => e.t === "hit-confirmed" && e.victimId === B,
    );
    expect(hit).toBeDefined();
    expect(hit!.amped).toBe(true);
    expect(hit!.damage).toBeCloseTo(28); // 20 * 1.4 — flag matches the math
  });

  test("radiant vs a CLEAN victim carries no amped flag", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    const proj = mkProjectile(1, A, 95, 400, "radiant", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      noInputs([attacker, victim]),
      DT_MS,
    );
    const hit = res.events.find(
      (e): e is HitConfirmed => e.t === "hit-confirmed" && e.victimId === B,
    );
    expect(hit).toBeDefined();
    expect(hit!.amped).toBeUndefined();
    expect(hit!.damage).toBeCloseTo(20);
  });

  test("a Fooled victim's amped consumption carries the flag on any element", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim: PlayerEntity = {
      ...mkPlayer(B, 100, 400),
      fooledUntilTick: Tick(9999),
    };
    const proj = mkProjectile(1, A, 95, 400, "neutral", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      noInputs([attacker, victim]),
      DT_MS,
    );
    const hit = res.events.find(
      (e): e is HitConfirmed => e.t === "hit-confirmed" && e.victimId === B,
    );
    expect(hit).toBeDefined();
    expect(hit!.amped).toBe(true);
    expect(hit!.damage).toBeGreaterThan(20); // the multiplier really applied
  });
});

describe("hit-confirmed.pierced (void through a held shield)", () => {
  test("void vs a HELD shield lands full damage with pierced: true, shield untouched", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim: PlayerEntity = {
      ...mkPlayer(B, 100, 400),
      shieldActive: true,
      shieldCharge: 50,
    };
    const proj = mkProjectile(1, A, 95, 400, "void", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      // The victim must HOLD shield this tick — tickShield drops
      // shieldActive without the held input bit.
      inputsWith([attacker, victim], { [B as string]: frame(SHIELD_BIT, 1) }),
      DT_MS,
    );
    const hit = res.events.find(
      (e): e is HitConfirmed => e.t === "hit-confirmed" && e.victimId === B,
    );
    expect(hit).toBeDefined();
    expect(hit!.pierced).toBe(true);
    expect(hit!.damage).toBeCloseTo(20);
    expect(res.state.players[B]!.health).toBeCloseTo(80);
  });

  test("a non-void shot vs the same held shield is absorbed — no pierced hit", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim: PlayerEntity = {
      ...mkPlayer(B, 100, 400),
      shieldActive: true,
      shieldCharge: 50,
    };
    const proj = mkProjectile(1, A, 95, 400, "neutral", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      inputsWith([attacker, victim], { [B as string]: frame(SHIELD_BIT, 1) }),
      DT_MS,
    );
    expect(
      res.events.some((e) => e.t === "hit-confirmed" && e.victimId === B),
    ).toBe(false);
    expect(res.state.players[B]!.health).toBe(100);
  });

  test("void vs an UNSHIELDED victim carries no pierced flag (nothing was pierced)", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    const proj = mkProjectile(1, A, 95, 400, "void", 20);
    const res = stepWithRuntime(
      mkState([attacker, victim], [proj]),
      createRuntime(flatMap),
      noInputs([attacker, victim]),
      DT_MS,
    );
    const hit = res.events.find(
      (e): e is HitConfirmed => e.t === "hit-confirmed" && e.victimId === B,
    );
    expect(hit).toBeDefined();
    expect(hit!.pierced).toBeUndefined();
  });
});
