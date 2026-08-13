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

## Acquisition — "did the post do anything"

`client/src/acquisition.ts`, carried on the `boot` event:

| Field | Meaning |
| --- | --- |
| `src` | `utm_source` if tagged, else the referrer host, else `direct` — the one field to read |
| `refGroup` | `direct` \| `social` \| `search` \| `self` \| `other` |
| `ref` | referrer HOST only, `www.` stripped (omitted when absent) |
| `utmMedium`, `utmCampaign` | our own tags (omitted when absent) |
| `landing` | our path, no query |

Two reductions keep the privacy contract above intact: only the referrer's
**host** is kept — never its path or query, which can carry the visitor's
search terms or a private group's URL — and the `utm_*` values are ours,
read from our own URL, describing the campaign rather than the person.

### Tag the links you post

**Do this, or half the campaign stays invisible.** Instagram and TikTok
in-app browsers send no referrer at all, so an untagged post from either is
indistinguishable from direct traffic. `utm_source` is the only thing that
attributes those, which is why it outranks the referrer host.

```
https://elyad.io/?utm_source=reddit&utm_medium=social&utm_campaign=<what-you-posted>
https://elyad.io/?utm_source=instagram&utm_medium=social&utm_campaign=<what-you-posted>
https://elyad.io/?utm_source=tiktok&utm_medium=social&utm_campaign=<what-you-posted>
https://elyad.io/?utm_source=discord&utm_medium=social&utm_campaign=<what-you-posted>
```

Keep `utm_campaign` stable per post (e.g. `fight-night-aug`) so repeat
shares of the same thing group into one row. Values are lowercased and
reduced to `[a-z0-9_-]` on arrival, so pick slugs.

### Read it

```
bun data-warehouse/ingest.ts && bun data-warehouse/report.ts
```

The **acquisition** section is scoped to candidate-real external sessions —
Jake's own machine reloading the site is not acquisition and would swamp
every row. Sessions that booted before this shipped report as
`(un-instrumented)`, deliberately NOT as `direct`: the referrer was never
asked for, and calling that "direct" would invent a finding out of a blind
spot.

**This only measures builds that carry it.** A deployed host running an
older bundle keeps producing un-instrumented sessions no matter what the
warehouse schema says.
