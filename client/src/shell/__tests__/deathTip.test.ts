import { describe, expect, test } from "bun:test";
import { pickDeathTip } from "../../game/highlights/deathTip.js";

describe("pickDeathTip", () => {
  test("empty / null signal → null", () => {
    expect(pickDeathTip(null)).toBeNull();
    expect(pickDeathTip(undefined)).toBeNull();
    expect(pickDeathTip({})).toBeNull();
  });

  test("parry evidence returns single tip string", () => {
    const tip = pickDeathTip({
      diedToProjectile: true,
      parryAvailableRecently: true,
    });
    expect(typeof tip).toBe("string");
    expect(tip!.length).toBeGreaterThan(0);
    // Must not return multiple tips mashed together
    expect(tip!.includes("\n")).toBe(false);
  });

  test("long-range dodge evidence returns tip", () => {
    const tip = pickDeathTip({ longRange: true, dodgeAvailable: true });
    expect(tip).toBeTruthy();
  });

  test("incomplete signal does not invent tip", () => {
    expect(pickDeathTip({ diedToProjectile: true })).toBeNull();
    expect(pickDeathTip({ parryAvailableRecently: true })).toBeNull();
    expect(pickDeathTip({ longRange: true })).toBeNull();
  });

  test("parry takes priority over dodge when both present", () => {
    const tip = pickDeathTip({
      diedToProjectile: true,
      parryAvailableRecently: true,
      longRange: true,
      dodgeAvailable: true,
    });
    expect(tip).toContain("parry");
  });
});
