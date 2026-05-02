// Void-plane kill check: a player whose y exceeds map.size.y +
// KILL_PLANE_MARGIN_PX is force-killed by the sim, emitting a hit-confirmed
// event with damage equal to remaining health. Mirrors the "fall through the
// hole / off the map edge" recovery path so the existing death → respawn flow
// can reset them on round transition.

import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import { KILL_PLANE_MARGIN_PX } from "../player.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
} from "../types.js";

const DT_MS = 1000 / 60;

const tinyMap: MapDefinition = {
  id: "void-test",
  name: "Void Test",
  size: { x: 800, y: 600 },
  spawns: [
    { x: 200, y: 300 },
    { x: 600, y: 300 },
  ],
  // Single floating platform far above the floor — there's nothing below
  // y=320 so a player who walks off the edge falls forever in the absence
  // of a kill plane.
  platforms: [
    { id: "perch", kind: "platform", position: { x: 400, y: 320 }, size: { x: 200, y: 16 } },
  ],
};

const players: PlayerSpawnInfo[] = [
  {
    playerId: PlayerId("voider"),
    characterId: "balanced",
    name: "Voider",
    color: "#ff0000",
    weaponId: "starter-pistol",
  },
];

function noInput(tick: number): InputFrame {
  return {
    seq: InputSeq(tick),
    tick: Tick(tick),
    keys: 0,
    aimX: 0,
    aimY: 0,
    dtMs: DT_MS,
  };
}

describe("void-plane kill", () => {
  test("player teleported below map.size.y + KILL_PLANE_MARGIN_PX is killed within one tick", () => {
    let state = World.create(tinyMap, players, 1);
    const runtime = createRuntime(tinyMap);

    // Force the player past the kill plane. Skip movement integration —
    // we're testing the void-plane gate, not gravity.
    const pid = PlayerId("voider");
    const teleportedY = tinyMap.size.y + KILL_PLANE_MARGIN_PX + 50;
    state = {
      ...state,
      players: {
        ...state.players,
        [pid]: { ...state.players[pid]!, y: teleportedY, vy: 0 },
      },
    };

    const before = state.players[pid]!;
    expect(before.alive).toBe(true);
    expect(before.health).toBe(100);

    const result = stepWithRuntime(
      state,
      runtime,
      { [pid]: noInput(0) },
      DT_MS,
    );

    const after = result.state.players[pid]!;
    expect(after.alive).toBe(false);
    expect(after.health).toBe(0);

    // The death MUST emit a hit-confirmed event so the client SFX/HUD,
    // round-end logic, and Convex match-result hook all run normally.
    const deathEvent = result.events.find(
      (e) => e.t === "hit-confirmed" && e.victimId === pid,
    );
    expect(deathEvent).toBeDefined();
    if (deathEvent && deathEvent.t === "hit-confirmed") {
      expect(deathEvent.damage).toBe(100);
      expect(deathEvent.sourceProjectileId).toBeNull();
    }
  });

  test("player just inside the kill plane (y === map.size.y + margin) is NOT killed", () => {
    let state = World.create(tinyMap, players, 1);
    const runtime = createRuntime(tinyMap);

    const pid = PlayerId("voider");
    const safeY = tinyMap.size.y + KILL_PLANE_MARGIN_PX; // boundary, inclusive of safe
    state = {
      ...state,
      players: {
        ...state.players,
        [pid]: { ...state.players[pid]!, y: safeY, vy: 0 },
      },
    };

    const result = stepWithRuntime(
      state,
      runtime,
      { [pid]: noInput(0) },
      DT_MS,
    );

    const after = result.state.players[pid]!;
    expect(after.alive).toBe(true);
    expect(after.health).toBe(100);
  });

  test("a player who falls naturally past the kill plane is killed (gravity-driven)", () => {
    // Walk off the perch and let gravity carry the player into the void.
    // After ~2s of free-fall the player should comfortably exceed
    // map.size.y + KILL_PLANE_MARGIN_PX and be marked dead.
    let state = World.create(tinyMap, players, 1);
    const runtime = createRuntime(tinyMap);
    const pid = PlayerId("voider");

    // Place the player 1px above the perch so they're on it.
    state = {
      ...state,
      players: {
        ...state.players,
        [pid]: { ...state.players[pid]!, x: 600, y: 300 }, // off the edge
      },
    };

    const TICKS = 240; // ~4 seconds, plenty for gravity to pull them past
    let killed = false;
    for (let i = 0; i < TICKS; i += 1) {
      const result = stepWithRuntime(state, runtime, { [pid]: noInput(i) }, DT_MS);
      state = result.state;
      const p = state.players[pid]!;
      if (!p.alive) {
        killed = true;
        break;
      }
    }
    expect(killed).toBe(true);
  });

  test("dead players are not re-killed (no spurious hit-confirmed events)", () => {
    let state = World.create(tinyMap, players, 1);
    const runtime = createRuntime(tinyMap);
    const pid = PlayerId("voider");
    const teleportedY = tinyMap.size.y + KILL_PLANE_MARGIN_PX + 50;
    state = {
      ...state,
      players: {
        ...state.players,
        [pid]: {
          ...state.players[pid]!,
          y: teleportedY,
          alive: false,
          health: 0,
        },
      },
    };

    const result = stepWithRuntime(state, runtime, { [pid]: noInput(0) }, DT_MS);
    const deathEvents = result.events.filter(
      (e) => e.t === "hit-confirmed" && e.victimId === pid,
    );
    expect(deathEvents.length).toBe(0);
  });
});
