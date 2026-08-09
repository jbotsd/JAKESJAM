// Does a player's input reach THAT player under wasm authority?
//
// gospel E2 blocker, found 2026-08-09 while reading the input contract for
// N0.3. Two facts that are individually reasonable and jointly wrong:
//
//   1. packWorldState orders the player array by `id.localeCompare` and
//      writes every player's `current_keys`/`prev_keys` as ZERO, leaving
//      "the caller patches the bytes between pack and step_world".
//   2. serverWasmHost.writeInputsIntoMemory patches player slot `i` for the
//      i-th id of `cachedInputs` — the players who have a frame THIS TICK.
//
// When every player has a frame those orders coincide and all is well.
// matchHost skips players with no frame (`if (!frame) continue`), so on any
// tick where one player's input is missing — jitter, a bot that didn't
// think, a mid-join — the subset index no longer matches the slot index and
// one player's keys are written into another player's slot.
//
// This is wasm-path-only: the TS step takes `inputsByPlayer` keyed by id and
// never does index math. It is a candidate explanation for the "live play
// kept surfacing symptoms under Zig authority that never reproduced under
// TS" note in matchHost's own header, which caused the May 2026 revert.

import { describe, test, expect, beforeAll } from "bun:test";
import { serverWasmHost } from "../serverWasmHost.ts";
import { World } from "@sim/World.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { PlayerId, type PlayerSpawnInfo, type WorldState } from "@sim/types.ts";
import { InputBit } from "@net/protocol.ts";

/** Two players whose ids sort unambiguously: "aaa_first" before "zzz_last". */
function twoPlayerState(): WorldState {
  const map = resolveMap("boxworks-tower");
  const spawns: PlayerSpawnInfo[] = [
    {
      playerId: PlayerId("aaa_first"),
      characterId: "balanced",
      weaponId: "shuriken",
      name: "AAA",
      color: "#ffffff",
    },
    {
      playerId: PlayerId("zzz_last"),
      characterId: "balanced",
      weaponId: "shuriken",
      name: "ZZZ",
      color: "#ffffff",
    },
  ];
  return World.create(map, spawns, 12345, []);
}

describe("wasm input routing (gospel E2)", () => {
  beforeAll(async () => {
    await serverWasmHost.ready();
    expect(serverWasmHost.isReady()).toBe(true);
  });

  test("an input for ONE player moves THAT player, not their neighbour", () => {
    const state = twoPlayerState();
    const map = resolveMap("boxworks-tower");
    serverWasmHost.setStatics(
      map.platforms.map((p) => ({ x: p.x, y: p.y, w: p.width, h: p.height })),
      map.platforms.map(() => 0),
    );
    serverWasmHost.setArenaSize(map.size.x, map.size.y);

    const before = {
      aaa: state.players[PlayerId("aaa_first")]!.x,
      zzz: state.players[PlayerId("zzz_last")]!.x,
    };

    // ONLY zzz_last has a frame this tick — exactly what matchHost produces
    // when aaa_first's input has not arrived yet.
    serverWasmHost.writeInputs(
      new Map([
        ["zzz_last", { keys: InputBit.Right, prevKeys: 0, aimX: 1, aimY: 0 }],
      ]),
    );

    let next = state;
    // 400 ticks: enough to clear the opening countdown (movement is frozen
    // until `fighting`, which cost the first run of this test a false
    // 'nobody moved' reading) and then move an unambiguous distance.
    for (let i = 0; i < 400; i++) {
      serverWasmHost.writeInputs(
        new Map([
          ["zzz_last", { keys: InputBit.Right, prevKeys: InputBit.Right, aimX: 1, aimY: 0 }],
        ]),
      );
      next = serverWasmHost.step(next, 16.667).state;
    }

    const after = {
      aaa: next.players[PlayerId("aaa_first")]!.x,
      zzz: next.players[PlayerId("zzz_last")]!.x,
    };
    const movedAaa = Math.abs(after.aaa - before.aaa);
    const movedZzz = Math.abs(after.zzz - before.zzz);

    // Assert the RELATIONSHIP, not "the idle player is perfectly still":
    // an idle body legitimately drifts a little from contact resolution
    // (~48 px over these 400 ticks when the suite's shared wasm heap is
    // warm), and an over-strict `< 1` here failed in-suite while passing
    // alone — a flaky test dressed up as a strict one.
    //
    // The bug this guards produced the exact INVERSE of these numbers:
    // before the fix, zzz_last (holding Right) moved 0.00 px and
    // aaa_first (holding nothing) moved 1304.65 px.
    expect(movedZzz).toBeGreaterThan(100);
    expect(movedAaa).toBeLessThan(movedZzz / 10);
  });
});
