import { describe, expect, test } from "bun:test";
import { grantEntitlement, getEntitlements, hasEntitlement } from "../entitlements.ts";

describe("entitlements", () => {
  test("a player with no purchases owns nothing", async () => {
    expect(await getEntitlements("nobody-yet")).toEqual([]);
    expect(await hasEntitlement("nobody-yet", "ember-trail")).toBe(false);
  });

  test("granting an entitlement makes it show up for that player only", async () => {
    await grantEntitlement("buyer-1", "ember-trail");
    expect(await hasEntitlement("buyer-1", "ember-trail")).toBe(true);
    expect(await hasEntitlement("buyer-2", "ember-trail")).toBe(false);
  });

  test("granting the same sku twice is idempotent (no duplicate, e.g. from a webhook retry)", async () => {
    await grantEntitlement("buyer-dup", "ember-trail");
    await grantEntitlement("buyer-dup", "ember-trail");
    const owned = await getEntitlements("buyer-dup");
    expect(owned.filter((s) => s === "ember-trail")).toHaveLength(1);
  });

  test("a player can own multiple distinct skus", async () => {
    await grantEntitlement("buyer-multi", "ember-trail");
    await grantEntitlement("buyer-multi", "some-other-sku");
    const owned = await getEntitlements("buyer-multi");
    expect(owned.sort()).toEqual(["ember-trail", "some-other-sku"]);
  });
});
