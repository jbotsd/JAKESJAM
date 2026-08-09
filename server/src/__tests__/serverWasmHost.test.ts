// Phase B3 prep — contract tests for serverWasmHost.
//
// Locks in the public surface introduced in the skeleton commit:
//   - preload() / ready() / isReady() lifecycle
//   - setStatics + writeInputs cache + snapshots
//   - step() requires preload (throws otherwise)
//   - step() returns {state, events, matchComplete} shape
//   - step() determinism gate (same inputs → same bytes)
//
// Mirrors client wasmHost.test.ts pattern but uses Bun's
// WebAssembly directly (loadServerSim already does this).

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { serverWasmHost } from "../serverWasmHost";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type PlayerEntity,
  type ProjectileEntity,
  type WorldState,
} from "@sim/types.ts";

function fixtureState(): WorldState {
  const proj: ProjectileEntity = {
    id: EntityId(1),
    ownerId: null,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
  const dest: DestructibleEntity = {
    id: EntityId(101),
    kind: "barrel",
    x: 100,
    y: 100,
    width: 32,
    height: 32,
    health: 100,
    explosive: true,
    flammable: false,
  };
  const fire: FireEntity = {
    id: EntityId(201),
    x: 0,
    y: 0,
    radius: 32,
    remainingMs: 500,
    ownerId: null,
    damagePerSecond: 14,
  };
  return {
    tick: Tick(7),
    rngState: 1234,
    players: {} as Record<PlayerId, never>,
    projectiles: { [proj.id]: proj } as Record<EntityId, ProjectileEntity>,
    destructibles: { [dest.id]: dest } as Record<EntityId, DestructibleEntity>,
    firePatches: { [fire.id]: fire } as Record<EntityId, FireEntity>,
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 30_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("serverWasmHost — B3 contract", () => {
  beforeAll(async () => {
    serverWasmHost.__resetForTests();
    await serverWasmHost.preload();
  });

  test("isReady is true after preload resolves", () => {
    expect(serverWasmHost.isReady()).toBe(true);
  });

  test("ready() resolves quickly when already ready", async () => {
    const t0 = performance.now();
    await serverWasmHost.ready();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  test("setStatics buffers AABBs + exposes via getStaticsSnapshot", () => {
    serverWasmHost.setStatics(
      [
        { x: 0, y: 600, w: 1280, h: 32 },
        { x: 0, y: 0, w: 32, h: 640 },
      ],
      [0, 0],
    );
    const snap = serverWasmHost.getStaticsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.y).toBe(600);
  });

  test("setStatics is idempotent — last call wins", () => {
    serverWasmHost.setStatics([{ x: 0, y: 0, w: 100, h: 100 }], [1]);
    serverWasmHost.setStatics(
      [
        { x: 0, y: 0, w: 200, h: 200 },
        { x: 0, y: 0, w: 300, h: 300 },
      ],
      [0, 0],
    );
    const snap = serverWasmHost.getStaticsSnapshot();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.w).toBe(200);
  });

  test("writeInputs caches the latest map + exposes via getInputsSnapshot", () => {
    const inputs = new Map<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >();
    inputs.set("p1", { keys: 0b0001, prevKeys: 0, aimX: 10, aimY: 20 });
    serverWasmHost.writeInputs(inputs);
    const snap = serverWasmHost.getInputsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.size).toBe(1);
    expect(snap!.get("p1")!.keys).toBe(0b0001);
  });

  test("step returns {state, events, matchComplete} shape", () => {
    const result = serverWasmHost.step(fixtureState(), 16.667);
    expect(result.state).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
    expect(typeof result.matchComplete).toBe("boolean");
  });

  test("step is byte-stable across two calls (determinism gate)", () => {
    const s = fixtureState();
    const a = serverWasmHost.step({ ...s }, 16.667);
    const b = serverWasmHost.step({ ...s }, 16.667);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.rngState).toBe(b.state.rngState);
  });

  test("launch pads fire inside step_world (world.zig §8c executes)", () => {
    // End-to-end zig-execution gate for the launch-pad mirror: pads reach
    // the module via setLaunchPads (same host-set path as statics/arena
    // bounds — zero WorldState bytes), and step_world applies the
    // launchPad.ts formula. Not a TS↔zig full-tick parity claim (those
    // gates are quarantined while TS is sim authority) — this pins that
    // the wasm path genuinely EXECUTES pads with the exact impulse math.
    const mkPlayer = (id: string, x: number): PlayerEntity => ({
      id: PlayerId(id),
      characterId: "balanced",
      x,
      y: 442,
      vx: 0,
      vy: 0,
      aimX: x + 100,
      aimY: 442,
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
    });
    const onPad = mkPlayer("a", 500); // inside the pad AABB below
    const bystander = mkPlayer("b", 900); // keeps detectRoundWinner from a KO
    const state: WorldState = {
      ...fixtureState(),
      projectiles: {},
      destructibles: {},
      firePatches: {},
      players: {
        [onPad.id]: onPad,
        [bystander.id]: bystander,
      } as WorldState["players"],
    };
    serverWasmHost.setStatics([], []);
    // Neutral inputs (earlier tests cache a held-left input map).
    serverWasmHost.writeInputs(
      new Map([
        ["a", { keys: 0, prevKeys: 0, aimX: 600, aimY: 442 }],
        ["b", { keys: 0, prevKeys: 0, aimX: 1000, aimY: 442 }],
      ]),
    );
    serverWasmHost.setLaunchPads([
      {
        id: "pad-0",
        position: { x: 500, y: 464 },
        size: { x: 96, y: 12 },
        impulse: { x: 0, y: -700 },
      },
    ]);
    try {
      const result = serverWasmHost.step(state, 16.667);
      // The zig pad pass runs AFTER zig player physics: one tick of rise
      // gravity leaves vAlong ≈ −24 (< the 0.5·|i| retrigger gate), the
      // ADD lands under the |impulse| floor, so the launch is EXACTLY the
      // pad impulse — bit-checkable.
      const launched = result.state.players[PlayerId("a")]!;
      expect(launched.vy).toBe(-700);
      expect(launched.vx).toBe(0);
      // Bystander untouched by the pad.
      expect(result.state.players[PlayerId("b")]!.vy).not.toBe(-700);
      // launch_pad_fired = kind 11 (world_state.zig SimEventKind), pad
      // index 0, player_idx_a = sorted index of "a" = 0.
      const fired = result.events.filter((e) => e.kind === 11);
      expect(fired.length).toBe(1);
      expect(fired[0]!.entityId).toBe(0);
      expect(fired[0]!.playerIdxA).toBe(0);
    } finally {
      // Module-level pad array persists in the wasm instance — clear so
      // later steps in this process see a pad-less world again.
      serverWasmHost.setLaunchPads([]);
    }
  });

  test("true slopes execute inside step_world — bit-exact vs TS stepPlayer, both grades both directions", async () => {
    // End-to-end zig-execution + parity gate for the slope mirror
    // (launch-pad precedent, upgraded to a bit-exactness claim): slopes
    // reach the module via setSlopes (host-set, zero WorldState bytes),
    // the wasm player pass grounds/projects on them, and across N ticks
    // the positions are EXACTLY the TS stepPlayer trajectory.
    //
    // The TS mirror carries movement memory across ticks, exactly like
    // the wasm full-sync cycle does since Track Z0e: the bridge now
    // packs/unpacks the player_movement parallel array and
    // serverWasmHost's mergeUnpacked rides it on the state object, so
    // step_world sees PERSISTENT memory (starting from the
    // freshPlayerMovementMemory() defaults an absent
    // `state.movementMemory` packs). This comment used to document the
    // OPPOSITE — "the reference steps with ZEROED memory per tick,
    // exactly what step_world sees" — which was a faithful mirror of a
    // real bug (the pack re-zeroed Zig's movement memory every tick:
    // air-acceleration on the ground, no ground friction, ground jumps
    // impossible). Z0e fixed the bug; the reference follows the live
    // semantics.
    const { stepPlayer, setStepPlayerBackend, freshPlayerMovementMemory } =
      await import("@sim/player.ts");
    const { buildStaticCache } = await import("@sim/collision.ts");
    setStepPlayerBackend(null);

    const mkPlayer = (id: string, x: number): PlayerEntity => ({
      id: PlayerId(id),
      characterId: "balanced",
      x,
      y: 572, // standing on the floor (top 600, half-height 28)
      vx: 0,
      vy: 0,
      aimX: x + 100,
      aimY: 572,
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
    });

    const scenarios = [
      { name: "2:1 ascending right", slope: { id: "s", base: { x: 500, y: 600 }, run: 240, grade: "2:1" as const, dir: 1 as const }, startX: 380, keys: 0b10 /* Right */ },
      { name: "2:1 ascending left", slope: { id: "s", base: { x: 780, y: 600 }, run: 240, grade: "2:1" as const, dir: -1 as const }, startX: 900, keys: 0b01 /* Left */ },
      { name: "1:1 ascending right", slope: { id: "s", base: { x: 500, y: 600 }, run: 160, grade: "1:1" as const, dir: 1 as const }, startX: 380, keys: 0b10 },
      { name: "1:1 ascending left", slope: { id: "s", base: { x: 780, y: 600 }, run: 160, grade: "1:1" as const, dir: -1 as const }, startX: 900, keys: 0b01 },
    ];

    const DT = 16.667;
    try {
      for (const sc of scenarios) {
        serverWasmHost.setStatics([{ x: 0, y: 600, w: 1280, h: 40 }], [0]);
        serverWasmHost.setArenaBounds(null, 0); // no ceiling, no kill plane
        serverWasmHost.setLaunchPads([]);
        serverWasmHost.setSlopes([sc.slope]);
        const mover = mkPlayer("a", sc.startX);
        const bystander = mkPlayer("b", sc.slope.dir === 1 ? 100 : 1180);
        let state: WorldState = {
          ...fixtureState(),
          projectiles: {},
          destructibles: {},
          firePatches: {},
          players: {
            [mover.id]: mover,
            [bystander.id]: bystander,
          } as WorldState["players"],
        };
        serverWasmHost.writeInputs(
          new Map([
            ["a", { keys: sc.keys, prevKeys: sc.keys, aimX: sc.startX + 100, aimY: 572 }],
            ["b", { keys: 0, prevKeys: 0, aimX: 0, aimY: 572 }],
          ]),
        );

        // TS reference — same statics, same slope, memory THREADED across
        // ticks (Track Z0e: the wasm cycle persists it now too).
        const cache = buildStaticCache(
          [{ id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } }],
          1280, 720,
          [sc.slope],
        );
        let ref: PlayerEntity = mover;
        let refMem = freshPlayerMovementMemory();
        let groundedProjectionTicks = 0;
        for (let t = 0; t < 60; t++) {
          const result = serverWasmHost.step(state, DT);
          state = result.state;
          const r = stepPlayer(
            ref, sc.keys, sc.keys, ref.aimX, ref.aimY,
            refMem, [], DT,
            { collisionCache: cache },
          );
          ref = r.player;
          refMem = r.memory;
          const w = state.players[PlayerId("a")]!;
          expect(w.x, `${sc.name} t=${t} x`).toBe(ref.x);
          expect(w.y, `${sc.name} t=${t} y`).toBe(ref.y);
          expect(w.vx, `${sc.name} t=${t} vx`).toBe(ref.vx);
          expect(w.vy, `${sc.name} t=${t} vy`).toBe(ref.vy);
          if (r.memory.groundedLastFrame && Math.abs(ref.vy) > 50) {
            groundedProjectionTicks++;
          }
        }
        // The run genuinely rode the slope (grounded + tangent climb),
        // otherwise this parity pass would be vacuous.
        expect(groundedProjectionTicks, sc.name).toBeGreaterThan(5);
      }
    } finally {
      // Module-level slope array persists in the wasm instance — clear so
      // later steps in this process see a slope-less world again.
      serverWasmHost.setSlopes([]);
      serverWasmHost.setStatics([], []);
    }
  });

  test("step throws when not ready (after reset)", async () => {
    // The exported singleton is the only public surface; verify
    // the not-ready error by resetting + probing before preload.
    serverWasmHost.__resetForTests();
    expect(() => serverWasmHost.step(fixtureState(), 16.667)).toThrow(
      /step\(\) called before ready/,
    );
    // Restore for subsequent tests.
    await serverWasmHost.preload();
  });

  test("__resetForTests clears caches + flips isReady false", async () => {
    serverWasmHost.setStatics([{ x: 0, y: 0, w: 1, h: 1 }], [0]);
    serverWasmHost.writeInputs(
      new Map([["p", { keys: 0, prevKeys: 0, aimX: 0, aimY: 0 }]]),
    );
    expect(serverWasmHost.getStaticsSnapshot()).not.toBeNull();
    expect(serverWasmHost.getInputsSnapshot()).not.toBeNull();
    serverWasmHost.__resetForTests();
    expect(serverWasmHost.getStaticsSnapshot()).toBeNull();
    expect(serverWasmHost.getInputsSnapshot()).toBeNull();
    expect(serverWasmHost.isReady()).toBe(false);
    // Restore — see the afterAll below for why leaving it dead is not a
    // local-only sin.
    await serverWasmHost.preload();
  });

  // `serverWasmHost` is a process-wide SINGLETON and `bun test` runs every
  // file in ONE process, so a reset that is never restored leaks into every
  // test file ordered after this one: their MatchHosts pin `simBackend`
  // "ts" (isReady() false at construction), and any host that had already
  // pinned "wasm" throws "step() called before ready" every tick and
  // silently falls back. That made `USE_WASM_STEP_WORLD=1 bun test` report
  // green while 294 ticks ran on TS — a hollow gate for gospel-goal E2,
  // whose first evidence row is "full server suite green under wasm step".
  // Restoring here is what makes that row mean what it says.
  afterAll(async () => {
    serverWasmHost.__resetForTests();
    await serverWasmHost.preload();
  });
});
