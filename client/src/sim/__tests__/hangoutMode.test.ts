// Hangout mode (graceful-gliding-flame plan A1, revised by venue-sprint2-goal
// S2.C): players move every tick (round machine never freezes them), no cards
// are ever granted, and the void kill-plane respawns in place instead of
// killing. Since S2.C the carve-out is TARGETS-ONLY: firing is live (so the
// venue lobby's practice dummies can be broken) but players take ZERO damage
// from any source — projectiles ghost through them entirely. Combat mode
// (mode omitted / "combat") must stay byte-identical — that's what keeps the
// rest of the parity/determinism suite (which only ever exercises combat
// mode) green.

import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import { KILL_PLANE_MARGIN_PX } from "../player.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
} from "../types.js";

const DT_MS = 1000 / 60;

const Bit = {
  Right: 1 << 1,
  Fire: 1 << 6,
} as const;

const tinyMap: MapDefinition = {
  id: "hangout-test",
  name: "Hangout Test",
  size: { x: 1200, y: 700 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 600, y: 650 }, size: { x: 1200, y: 60 } },
  ],
};

const players: PlayerSpawnInfo[] = [
  {
    playerId: PlayerId("a"),
    characterId: "balanced",
    name: "Alpha",
    color: "#ff0000",
    weaponId: "starter-pistol",
  },
  {
    playerId: PlayerId("b"),
    characterId: "balanced",
    name: "Bravo",
    color: "#00ff00",
    weaponId: "starter-pistol",
  },
];

function frame(tick: number, keys: InputBitfield, aimX = 900, aimY = 400): InputFrame {
  return { seq: InputSeq(tick), tick: Tick(tick), keys, aimX, aimY, dtMs: DT_MS };
}

describe("hangout mode", () => {
  test("World.create starts already in the fighting phase (no countdown)", () => {
    const state = World.create(tinyMap, players, 1, [], "hangout");
    expect(state.round.phase).toBe("fighting");
  });

  test("combat mode (default) is unchanged — still starts in countdown", () => {
    const state = World.create(tinyMap, players, 1);
    expect(state.round.phase).toBe("countdown");
  });

  test("players move immediately — no countdown freeze", () => {
    let state = World.create(tinyMap, players, 1, [], "hangout");
    const runtime = createRuntime(tinyMap, "hangout");
    const pid = PlayerId("a");
    const startX = state.players[pid]!.x;
    for (let i = 0; i < 30; i += 1) {
      const result = stepWithRuntime(
        state,
        runtime,
        { [pid]: frame(i, Bit.Right) },
        DT_MS,
      );
      state = result.state;
    }
    expect(state.players[pid]!.x).toBeGreaterThan(startX);
  });

  test("firing is LIVE in hangout mode (S2.C) — holding Fire spawns projectiles", () => {
    let state = World.create(tinyMap, players, 1, [], "hangout");
    const runtime = createRuntime(tinyMap, "hangout");
    const pid = PlayerId("a");
    let fired = false;
    for (let i = 0; i < 30; i += 1) {
      const result = stepWithRuntime(
        state,
        runtime,
        { [pid]: frame(i, Bit.Fire) },
        DT_MS,
      );
      state = result.state;
      if (result.events.some((e) => e.t === "shot-fired")) fired = true;
    }
    expect(fired).toBe(true);
  });

  test("players take ZERO projectile damage — shots ghost straight through them (S2.C)", () => {
    // Alpha stands at x=200, Bravo at x=600 on the same floor. Alpha holds
    // Fire aimed square at Bravo for two seconds of sim time.
    let state = World.create(tinyMap, players, 1, [], "hangout");
    const runtime = createRuntime(tinyMap, "hangout");
    const shooter = PlayerId("a");
    const target = PlayerId("b");
    // Let both settle onto the floor first so the aim line is truly flat.
    for (let i = 0; i < 30; i += 1) {
      state = stepWithRuntime(state, runtime, {}, DT_MS).state;
    }
    const targetY = state.players[target]!.y;
    const startHealth = state.players[target]!.health;
    for (let i = 30; i < 150; i += 1) {
      const result = stepWithRuntime(
        state,
        runtime,
        { [shooter]: frame(i, Bit.Fire, state.players[target]!.x, targetY) },
        DT_MS,
      );
      state = result.state;
      expect(result.events.some((e) => e.t === "hit-confirmed")).toBe(false);
      expect(result.events.some((e) => e.t === "player-killed")).toBe(false);
    }
    expect(state.players[target]!.health).toBe(startHealth);
    expect(state.players[target]!.alive).toBe(true);
  });

  test("practice dummies take real damage and break (S2.C targets-only carve-out)", () => {
    const dummyMap: MapDefinition = {
      ...tinyMap,
      id: "hangout-dummy-test",
      destructibles: [
        {
          id: "dummy_0",
          kind: "box",
          health: 60,
          // Center coords (centerToAABB): resting on the floor top (y=620),
          // dead ahead of Alpha's spawn and BEHIND Bravo — the shot must
          // ghost through Bravo and still break the box.
          position: { x: 800, y: 598 },
          size: { x: 44, y: 44 },
          explosive: false,
          flammable: false,
        },
      ],
    };
    let state = World.create(dummyMap, players, 1, [], "hangout");
    const runtime = createRuntime(dummyMap, "hangout");
    const shooter = PlayerId("a");
    const bystander = PlayerId("b");
    expect(Object.keys(state.destructibles).length).toBe(1);
    const startHealth = Object.values(state.destructibles)[0]!.health;
    for (let i = 0; i < 30; i += 1) {
      state = stepWithRuntime(state, runtime, {}, DT_MS).state;
    }
    let damaged = false;
    for (let i = 30; i < 900 && Object.keys(state.destructibles).length > 0; i += 1) {
      const result = stepWithRuntime(
        state,
        runtime,
        { [shooter]: frame(i, Bit.Fire, 800, 598) },
        DT_MS,
      );
      state = result.state;
      const box = Object.values(state.destructibles)[0];
      if (box && box.health < startHealth) damaged = true;
    }
    expect(damaged).toBe(true);
    expect(Object.keys(state.destructibles).length).toBe(0); // broken
    // The bystander standing in the line of fire the whole time: untouched.
    expect(state.players[bystander]!.health).toBe(100);
    expect(state.players[bystander]!.alive).toBe(true);
  });

  test("round machine never transitions — phase stays fighting for many ticks, no scores change", () => {
    let state = World.create(tinyMap, players, 1, [], "hangout");
    const runtime = createRuntime(tinyMap, "hangout");
    for (let i = 0; i < 600; i += 1) {
      const result = stepWithRuntime(state, runtime, {}, DT_MS);
      state = result.state;
      expect(result.matchComplete).toBe(false);
    }
    expect(state.round.phase).toBe("fighting");
    expect(state.round.roundIndex).toBe(0);
    expect(Object.values(state.round.scores).every((s) => s === 0)).toBe(true);
    expect(state.round.draftingOffers).toBeUndefined();
  });

  test("void kill-plane respawns in place instead of killing", () => {
    let state = World.create(tinyMap, players, 1, [], "hangout");
    const runtime = createRuntime(tinyMap, "hangout");
    const pid = PlayerId("a");
    const teleportedY = tinyMap.size.y + KILL_PLANE_MARGIN_PX + 50;
    state = {
      ...state,
      players: {
        ...state.players,
        [pid]: { ...state.players[pid]!, y: teleportedY, vy: 0, health: 100 },
      },
    };
    const result = stepWithRuntime(state, runtime, {}, DT_MS);
    const after = result.state.players[pid]!;
    expect(after.alive).toBe(true);
    expect(after.health).toBe(100);
    expect(after.y).toBeLessThan(teleportedY);
    expect(result.events.some((e) => e.t === "player-killed")).toBe(false);
    expect(result.events.some((e) => e.t === "hit-confirmed")).toBe(false);
  });
});
