// Stripe Checkout — the payment half of the cosmetics store (research brief
// §2). Raw fetch against Stripe's REST API, matching this project's
// dependency-light style (no stripe npm SDK, same pattern as tiktok/).
// Mechanically complete per Stripe's documented API, but CANNOT be exercised
// against a live account without a real STRIPE_SECRET_KEY — an external,
// credential-gated step only the account owner can do.

const STRIPE_API = "https://api.stripe.com/v1";

export type CosmeticSku = {
  id: string;
  name: string;
  description: string;
  /** Price in the smallest currency unit (cents for USD). */
  amountCents: number;
  currency: string;
};

/**
 * The initial catalog. Purely visual — none of these touch sim state or the
 * gameplay card system (crystalRoundsCards). Extend this list as real
 * cosmetic assets/rendering variants land; the checkout/webhook plumbing
 * below doesn't change per-item.
 */
export const COSMETIC_CATALOG: readonly CosmeticSku[] = [
  {
    id: "ember-trail",
    name: "Ember Wand Trail",
    description: "Recolors your wand's projectile trail to a warm ember palette. Visual only.",
    amountCents: 300,
    currency: "usd",
  },
];

export function findSku(skuId: string): CosmeticSku | null {
  return COSMETIC_CATALOG.find((s) => s.id === skuId) ?? null;
}

export function requireStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Stripe integration not configured — missing env var STRIPE_SECRET_KEY. " +
        "Create a Stripe account, get an API key from the dashboard, and set it.",
    );
  }
  return key;
}

export type CheckoutSession = { id: string; url: string };

/**
 * Create a Checkout Session for one cosmetic purchase. `playerId` rides
 * along as `client_reference_id` so the webhook can attribute the completed
 * payment to the right player without a separate lookup table.
 */
export async function createCheckoutSession(opts: {
  sku: CosmeticSku;
  playerId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const secretKey = requireStripeSecretKey();
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": opts.sku.currency,
    "line_items[0][price_data][unit_amount]": String(opts.sku.amountCents),
    "line_items[0][price_data][product_data][name]": opts.sku.name,
    "line_items[0][price_data][product_data][description]": opts.sku.description,
    client_reference_id: opts.playerId,
    "metadata[sku_id]": opts.sku.id,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
  if (!res.ok || !json.id || !json.url) {
    throw new Error(`Stripe checkout session creation failed: ${res.status} ${json.error?.message ?? "unknown"}`);
  }
  return { id: json.id, url: json.url };
}
