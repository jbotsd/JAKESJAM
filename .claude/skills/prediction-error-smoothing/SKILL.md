---
name: prediction-error-smoothing
description: >
  Substrate-agnostic recipe for hiding client-prediction-vs-server-reconcile
  error visually, without violating sim authority. Codifies the
  "sim entity ≠ render entity" pattern, exponential error-offset decay,
  and the snap thresholds shipped by Source, Quake 3, Unreal, Unity, and
  Rocket League. Use when players complain that movement "kicks",
  "jitters", or "snaps" after a rollback — especially in the air or
  during long arcs where the symptom is most visible. PROJECT-AGNOSTIC.
version: 1.0.0
---

# Prediction-error smoothing

## Why this skill exists

You ship Gambetta-style client-side prediction + server reconciliation. Ground movement feels great. **But jumping, projectiles, vehicles, ragdolls, and any motion not pinned by a hard constraint feel jittery.** Players say "it kicks", "rubber-bands mid-air", "snaps when I jump". The symptom is universal across genres — Source games, Quake clones, platformers, racers, Rocket League before they fixed it.

The cause is always the same: **you're applying server corrections directly to the entity that the renderer reads.** Even small corrections (0.5–5 px) become visible "kicks" because there's no physical anchor (floor, wall, contact) to absorb the discontinuity.

The fix is also always the same — and it's been shipped, in nearly identical form, by every major engine since GoldSrc.

## The hard rule

> **The renderer never reads the sim entity directly. It reads `sim_position + smoothed_error_offset`.**

Sim authority is unchanged. Collision, hit detection, gameplay logic — all read the unsmoothed sim. Only the *visual* representation lerps toward the corrected position. This is non-negotiable: smoothing the sim itself breaks determinism, lag compensation, and replay.

## The error-offset pattern (Glenn Fiedler, *State Synchronization*)

```
on snapshot received:
    new_error = (old_sim_pos + old_error) - new_sim_pos
    sim_pos    = new_sim_pos                 // sim snaps (authoritative)
    error      = new_error                   // visual offset absorbs the snap

every render frame:
    error *= decay_factor                    // exponential decay toward zero
    if |error| < epsilon: error = 0          // dead-band — stop fighting jitter
    render_pos = sim_pos + error
```

Two key properties:
1. The instant a snapshot arrives, `render_pos` is *unchanged* — `(new_sim + new_error) == (old_sim + old_error)`. The visual doesn't twitch on snapshot receipt.
2. Over the next ~100ms the offset decays to zero, gradually revealing the corrected position. The viewer sees "the character was always there", not "the character teleported".

Source: https://gafferongames.com/post/state_synchronization/

## Time constants & snap thresholds — what shipped games use

| Engine / Source | Smooth window | Snap threshold | Decay shape |
|---|---|---|---|
| Source (HL2, CS:S, TF2) | `cl_smoothtime = 0.1` (100 ms) | undocumented hard cap | linear toward zero |
| gafferongames *State Sync* | τ ≈ 100 ms (factor 0.95/frame) | continuous, no hard snap | dual-rate exponential: 0.95 if \|err\|<25 cm, 0.85 if \|err\|>1 m |
| Unity Netcode for Entities | 1 m – 10 m smoothing band | > 10 m → snap | linear toward sim |
| Unreal `CharacterMovementComponent` | `NetworkMaxSmoothUpdateDistance` | `NetworkNoSmoothUpdateDistance` → teleport | `ENetworkSmoothingMode::Exponential` (Fiedler-style) |
| Quake 3 `cg_predict` | "decay error away" | (community: ~64 units) | linear over fixed ms |
| Rocket League | full physics rollback every tick (no error decay needed) | n/a | n/a — replay is the smoothing |

**Recipe for a generic 60Hz game:**

- Decay factor `0.9 / frame` at 60fps ≈ τ=95ms ≈ Source's `cl_smoothtime`. Good default.
- Dead-band: `|error| < 1px` → set to zero. Stops fighting sub-pixel jitter forever.
- Soft band: `|error| < 0.25 m` (or ~25 game units) → factor 0.95/frame (slower, smoother).
- Hard band: `|error| > 1 m` → factor 0.85/frame (faster catch-up).
- Snap: `|error| > max_jump_arc * 1.5` (or ~2 m for a typical platformer) → set offset to zero, accept the visible teleport. This bound exists because beyond it, smoothing looks like *cheating* — the player slides through walls.

If you're at high latency (>150 ms RTT) and tempted to widen the smooth window, **don't go past 200ms**. Past that, the player sees their character lag behind their input visibly, which is worse than the jitter. Fix the underlying determinism instead (see `fixed-step-sim-integration`).

## Why air feels worse than ground

Ground movement has a **hard physical anchor** — every tick, collision resolution snaps the entity to the floor surface. Sub-pixel error in the sim is silently consumed by the floor-snap. In the air, **there is no anchor**. The full error rides the parabolic arc until landing.

This is why:
- Same magnitude of prediction error (e.g. 2 px from a 16ms RTT spike) is invisible on ground, blatant in air.
- Acceleration-integrated motion (gravity: `vy += g*dt`) compounds drift across rewinds; constant-velocity input motion (`vx = ±SPEED`) replays identically.
- Vehicles, projectiles, ragdolls, and grappling-hook arcs all show the same symptom for the same reason.

A render-layer smoother fixes the *visible* symptom. Underlying integration drift is a separate concern — see `fixed-step-sim-integration`.

## Anti-patterns

- ❌ **Smoothing the sim entity itself.** Breaks lag-compensated hit detection, breaks replays, breaks rollback. The sim must remain authoritative.
- ❌ **Single-rate decay.** A factor that hides 1 px jitter takes seconds to correct a 5 m respawn. Use the soft-band/hard-band split.
- ❌ **Smoothing past 200 ms.** Hides input feedback to the player. They'll feel "input lag" even when latency is fine.
- ❌ **Snap threshold tied to RTT.** It should be tied to game-physics scale (jump arc, vehicle length), not network conditions. Tie it to RTT and you mask determinism bugs that should be fixed at the source.
- ❌ **Per-component smoothing without correlation.** Smoothing `x` and `y` independently can produce diagonal "wobble" if the magnitudes differ. Smooth as a vector — `error_vec *= factor`.
- ❌ **Smoothing on remote players.** Remote players use *interpolation* (snapshot-buffered, ~100 ms behind). Layering an error smoother on top of an interpolation buffer double-smooths and produces lag. Smoother is for the *local* predicted player only.

## Pre-flight checklist

- [ ] Renderer reads `sim + error_offset`, never raw sim. Verified by grep.
- [ ] Error offset decays per render frame, not per sim tick (otherwise low-FPS clients smooth slower).
- [ ] Dead-band epsilon is set (≥ 0.5 px or game-equivalent) — no sub-pixel fighting.
- [ ] Snap threshold is tied to a physics scale (max jump, vehicle length), not a network metric.
- [ ] Smoother applies to local predicted entity only. Remote entities use interpolation.
- [ ] Smoother is a no-op when no correction is pending (`error == 0` short-circuits).
- [ ] In tests/replays, smoothing is bypassed — replays should show raw sim.

## Sister skills

- `deterministic-netcode-architecture` — the layer model this fits into; predicts where the smoother lives.
- `fixed-step-sim-integration` — fixes the *upstream* determinism so corrections shrink in the first place.
- `game-feel-juice` (project-specific) — render-layer effects (hit-stop, screen shake) that compose with smoothing without violating it.

## Source

- Glenn Fiedler, *State Synchronization*: https://gafferongames.com/post/state_synchronization/
- Glenn Fiedler, *Snapshot Interpolation*: https://gafferongames.com/post/snapshot_interpolation/
- Valve Developer Wiki, *Source Multiplayer Networking* (`cl_smoothtime`): https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- Unity Netcode for Entities, *Prediction Smoothing*: https://docs.unity3d.com/Packages/com.unity.netcode@1.3/manual/prediction-smoothing.html
- Unity, *DefaultSmoothingActionUserParams.maxDist* (1 m / 10 m bands): https://docs.unity3d.com/Packages/com.unity.netcode@1.1/api/Unity.NetCode.DefaultSmoothingActionUserParams.maxDist.html
- Unreal, *Understanding Networked Movement in CMC*: https://dev.epicgames.com/documentation/en-us/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine
- Unreal, *ENetworkSmoothingMode*: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/ENetworkSmoothingMode
- Fabien Sanglard, *Quake Engine Prediction*: https://fabiensanglard.net/quakeSource/quakeSourcePrediction.php
- Cone, *It IS Rocket Science!* (GDC 2018, Rocket League): https://ubm-twvideo01.s3.amazonaws.com/o1/vault/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf
- Edgegap, *Overwatch Netcode deep dive* (Tim Ford GDC 2017 summary): https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback
