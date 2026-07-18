// Nameplate status legibility (class-overhaul-workboard.md chunk 4.2):
// "spectator-visible tells for the new window-bearing buffs... action-bar
// cooldowns are covered, nameplate chips aren't." These tests cover the
// pure derivation (statusChips.ts) that both HudSystem's nameplate column
// and ActionBarSystem's chip strip read — no Phaser scene needed, same
// "sim state in, display model out" contract as activeSlots.test would use
// if it existed (acquiredAbilities.test.ts is the closest sibling pattern).

import { describe, expect, test } from "bun:test";
import {
  BUFF_DESCRIPTORS,
  DEBUFF_DESCRIPTORS,
  deriveHudChips,
  deriveNameplateTicks,
} from "../statusChips.js";
import { InputSeq, PlayerId, Tick, type PlayerEntity } from "../../../sim/types.js";

function mkPlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("a"),
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
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

const TICK = Tick(1000);

describe("statusChips descriptor coverage", () => {
  // The gap the workboard chunk names by example: sunlanceUntilTick,
  // overclockUntilTick, plus facetMarkUntilTick and the very-recently-landed
  // resonanceUntilTick. Asserting these are present (not just "some fields
  // exist") is the actual regression guard — it's easy to add a new
  // *UntilTick field to types.ts and forget the nameplate row.
  test("covers every Geometrician catalog + Resonance window-buff field", () => {
    const fields = BUFF_DESCRIPTORS.map((d) => d.field);
    expect(fields).toContain("sunlanceUntilTick");
    expect(fields).toContain("facetMarkUntilTick");
    expect(fields).toContain("overclockUntilTick");
    expect(fields).toContain("resonanceUntilTick");
  });

  test("covers every Interstice catalog v1 (ninja-only) window-buff field", () => {
    const fields = BUFF_DESCRIPTORS.map((d) => d.field);
    expect(fields).toContain("readMarkUntilTick");
    expect(fields).toContain("undercutUntilTick");
    expect(fields).toContain("edgeStormUntilTick");
    expect(fields).toContain("wallBloomUntilTick");
    expect(fields).toContain("ghostGuardChargeUntilTick");
    expect(fields).toContain("secondWindUntilTick");
    expect(fields).toContain("razorRouteUntilTick");
  });

  test("no descriptor targets a cooldown field (action bar's job, not the nameplate's)", () => {
    const allFields = [...BUFF_DESCRIPTORS, ...DEBUFF_DESCRIPTORS].map((d) => d.field);
    for (const f of allFields) {
      expect(String(f)).not.toMatch(/CooldownUntilTick$/);
    }
  });
});

describe("deriveNameplateTicks", () => {
  test("a player with no active buffs shows no ticks", () => {
    const p = mkPlayer();
    expect(deriveNameplateTicks(p, TICK)).toEqual([]);
  });

  test("undefined player (not in this frame's roster) shows no ticks", () => {
    expect(deriveNameplateTicks(undefined, TICK)).toEqual([]);
  });

  test("an active sunlanceUntilTick buff produces exactly one tick", () => {
    const p = mkPlayer({ sunlanceUntilTick: (TICK + 30) as ReturnType<typeof Tick> });
    const ticks = deriveNameplateTicks(p, TICK);
    expect(ticks.length).toBe(1);
    expect(ticks[0]!.isDebuff).toBe(false);
    const descriptor = BUFF_DESCRIPTORS.find((d) => d.key === "sunlance")!;
    expect(ticks[0]!.color).toBe(descriptor.color);
  });

  test("overclockUntilTick and resonanceUntilTick each produce a tick", () => {
    const p = mkPlayer({
      overclockUntilTick: (TICK + 60) as ReturnType<typeof Tick>,
      resonanceUntilTick: (TICK + 40) as ReturnType<typeof Tick>,
    });
    const ticks = deriveNameplateTicks(p, TICK);
    expect(ticks.length).toBe(2);
    expect(ticks.every((t) => !t.isDebuff)).toBe(true);
  });

  test("facetMarkUntilTick (mark lives on the caster) produces a buff tick", () => {
    const p = mkPlayer({
      facetTargetId: PlayerId("victim"),
      facetMarkUntilTick: (TICK + 200) as ReturnType<typeof Tick>,
    });
    const ticks = deriveNameplateTicks(p, TICK);
    expect(ticks.length).toBe(1);
    expect(ticks[0]!.isDebuff).toBe(false);
  });

  test("a tick at or before the current tick is expired — no tick shown", () => {
    const exactlyExpired = mkPlayer({ sunlanceUntilTick: TICK });
    expect(deriveNameplateTicks(exactlyExpired, TICK)).toEqual([]);

    const pastExpired = mkPlayer({ sunlanceUntilTick: (TICK - 5) as ReturnType<typeof Tick> });
    expect(deriveNameplateTicks(pastExpired, TICK)).toEqual([]);
  });

  test("a chip disappears once its tick expires — same player, later frame", () => {
    const p = mkPlayer({ overclockUntilTick: (TICK + 10) as ReturnType<typeof Tick> });
    expect(deriveNameplateTicks(p, TICK).length).toBe(1);
    // 20 ticks later the window has closed.
    expect(deriveNameplateTicks(p, (TICK + 20) as ReturnType<typeof Tick>).length).toBe(0);
  });

  test("multiple simultaneous buffs/debuffs on one player all show, without dropping any", () => {
    const p = mkPlayer({
      sunlanceUntilTick: (TICK + 30) as ReturnType<typeof Tick>,
      overclockUntilTick: (TICK + 60) as ReturnType<typeof Tick>,
      resonanceUntilTick: (TICK + 90) as ReturnType<typeof Tick>,
      burnUntilTick: (TICK + 120) as ReturnType<typeof Tick>,
      freezeUntilTick: (TICK + 15) as ReturnType<typeof Tick>,
    });
    const ticks = deriveNameplateTicks(p, TICK);
    expect(ticks.length).toBe(5);
    // Buffs report isDebuff:false, debuffs isDebuff:true — the caller (the
    // HUD's row layout) is what actually prevents overlap/clipping, but the
    // derivation must at minimum hand back every simultaneous status.
    const debuffCount = ticks.filter((t) => t.isDebuff).length;
    expect(debuffCount).toBe(2); // burn + freeze
  });

  test("remainingFrac is clamped to [0, 1] even when far under the nominal duration", () => {
    const p = mkPlayer({ sunlanceUntilTick: (TICK + 1) as ReturnType<typeof Tick> });
    const [tick] = deriveNameplateTicks(p, TICK);
    expect(tick!.remainingFrac).toBeGreaterThan(0);
    expect(tick!.remainingFrac).toBeLessThanOrEqual(1);
  });
});

describe("deriveHudChips", () => {
  test("undefined player shows no chips", () => {
    expect(deriveHudChips(undefined, TICK)).toEqual([]);
  });

  test("an active resonanceUntilTick buff produces a labeled chip with positive remaining seconds", () => {
    const p = mkPlayer({ resonanceUntilTick: (TICK + 120) as ReturnType<typeof Tick> });
    const chips = deriveHudChips(p, TICK);
    expect(chips.length).toBe(1);
    expect(chips[0]!.label).toBe("RES");
    expect(chips[0]!.isDebuff).toBe(false);
    expect(chips[0]!.remainingSec).toBeGreaterThan(0);
  });

  test("facet-mark and overcharge (pickup) use distinct labels — never conflated", () => {
    const p = mkPlayer({
      overclockUntilTick: (TICK + 30) as ReturnType<typeof Tick>,
      overchargeUntilTick: (TICK + 30) as ReturnType<typeof Tick>,
    });
    const labels = deriveHudChips(p, TICK).map((c) => c.label);
    expect(labels).toContain("OVCK");
    expect(labels).toContain("OC");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
