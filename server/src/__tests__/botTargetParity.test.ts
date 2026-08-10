// gospel N-BOT (second slice) — target selection must agree.
//
// `nearestFoe` maintains FOUR running bests (nearest anything, nearest
// bot, nearest non-fresh, nearest human) and picks between them by a
// preference rule, every comparison a strict `<`. So the selection is
// order-sensitive, and getting it subtly wrong does not throw — it just
// makes the bots pile onto one player, or stop preferring each other, or
// dogpile the newcomer the grace window exists to protect. None of that
// surfaces as an error; it surfaces as "the bots feel off".
//
// This drives the REAL private methods (reached through a cast, which is
// the point — testing a copy would prove nothing) against the wasm export
// over randomised layouts.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../../../client/src/sim/wasm/loader.ts";
import { WorldBots } from "../worldBots.ts";
import { PlayerId, type PlayerEntity } from "@sim/types.ts";

const bytes = await readFile(
  resolve(import.meta.dir, "../../../client/src/sim/wasm/sim.wasm"),
);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  bot_target_set_foe: (
    i: number, x: number, y: number, vx: number, vy: number,
    alive: number, isBot: number, isFresh: number,
  ) => void;
  bot_target_nearest: (meIndex: number, meX: number, meY: number, count: number) => number;
  bot_target_heading_toward: (
    meX: number, meY: number, fx: number, fy: number, fvx: number, fvy: number,
  ) => number;
};

/** Reach the real private methods. Testing a reimplementation would be
 *  testing the test. */
type Internals = {
  nearestFoe(players: readonly PlayerEntity[], me: PlayerEntity, nowMs: number): PlayerEntity | null;
  headingTowardMe(me: PlayerEntity, foe: PlayerEntity): boolean;
  humanFirstSeenAtMs: Map<string, number>;
};

function mk(id: string, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId(id), characterId: "balanced", x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: 0 as never, ...over,
  };
}

const NOW = 1_000_000;
/** A human first seen just now is "fresh"; one seen long ago is not. */
const FRESH_AT = NOW - 1_000;
const OLD_AT = NOW - 500_000;

function pushToWasm(players: PlayerEntity[], freshIds: Set<string>): void {
  players.forEach((p, i) => {
    const isBot = p.id.toString().startsWith("bot_");
    ex.bot_target_set_foe(
      i, p.x, p.y, p.vx, p.vy,
      p.alive ? 1 : 0,
      isBot ? 1 : 0,
      freshIds.has(p.id.toString()) ? 1 : 0,
    );
  });
}

function tsPick(bots: WorldBots, players: PlayerEntity[], meIndex: number): number {
  const i = bots as unknown as Internals;
  const got = i.nearestFoe(players, players[meIndex]!, NOW);
  return got === null ? -1 : players.findIndex((p) => p.id === got.id);
}

describe("N-BOT — nearestFoe parity, Zig vs the real brain", () => {
  test("bot-on-bot preference: a bot within 1.55x of the nearest human wins", () => {
    const bots = new WorldBots();
    (bots as unknown as Internals).humanFirstSeenAtMs.set("human_1", OLD_AT);
    // Human is CLOSER, but the bot is inside the preference factor.
    const players = [mk("bot_me", 0, 0), mk("human_1", 100, 0), mk("bot_b", 140, 0)];
    pushToWasm(players, new Set());
    const zig = ex.bot_target_nearest(0, 0, 0, players.length);
    expect(zig).toBe(tsPick(bots, players, 0));
    expect(players[zig]!.id.toString()).toBe("bot_b"); // and it IS the bot
  });

  test("outside the factor, the human wins", () => {
    const bots = new WorldBots();
    (bots as unknown as Internals).humanFirstSeenAtMs.set("human_1", OLD_AT);
    const players = [mk("bot_me", 0, 0), mk("human_1", 100, 0), mk("bot_b", 400, 0)];
    pushToWasm(players, new Set());
    const zig = ex.bot_target_nearest(0, 0, 0, players.length);
    expect(zig).toBe(tsPick(bots, players, 0));
    expect(players[zig]!.id.toString()).toBe("human_1");
  });

  test("a FRESH human is skipped while any seasoned target exists", () => {
    // The grace window's whole purpose: a first-timer must not be the
    // one every bot converges on.
    const bots = new WorldBots();
    const i = bots as unknown as Internals;
    i.humanFirstSeenAtMs.set("human_new", FRESH_AT);
    i.humanFirstSeenAtMs.set("human_old", OLD_AT);
    const players = [mk("me_h", 0, 0), mk("human_new", 50, 0), mk("human_old", 300, 0)];
    pushToWasm(players, new Set(["human_new"]));
    const zig = ex.bot_target_nearest(0, 0, 0, players.length);
    expect(zig).toBe(tsPick(bots, players, 0));
    expect(players[zig]!.id.toString()).toBe("human_old");
  });

  test("dead players are never targeted", () => {
    const bots = new WorldBots();
    (bots as unknown as Internals).humanFirstSeenAtMs.set("human_1", OLD_AT);
    const players = [mk("bot_me", 0, 0), mk("human_1", 50, 0, { alive: false }), mk("human_2", 500, 0)];
    (bots as unknown as Internals).humanFirstSeenAtMs.set("human_2", OLD_AT);
    pushToWasm(players, new Set());
    const zig = ex.bot_target_nearest(0, 0, 0, players.length);
    expect(zig).toBe(tsPick(bots, players, 0));
    expect(players[zig]!.id.toString()).toBe("human_2");
  });

  test("randomised layouts agree, and the choice actually varies", () => {
    // Fixed seed: a parity test that shuffles differently each run turns a
    // real divergence into a flake nobody can reproduce.
    let seed = 0x1234_5678;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    const chosen = new Set<string>();
    for (let round = 0; round < 300; round++) {
      const bots = new WorldBots();
      const inner = bots as unknown as Internals;
      const n = 2 + Math.floor(rnd() * 5);
      const players: PlayerEntity[] = [mk("bot_me", 0, 0)];
      const fresh = new Set<string>();
      for (let k = 1; k < n; k++) {
        const isBot = rnd() < 0.5;
        const id = isBot ? `bot_${k}` : `human_${k}`;
        const p = mk(id, (rnd() - 0.5) * 1200, (rnd() - 0.5) * 600, {
          alive: rnd() > 0.15,
        });
        players.push(p);
        if (!isBot) {
          const isFresh = rnd() < 0.4;
          inner.humanFirstSeenAtMs.set(id, isFresh ? FRESH_AT : OLD_AT);
          if (isFresh) fresh.add(id);
        }
      }
      pushToWasm(players, fresh);
      const zig = ex.bot_target_nearest(0, 0, 0, players.length);
      const ts = tsPick(bots, players, 0);
      expect({ round, zig }).toEqual({ round, zig: ts });
      chosen.add(zig === -1 ? "none" : players[zig]!.id.toString().split("_")[0]!);
    }
    // Vacuity guard: if every round picked the same KIND of target, the
    // preference logic was never exercised and 300 agreements mean little.
    expect(chosen.size).toBeGreaterThan(1);
  });
});

describe("N-BOT — headingTowardMe parity", () => {
  test("agrees across a velocity sweep, including the stationary case", () => {
    const bots = new WorldBots();
    const inner = bots as unknown as Internals;
    const me = mk("me", 0, 0);
    let toward = 0;
    let away = 0;
    for (let ang = 0; ang < Math.PI * 2; ang += 0.21) {
      for (const speed of [0, 50, 400]) {
        const foe = mk("f", 200, 0, {
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
        });
        const ts = inner.headingTowardMe(me, foe);
        const zig = ex.bot_target_heading_toward(0, 0, foe.x, foe.y, foe.vx, foe.vy) === 1;
        expect({ ang, speed, zig }).toEqual({ ang, speed, zig: ts });
        if (ts) toward += 1;
        else away += 1;
      }
    }
    // Both outcomes must occur or the agreement is agreement on a constant.
    expect(toward).toBeGreaterThan(0);
    expect(away).toBeGreaterThan(0);
  });
});
