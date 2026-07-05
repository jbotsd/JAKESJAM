// Stripe webhook signature verification — the security-critical half of the
// checkout flow. Stripe's own documented scheme (stable, long-standing API
// contract): the `Stripe-Signature` header carries `t=<timestamp>,v1=<hex-hmac>`
// where the hmac is HMAC-SHA256(webhook secret, `${timestamp}.${rawBody}`).
//
// MUST verify against the RAW request body — parsing to JSON first and
// re-stringifying will not reproduce the same bytes Stripe signed, and the
// signature will never match. Callers must read the body as text before any
// JSON.parse.

import { createHmac, timingSafeEqual } from "node:crypto";

export function requireStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "Stripe webhook not configured — missing env var STRIPE_WEBHOOK_SECRET. " +
        "Register a webhook endpoint in the Stripe dashboard and set its signing secret.",
    );
  }
  return secret;
}

/** How much clock skew to tolerate between Stripe's timestamp and ours,
 *  guarding against a stale/replayed payload without being overly strict
 *  about clock drift between hosts. */
const TOLERANCE_SEC = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Stripe webhook signature. `rawBody` must be the EXACT bytes of the
 * request body (as a string) — not a re-serialized parse of it.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: "missing Stripe-Signature header" };
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v] as [string, string];
    }),
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return { ok: false, reason: "malformed Stripe-Signature header" };

  const age = Math.abs(nowSec - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) {
    return { ok: false, reason: `timestamp outside tolerance (${age}s)` };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(v1, "hex");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

export type CheckoutCompletedEvent = {
  playerId: string;
  skuId: string;
  sessionId: string;
};

/**
 * Parse a (already-verified) `checkout.session.completed` webhook payload
 * into the fields the entitlement grant needs. Returns null for any other
 * event type or a malformed session object — callers should 200 those (per
 * Stripe's retry semantics: only non-2xx responses get retried) without
 * granting anything.
 */
export function parseCheckoutCompleted(rawBody: string): CheckoutCompletedEvent | null {
  let event: {
    type?: string;
    data?: { object?: { client_reference_id?: string; metadata?: { sku_id?: string }; id?: string } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data?.object;
  const playerId = session?.client_reference_id;
  const skuId = session?.metadata?.sku_id;
  const sessionId = session?.id;
  if (!playerId || !skuId || !sessionId) return null;
  return { playerId, skuId, sessionId };
}
