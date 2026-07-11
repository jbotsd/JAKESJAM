# Session goal — gnostic deaths + the no-bug-report pipe

**One sentence:** dying in JAKESJAM becomes a beautiful gnostic beat — the
soul visibly returns to the arena's center motif — and when anything breaks
for any player, the game tells us itself, with enough context to fix it,
without ever identifying the player.

## Pillar 1 — Vivid gnostic death sequences

**Outcome:** death is a narrative moment, not a disappearance. The body
dissolves where it fell; a soul-mote rises and travels — beautifully, with
intent — to the center motif of the map, which receives it with a visible
pulse. It reads as *the arena collecting a spirit*.

**Acceptance tests**
1. **Authored once, appears everywhere** (the pillar-6 litmus): the sequence
   is a render-contract producer + painter. The SAME code paints it on
   desktop, phone, potato/Pi, and inside replay-rendered clips. Proof: a
   replay render of a match with deaths shows the full sequence.
2. **Deterministic:** the soul path derives from sim state (death position,
   tick), never `Math.random()` in the render path — two renders of the same
   replay slice produce the identical sequence, pixel-plausible.
3. **Tiered, never absent:** fxLevel 0 still shows the legible core (mote +
   trail + motif pulse — cheap: one additive sprite chain); fx1 adds the
   corpse dissolve; fx2 adds the full richness (particle dissolution, ribbon
   trail, motif flare rings). The death is never invisible on any tier.
4. **Zero hot-path allocation** steady-state (pooled objects, contract-style
   scratch arrays) and **no motion hitch**: 4 simultaneous deaths under 8×
   CPU throttle cause no governor step-down.
5. **Legibility guarded:** additive/alpha only, no full-screen flashes, never
   obscures live combat, never delays the respawn timer.
6. **The eye test:** Jake judges it "beautiful and gnostic" — on desktop and
   at phone size (an A/B-grade clip is the evidence, same discipline as the
   rig acceptance).

## Pillar 2 — Sovereign telemetry: the user never files a bug report

**Outcome:** when it breaks, we already know. The game phones home to OUR
box — never a third party — with the error, the device class, and the last
breadcrumbs of engine lifecycle, under a privacy contract a cypherpunk would
sign (docs/TELEMETRY.md).

**Acceptance tests**
1. **Capture is total for the failure classes that matter:** JS errors
   (`window.onerror`), unhandled promise rejections, WebGL context loss,
   abnormal WebSocket closes (with reason: `stale-on-resume` etc.),
   governor floor-hits, boot facts (tier, renderer string, load-to-match ms).
   Errors carry a ~40-entry breadcrumb ring (connects, scene changes,
   governor steps).
2. **Privacy contract holds and is verifiable:** same-origin POST only; no
   third-party request anywhere; session id is a random UUID living only in
   memory (grep localStorage/cookies: absent); server writes NO IP and NO
   user id into the store (grep the JSONL: absent); device facts limited to
   the tier-debugging set already in use (renderer string, screen, DPR,
   touch/desktop).
3. **Transport is polite:** batched ≤32KB, ≥5s apart, `sendBeacon` on
   pagehide; offline events are dropped, not hoarded in storage.
4. **Server is bounded:** shape-validated, per-session rate-limited, JSONL
   day files under `server/.telemetry/` with a hard size quota (oldest-first
   prune), signature-dedupe index (first-seen / last-seen / count / sample).
5. **The loop closes live:** a deliberately thrown error on play.elyad.io
   appears in `GET /ops/api/telemetry/summary` (admin-secret gated) within
   60 seconds, with a stack and breadcrumbs good enough to act on.
6. **Claude-QA ready (foundation only this session):** a documented path for
   a kept-alive Claude session to tail the store and reproduce issues via
   the deterministic replay substrate. Building that live QA loop is
   explicitly OUT of scope today; the telemetry it will feed on is IN.

## Out of scope today
- The kept-alive Claude QA/iteration loop itself (later session).
- Any gameplay change: death timing, respawn rules, scoring are untouched —
  both pillars are pure observation/presentation layers.

---

## Evidence ledger (2026-07-11)

**Pillar 1 — death sequences**
- Tests 1+2 PASSED: producer+painter authored once (renderContract.ts +
  deathFxPainter.ts), consumed by OnlineMatchScene AND ReplayScene;
  ReplayScene events wired (was discarded); determinism locked by test
  ("two identical runs trace identical souls") + replay-rendered proof
  clip: https://play.elyad.io/c/d95edcd8-7148-471b-addc-8a360e39523a
  (vertical /c/ca0c61e5) — real stored match, Jake's death @tick 1932.
- Test 3 (tiered, never absent) PASSED by construction: fx0 core path
  has no gate; fx1/fx2 additive; offline renders force fx2.
- Test 4: pooled (16 souls / 48 shards / 12 uploads, ring trails), no
  steady-state alloc; 8×-throttle multi-death soak NOT yet run.
- Test 5 PASSED: ADD-blend only; overlay held 3s; respawn untouched.
- Test 6 (the eye): AWAITING JAKE. Scope grew live: Doom-style burst +
  damage-proportional homing shards (new hit-confirmed.attackerId) +
  gnostic spawn-in upload — all shipped same-session.

**Pillar 2 — sovereign telemetry: ALL TESTS PASSED**
- Deliberate real-browser error on play.elyad.io → captured by
  window.onerror → batched POST → JSONL store → visible in
  /ops/api/telemetry/summary with stack, 40-crumb ring, build hash —
  well inside 60s. Boot events flow (tier/renderer/DPR).
- Privacy verified by grep: zero ip/uid fields in the store; session
  UUID in-memory only; rate limit keyed on session, never IP.
- Bounded: 50MB quota oldest-first, shape caps, signature dedupe index.
- Claude-QA foundation documented (TELEMETRY.md flow section).

**Bonus (user-directed, same session)**: host-rendered clips
(clipRenderQueue, /clips/recent, phone tier stops encoding), DPR-crisp
tiers + glyph resolution, share-page mp4 theater, fullscreen toggle,
tap-jump + dash mini-stick + hold-dash.
