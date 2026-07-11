# Telemetry — the no-bug-report pipeline

**Goal:** a player should never have to describe a bug. When something breaks,
the game itself sends back exactly enough for us to fix it — and nothing that
identifies the player.

## Privacy contract (sovereign by construction)

What makes this different from bolting on Sentry/PostHog: **no third party
ever sees a byte.** Events go to the same game server the player is already
talking to (`play.elyad.io`), stored as flat files on hardware we own, with
hard quotas. Specifically:

- **No third-party services.** The endpoint is same-origin; no CDN beacons,
  no analytics SDKs, no external error trackers.
- **No persistent identity.** A session gets a random UUID that lives only
  for that tab's lifetime — never written to localStorage/cookies, never
  correlated across sessions. There is no user id in the pipeline at all.
- **No IP retention.** The server does not write the remote address into the
  telemetry store. (Transport-level logs are not part of this pipeline.)
- **No fingerprinting.** We keep the minimum device facts needed to
  reproduce a bug: GPU renderer string (already used for quality tiering),
  screen size, DPR, quality tier, orientation, and a coarse platform flag
  (touch vs desktop). No fonts, no canvas hashes, no locale, no UA beyond
  `navigator.platform`-level coarseness.
- **No gameplay surveillance.** Breadcrumbs are engine lifecycle events
  (connect/disconnect, scene changes, governor steps, errors), not chat, not
  input streams, not who-killed-whom.
- **Hard local quota.** The store is size-capped and oldest-first pruned;
  it can never grow into a shadow database.
- **Readable by the owner in one `cat`.** JSONL on disk. What is collected
  is exactly what you can read there — no hidden enrichment.

## What is captured

| Kind | Contents |
| --- | --- |
| `error` | message, stack (bundle frames), source (`window.onerror`, `unhandledrejection`, `console.error` opt-in hooks), dedupe signature |
| `context-loss` | WebGL context lost/restored events |
| `net` | ws close code + reason (`stale-on-resume`, supervisor reconnect outcomes), connect latency |
| `perf` | governor step-downs (frame-dt EMA at the time), tier, renderScale floor hits, fps snapshot on death of the session (pagehide) |
| `boot` | tier decision, renderer string, screen/DPR, load-to-match ms |

Each event carries the session UUID, a monotonic sequence number, game build
hash, and the last ~40 breadcrumbs (ring buffer) when it's an error.

## Flow

client ring buffer → batched `POST /telemetry` (JSON, ≤32KB/batch, ≥5s apart,
`sendBeacon` on pagehide) → server validates shape + rate-limits per session →
appends to `server/.telemetry/events-YYYY-MM-DD.jsonl` → signature dedupe
index `server/.telemetry/signatures.json` (first-seen, last-seen, count) →
`GET /ops/api/telemetry/summary` (admin-secret) lists top signatures.

The later step (not in this pass): a kept-alive Claude session tails the
store, reproduces via the deterministic replay substrate, and proposes fixes.
