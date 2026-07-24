// Track Z1c "Kindled Ward partial mitigation" item (convergence-goal.md) —
// parity gate for world.zig's new Paladin-specific branch inside every
// "shield_active" check (port of combat.ts's `tryDeflectDamage` step 2
// paladin branch, docs/classes-goal.md "Defense IS the engine" for
// Kindled/Ward), wired at all four damage-resolution sites: the real-
// projectile hit site, the hitscan hit site (Track Z1c item 1),
// `resolveInstantAoeCasts`, and `stepMeleeSwing`.
//
// BEFORE this item: EVERY class holding Shield got the generic 100%-block-
// and-drain-charge treatment uniformly — a live gameplay divergence from
// TS's actual design (Paladin should take 40% of a hit IN CONE (60%
// mitigated, Kindling granted) and full damage out of cone; Ninja's Shield
// should never mitigate at all, dash i-frames being its only defense
// verb). This file proves both corrected branches AND that the
// PRE-EXISTING generic block (Wizard/Priest) is UNCHANGED.

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
import { starterWeapon } from "../../data/weapons";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
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
  id: "kindled-ward-parity-arena",
  name: "Kindled Ward Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 450 }, size: { x: 1600, y: 60 } },
  ],
};

const ATTACKER = PlayerId("attacker");
const VICTIM = PlayerId("victim");
const Y = 400;
const ATTACKER_X = 700;
const VICTIM_X = 900;
const STARTER_DAMAGE = starterWeapon.damage;
const WARD_MITIGATION_FRACTION = 0.6;
const EXPECTED_MITIGATED_DAMAGE = STARTER_DAMAGE * (1 - WARD_MITIGATION_FRACTION);
const EXPECTED_KINDLING_GRANTED = STARTER_DAMAGE * WARD_MITIGATION_FRACTION;

const FireBit = 1 << 6;
const ShieldBit = 1 << 8;

function makePlayer(
  id: PlayerId,
  x: number,
  characterId: CharacterArchetype,
  aimX: number,
  aimY: number,
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
    ammo: 999,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

/** Runs `nTicks`: the victim holds Shield the WHOLE run (aimed per
 *  `victimAimX/Y` — toward the attacker for an in-cone scenario, away for
 *  out-of-cone), established well before the attacker starts firing at
 *  tick `fireFromTick`. Returns each side's final victim health + Kindling. */
function runHitscan(
  victimCharacterId: CharacterArchetype,
  victimAimX: number,
  victimAimY: number,
  nTicks = 10,
  fireFromTick = 5,
): {
  tsHealth: number;
  tsKindling: number;
  zigHealth: number;
  zigKindling: number;
} {
  const runtime = createRuntime(MAP);
  let tsState: WorldState = {
    tick: Tick(0),
    rngState: 1,
    players: {
      [ATTACKER]: makePlayer(ATTACKER, ATTACKER_X, "balanced", VICTIM_X, Y),
      [VICTIM]: makePlayer(VICTIM, VICTIM_X, victimCharacterId, victimAimX, victimAimY),
    } as Record<PlayerId, PlayerEntity>,
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
  let zigState: WorldState = structuredClone(tsState);

  for (let t = 1; t <= nTicks; t++) {
    const attackerKeys = t >= fireFromTick ? FireBit : 0;
    const inputs: Record<PlayerId, InputFrame | null> = {
      [ATTACKER]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: attackerKeys,
        aimX: VICTIM_X,
        aimY: Y,
        dtMs: DT_MS,
      },
      [VICTIM]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: ShieldBit,
        aimX: victimAimX,
        aimY: victimAimY,
        dtMs: DT_MS,
      },
    } as Record<PlayerId, InputFrame | null>;

    tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

    const prevAttackerKeys = t - 1 >= fireFromTick ? FireBit : 0;
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [String(ATTACKER), { keys: attackerKeys, prevKeys: prevAttackerKeys, aimX: VICTIM_X, aimY: Y }],
      [String(VICTIM), { keys: ShieldBit, prevKeys: ShieldBit, aimX: victimAimX, aimY: victimAimY }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return {
    tsHealth: tsState.players[VICTIM]!.health,
    tsKindling: tsState.players[VICTIM]!.kindling ?? 0,
    zigHealth: zigState.players[VICTIM]!.health,
    zigKindling: zigState.players[VICTIM]!.kindling ?? 0,
  };
}

describe("Kindled Ward self-mitigation parity (Track Z1c Kindled Ward partial mitigation item)", () => {
  test("a Paladin facing the threat (in cone) takes the mitigated 40% and banks Kindling, identically on both engines", () => {
    // Facing toward the attacker (aimX = attacker's x) puts the muzzle
    // origin dead-centre in the victim's frontal cone.
    const { tsHealth, tsKindling, zigHealth, zigKindling } = runHitscan("heavy", ATTACKER_X, Y);
    const tsDamage = 100 - tsHealth;
    const zigDamage = 100 - zigHealth;
    expect(tsDamage, "TS: 40% lands").toBeCloseTo(EXPECTED_MITIGATED_DAMAGE, 6);
    expect(zigDamage, "Zig: 40% lands").toBeCloseTo(EXPECTED_MITIGATED_DAMAGE, 6);
    expect(tsKindling, "TS: Kindling granted").toBeCloseTo(EXPECTED_KINDLING_GRANTED, 6);
    expect(zigKindling, "Zig: Kindling granted").toBeCloseTo(EXPECTED_KINDLING_GRANTED, 6);
  });

  test("control: a Paladin facing AWAY (out of cone) takes the FULL raw hit, no Kindling, on both engines", () => {
    // Facing away from the attacker (aimX beyond the victim, same
    // direction as the attacker is NOT) puts the muzzle origin behind the
    // victim's cone.
    const { tsHealth, tsKindling, zigHealth, zigKindling } = runHitscan("heavy", VICTIM_X + 200, Y);
    expect(100 - tsHealth, "TS: full raw damage, no cone coverage").toBeCloseTo(STARTER_DAMAGE, 6);
    expect(100 - zigHealth, "Zig: full raw damage, no cone coverage").toBeCloseTo(STARTER_DAMAGE, 6);
    expect(tsKindling, "TS: no Kindling out of cone").toBe(0);
    expect(zigKindling, "Zig: no Kindling out of cone").toBe(0);
  });

  test("control: a Ninja's held Shield NEVER mitigates (LOCKED doctrine — dash i-frames only), on both engines", () => {
    const { tsHealth, zigHealth } = runHitscan("sprinter", ATTACKER_X, Y);
    expect(100 - tsHealth, "TS: ninja shield grants zero mitigation").toBeCloseTo(STARTER_DAMAGE, 6);
    expect(100 - zigHealth, "Zig: ninja shield grants zero mitigation").toBeCloseTo(STARTER_DAMAGE, 6);
  });

  test("regression: a Wizard's held Shield keeps the PRE-EXISTING generic 100% block, unaffected by this item", () => {
    const { tsHealth, zigHealth } = runHitscan("balanced", ATTACKER_X, Y);
    expect(tsHealth, "TS: full generic block").toBe(100);
    expect(zigHealth, "Zig: full generic block").toBe(100);
  });
});
