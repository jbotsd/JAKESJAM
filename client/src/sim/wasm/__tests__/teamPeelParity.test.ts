// Track Z1c "team peel" item (convergence-goal.md) — parity gate for
// world.zig's new `findTeamPeelWarderIdx`/`applyTeamPeel` (port of
// World.ts's `findTeamPeelWarder`/`applyTeamPeel`, combat.ts's
// `isAllyBodyInWardCone`/`computeTeamPeelMitigation`), using the Track Z1a
// ally substrate (`isAlly`) that was bridged specifically so this item
// could consume it without another growth cut.
//
// Scenario: a Paladin (WARDER) holds Shield near their teammate (VICTIM,
// same teamId), facing them within WARD_ARC_RADIANS/WARD_PEEL_RADIUS_PX —
// an eligible "peel" configuration. A third player (ATTACKER, no team,
// wizard/raycast basic gun — hitscan resolves same-tick, no travel-time
// noise) shoots the VICTIM. Team peel should extend the Warder's Ward to
// the hit: only WARD_MITIGATION_FRACTION-complement (40%) of the raw
// damage lands on the victim, and the Warder banks Kindling for the
// portion blocked — proven identical on both engines.

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
  id: "team-peel-parity-arena",
  name: "Team Peel Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  // Close floor (unlike hitscanResolveParity's deliberately-distant one) —
  // this scenario runs several ticks, not 1-2, so gravity must not carry
  // anyone into the kill plane before the shot resolves.
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 450 }, size: { x: 1600, y: 60 } },
  ],
};

const ATTACKER = PlayerId("attacker");
const VICTIM = PlayerId("victim");
const WARDER = PlayerId("warder");
const Y = 400;
const ATTACKER_X = 700;
const VICTIM_X = 900; // 200px from attacker — inside starterWeapon's raycast range floor.
const WARDER_X = VICTIM_X + 50; // 50px from victim — inside WARD_PEEL_RADIUS_PX (160).
const STARTER_DAMAGE = starterWeapon.damage;
const WARD_MITIGATION_FRACTION = 0.6; // combat.ts/combat.zig
const RAW_DAMAGE = STARTER_DAMAGE; // wizard body hit, no headshot, no chaos scaling.
const EXPECTED_MITIGATED_DAMAGE = RAW_DAMAGE * (1 - WARD_MITIGATION_FRACTION);
const EXPECTED_KINDLING_GRANTED = RAW_DAMAGE * WARD_MITIGATION_FRACTION; // KINDLING_PER_DAMAGE_BLOCKED = 1.0

const FireBit = 1 << 6;
const ShieldBit = 1 << 8;

function makePlayer(
  id: PlayerId,
  x: number,
  characterId: CharacterArchetype,
  aimX: number,
  aimY: number,
  teamId: string | undefined,
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
    teamId,
  };
}

function makeState(): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {
      [ATTACKER]: makePlayer(ATTACKER, ATTACKER_X, "balanced", VICTIM_X, Y, undefined),
      [VICTIM]: makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y, "red"),
      // Warder faces LEFT (toward the victim, dx<0) — WARD_ARC_RADIANS
      // (120°) is wide enough that "aim roughly at the victim" is plenty.
      [WARDER]: makePlayer(WARDER, WARDER_X, "heavy", VICTIM_X, Y, "red"),
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
}

/** Run `nTicks`: the warder holds Shield the WHOLE run (established well
 *  before the attacker ever fires); the attacker holds Fire starting tick
 *  `fireFromTick` (delayed so `shieldActive` is unambiguously live on both
 *  engines by the time the shot resolves — `tickShield` is a per-tick,
 *  input-driven recompute, not a persistent flag the initial entity value
 *  alone guarantees). Returns each side's final victim health + warder
 *  kindling. */
function runTicks(
  nTicks: number,
  fireFromTick: number,
): {
  tsVictimHealth: number;
  tsWarderKindling: number;
  zigVictimHealth: number;
  zigWarderKindling: number;
} {
  const runtime = createRuntime(MAP);
  let tsState = makeState();

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
        keys: 0,
        aimX: VICTIM_X + 100,
        aimY: Y,
        dtMs: DT_MS,
      },
      [WARDER]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: ShieldBit,
        aimX: VICTIM_X,
        aimY: Y,
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
      [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
      [String(WARDER), { keys: ShieldBit, prevKeys: ShieldBit, aimX: VICTIM_X, aimY: Y }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return {
    tsVictimHealth: tsState.players[VICTIM]!.health,
    tsWarderKindling: tsState.players[WARDER]!.kindling ?? 0,
    zigVictimHealth: zigState.players[VICTIM]!.health,
    zigWarderKindling: zigState.players[WARDER]!.kindling ?? 0,
  };
}

describe("team peel parity (Track Z1c team peel item)", () => {
  test("a peel-eligible Warder mitigates a teammate's hit IDENTICALLY on both engines (60% blocked, Kindling granted)", () => {
    // Warder holds Shield ticks 1-4 (established); attacker fires starting
    // tick 5 — well past any first-tick shield-establishment ordering
    // question either engine's per-player loop order might raise.
    const { tsVictimHealth, tsWarderKindling, zigVictimHealth, zigWarderKindling } = runTicks(10, 5);

    const tsDamageTaken = 100 - tsVictimHealth;
    const zigDamageTaken = 100 - zigVictimHealth;

    // The actual mechanic: damage is MITIGATED (40% of raw), not the full
    // raw 12 — and not the generic shield's 100% block either.
    expect(tsDamageTaken, "TS: victim takes the mitigated 40%, not raw").toBeCloseTo(
      EXPECTED_MITIGATED_DAMAGE,
      6,
    );
    expect(zigDamageTaken, "Zig: victim takes the mitigated 40%, not raw").toBeCloseTo(
      EXPECTED_MITIGATED_DAMAGE,
      6,
    );
    expect(zigDamageTaken, "TS vs Zig damage taken").toBeCloseTo(tsDamageTaken, 6);

    // The Warder's own reward: Kindling for the blocked 60%.
    expect(tsWarderKindling, "TS: Warder banks Kindling for the block").toBeCloseTo(
      EXPECTED_KINDLING_GRANTED,
      6,
    );
    expect(zigWarderKindling, "Zig: Warder banks Kindling for the block").toBeCloseTo(
      EXPECTED_KINDLING_GRANTED,
      6,
    );
    expect(zigWarderKindling, "TS vs Zig Kindling granted").toBeCloseTo(tsWarderKindling, 6);
  });

  test("control: an OUT-OF-CONE Warder (facing away) never peels — victim takes the FULL raw hit on both engines", () => {
    const runtime = createRuntime(MAP);
    let tsState = makeState();
    // Warder faces AWAY from the victim (aim to the right, +x) — outside
    // WARD_ARC_RADIANS entirely, so `isAllyBodyInWardCone` must fail on
    // both engines despite every OTHER eligibility condition holding.
    tsState = {
      ...tsState,
      players: {
        ...tsState.players,
        [WARDER]: { ...tsState.players[WARDER]!, aimX: WARDER_X + 100, aimY: Y },
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

    const nTicks = 10;
    const fireFromTick = 5;
    for (let t = 1; t <= nTicks; t++) {
      const attackerKeys = t >= fireFromTick ? FireBit : 0;
      const inputs: Record<PlayerId, InputFrame | null> = {
        [ATTACKER]: { seq: InputSeq(t), tick: Tick(t), keys: attackerKeys, aimX: VICTIM_X, aimY: Y, dtMs: DT_MS },
        [VICTIM]: { seq: InputSeq(t), tick: Tick(t), keys: 0, aimX: VICTIM_X + 100, aimY: Y, dtMs: DT_MS },
        [WARDER]: { seq: InputSeq(t), tick: Tick(t), keys: ShieldBit, aimX: WARDER_X + 100, aimY: Y, dtMs: DT_MS },
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
        [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
        [String(WARDER), { keys: ShieldBit, prevKeys: ShieldBit, aimX: WARDER_X + 100, aimY: Y }],
      ]);
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
    }

    const tsDamageTaken = 100 - tsState.players[VICTIM]!.health;
    const zigDamageTaken = 100 - zigState.players[VICTIM]!.health;
    expect(tsDamageTaken, "TS: no peel, full raw damage").toBeCloseTo(RAW_DAMAGE, 6);
    expect(zigDamageTaken, "Zig: no peel, full raw damage").toBeCloseTo(RAW_DAMAGE, 6);
    expect(tsState.players[WARDER]!.kindling ?? 0, "TS: no Kindling granted").toBe(0);
    expect(zigState.players[WARDER]!.kindling ?? 0, "Zig: no Kindling granted").toBe(0);
  });
});
