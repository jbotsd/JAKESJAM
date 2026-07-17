// Kill-switch admission mask (emission-engine-goal / six-axes-goal "ship
// safely"). The mask is THE single gate — humans and bots both route
// through matchHost.applyInput, so proving the mask proves the lever
// (integration coverage of that routing lives in emissionChargeBots.test).

import { describe, expect, test } from "bun:test";
import { KNOWN_KEY_BITS, sanitizeKeyMaskFor } from "../matchHost.ts";

const ABILITY_BIT = 1 << 7;
const SLOT_BITS = 0b1111 << 10;

describe("sanitizeKeyMaskFor", () => {
  test("default: all known bits pass — Emission bit and slot bits included", () => {
    const mask = sanitizeKeyMaskFor(false, false);
    expect(mask).toBe(KNOWN_KEY_BITS);
    expect(mask & ABILITY_BIT).toBe(ABILITY_BIT);
    expect(mask & SLOT_BITS).toBe(SLOT_BITS);
  });

  test("unknown high bits are never admitted (smuggling guard)", () => {
    const mask = sanitizeKeyMaskFor(false, false);
    expect((0xffff_ffff & mask) >>> 14).toBe(0);
  });

  test("EMISSIONS=off strips exactly the Emission bit", () => {
    const mask = sanitizeKeyMaskFor(true, false);
    expect(mask & ABILITY_BIT).toBe(0);
    expect(mask & SLOT_BITS).toBe(SLOT_BITS);
    expect(mask | ABILITY_BIT).toBe(KNOWN_KEY_BITS);
  });

  test("ABILITIES=off strips exactly the four slot bits", () => {
    const mask = sanitizeKeyMaskFor(false, true);
    expect(mask & SLOT_BITS).toBe(0);
    expect(mask & ABILITY_BIT).toBe(ABILITY_BIT);
    expect(mask | SLOT_BITS).toBe(KNOWN_KEY_BITS);
  });

  test("both levers compose", () => {
    const mask = sanitizeKeyMaskFor(true, true);
    expect(mask & (ABILITY_BIT | SLOT_BITS)).toBe(0);
    // Movement/fire/shield/dash untouched.
    expect(mask & 0b1101111111).toBe(0b1101111111);
  });
});
