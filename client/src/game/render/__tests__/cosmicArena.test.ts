import { describe, expect, test } from "bun:test";
import { getMusicLevel } from "../../systems/MusicAmplitude";
import { writeMusicBands } from "../../systems/SonicField";

describe("MusicAmplitude", () => {
  test("defaults to rest levels", () => {
    const L = getMusicLevel();
    expect(L.bass).toBeGreaterThanOrEqual(0);
    expect(L.pulse).toBeGreaterThanOrEqual(0);
    expect(L.beat).toBeGreaterThanOrEqual(0);
  });

  test("reflects SonicField music bands", () => {
    writeMusicBands({ bass: 0.8, mid: 0.5, high: 0.3, rms: 0.6, pulse: 0.7, beat: 0.9 });
    const L = getMusicLevel();
    expect(L.bass).toBeCloseTo(0.8, 5);
    expect(L.mid).toBeCloseTo(0.5, 5);
    expect(L.high).toBeCloseTo(0.3, 5);
    expect(L.pulse).toBeCloseTo(0.7, 5);
    expect(L.beat).toBeCloseTo(0.9, 5);
  });

  test("clamps out-of-range values", () => {
    writeMusicBands({ bass: 2, mid: -1, high: 0.5, rms: 0.5, pulse: 1.5, beat: -0.2 });
    const L = getMusicLevel();
    expect(L.bass).toBe(1);
    expect(L.mid).toBe(0);
    expect(L.pulse).toBe(1);
    expect(L.beat).toBe(0);
  });

  test("returns the same object every call (hot-path zero-alloc)", () => {
    expect(getMusicLevel()).toBe(getMusicLevel());
  });
});
