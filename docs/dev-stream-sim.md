# JAKESJAM — Dev Stream: Sim & Gameplay

**Owner:** Dev A (you)
**Parallel stream:** Dev B owns netcode + infra (`server/`, `client/src/net/`, Convex schema changes, Vercel/Fly.io deployments). See `dev-stream-netcode.md`.

This doc is self-contained. Read this, plus the three required-reading docs below, and you have everything to start.

## Required Reading (in order)

1. `AGENTS.md` — the project-wide rules (no Java, Convex boundary, etc.)
2. `docs/game-design-document.md` — what the game IS
3. `docs/netcode-architecture.md` — **the most important one**. The whole reason your stream exists is to make the simulation portable enough to run on both client (prediction) and a Bun + uWebSockets server (authority). Read it twice.

## Why This Stream Exists

We're moving from "simulation lives inside Phaser scenes" to "simulation is a pure, deterministic, runtime-agnostic package that both the client and the authoritative game server can run". This is the precondition for client-side prediction + server reconciliation (the Gambetta pattern). Without your work, the game can't be properly online.

Right now `client/src/game/scenes/MatchScene.ts` is 2012 lines and contains the world simulation tangled with Phaser rendering, Phaser physics, input handling, and audio triggers. Your job is to surgically separate the simulation out into a new `sim/` package that knows nothing about Phaser, the DOM, or `Date.now()`.

## Your Domain

Files and concepts you own. Dev B will not touch these without asking:

```
client/src/sim/                        # NEW — entire directory is yours
  types.ts                             # CRITICAL — see "The Contract" below
  World.ts                             # World class with step(state, inputs, dt) → newState
  player.ts                            # movement, jump buffer, coyote time, crouch
  projectile.ts                        # projectile motion, collision, pathing modifiers
  weapon.ts                            # fire-rate, ammo, modifier resolution
  destructible.ts                      # barrels, boxes, mines, cubes
  fire.ts                              # napalm patches, DoT, dissipation
  pickup.ts                            # health/shield/overcharge collection
  collision.ts                         # deterministic AABB + swept AABB (replaces Phaser physics)
  rng.ts                               # seeded mulberry32
  constants.ts                         # STEP_MS, gravity, friction, etc.
  index.ts                             # public re-exports
  __tests__/                           # unit tests live next to the code

client/src/game/scenes/MatchScene.ts   # YOU WILL HEAVILY REFACTOR THIS
                                       # (extract sim out, leave rendering/input behind)
client/src/game/systems/MovementSystem.ts    # DELETED (2026-07-07) — see client/src/sim/player.ts + LocalPlayerController.ts
client/src/game/systems/WeaponSystem.ts      # delete after extraction
client/src/game/systems/ProjectileSystem.ts  # delete after extraction
client/src/game/systems/AudioSystem.ts       # KEEP — audio is rendering, not sim. Read events from sim, play sounds.

client/src/game/types/game.ts          # refactor — most types should move into sim/types.ts
                                       # leave UI-only types here
```

You also keep ownership of all gameplay backlog items (Milestones 2–3 leftovers and 10–13): projectile pathing modifiers, destructible behavior, fire/napalm tuning, character archetypes, weapon paths, draft cards. Once `sim/` exists, all new gameplay code goes there.

## Dev B's Domain (Don't Touch)

```
server/                                # NEW — entire workspace, Bun + uWebSockets game server
client/src/net/                        # NEW — transport, protocol, prediction client, reconciliation
client/src/game/net/RoomClient.ts      # Convex room/lobby client — Dev B will adjust signaling
convex/schema.ts                       # Dev B will add matchmaker URL field, drop matchPlayerSnapshots
convex/rooms.ts, convex/matches.ts     # Dev B owns matchmaking-related changes
package.json (root)                    # Dev B adds workspace + deploy scripts
vercel.json, fly.toml                  # Dev B owns deployment configs
```

If you need a change in any of these, leave a comment in the relevant PR or open an issue tagged `needs-dev-b`. Do not edit them yourself.

## The Contract (CRITICAL — Ship This First, Day 1)

Dev B is **blocked on you** until `client/src/sim/types.ts` is published and stable. The earlier you publish, the earlier we run in parallel. Treat this as a half-day-max task.

The contract is exactly these exports from `sim/types.ts`. Names and shapes are negotiable on day 1; locked after that. Once you push these to `main`, Dev B starts wiring the netcode against them.

```ts
// Identifiers
export type Tick = number;                    // monotonically increasing 60 Hz tick counter
export type EntityId = number;                // server-assigned, monotonic, unique per match
export type PlayerId = string;                // matches Convex roomPlayers.playerId
export type InputSeq = number;                // monotonic per-player input sequence

// Inputs
export type InputBitfield = number;           // bit 0 left, 1 right, 2 up, 3 down, 4 jump,
                                              // 5 crouch, 6 fire, 7 ability (LIVE 2026-07-16:
                                              // the Emission cast at full charge, legacy-parry
                                              // fall-through below — docs/emission-engine-goal.md),
                                              // 8 shield, 9 dash, 10-13 drafted ability
                                              // slots 1-4 (LIVE 2026-07-17 —
                                              // docs/six-axes-goal.md Layer 2), 14-15 reserved
export type InputFrame = {
  seq: InputSeq;
  tick: Tick;                                 // tick this input was generated for
  keys: InputBitfield;
  aimX: number;                               // world-space; quantize to int32 for protocol
  aimY: number;
  dtMs: number;                               // 8..50, clamped — server may override
};

// World snapshot — what the server broadcasts
export type WorldState = {
  tick: Tick;
  rngState: number;                           // current RNG cursor
  players: Record<PlayerId, PlayerEntity>;
  projectiles: Record<EntityId, ProjectileEntity>;
  destructibles: Record<EntityId, DestructibleEntity>;
  firePatches: Record<EntityId, FireEntity>;
  pickups: Record<EntityId, PickupEntity>;
  round: RoundState;
};

export type PlayerEntity = {
  id: PlayerId;
  characterId: 'balanced' | 'heavy' | 'sprinter' | 'shielded';
  x: number; y: number;
  vx: number; vy: number;
  aimX: number; aimY: number;
  health: number;
  shieldActive: boolean;
  crouching: boolean;
  alive: boolean;
  weaponId: string;
  cards: string[];                            // active card IDs
  fireCooldownMs: number;
  ammo: number;
  abilityCharge: number;
  lastProcessedInputSeq: InputSeq;            // for reconciliation
};

export type ProjectileEntity = {
  id: EntityId;
  ownerId: PlayerId;
  x: number; y: number;
  vx: number; vy: number;
  shape: 'circle' | 'triangle' | 'square' | 'hexagon' | 'orb';
  radius: number;
  damage: number;
  lifetimeMs: number;                         // remaining
  pathing: 'straight' | 'gravity' | 'bounce' | 'boomerang' | 'homing' | 'anti-homing' | 'float' | 'accelerate';
  element: string;
  bouncesRemaining: number;
  pierceRemaining: number;
};

export type DestructibleEntity = {
  id: EntityId;
  kind: 'barrel' | 'box' | 'mine' | 'cube';
  x: number; y: number;
  width: number; height: number;
  health: number;
  explosive: boolean;
  flammable: boolean;
};

export type FireEntity = {
  id: EntityId;
  x: number; y: number;
  radius: number;
  remainingMs: number;
  ownerId: PlayerId;
  damagePerSecond: number;
};

export type PickupEntity = {
  id: EntityId;
  kind: 'health-shard' | 'shield-cell' | 'overcharge-core';
  x: number; y: number;
  radius: number;
  amount: number;
  active: boolean;
  respawnAtTick: Tick;
};

export type RoundState = {
  phase: 'countdown' | 'fighting' | 'round-over';
  countdownRemainingMs: number;
  scores: Record<PlayerId, number>;
  roundIndex: number;
  winnerPlayerId: PlayerId | null;
};

// Discrete events emitted during a tick (broadcast in snapshot, used for SFX/VFX)
export type SimEvent =
  | { t: 'shot-fired';   playerId: PlayerId; x: number; y: number }
  | { t: 'hit-confirmed'; victimId: PlayerId; damage: number; sourceProjectileId: EntityId | null }
  | { t: 'destructible-broken'; entityId: EntityId; x: number; y: number }
  | { t: 'pickup-taken'; entityId: EntityId; playerId: PlayerId }
  | { t: 'round-end';    winnerId: PlayerId | null };

// The step function signature
export type StepResult = {
  state: WorldState;
  events: SimEvent[];                          // discrete events that happened this tick
};

// World class signature (in World.ts, not types.ts)
export class World {
  static create(map: MapDefinition, players: PlayerSpawnInfo[], rngSeed: number): WorldState;
  static step(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,  // null = no new input, hold last
    dtMs: number,                                          // always STEP_MS (16.67) in production
  ): StepResult;
}
```

Push `sim/types.ts` (just the type defs) and `sim/World.ts` (with `create` + a no-op `step` returning `{ state, events: [] }`) on day 1. Implement the actual logic afterward — Dev B can wire the netcode against the empty stub.

If you need to break the contract after day 1, ping Dev B before merging.

## Hard Rules for `sim/`

These are not negotiable. They are why the architecture works.

1. **No Phaser imports.** Not `phaser`, not `Phaser.Math`, not `Phaser.Geom`. Add an ESLint rule (`no-restricted-imports`) once the package exists. Phaser stays in `client/src/game/`.
2. **No DOM, no `window`, no `fetch`, no `localStorage`.** The package must run inside a Bun process with no DOM polyfill.
3. **No wall-clock reads.** Forbidden: `Date.now()`, `performance.now()`, `Math.random()`. Time comes in as `dtMs` parameter. Randomness comes from `rng.ts` (seeded mulberry32).
4. **Pure step function.** `World.step(state, inputs, dt)` returns a new state. It must not mutate the input `state`. (Use Immer-style draft if you want, but immutability at the boundary.) Easier alternative: clone-then-mutate-then-return.
5. **Fixed step size.** Always 16.667 ms (1000/60). The accumulator that drives `step` lives outside `sim/` (in `client/src/net/guestLoop.ts` and in `server/index.ts`). The sim never sees variable dt.
6. **Deterministic collision.** Phaser's Arcade physics is *not* deterministic across runtimes and you can't import it anyway. Write swept-AABB in `sim/collision.ts`. Reference: [Box2D-Lite](https://github.com/erincatto/box2d-lite/blob/master/box2d/Collide.cpp) for swept AABB; we don't need rotation or stacking, just player-vs-platform and projectile-vs-anything.
7. **Floats are best-effort, not bit-exact.** Cross-browser/runtime FP determinism for trig is not guaranteed. We accept small drift and let server snapshots correct it. Don't burn time chasing bit-equality.

## What To Extract From Where

Your starting material lives in these files. Order roughly matches dependency:

| Source (current) | Destination (new) | Notes |
|---|---|---|
| `client/src/game/types/game.ts` lines 60–227 (gameplay types) | `sim/types.ts` | Keep UI-only types (`CardVisualDefinition`, `CharacterDefinition`) in `game/types/game.ts` — sim doesn't need them. |
| `client/src/game/systems/MovementSystem.ts` (184 lines) | `sim/player.ts` | ✅ Done (2026-07-07) — extracted, `MatchScene` now wraps `stepPlayer` via `LocalPlayerController.ts`, `MovementSystem.ts` deleted. |
| `client/src/game/systems/WeaponSystem.ts` (169 lines) | `sim/weapon.ts` | Fire-rate, recoil, modifier composition. |
| `client/src/game/systems/ProjectileSystem.ts` (952 lines) | `sim/projectile.ts` + `sim/collision.ts` | Biggest extraction. Split projectile motion from collision response. |
| `client/src/game/scenes/MatchScene.ts` lines 1557–1597 (TestTarget, ArenaDestructible, FirePatch, HazardHit) | `sim/destructible.ts` + `sim/fire.ts` | These are inline in MatchScene right now. |
| `client/src/game/scenes/MatchScene.ts` lines 1640–1972 (createPlayerBody, expandMap, addTraversalConnectors, createDestructibleStates, createPickupStates, createTestTarget, helpers) | `sim/World.ts` (`World.create`) and `sim/destructible.ts` / `sim/pickup.ts` | World construction logic — pull out, leave Phaser sprite creation behind. |
| `client/src/game/scenes/MatchScene.ts` lines 1991–2012 (smoothSnapshot, lerpVec, distance) | `sim/util.ts` (only the math helpers) | `smoothSnapshot` is for interpolation — that's Dev B's territory. |

When you finish each extraction, **delete the source file** (or the relevant section). Do not leave the old code behind as a fallback. We will not maintain two implementations.

`MatchScene.ts` after refactor should be ~400 lines, doing only:
- Phaser scene lifecycle (init/preload/create/update)
- Render sprites/graphics from `WorldState`
- Capture input → `InputFrame`
- Hand `InputFrame` to whichever loop is active (offline `localLoop` or online `guestLoop`)
- Subscribe to `SimEvent[]` for SFX/VFX/screen shake

## The Phaser Physics Replacement

This is the hardest part of your stream and the one most likely to derail. Do it before any new gameplay work.

What you're replacing:
- Player vs. platform collisions (currently Phaser Arcade body collision)
- Projectile vs. platform collisions
- Projectile vs. player overlap
- Projectile vs. destructible overlap
- Player vs. pickup overlap
- Fire patch vs. player overlap

What to write in `sim/collision.ts`:

```ts
type AABB = { x: number; y: number; w: number; h: number };

// Static-vs-static overlap. Cheap, used for triggers (pickups, fire patches).
export function aabbOverlap(a: AABB, b: AABB): boolean;

// Swept AABB: where does `mover` first contact any of `statics` along velocity (vx*dt, vy*dt)?
// Returns hit time t in [0,1], normal, and the static index. null = no hit this frame.
export function sweepAABB(
  mover: AABB,
  vx: number, vy: number, dt: number,
  statics: AABB[],
): { t: number; nx: number; ny: number; index: number } | null;

// Resolve player movement: try full motion, on hit clip to t and slide along the surface, recurse up to 2 substeps.
export function resolveMove(mover: AABB, vx: number, vy: number, dt: number, statics: AABB[]): {
  x: number; y: number;
  vx: number; vy: number;
  groundedThisFrame: boolean;
};
```

For circle-vs-AABB (projectiles vs. platforms/destructibles), expand the AABB by the circle radius and treat as point-vs-AABB. Standard trick, works fine here.

Don't over-engineer it. We have ~30 platforms, ~10 destructibles, ~15 projectiles in flight max. O(n × m) brute force is correct for our scale; spatial hashing is premature.

## Determinism Strategy

True bit-exact determinism across browsers/runtimes is hard and we don't need it (snapshots are authoritative). What we DO need:

- **Same inputs in same order produce same state on the same machine.** Required for prediction replay on the client.
- **Server's state is monotonic and reproducible from initial seed + input log.** Required for debugging/replay.

Get this by:
- Seeded RNG with explicit state in `WorldState.rngState` (so step is pure with respect to randomness).
- Iteration order over entities is sorted (e.g., by `EntityId` ascending) — never iterate over `Object.values()` order without sorting.
- No floating-point comparisons with `===`. Use epsilon comparisons (`Math.abs(a - b) < 1e-6`).
- All random selections (e.g., spread angle within a cone) draw from `rng.ts`.

## Test Strategy

Add Vitest to the client workspace (it's already a TS/Vite project, drop-in). Write tests as you extract:

```
client/src/sim/__tests__/
  player.test.ts         # jump buffer, coyote time, fall speed cap
  projectile.test.ts     # straight/gravity/bounce/boomerang each get a test
  collision.test.ts      # swept AABB corners (corner hits, slide, two-axis)
  weapon.test.ts         # fire rate gating, ammo, recoil
  world.test.ts          # full step with synthetic input frame, golden state assertion
  determinism.test.ts    # run 600 ticks twice with same seed+inputs, expect identical state
```

The determinism test is the most important one. If it ever fails, prediction will desync.

For the "golden state" tests, store the expected `WorldState` JSON next to the test and snapshot-compare. When you change sim behavior intentionally, regenerate the goldens.

Target: `npm run test --workspace client` runs in under 5 seconds. Keep tests fast and deterministic (they will be in CI).

## Definition of Done (for the extraction phase)

You're done with the extraction (and unblock real gameplay work) when:

- [ ] `sim/types.ts` matches the contract above (or has been renegotiated with Dev B in writing)
- [ ] `sim/World.create()` builds a starting state for a 1v1 match on Boxworks with both players, all destructibles, all pickups
- [ ] `sim/World.step()` advances one 60Hz tick: movement, projectile motion, collisions, damage, destructible health, fire DoT, pickup collection
- [ ] `MatchScene.ts` is ≤500 lines and contains zero gameplay logic — only Phaser lifecycle, rendering, and input capture
- [x] `MovementSystem.ts` is deleted (2026-07-07) — [ ] `WeaponSystem.ts`, `ProjectileSystem.ts` still pending
- [ ] `npm run test --workspace client` passes with at least the determinism test green
- [ ] `npm run typecheck` passes
- [ ] `npm run dev:client` boots, you can play offline practice using only `sim/` + `MatchScene` rendering, no behavioral regressions vs. current main
- [ ] No file in `sim/` imports from `phaser`, `convex`, the DOM, or `client/src/game/`

After that, all new gameplay (projectile pathing modifiers, fire tuning, draft cards' projectile effects, etc.) is built directly inside `sim/` with tests. Online sync becomes Dev B's problem to wire up — your code already runs in both places.

## Coordination Points

These are the moments where the streams will collide. Plan for them.

| When | What | How to handle |
|---|---|---|
| Day 1, end of day | You publish `sim/types.ts` + stub `sim/World.ts` | One PR, small, clearly titled `[sim] contract types — unblocks netcode`. Dev B reviews and merges fast. |
| ~~When you delete `MovementSystem.ts`~~ Done (2026-07-07) | Confirmed via grep: nothing outside the file itself referenced it (`RoomClient`/`RemotePlayerManager` don't) | Deleted; `MatchScene.ts` now runs the real physics via `LocalPlayerController.ts` (wraps `sim/player.ts`'s `stepPlayer`, same as the online path). |
| When you refactor `MatchScene.ts` | Dev B will be adding the online connection boot path here | Land your refactor first, in a single PR. Dev B integrates against the new shape. |
| When `sim/` step exists for real | Dev B can finally test reconciliation against your sim | Pair-debug session — reconciliation bugs often look like sim bugs and vice versa. Plan an hour together. |
| When character archetypes / cards modify sim behavior | Dev B's protocol may need new event types | Ping Dev B; don't add to `SimEvent` union without a heads-up. Versioned protocol means breaking change costs us a deploy coordination. |

## Workflow

- One feature per PR. Title prefix `[sim]` so Dev B can filter.
- Branch off `main`. Don't long-lived-branch — rebase often, especially while `MatchScene.ts` is in flux.
- Run `npm run verify` (typecheck + build) before opening PR. Add `npm run test` once Vitest is wired.
- If you find Convex / netcode work that needs doing, write it in your PR description as `## For Dev B` and tag them, don't do it yourself.

## Backlog Pointers (After Extraction)

Once the extraction is done, your gameplay backlog is:

- Milestone 2 leftovers: `JJ-0203B` first pathing modifiers (bounce, boomerang, weak homing, anti-homing) — now built in `sim/projectile.ts`
- Milestone 3: destructibles richer physics, fire ownership, tuning
- Milestone 5: card system + draft (data is in `client/src/game/data/cards.ts` already)
- Milestone 11: actual draft scene/UI
- Milestone 13: PvP health/shield/damage authority — much easier now since `sim/` is the authority

Ignore Milestones 4 and 8's "low-frequency Convex snapshot sync" line items entirely. Those are obsoleted by the new netcode plan.

## Questions / Stuck

If anything in `docs/netcode-architecture.md` contradicts this doc, the netcode doc wins (it's the higher-level architecture). If you spot a contradiction, flag it.

If you need a sim-side capability that Dev B's protocol doesn't carry yet (new event type, new entity field), open a discussion before implementing. Protocol changes are coordinated.

If `sim/` extraction is taking longer than expected, prioritize getting `types.ts` + a stub `World` shipped over completeness. Dev B is blocked on the types — partial is far better than late.
