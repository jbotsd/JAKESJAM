// Fixed-window per-key rate limiter — in-memory, single-process. Good enough
// for a single self-hosted Bun instance sitting behind a public Tailscale
// Funnel URL; it is NOT meant to survive horizontal scaling (that would need
// a shared store like Redis/Convex).
//
// Purpose: bound abuse (disk-fill uploads, token-mint spam, WS-connect
// floods) from anonymous internet traffic, not to be a precise quota system.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Sweep stale entries periodically so idle keys don't leak memory forever.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

/**
 * Returns true if `key` is still within `limit` hits per `windowMs`,
 * incrementing its counter as a side effect.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

/**
 * Best-effort client identifier for rate limiting. Tailscale Funnel proxies
 * through the local tailscaled process, so `srv.requestIP` alone would
 * collapse every internet visitor onto one loopback-ish address — prefer the
 * `x-forwarded-for` header Funnel sets, falling back to the raw socket IP for
 * direct/LAN connections. Callers should treat this as abuse-mitigation, not
 * a hard security boundary: a header is only trustworthy because Funnel is
 * presently the sole ingress path (no direct port-forward is configured).
 */
export function clientKey(req: Request, srv: { requestIP(req: Request): { address: string } | null }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return srv.requestIP(req)?.address ?? "unknown";
}
