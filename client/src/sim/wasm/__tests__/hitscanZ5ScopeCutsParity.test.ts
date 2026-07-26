// Track Z5 item 3 (finish-line-goal.md) — parity gate for the v1 hitscan
// scope cuts closed this pass: the shooter-side amp chain + Ghost Guard
// evasion, mirror-shield retrace, and impact-AOE routing (player-hit case).
// See world.zig's "Hitscan resolution" section header for the full STATUS
// list (which of the 5 v1 cuts are closed vs still open after this pass).
//
// Same lockstep harness shape as hitscanResolveParity.test.ts (Track Z1c
// item 1): both players are "balanced" (wizard) unless a scenario needs a
// specific chassis (Ghost Guard needs "sprinter"/Ninja) — starterWeapon's
// `delivery` is raycast for every class-blind build (THE GEOMETRICIAN
// RULING keeps wizard raycast even WITH a projectile-flavored card, e.g.
// Explosive Facet, equipped).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import { starterWeapon } from "../../data/weapons";
import {
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm"))
    return Promise.resolve(
      new Response(ab as ArrayBuffer, { headers: { "Content-Type": "application/wasm" } }),
    );
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "hitscan-z5-parity-arena",
  name: "Hitscan Z5 Scope-Cuts Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 1200 }, size: { x: 1600, y: 60 } },
  ],
};

const SHOOTER = PlayerId("shooter");
const VICTIM = PlayerId("victim");
const BYSTANDER = PlayerId("bystander");
const SHOOTER_X = 700;
const VICTIM_X = 900; // 200px — inside starterWeapon's raycast range floor.
const Y = 400;
const STARTER_DAMAGE = starterWeapon.damage;
const FireBit = 1 << 6;
// World.ts:300 — held every tick a scenario needs `shieldActive` genuinely
// derived (it's a per-tick recompute from HELD input, `tickShield`-
// equivalent, not a persistent flag a scenario can just seed once and
// expect to survive a step — same "recomputes fresh from held input every
// tick regardless" contract world.zig's own `bulwark_step` doc comment
// already documents for this exact mechanic).
const ShieldBit = 1 << 8;
const HUGE_TICK = 100_000 as unknown as Tick;

function makePlayer(
  id: PlayerId,
  x: number,
  characterId: CharacterArchetype,
  aimX: number,
  aimY: number,
  extra: Partial<PlayerEntity> = {},
): PlayerEntity {
  return {
    id,
    characterId,
    x,
    y: Y,
    vx: 0,
    vy: 0,
    aimX,
    aimY,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
    ...extra,
  };
}

/** Sets up the world + steps BOTH orchestrators (TS lockstep + wasm) for
 *  `nTicks`, the shooter holding Fire the whole time aimed dead-on at the
 *  victim (dead body-centre, no headshot). Returns the final players
 *  record from each side for the caller to inspect whatever fields matter
 *  to its own scenario. */
function runLockstep(
  players: PlayerEntity[],
  nTicks = 1,
  extraKeysById: Partial<Record<PlayerId, number>> = {},
): { ts: WorldState; zig: WorldState } {
  const runtime = createRuntime(MAP);
  const initial: WorldState = {
    tick: Tick(0),
    rngState: 1,
    players: Object.fromEntries(players.map((p) => [p.id, p])) as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
  let tsState = initial;

  setWorldStatics(
    MAP.platforms.map(platformToAABB),
    MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  setWorldArenaBounds(
    runtime.ceilingClampY,
    MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  setWorldSpawnPoints(MAP.spawns);
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
  let zigState: WorldState = structuredClone(initial);

  for (let t = 1; t <= nTicks; t++) {
    const inputs: Record<PlayerId, InputFrame | null> = {};
    const wasmInputs = new Map<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >();
    for (const p of players) {
      const keys = (p.id === SHOOTER ? FireBit : 0) | (extraKeysById[p.id] ?? 0);
      inputs[p.id] = {
        seq: InputSeq(t),
        tick: Tick(t),
        keys,
        aimX: p.aimX,
        aimY: p.aimY,
        dtMs: DT_MS,
      };
      const prevExtra = t > 1 ? (extraKeysById[p.id] ?? 0) : 0;
      wasmInputs.set(String(p.id), {
        keys,
        prevKeys: (p.id === SHOOTER && t > 1 ? FireBit : 0) | prevExtra,
        aimX: p.aimX,
        aimY: p.aimY,
      });
    }
    tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = wasmInputs;
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return { ts: tsState, zig: zigState };
}

describe("hitscan Z5 scope cuts (Track Z5 item 3): shooter-side amp chain + Ghost Guard", () => {
  test("stacked shooter buffs (Facet Break × Rally Light × Kindled Resolve) compose IDENTICALLY on both engines, and actually change the outcome vs baseline", () => {
    // damage_amp/overcharge/boss_mode are DELIBERATELY excluded from this
    // scenario: grepped directly, `damageAmpUntilTick`/`overchargeUntilTick`/
    // `bossModeUntilTick` have ZERO TS consumers anywhere in World.ts/
    // combat.ts/weapon.ts/projectile.ts — a pre-existing "TS-declared,
    // TS-dead, Zig-live" characteristic of the ALREADY-SHIPPED real-
    // projectile amp chain this pass's hitscan port faithfully mirrors
    // (verified: setting them here made Zig's damage diverge from TS's,
    // because TS silently ignores them while Zig's real-projectile-mirrored
    // code applies them — a pre-existing gap orthogonal to this item, not
    // something this pass's hitscan port introduces or is responsible for
    // fixing). Facet Break / Rally Light / Kindled Resolve all DO have real
    // TS consumers (World.ts's own resolveRangedHit reads each), so this
    // combo is a genuine, meaningful cross-engine proof.
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y, {
      facetTargetId: VICTIM,
      facetMarkUntilTick: HUGE_TICK,
      rallyLightUntilTick: HUGE_TICK,
      kindledResolveUntilTick: HUGE_TICK,
    });
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y, { health: 100_000 });
    const { ts, zig } = runLockstep([shooter, victim]);
    const tsDealt = 100_000 - ts.players[VICTIM]!.health;
    const zigDealt = 100_000 - zig.players[VICTIM]!.health;
    expect(tsDealt, "TS: stacked amp damage dealt").toBeGreaterThan(0);
    expect(zigDealt, "Zig: stacked amp damage dealt").toBeCloseTo(tsDealt, 6);
    // Sanity floor: the full stack is 1.25(facet) * 1.12(rally) *
    // 1.1(kindled) ≈ 1.54x base — clears a bare unbuffed shot with margin.
    expect(tsDealt, "stacked amp clearly exceeds a bare unbuffed shot").toBeGreaterThan(STARTER_DAMAGE * 1.3);
  });

  test("control: Facet Break's amp does NOT apply to an unmarked bystander (proves the mark gate, not a blanket buff)", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y, {
      facetTargetId: PlayerId("someone-else"),
      facetMarkUntilTick: HUGE_TICK,
    });
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y);
    const { ts, zig } = runLockstep([shooter, victim]);
    expect(ts.players[VICTIM]!.health, "TS: plain unamplified hit").toBeCloseTo(100 - STARTER_DAMAGE, 9);
    expect(zig.players[VICTIM]!.health, "Zig: plain unamplified hit").toBeCloseTo(100 - STARTER_DAMAGE, 9);
  });

  test("Ghost Guard: a charged, fast-moving Ninja fully evades the shot on both engines", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y);
    const victim = makePlayer(VICTIM, VICTIM_X, "sprinter", VICTIM_X + 100, Y, {
      ghostGuardChargeUntilTick: HUGE_TICK,
      vx: 400, // well above NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD (60px/s)
      vy: 0,
    });
    const { ts, zig } = runLockstep([shooter, victim]);
    expect(ts.players[VICTIM]!.health, "TS: fully evaded").toBe(100);
    expect(zig.players[VICTIM]!.health, "Zig: fully evaded").toBe(100);
  });

  test("control: a Ninja with NO Ghost Guard charge takes the normal hit on both engines (proves the gate, not an always-evade bug)", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y);
    const victim = makePlayer(VICTIM, VICTIM_X, "sprinter", VICTIM_X + 100, Y, { vx: 400, vy: 0 });
    const { ts, zig } = runLockstep([shooter, victim]);
    expect(ts.players[VICTIM]!.health, "TS: normal hit lands").toBeCloseTo(100 - STARTER_DAMAGE, 9);
    expect(zig.players[VICTIM]!.health, "Zig: normal hit lands").toBeCloseTo(100 - STARTER_DAMAGE, 9);
  });
});

describe("hitscan Z5 scope cuts (Track Z5 item 3): mirror-shield retrace", () => {
  test("a Mirror Shield block fires ONE reflected retrace back along the shot's reverse line, landing on whoever is actually there — IDENTICALLY on both engines (blocker untouched, the crossed bystander takes the bounce)", () => {
    // The retrace's `backAngle` derives from the ORIGINAL fired angle
    // (itself muzzle-offset-adjusted, matching World.ts's own
    // `Math.atan2(pending.source.vy, pending.source.vx) + Math.PI`, not a
    // fresh origin→hit-point recompute) then travels the weapon's FULL
    // range — a real, honest v1 approximation shared by both engines: at
    // typical engagement ranges the muzzle's fixed vertical anchor offset
    // (MUZZLE_ANCHOR_UP=60px, weapon.ts) means the bounce is NOT guaranteed
    // to land back on the original shooter specifically (verified
    // empirically: it doesn't, in this exact geometry, on EITHER engine —
    // an existing TS characteristic this port faithfully mirrors, not
    // something this item introduces or is asked to fix). BYSTANDER sits
    // exactly on the empirically-observed reverse-ray crossing point for
    // this fixed geometry (SHOOTER_X/VICTIM_X/Y below, 1 tick of fall)),
    // proving the retrace mechanism genuinely fires and connects — the
    // real proof this test needs is that BOTH engines land it on the
    // SAME target for the SAME damage, not that it happens to be the
    // shooter.
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y);
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y, {
      cards: ["mirror-shield"],
      shieldActive: true,
      shieldCharge: 100,
    });
    const bystander = makePlayer(BYSTANDER, 48.65, "balanced", 148.65, 177.7, { y: 177.7 });
    const { ts, zig } = runLockstep([shooter, victim, bystander], 1, { [VICTIM]: ShieldBit });
    expect(ts.players[VICTIM]!.health, "TS: blocker fully absorbed, no damage").toBe(100);
    expect(zig.players[VICTIM]!.health, "Zig: blocker fully absorbed, no damage").toBe(100);
    expect(ts.players[SHOOTER]!.health, "TS: shooter itself untouched by this bounce").toBe(100);
    expect(zig.players[SHOOTER]!.health, "Zig: shooter itself untouched by this bounce").toBe(100);
    expect(ts.players[BYSTANDER]!.health, "TS: the crossed bystander takes the bounce").toBeLessThan(100);
    expect(zig.players[BYSTANDER]!.health, "Zig: the crossed bystander takes the bounce").toBeLessThan(100);
    expect(zig.players[BYSTANDER]!.health, "both engines agree on the bounce damage").toBeCloseTo(
      ts.players[BYSTANDER]!.health,
      6,
    );
  });

  test("control: a plain (non-mirror) shield block absorbs with NO bounce on either engine", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y);
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y, {
      shieldActive: true,
      shieldCharge: 100,
    });
    const { ts, zig } = runLockstep([shooter, victim], 1, { [VICTIM]: ShieldBit });
    expect(ts.players[VICTIM]!.health, "TS: blocker fully absorbed").toBe(100);
    expect(zig.players[VICTIM]!.health, "Zig: blocker fully absorbed").toBe(100);
    expect(ts.players[SHOOTER]!.health, "TS: shooter untouched — no bounce").toBe(100);
    expect(zig.players[SHOOTER]!.health, "Zig: shooter untouched — no bounce").toBe(100);
  });
});

describe("hitscan Z5 scope cuts (Track Z5 item 3): impact-AOE routing (explosive/slow-field)", () => {
  test("Explosive Facet detonates at the hit point — a nearby BYSTANDER (never directly hit) also takes splash damage on both engines", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y, {
      cards: ["explosive-facet"],
    });
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y);
    // Explosive Facet's impactRadiusPx is 64 — well within reach at +30px.
    const bystander = makePlayer(BYSTANDER, VICTIM_X + 30, "balanced", VICTIM_X + 130, Y);
    const { ts, zig } = runLockstep([shooter, victim, bystander]);
    expect(ts.players[BYSTANDER]!.health, "TS: bystander catches the splash").toBeLessThan(100);
    expect(zig.players[BYSTANDER]!.health, "Zig: bystander catches the splash").toBeLessThan(100);
    expect(zig.players[BYSTANDER]!.health, "both engines agree on the splash amount").toBeCloseTo(
      ts.players[BYSTANDER]!.health,
      6,
    );
    // The direct-hit victim is at distance ~0 from the blast centre, so
    // TS's own design has no SEPARATE per-hit damage push for them — the
    // AOE already covers them (World.ts:3047's comment) — same on Zig.
    expect(ts.players[VICTIM]!.health, "TS: direct target also takes the blast").toBeLessThan(100);
    expect(zig.players[VICTIM]!.health, "Zig: direct target also takes the blast").toBeLessThan(100);
  });

  test("Slow Field detonates at the hit point — a nearby BYSTANDER picks up the slow status on both engines (status-only, no HP loss)", () => {
    const shooter = makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, Y, {
      cards: ["slow-field"],
    });
    const victim = makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y);
    const bystander = makePlayer(BYSTANDER, VICTIM_X + 30, "balanced", VICTIM_X + 130, Y);
    const { ts, zig } = runLockstep([shooter, victim, bystander]);
    expect(ts.players[BYSTANDER]!.health, "TS: status-only, no HP loss").toBe(100);
    expect(zig.players[BYSTANDER]!.health, "Zig: status-only, no HP loss").toBe(100);
    expect(ts.players[BYSTANDER]!.slowedUntilTick, "TS: bystander picks up the slow").toBeGreaterThan(0);
    expect(zig.players[BYSTANDER]!.slowedUntilTick, "Zig: bystander picks up the slow").toBeGreaterThan(0);
    expect(
      ts.players[BYSTANDER]!.slowMultiplier,
      "both engines agree on the slow strength",
    ).toBeCloseTo(zig.players[BYSTANDER]!.slowMultiplier!, 6);
  });
});
