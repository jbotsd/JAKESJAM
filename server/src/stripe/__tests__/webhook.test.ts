import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyStripeSignature, parseCheckoutCompleted } from "../webhook.ts";

const SECRET = "whsec_test_secret";

function signAt(rawBody: string, secret: string, timestampSec: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`).digest("hex");
  return `t=${timestampSec},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ type: "checkout.session.completed" });

  test("accepts a correctly-signed, fresh payload", () => {
    const now = 1_700_000_000;
    const header = signAt(body, SECRET, now);
    expect(verifyStripeSignature(body, header, SECRET, now)).toEqual({ ok: true });
  });

  test("rejects a signature computed with the wrong secret", () => {
    const now = 1_700_000_000;
    const header = signAt(body, "wrong_secret", now);
    const result = verifyStripeSignature(body, header, SECRET, now);
    expect(result.ok).toBe(false);
  });

  test("rejects a payload that was tampered with after signing", () => {
    const now = 1_700_000_000;
    const header = signAt(body, SECRET, now);
    const tamperedBody = JSON.stringify({ type: "checkout.session.completed", extra: "injected" });
    const result = verifyStripeSignature(tamperedBody, header, SECRET, now);
    expect(result.ok).toBe(false);
  });

  test("rejects a stale timestamp outside the tolerance window", () => {
    const signedAt = 1_700_000_000;
    const header = signAt(body, SECRET, signedAt);
    const nowMuchLater = signedAt + 10 * 60; // 10 minutes later, tolerance is 5
    const result = verifyStripeSignature(body, header, SECRET, nowMuchLater);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tolerance/);
  });

  test("rejects a missing signature header", () => {
    const result = verifyStripeSignature(body, null, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing/);
  });

  test("rejects a malformed signature header", () => {
    const result = verifyStripeSignature(body, "not-a-valid-header", SECRET);
    expect(result.ok).toBe(false);
  });

  test("a signature of different length than expected doesn't crash timingSafeEqual", () => {
    const now = 1_700_000_000;
    const result = verifyStripeSignature(body, `t=${now},v1=abcd`, SECRET, now);
    expect(result.ok).toBe(false);
  });
});

describe("parseCheckoutCompleted", () => {
  test("extracts playerId/skuId/sessionId from a well-formed event", () => {
    const raw = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "player-1", metadata: { sku_id: "ember-trail" }, id: "cs_123" } },
    });
    expect(parseCheckoutCompleted(raw)).toEqual({
      playerId: "player-1",
      skuId: "ember-trail",
      sessionId: "cs_123",
    });
  });

  test("ignores events of a different type", () => {
    const raw = JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } });
    expect(parseCheckoutCompleted(raw)).toBeNull();
  });

  test("returns null when client_reference_id is missing (can't attribute the purchase)", () => {
    const raw = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { sku_id: "ember-trail" }, id: "cs_123" } },
    });
    expect(parseCheckoutCompleted(raw)).toBeNull();
  });

  test("returns null on unparseable JSON rather than throwing", () => {
    expect(parseCheckoutCompleted("not json{{{")).toBeNull();
  });
});
