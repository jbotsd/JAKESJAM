// Launch pad unit tests — the formula, the stateless retrigger gate, and
// the deterministic iteration discipline (see sim/launchPad.ts header).
// The pad's Zig mirror is sim/src/world.zig §8c; the wasm-execution gate
// lives in server/src/__tests__/serverWasmHost.test.ts ("launch pads fire
// inside step_world").

import { describe, expect, test } from "bun:test";
import {
  LAUNCH_ALONG_CAP_FACTOR,
  LAUNCH_RETRIGGER_FRACTION,
  stepLaunchPads,
} from "../launchPad.js";
import { EntityId, InputSeq, PlayerId } from "../types.js";
import type {
  LaunchPadDefinition,
  PlayerEntity,
  WorldState,
} from "../types.js";

function makePlayer(
  id: string,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  alive = true,
): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y,
    vx,
    vy,
    aimX: x + 100,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

const upPad: LaunchPadDefinition = {
  id: "pad-up",
  position: { x: 500, y: 464 },
  size: { x: 96, y: 12 },
  impulse: { x: 0, y: -700 },
};

const diagPad: LaunchPadDefinition = {
  id: "pad-diag",
  position: { x: 500, y: 464 },
  size: { x: 96, y: 12 },
  impulse: { x: 460, y: -700 },
};

function playersOf(...ps: PlayerEntity[]): WorldState["players"] {
  const out: WorldState["players"] = {};
  for (const p of ps) out[p.id] = p;
  return out;
}

describe("stepLaunchPads — impulse formula", () => {
  test("standing player on an up-pad gets exactly the impulse", () => {
    // Player center 28 above the pad bottom = standing on the floor the
    // pad sits on (pad top 458 < player bottom 470).
    const p = makePlayer("a", 500, 442);
    const r = stepLaunchPads({ pads: [upPad], players: playersOf(p) });
    const launched = r.players[PlayerId("a")]!;
    expect(launched.vx).toBe(0);
    expect(launched.vy).toBe(-700);
    expect(r.events).toEqual([
      { t: "launch-pad-fired", entityId: EntityId(0), playerId: PlayerId("a") },
    ]);
  });

  test("approach speed is preserved (perpendicular passes through)", () => {
    // Running right at 330 over a straight-up pad: horizontal velocity is
    // fully perpendicular to the impulse — it must survive untouched.
    const p = makePlayer("a", 500, 442, 330, 0);
    const r = stepLaunchPads({ pads: [upPad], players: playersOf(p) });
    const launched = r.players[PlayerId("a")]!;
    expect(launched.vx).toBe(330);
    expect(launched.vy).toBe(-700);
  });

  test("approach along the pad direction ADDS, capped at the factor", () => {
    // Fabricate a player already moving fast along the diagonal pad's
    // direction (but under the retrigger gate) — the along component adds
    // and clamps at LAUNCH_ALONG_CAP_FACTOR·|impulse|.
    const mag = Math.sqrt(460 * 460 + 700 * 700);
    const ux = 460 / mag;
    const uy = -700 / mag;
    const along0 = 0.4 * mag; // below the 0.5 gate
    const p = makePlayer("a", 500, 442, along0 * ux, along0 * uy);
    const r = stepLaunchPads({ pads: [diagPad], players: playersOf(p) });
    const launched = r.players[PlayerId("a")]!;
    const alongAfter = launched.vx * ux + launched.vy * uy;
    // 0.4m + m = 1.4m clamps at 1.35m.
    expect(alongAfter).toBeCloseTo(LAUNCH_ALONG_CAP_FACTOR * mag, 9);
  });

  test("a hard fall onto an up-pad still launches at full impulse (floor)", () => {
    const p = makePlayer("a", 500, 442, 0, 900); // falling fast
    const r = stepLaunchPads({ pads: [upPad], players: playersOf(p) });
    const launched = r.players[PlayerId("a")]!;
    // ADD alone would give 900·(-1)+700 = weak −? launch; the floor
    // guarantees the pad's own speed.
    expect(launched.vy).toBe(-700);
  });
});

describe("stepLaunchPads — stateless retrigger gate", () => {
  test("a freshly launched player does not refire on the next step", () => {
    const p = makePlayer("a", 500, 442);
    const first = stepLaunchPads({ pads: [upPad], players: playersOf(p) });
    expect(first.events.length).toBe(1);
    // Same position (still overlapping), but now carrying the launch
    // velocity: vAlong = 700 ≥ 0.5·700 → gate closed, zero state needed.
    const launched = first.players[PlayerId("a")]!;
    const second = stepLaunchPads({
      pads: [upPad],
      players: playersOf(launched),
    });
    expect(second.events.length).toBe(0);
    expect(second.players[PlayerId("a")]).toBeUndefined(); // untouched
  });

  test("gate threshold is exactly LAUNCH_RETRIGGER_FRACTION·|impulse|", () => {
    // vAlong exactly at the gate → no fire (>= comparison).
    const atGate = makePlayer("a", 500, 442, 0, -LAUNCH_RETRIGGER_FRACTION * 700);
    const r1 = stepLaunchPads({ pads: [upPad], players: playersOf(atGate) });
    expect(r1.events.length).toBe(0);
    // A hair under the gate → fires.
    const underGate = makePlayer(
      "a",
      500,
      442,
      0,
      -(LAUNCH_RETRIGGER_FRACTION * 700 - 1),
    );
    const r2 = stepLaunchPads({ pads: [upPad], players: playersOf(underGate) });
    expect(r2.events.length).toBe(1);
  });
});

describe("stepLaunchPads — gating + determinism", () => {
  test("dead players and non-overlapping players are ignored", () => {
    const dead = makePlayer("a", 500, 442, 0, 0, false);
    const far = makePlayer("b", 900, 442);
    const r = stepLaunchPads({ pads: [upPad], players: playersOf(dead, far) });
    expect(r.events.length).toBe(0);
    expect(Object.keys(r.players).length).toBe(0);
  });

  test("degenerate zero-impulse pad is inert", () => {
    const inert: LaunchPadDefinition = {
      ...upPad,
      impulse: { x: 0, y: 0 },
    };
    const p = makePlayer("a", 500, 442);
    const r = stepLaunchPads({ pads: [inert], players: playersOf(p) });
    expect(r.events.length).toBe(0);
  });

  test("events order: pad index outer (map order), player id inner (sorted)", () => {
    const padLeft: LaunchPadDefinition = {
      id: "L",
      position: { x: 200, y: 464 },
      size: { x: 96, y: 12 },
      impulse: { x: 0, y: -700 },
    };
    const padRight: LaunchPadDefinition = {
      id: "R",
      position: { x: 600, y: 464 },
      size: { x: 96, y: 12 },
      impulse: { x: 0, y: -700 },
    };
    // Two players on the right pad (ids deliberately unsorted in insertion
    // order), one on the left.
    const players = playersOf(
      makePlayer("z", 600, 442),
      makePlayer("b", 610, 442),
      makePlayer("m", 200, 442),
    );
    const r = stepLaunchPads({ pads: [padLeft, padRight], players });
    expect(r.events.map((e) => `${"entityId" in e ? e.entityId : "?"}:${"playerId" in e ? e.playerId : "?"}`)).toEqual([
      "0:m",
      "1:b",
      "1:z",
    ]);
  });

  test("pure: same inputs → byte-identical result, inputs not mutated", () => {
    const p = makePlayer("a", 500, 442, 120, 40);
    const players = playersOf(p);
    const r1 = stepLaunchPads({ pads: [diagPad], players });
    const r2 = stepLaunchPads({ pads: [diagPad], players });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(players[PlayerId("a")]!.vx).toBe(120); // input untouched
  });
});
