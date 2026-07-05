import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createCheckoutSession, findSku, COSMETIC_CATALOG } from "../checkout.ts";

describe("catalog", () => {
  test("has at least one SKU with a positive price", () => {
    expect(COSMETIC_CATALOG.length).toBeGreaterThan(0);
    for (const sku of COSMETIC_CATALOG) expect(sku.amountCents).toBeGreaterThan(0);
  });

  test("findSku resolves a known id and returns null for an unknown one", () => {
    expect(findSku("ember-trail")).not.toBeNull();
    expect(findSku("does-not-exist")).toBeNull();
  });
});

describe("createCheckoutSession (mocked network)", () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  let lastCall: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    lastCall = null;
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...savedEnv };
  });

  function mockFetch(status: number, body: unknown) {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      lastCall = { url: String(url), init };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  test("throws with an actionable message when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const sku = findSku("ember-trail")!;
    await expect(
      createCheckoutSession({ sku, playerId: "p1", successUrl: "https://x/ok", cancelUrl: "https://x/no" }),
    ).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });

  test("sends the sku's price + attributes the session to the player via client_reference_id", async () => {
    mockFetch(200, { id: "cs_abc", url: "https://checkout.stripe.com/pay/cs_abc" });
    const sku = findSku("ember-trail")!;
    const session = await createCheckoutSession({
      sku,
      playerId: "player-42",
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
    });
    expect(session.id).toBe("cs_abc");
    expect(session.url).toContain("checkout.stripe.com");
    const sentBody = new URLSearchParams(lastCall!.init.body as string);
    expect(sentBody.get("client_reference_id")).toBe("player-42");
    expect(sentBody.get("metadata[sku_id]")).toBe("ember-trail");
    expect(sentBody.get("line_items[0][price_data][unit_amount]")).toBe(String(sku.amountCents));
    expect(sentBody.get("mode")).toBe("payment");
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_123");
  });

  test("throws on a non-ok Stripe response", async () => {
    mockFetch(400, { error: { message: "No such price" } });
    const sku = findSku("ember-trail")!;
    await expect(
      createCheckoutSession({ sku, playerId: "p1", successUrl: "https://x/ok", cancelUrl: "https://x/no" }),
    ).rejects.toThrow(/No such price/);
  });
});
