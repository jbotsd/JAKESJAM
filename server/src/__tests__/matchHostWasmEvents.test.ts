// Track Z2 item 2 (convergence-goal.md) — the wasm event-drop branch is
// gone.
//
// THE BUG THIS PINS DOWN: matchHost.runStep's wasm branch discarded every
// Zig-emitted SimEvent except the drafting overlay's own round/draft
// events ("serverWasmHost's own WasmSimEvents are dropped"). Wasm-mode
// matches therefore ran event-blind server-side: no shot-fired /
// hit-confirmed / player-killed / first-blood ever reached onSimEvent,
// the host-clip trigger (maybeSignalHostClip), the spectator director,
// or the snapshot broadcast's event stream — while the TS backend
// delivered all of them. The fix forwards the FULL converted stream
// (convertWasmEventsToTs — the same translation the client wasm path has
// always used) merged with the overlay's events.
//
// The test drives MatchHost's own private runStep on the wasm backend
// with a fire input and asserts a NON-round event (shot-fired) comes back
// — verified-failing on the old drop branch. A console.warn spy proves
// the result came from the wasm path, not the TS fallback (which would
// also emit shot-fired and mask the drop).

import { describe, expect, test, spyOn } from "bun:test";

process.env.USE_WASM_STEP_WORLD = "1";

const { serverWasmHost } = await import("../serverWasmHost.ts");
await serverWasmHost.preload();
const { MatchHost } = await import("../matchHost.ts");

import {
  PlayerId,
  type InputFrame,
  type PlayerSpawnInfo,
  type SimEvent,
  type WorldState,
} from "@sim/types.ts";
import { InputSeq, Tick } from "@sim/types.ts";
import { KILL_PLANE_MARGIN_PX } from "@sim/player.ts";
import type { WorldRuntime } from "@sim/World.ts";
import type { MapDefinition } from "@sim/types.ts";

const A = PlayerId("wasm-events-a");
const B = PlayerId("wasm-events-b");
const FIRE_BIT = 1 << 6;

type HostInternals = {
  map: MapDefinition;
  state: WorldState;
  runtime: WorldRuntime;
  simBackend: "wasm" | "ts";
  runStep(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): { state: WorldState; events: SimEvent[]; matchComplete: boolean };
};

function makeWasmHost(): HostInternals {
  const spawn = (pid: PlayerId, name: string): PlayerSpawnInfo => ({
    playerId: pid,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ffffff",
    name,
  });
  const host = new MatchHost("test-wasm-events", [spawn(A, "A"), spawn(B, "B")], []);
  const internals = host as unknown as HostInternals;
  // Belt-and-braces against module-cache ordering in full-suite runs: if
  // another test file imported matchHost.ts before our env write, the
  // module-level USE_WASM_STEP_WORLD gate read false and the constructor
  // neither pinned the wasm backend nor pushed the map wiring. Re-pin +
  // re-push here (all serverWasmHost setters are idempotent
  // cache-and-reapply calls).
  internals.simBackend = "wasm";
  serverWasmHost.setStatics(
    internals.map.platforms.map((p) => ({
      x: p.position.x - p.size.x / 2,
      y: p.position.y - p.size.y / 2,
      w: p.size.x,
      h: p.size.y,
    })),
    internals.map.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  serverWasmHost.setArenaBounds(
    internals.runtime.ceilingClampY,
    internals.map.size.y > 0 ? internals.map.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  serverWasmHost.setArenaSize(internals.map.size.x, internals.map.size.y);
  serverWasmHost.setLaunchPads(internals.map.launchPads ?? []);
  serverWasmHost.setSlopes(internals.map.slopes ?? []);
  serverWasmHost.setSpawnPoints(
    internals.map.spawns.length > 0
      ? internals.map.spawns
      : [{ x: internals.map.size.x / 2, y: internals.map.size.y / 2 }],
  );
  return internals;
}

describe("MatchHost wasm backend — SimEvents are forwarded (Track Z2 item 2)", () => {
  test("a fire input surfaces shot-fired from the wasm step (no TS fallback)", async () => {
    expect(serverWasmHost.isReady()).toBe(true);
    const internals = makeWasmHost();

    // Fighting phase so weapon fire is live (World.create starts in
    // countdown, where the fire gate blocks the shot).
    internals.state = {
      ...internals.state,
      round: {
        ...internals.state.round,
        phase: "fighting",
        countdownRemainingMs: 90_000,
      },
    };

    const warnSpy = spyOn(console, "warn");
    const inputs: Record<PlayerId, InputFrame | null> = {
      [A]: {
        seq: InputSeq(1),
        tick: Tick(1),
        keys: FIRE_BIT,
        aimX: internals.state.players[A]!.x + 200,
        aimY: internals.state.players[A]!.y,
        dtMs: 1000 / 60,
      },
      [B]: null,
    };

    const result = internals.runStep(internals.state, inputs);

    // No silent TS fallback — the events must have come from the wasm
    // branch (the fallback would emit shot-fired too and mask the drop).
    const fellBack = warnSpy.mock.calls.some((args) =>
      String(args[0]).includes("wasm step threw"),
    );
    warnSpy.mockRestore();
    expect(fellBack).toBe(false);

    // The drop branch is gone: a NON-round wasm event reaches the host's
    // event output.
    const kinds = result.events.map((e) => e.t);
    expect(kinds).toContain("shot-fired");
    const shot = result.events.find((e) => e.t === "shot-fired");
    expect(shot && "playerId" in shot ? shot.playerId : null).toBe(A);
  });
});
