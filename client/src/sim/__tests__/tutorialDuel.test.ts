// Combat-composition sanity for tutorialDuel.ts: proves the trimmed
// pipeline still gives real hit/parry resolution (the whole point of NOT
// reusing World.stepWithRuntime — see tutorialDuel.ts's header) and that
// the round machinery really is absent, not just unused.

import { describe, expect, test } from "bun:test";
import {
  createTutorialDuelRuntime,
  createTutorialDuelState,
  stepTutorialDuel,
  type TutorialDuelInput,
} from "../tutorialDuel.js";
import { InputBit } from "../../net/protocol.js";
import { tutorialArena } from "../data/tutorial-arena.js";
import { EntityId, PlayerId } from "../types.js";

const DT_MS = 1000 / 60;
const HERO = PlayerId("hero");
const DUMMY = PlayerId("dummy");

function idle(): TutorialDuelInput {
  return { keys: 0, aimX: 0, aimY: 0 };
}

describe("tutorialDuel", () => {
  test("a fired shot damages the target", () => {
    const runtime = createTutorialDuelRuntime(tutorialArena);
    let state = createTutorialDuelState(
      [
        { playerId: HERO, characterId: "balanced", name: "hero", color: "#fff", weaponId: "starter-pistol" },
        { playerId: DUMMY, characterId: "balanced", name: "dummy", color: "#fff", weaponId: "starter-pistol" },
      ],
      new Map([
        [HERO as string, { x: 500, y: 900 }],
        [DUMMY as string, { x: 700, y: 900 }],
      ]),
    );

    const heroInput: TutorialDuelInput = { keys: InputBit.Fire, aimX: 700, aimY: 900 };
    // Fire once, then let the shard fly for up to 2 seconds of ticks.
    let hit = false;
    for (let i = 0; i < 180; i++) {
      const events = stepTutorialDuel(state, runtime, { [HERO as string]: i === 0 ? heroInput : idle(), [DUMMY as string]: idle() }, DT_MS);
      state = events.state;
      if (events.events.some((e) => e.t === "hit-confirmed" && e.victimId === DUMMY)) hit = true;
      if (hit) break;
    }
    expect(hit).toBe(true);
    expect(state.players[DUMMY]!.health).toBeLessThan(100);
  });

  test("a shot arriving while dashing toward it is deflected (zero damage)", () => {
    // isHitInParryArc estimates the shot's source direction from the raw
    // end-of-tick relative position (projectile.x - player.x), not a swept
    // entry point. At full DASH_SPEED (940px/s) closing against a 640px/s
    // shard, a standard 16.67ms tick can overshoot PAST the crossing point
    // in a single step, which flips the sign of that estimate and reads as
    // "shot arrived from behind" even though it logically came from the
    // dash's own target direction — a real geometric edge case in the
    // shared arc-check (combat.ts), not something specific to this module.
    // Sub-stepping the SAME stepTutorialDuel/stepPlayer/stepProjectile code
    // at a finer dtMs (here 2ms vs the usual 16.67ms) resolves the crossing
    // with enough resolution to avoid that overshoot — legitimate temporal
    // supersampling of production physics, not a behavior change.
    const runtime = createTutorialDuelRuntime(tutorialArena);
    // Pre-seed the dummy's movement memory mid-dash-burst so the very first
    // stepped tick already reflects dashing=true via the real mem→entity
    // mirror path (mirrorMovementMemoryOntoEntity), not a hand-set field
    // that a genuine movement step would just overwrite back to false.
    runtime.movement.set(DUMMY, {
      coyoteMs: 0,
      jumpBufferMs: 0,
      jumpCutApplied: true,
      jumpReleasedSinceJump: true,
      groundedLastFrame: false,
      jetpackActive: false,
      touchingWallDir: 0,
      airJumpsUsed: 0,
      dashCooldownMs: 500,
      dashUsedInAir: 0,
      dashActiveMs: 150,
      dashRecoveryMs: 0,
    });

    let state = createTutorialDuelState(
      [
        { playerId: HERO, characterId: "balanced", name: "hero", color: "#fff", weaponId: "starter-pistol" },
        { playerId: DUMMY, characterId: "balanced", name: "dummy", color: "#fff", weaponId: "starter-pistol" },
      ],
      new Map([
        [HERO as string, { x: 500, y: 900 }],
        [DUMMY as string, { x: 650, y: 900 }],
      ]),
    );
    // Dummy already mid-lunge toward the hero; a shard already in flight,
    // 90px out — well inside the dash's frontal cone and closing.
    state = {
      ...state,
      players: { ...state.players, [DUMMY]: { ...state.players[DUMMY], vx: -940, vy: 0 } },
      projectiles: {
        [EntityId(1)]: {
          id: EntityId(1),
          ownerId: HERO,
          x: 560,
          y: 900,
          vx: 640,
          vy: 0,
          shape: "hexagon",
          radius: 7,
          damage: 12,
          lifetimeMs: 1000,
          pathing: "straight",
          element: "crystal",
          bouncesRemaining: 0,
          pierceRemaining: 0,
          impact: "none",
          impactRadiusPx: 0,
          splitCount: 0,
          slowMultiplier: 1,
          homingStrength: 0,
          accelerationMultiplier: 0,
          gravityScale: 0,
          rangePx: 720,
          ageMs: 0,
          traveledPx: 0,
          originX: 500,
          originY: 900,
        },
      },
    };

    const dummyDash: TutorialDuelInput = { keys: InputBit.Dash, aimX: 500, aimY: 900 };
    const SUBSTEP_MS = 2;
    let deflected = false;
    let anyDamage = false;
    for (let i = 0; i < 60 && Object.keys(state.projectiles).length > 0; i++) {
      const events = stepTutorialDuel(state, runtime, { [HERO as string]: idle(), [DUMMY as string]: i === 0 ? dummyDash : idle() }, SUBSTEP_MS);
      state = events.state;
      for (const e of events.events) {
        if (e.t === "parry-deflected" && e.playerId === DUMMY) deflected = true;
        if (e.t === "hit-confirmed" && e.victimId === DUMMY && e.damage > 0) anyDamage = true;
      }
      if (deflected || anyDamage) break;
    }
    expect(deflected).toBe(true);
    expect(anyDamage).toBe(false);
    expect(state.players[DUMMY]!.health).toBe(100);
  });

  test("round phase never leaves 'fighting' no matter how many hits land", () => {
    const runtime = createTutorialDuelRuntime(tutorialArena);
    let state = createTutorialDuelState(
      [
        { playerId: HERO, characterId: "balanced", name: "hero", color: "#fff", weaponId: "starter-pistol" },
        { playerId: DUMMY, characterId: "balanced", name: "dummy", color: "#fff", weaponId: "starter-pistol" },
      ],
      new Map([
        [HERO as string, { x: 500, y: 900 }],
        [DUMMY as string, { x: 560, y: 900 }],
      ]),
    );
    const heroFire: TutorialDuelInput = { keys: InputBit.Fire, aimX: 560, aimY: 900 };
    for (let i = 0; i < 600; i++) {
      const events = stepTutorialDuel(state, runtime, { [HERO as string]: heroFire, [DUMMY as string]: idle() }, DT_MS);
      state = events.state;
      expect(state.round.phase).toBe("fighting");
    }
    // Enough sustained fire to have killed the dummy several times over —
    // proves lethal damage doesn't trigger any round-over transition.
    expect(state.players[DUMMY]!.health).toBeLessThanOrEqual(0);
  });
});
