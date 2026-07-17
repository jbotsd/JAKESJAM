// Emission derivation parity — Zig weapon_build.emissionFromConfig must
// match TS resolveEmission for EVERY card (docs/emission-engine-goal.md,
// elegance bar: "resolve_emission_test parity export"). Same gate pattern
// as weaponBuildParity.test.ts: the derivation runs over the resolved
// fire config on both sides, so a drift here means the cast would differ
// between the TS-authoritative prod sim and the opt-in wasm world.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import { createWeaponBuild } from "../../data/weaponBuild";
import { resolveEmission } from "../../data/emission";
import { crystalRoundsCards } from "../../data/cards";
import { starterWeapon } from "../../data/weapons";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  resolve_emission_test: (i: number, out: number) => void;
  resolve_build_card_count: () => number;
};

const cards = crystalRoundsCards.filter((c) => c.modifier);
const SCRATCH = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 8192;

function zig(i: number): { volley: number; damage: number; speed: number; radius: number; impactRadius: number } {
  ex.resolve_emission_test(i, SCRATCH);
  const v = new DataView(ex.memory.buffer, SCRATCH, 40);
  return {
    volley: v.getFloat64(0, true),
    damage: v.getFloat64(8, true),
    speed: v.getFloat64(16, true),
    radius: v.getFloat64(24, true),
    impactRadius: v.getFloat64(32, true),
  };
}

function ts(i: number) {
  const build = createWeaponBuild(starterWeapon, i < 0 ? [] : [cards[i]!]);
  return resolveEmission(build);
}

describe("emission derivation parity (TS resolveEmission ↔ Zig emissionFromConfig)", () => {
  test("base build (no cards)", () => {
    const z = zig(-1);
    const t = ts(-1);
    expect(z.volley).toBe(t.volleyCount);
    expect(z.damage).toBeCloseTo(t.damagePerShard, 6);
    expect(z.speed).toBeCloseTo(t.speed, 6);
    expect(z.radius).toBeCloseTo(t.radiusPx, 6);
    expect(z.impactRadius).toBeCloseTo(t.impactRadiusPx, 6);
  });

  test("every card in the pool derives identically", () => {
    for (let i = 0; i < cards.length; i++) {
      const z = zig(i);
      const t = ts(i);
      const label = ` [${cards[i]!.id}]`;
      expect(z.volley, "volley" + label).toBe(t.volleyCount);
      expect(z.damage, "damage" + label).toBeCloseTo(t.damagePerShard, 6);
      expect(z.speed, "speed" + label).toBeCloseTo(t.speed, 6);
      expect(z.radius, "radius" + label).toBeCloseTo(t.radiusPx, 6);
      expect(z.impactRadius, "impactRadius" + label).toBeCloseTo(t.impactRadiusPx, 6);
    }
  });
});
