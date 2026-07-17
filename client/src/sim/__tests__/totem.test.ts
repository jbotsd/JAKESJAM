// Ready/Launch totems (graceful-gliding-flame plan A3) — the exact per-tick
// circle-overlap-scan pattern pickup.ts proves out, applied to a
// server-authoritative-only interaction (see totem.ts's module doc for why
// this deliberately isn't wired into World.ts/stepWithRuntime).

import { describe, test, expect } from "bun:test";
import {
  stepTotems,
  resolveHangoutTotems,
  resolveVenueTotems,
  type TotemDefinition,
} from "../totem.js";
import { resolveMap } from "../data/maps.js";
import { InputSeq, PlayerId, Tick, type PlayerEntity, type WorldState } from "../types.js";

const DT_MS = 1000 / 60;

function player(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
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
    ...overrides,
  };
}

const readyTotem: TotemDefinition = { id: "totem-ready", kind: "ready", x: 500, y: 500, radius: 70 };
const launchTotem: TotemDefinition = { id: "totem-launch", kind: "launch", x: 900, y: 500, radius: 70 };

describe("stepTotems", () => {
  test("overlapping the ready totem emits ready-toggled", () => {
    const players: WorldState["players"] = { [PlayerId("p1")]: player({ x: 500, y: 500 }) };
    const result = stepTotems({
      totems: [readyTotem],
      players,
      tick: Tick(0),
      dtMs: DT_MS,
      cooldowns: new Map(),
    });
    expect(result.events).toEqual([{ t: "ready-toggled", playerId: PlayerId("p1") }]);
  });

  test("overlapping the launch totem emits launch-requested", () => {
    const players: WorldState["players"] = { [PlayerId("p1")]: player({ x: 900, y: 500 }) };
    const result = stepTotems({
      totems: [launchTotem],
      players,
      tick: Tick(0),
      dtMs: DT_MS,
      cooldowns: new Map(),
    });
    expect(result.events).toEqual([{ t: "launch-requested", playerId: PlayerId("p1") }]);
  });

  test("not overlapping emits nothing", () => {
    const players: WorldState["players"] = { [PlayerId("p1")]: player({ x: 0, y: 0 }) };
    const result = stepTotems({
      totems: [readyTotem],
      players,
      tick: Tick(0),
      dtMs: DT_MS,
      cooldowns: new Map(),
    });
    expect(result.events).toEqual([]);
  });

  test("dead players never trigger a totem", () => {
    const players: WorldState["players"] = {
      [PlayerId("p1")]: player({ x: 500, y: 500, alive: false }),
    };
    const result = stepTotems({
      totems: [readyTotem],
      players,
      tick: Tick(0),
      dtMs: DT_MS,
      cooldowns: new Map(),
    });
    expect(result.events).toEqual([]);
  });

  test("standing on a totem re-triggers at most once per cooldown window", () => {
    const players: WorldState["players"] = { [PlayerId("p1")]: player({ x: 500, y: 500 }) };
    const cooldowns = new Map<PlayerId, Tick>();
    let totalEvents = 0;
    for (let tick = 0; tick < 120; tick += 1) {
      const result = stepTotems({
        totems: [readyTotem],
        players,
        tick: Tick(tick),
        dtMs: DT_MS,
        cooldowns,
      });
      totalEvents += result.events.length;
    }
    // 120 ticks @ 60Hz = 2s; TOTEM_RETRIGGER_MS=1200ms → at most 2 triggers.
    expect(totalEvents).toBeGreaterThan(0);
    expect(totalEvents).toBeLessThanOrEqual(2);
  });

  test("walking off and back on retriggers immediately (no lingering cooldown across a miss)", () => {
    const cooldowns = new Map<PlayerId, Tick>();
    const onPlayers: WorldState["players"] = { [PlayerId("p1")]: player({ x: 500, y: 500 }) };
    const offPlayers: WorldState["players"] = { [PlayerId("p1")]: player({ x: -500, y: -500 }) };
    const first = stepTotems({ totems: [readyTotem], players: onPlayers, tick: Tick(0), dtMs: DT_MS, cooldowns });
    expect(first.events.length).toBe(1);
    stepTotems({ totems: [readyTotem], players: offPlayers, tick: Tick(1), dtMs: DT_MS, cooldowns });
    const third = stepTotems({ totems: [readyTotem], players: onPlayers, tick: Tick(2), dtMs: DT_MS, cooldowns });
    // Still within the cooldown window (cooldown is time-based, not
    // overlap-edge-based) — this documents the current flat-debounce
    // behavior rather than true rising-edge detection (see totem.ts doc).
    expect(third.events.length).toBe(0);
  });
});

describe("resolveHangoutTotems", () => {
  test("vessel-nexus gets two totems on its ground band, inside the arena bounds", () => {
    const map = { id: "vessel-nexus", name: "x", size: { x: 3000, y: 1100 }, spawns: [], platforms: [] };
    const totems = resolveHangoutTotems(map);
    expect(totems.length).toBe(2);
    for (const t of totems) {
      expect(t.x).toBeGreaterThan(0);
      expect(t.x).toBeLessThan(map.size.x);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(map.size.y);
    }
    expect(totems.some((t) => t.kind === "ready")).toBe(true);
    expect(totems.some((t) => t.kind === "launch")).toBe(true);
  });

  test("an unknown map still gets a sane fallback placement (never throws)", () => {
    const map = { id: "some-other-map", name: "x", size: { x: 2000, y: 900 }, spawns: [], platforms: [] };
    const totems = resolveHangoutTotems(map);
    expect(totems.length).toBe(2);
  });

  // venue-goal Pillar 1.6 (audit §9 gap #4): the old non-vessel fallback was
  // a blind "center-ish guess" that could float a totem over a pit. Every
  // map in (and beyond) the arena rotation must place totems ON a real
  // standable surface: totem x inside a floor/platform's horizontal span,
  // totem y exactly at that surface's standing height.
  test("totems land on standable ground on every rotation map + gen seeds", () => {
    const STAND_OFFSET = 68;
    const mapIds = [
      "vessel-nexus",
      "boxworks-tower",
      "boxworks",
      "boxworks-mini",
      "gen:venue1",
      "gen:venue2",
      "gen:12345",
    ];
    for (const id of mapIds) {
      const map = resolveMap(id);
      const totems = resolveHangoutTotems(map);
      expect(totems.length).toBe(2);
      for (const t of totems) {
        if (map.id === "vessel-nexus") {
          // Hand-tuned ground band — its own invariant.
          expect(t.y).toBe(map.size.y - 36 - STAND_OFFSET);
          continue;
        }
        const under = map.platforms.find(
          (p) =>
            p.kind !== "wall" &&
            t.x >= p.position.x &&
            t.x <= p.position.x + p.size.x &&
            t.y === p.position.y - STAND_OFFSET,
        );
        if (!under) {
          throw new Error(
            `totem ${t.id} on ${id} floats at (${t.x},${t.y}) with no standable surface under it`,
          );
        }
      }
    }
  });
});

// The venue lobby's separated stations (Jake 2026-07-17: "seperate the card
// selector test room thing with the bell queue") — the loadout station is
// its own walk-up totem by the practice-dummy band; the bell is only a bell.
describe("resolveVenueTotems", () => {
  test("vessel-nexus: loadout station + bell portal, distinct kinds, both off the center spawn", () => {
    const map = resolveMap("vessel-nexus");
    const totems = resolveVenueTotems(map);
    expect(totems.map((t) => t.id)).toEqual(["totem-loadout", "totem-bell"]);
    expect(totems.map((t) => t.kind)).toEqual(["ready", "launch"]); // station opens, bell queues
    const [loadout, bell] = totems as [TotemDefinition, TotemDefinition];
    // Neither station may sit on the map-center spawn fallback — a totem on
    // the spawn point fires its interaction the instant someone lands (the
    // S2.F bell lesson, now a law for BOTH stations: no modal-on-arrival).
    const center = map.size.x / 2;
    expect(Math.abs(loadout.x - center)).toBeGreaterThan(loadout.radius + 100);
    expect(Math.abs(bell.x - center)).toBeGreaterThan(bell.radius + 100);
    // The loadout station flanks the practice-dummy band (dummies at
    // 0.3/0.35W, venueHost.venueLobbyMap) — pick, turn, try it on a dummy.
    expect(Math.abs(loadout.x - map.size.x * 0.3)).toBeLessThan(300);
    // Ground band, both.
    expect(loadout.y).toBe(map.size.y - 36 - 68);
    expect(bell.y).toBe(loadout.y);
  });

  test("non-vessel maps snap both venue stations onto standable ground", () => {
    const STAND_OFFSET = 68;
    // NB: "gen:venueN" seeds are non-numeric → resolveMap falls back to
    // vessel-nexus (the rotation-map test above leans on that); use a real
    // numeric gen seed here so the non-vessel snap path is what's tested.
    for (const id of ["boxworks-tower", "gen:12345"]) {
      const map = resolveMap(id);
      const totems = resolveVenueTotems(map);
      expect(totems.length).toBe(2);
      for (const t of totems) {
        const under = map.platforms.find(
          (p) =>
            p.kind !== "wall" &&
            t.x >= p.position.x &&
            t.x <= p.position.x + p.size.x &&
            t.y === p.position.y - STAND_OFFSET,
        );
        if (!under) {
          throw new Error(
            `venue totem ${t.id} on ${id} floats at (${t.x},${t.y}) with no standable surface under it`,
          );
        }
      }
    }
  });
});
