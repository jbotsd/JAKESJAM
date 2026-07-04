# Character controller overhaul — Super Meat Boy DNA

Brief (2026-07-04): "go deep on Super Meat Boy controls — slide, wall
bounce, etc. — and think about overhauling our character controller."

## 1. What actually makes Super Meat Boy feel good

SMB is the reference for "tight" 2D movement. The feel comes from a small
set of decisions, not one trick:

- **Instant response, near-zero inertia.** Ground accel is almost a step
  function — tap left, you're at full speed in ~2 frames; release, you stop
  in ~2. High accel AND high friction. (Ours: `groundAcceleration`/
  `groundFriction` — already fairly snappy, ~120ms to max, ~92ms to stop.)
- **Strong air control.** You steer mid-air almost as well as on the ground
  (~80–90% of ground accel). (Ours: `airAcceleration` ≈ 76% — close.)
- **Run speed is FAST.** SMB is about flow and speed. Meat Boy crosses a
  screen quickly. (Ours: 330 px/s = 5.9 H/s — mid-tier; SMB-feel wants the
  option to go faster, or a run/sprint.)
- **Wall SLIDE.** Press into a wall while airborne and you cling + descend
  slowly (a capped fall speed, ~1/3 of normal). This is the core traversal
  primitive — it turns every wall into a foothold and buys reaction time.
- **Wall JUMP.** From a slide (or wall-touch), jump launches you UP and AWAY
  from the wall with a fixed horizontal kick, then hands control back after a
  brief "lock-out" (~80–120 ms) so you don't instantly re-stick. Chaining
  wall-jumps up a shaft is the signature SMB move.
- **No double jump.** Vertical traversal comes from walls, not air-jumps.
  Wall-jump IS the vertical toolkit.
- **Variable jump height (jump-cut).** Hold for high, tap for low. (Ours:
  `jumpCutMultiplier` 0.48 — have it.)
- **Coyote time + jump buffer.** Forgiveness windows. (Ours: 110/110 ms —
  have them.)
- **Momentum preservation on jump.** Horizontal speed carries fully into the
  arc; jumping never scrubs speed. (Ours: yes — jump only sets `vy`.)
- **Fast-fall.** Down = drop faster for precision. (Ours: `fastFallGravity`
  2800 — have it.)

"Wall bounce" (the user's word) usually means one of two SMB-adjacent things:
1. **Wall-jump kick** (the standard) — launch off with a set horizontal
   impulse. Or
2. **True bounce** — hit a wall with horizontal speed and rebound with
   preserved/partial velocity (more Celeste/N++). Snappier, more chaotic.
We can support both via a `wallRestitution` knob (0 = pure wall-jump kick,
>0 = elastic rebound).

## 2. Honest read of what we have

We're a **jetpack platformer**, not an SMB platformer. `player.ts` /
`player.zig`:
- Jump → fixed `jumpVelocity` (-635), with coyote/buffer/cut. ✓ SMB-grade.
- **Hold-jump-airborne → jetpack thrust** (fuel-limited). This is the
  vertical-traversal answer *instead of* walls. It's the direct competitor
  to wall-jump — you can't cleanly have both as the "hold jump" verb.
- Asymmetric gravity (descent 2175 / fast-fall 2800). ✓ good weight.
- Swept-AABB collision (`resolveMoveCached`) with contact **normals** — so
  the physics ALREADY knows when you hit a wall (it zeroes `vx` on a side
  hit). We just don't surface that as a "touching wall" signal yet.

The fundamentals (accel/friction/coyote/buffer/cut/fast-fall) are already
SMB-shaped. **The overhaul is really two things:** (a) add wall slide +
wall jump, and (b) decide the jetpack's fate.

## 3. The core design decision: jetpack vs walls

These are two different games. You should pick per the vision:

- **Option A — Full SMB (recommended for "tight platformer" feel).** Remove
  the jetpack. Hold-jump does nothing special airborne; vertical traversal is
  wall-jump only. Maps get walls/shafts to climb. Tightest, most skillful,
  most readable. Biggest change (maps + the jetpack-reliant AI/bots).
- **Option B — Hybrid (lowest risk).** Keep the jetpack but make **wall
  slide + wall jump** first-class, and gate the jetpack behind a *separate*
  input or a longer hold so it doesn't fight wall-jump. E.g. wall-jump on the
  jump tap while wall-touching; jetpack only after ~150ms of airborne hold
  in open space. You keep the current air game and add wall movement.
- **Option C — Cosmetic only.** Just add wall slide (no wall-jump), as a
  "grip" that slows falls near walls. Small, safe, but not the SMB ask.

**Recommendation: B, then evaluate A.** Ship wall-slide + wall-jump as a
first-class layer alongside the jetpack (input-disambiguated), playtest the
feel, and if the wall game is clearly better, retire the jetpack (Option A)
in a follow-up — including re-tuning maps and the bot AI (which currently
jetpacks; it'd need wall-jump pathing).

## 4. Proposed mechanics + numbers (tunable)

New movement-memory state: `touchingWallDir` (-1/0/+1), `wallStickMs`,
`wallJumpLockMs`.

- **Wall detection** — surface a `wallContactDir` from `resolveMoveCached`
  (the collision already computes the side normal; expose it: −1 = wall on
  left, +1 = wall on right). A short **wall-stick grace** (~90 ms, mirrors
  coyote) keeps the state alive for a few frames after leaving the wall so
  the wall-jump window is forgiving.
- **Wall slide** — when airborne, `wallContactDir !== 0`, pressing INTO the
  wall, and `vy > 0` (descending): clamp `vy ≤ WALL_SLIDE_MAX_FALL`
  (~250 px/s, vs ~1000 normal). A tiny stick so you don't slide off the top
  edge instantly.
- **Wall jump** — jump pressed while wall-touching (or within the
  wall-stick grace): set `vy = WALL_JUMP_VY` (~-560, a touch under a floor
  jump) and `vx = -wallDir * WALL_JUMP_VX` (~420 away from the wall). Then
  set `wallJumpLockMs` (~110 ms) during which horizontal INPUT toward the
  wall is ignored (so you actually leave) — input control returns after.
- **Wall bounce (opt-in via `WALL_RESTITUTION`)** — on a side collision with
  horizontal speed above a threshold and NOT pressing into the wall, reflect:
  `vx = -vx * WALL_RESTITUTION` (~0.5). Gives the chaotic rebound flavor.
- **Speed option (SMB flow)** — consider a sprint or a higher `maxGroundSpeed`
  (400+). Optional; test with the wall game first.

## 5. Implementation plan (parity-critical)

Every rule lands in BOTH `client/src/sim/player.ts` AND `sim/src/player.zig`,
bit-identically (determinism — see the reflect/parry parity lesson). Steps:

1. **Collision:** add a `wall_contact_dir` output to the swept-resolve result
   in `collision.ts` + `collision.zig` (derive from the side-hit normal;
   0 when no side hit). No behavior change — just surfacing existing data.
2. **Player memory:** add `touchingWallDir`, `wallStickMs`, `wallJumpLockMs`
   to `MovementMemory` (TS) + the Zig movement-memory struct.
3. **Player step:** after collision resolve, update wall state; apply wall
   slide clamp; branch the jump (wall-jump when wall-touching, else the
   normal jump); apply the input lock-out; optional restitution.
4. **Input disambiguation** (Option B): wall-jump on jump-tap while
   wall-touching takes precedence; jetpack hold-threshold pushed out so it
   doesn't fire during a wall-jump.
5. **Tuning constants** in the `M` table (both sides) — one block, documented
   like the M1 gravity work.
6. **Tests:** parity tests (TS↔wasm) for the new physics; unit tests for
   wall-slide clamp, wall-jump velocity, lock-out, and grace window; a
   `game-feel-tuning.md`-style metrics pass (wall-jump height/kick vs a
   benchmark).
7. **Bots + maps:** if we go Option A later, the bot AI (`worldBots.ts`)
   needs wall-jump pathing and maps need climbable walls (the generator +
   curated maps). Under Option B the current AI still works (jetpack intact).

## 6. Risk + why this isn't a same-session slam-dunk

- **Determinism.** Any divergence between the TS and Zig physics breaks
  client/server agreement → rubber-banding. New velocity branches must be
  byte-identical (the `Math.hypot` vs naive-sqrt note in player.ts is exactly
  this class of trap). Needs the parity test suite green before shipping.
- **Feel needs your hands.** Wall-jump kick, slide speed, and lock-out are
  pure feel — they want iteration with a controller in hand, like the audio.
  I can land good starting numbers, but expect 2–3 tuning rounds.
- **Scope of Option A.** Removing the jetpack cascades into maps + bot AI.
  That's why B (additive) is the safe first cut.

## Recommendation

Do **Option B, Phase 1**: surface wall-contact from collision (TS+Zig),
add wall-slide + wall-jump with the numbers above, input-disambiguate from
the jetpack, ship behind the existing sim with full parity tests. Play it,
tune the three feel knobs, then decide whether to commit to full SMB
(retire the jetpack, Option A) as Phase 2. I can start Phase 1 on your go.
