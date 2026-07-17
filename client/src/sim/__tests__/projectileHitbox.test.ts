// Regression gate: projectile.ts (and fire.ts) used to build the player's
// COMBAT hitbox as a hand-rolled 36×36 square (`PLAYER_RADIUS = 18`,
// independently duplicated in three files), while the REAL body — the same
// box movement collision has always used — is 26 wide × 56 tall (38 tall
// crouched), centred on player.x/y. The square was 20px shorter than the
// standing body: a shot that visually landed on the head or feet (the outer
// ~36% of the character's real vertical profile) missed outright. Fixed by
// routing both through player.ts's playerHitboxAABB, the same box movement
// already uses. Headshots (2026-07-15 design ask): a slight damage boon for
// landing in the real head zone, now that the hitbox actually reaches it.

import { describe, expect, test } from "bun:test";
import { spawnProjectile, stepProjectile } from "../projectile.js";
import { HEADSHOT_DAMAGE_MULTIPLIER } from "../player.js";
import { EntityId, InputSeq, PlayerId, Tick } from "../types.js";
import type { PlayerEntity, SimEvent } from "../types.js";

const DT_MS = 1000 / 60;

function mkPlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("victim"),
    characterId: "balanced",
    x: 200,
    y: 300,
    vx: 0,
    vy: 0,
    aimX: 300,
    aimY: 300,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

/** Fire a fast horizontal shot at `originY` toward the victim and run ticks
 *  until it either hits or clearly sails past (spatial timeout, not a tick
 *  count guess) — returns the hit-confirmed event, or null if it never hit. */
function fireHorizontalAt(
  players: Record<PlayerId, PlayerEntity>,
  originY: number,
): SimEvent | null {
  let proj = spawnProjectile(EntityId(1), {
    ownerId: PlayerId("shooter"),
    origin: { x: 60, y: originY },
    aimAngle: 0, // straight +x
    speed: 900,
    damage: 20,
    lifetimeMs: 3000,
  });
  let rngState = 1;
  let tick = 0;
  while (proj.x < 400 && tick < 60) {
    const result = stepProjectile(proj, {
      platforms: [],
      players,
      dtMs: DT_MS,
      tick: Tick(tick),
      rngState,
    });
    rngState = result.rngState;
    const hit = result.events.find((e) => e.t === "hit-confirmed");
    if (hit) return hit;
    if (result.expired || !result.projectile) return null;
    proj = result.projectile;
    tick += 1;
  }
  return null;
}

describe("projectile hit detection — real body hitbox (regression)", () => {
  test("a shot at the top of a standing player's real body (outside the old 36x36 square) now hits", () => {
    // Standing body spans y 272..328 (300 ± 28). The old square only spanned
    // 282..318 — y=275 was a real, visible hit that used to miss outright.
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 275);
    expect(hit).not.toBeNull();
  });

  test("a shot at the bottom (feet) of a standing player's real body now hits", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 325);
    expect(hit).not.toBeNull();
  });

  test("a shot clearly above the head still misses (the fix isn't an unbounded hitbox)", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 250);
    expect(hit).toBeNull();
  });

  test("a shot clearly below the feet still misses", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 350);
    expect(hit).toBeNull();
  });

  test("a shot to the torso (well within both old and new hitboxes) still hits, as before", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 305);
    expect(hit).not.toBeNull();
  });
});

describe("headshots — slight damage boon", () => {
  test("a hit in the head zone is flagged headshot and deals boosted damage", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 275); // near the top of the head zone
    expect(hit).not.toBeNull();
    if (hit?.t !== "hit-confirmed") throw new Error("expected hit-confirmed");
    expect(hit.headshot).toBe(true);
    expect(hit.damage).toBeCloseTo(20 * HEADSHOT_DAMAGE_MULTIPLIER, 5);
  });

  test("a hit to the torso is NOT a headshot and deals base damage", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    const hit = fireHorizontalAt(players, 305);
    expect(hit).not.toBeNull();
    if (hit?.t !== "hit-confirmed") throw new Error("expected hit-confirmed");
    expect(hit.headshot).toBe(false);
    expect(hit.damage).toBe(20);
  });

  test("the head zone follows crouch height — a shot that's a headshot standing may not be while crouched", () => {
    // Standing: head zone top 272, threshold ~289.9 (272 + 0.32*56).
    // Crouching: box 281..319 (300 ± 19), threshold ~293.2 (281 + 0.32*38).
    // y=291 is a headshot crouched (291 < 293.2) but NOT standing (291 > 289.9).
    const standing = { [PlayerId("victim")]: mkPlayer({ crouching: false }) };
    const standingHit = fireHorizontalAt(standing, 291);
    expect(standingHit).not.toBeNull();
    if (standingHit?.t !== "hit-confirmed") throw new Error("expected hit-confirmed");
    expect(standingHit.headshot).toBe(false);

    const crouching = { [PlayerId("victim")]: mkPlayer({ crouching: true }) };
    const crouchHit = fireHorizontalAt(crouching, 291);
    expect(crouchHit).not.toBeNull();
    if (crouchHit?.t !== "hit-confirmed") throw new Error("expected hit-confirmed");
    expect(crouchHit.headshot).toBe(true);
  });

  test("explosive AOE splash damage never grants a headshot bonus", () => {
    const players = { [PlayerId("victim")]: mkPlayer() };
    // spawnProjectile() doesn't thread impact/impactRadiusPx through (it's
    // a straight-shot-only convenience factory) — build the entity directly
    // so this projectile is genuinely explosive, not a disguised direct hit.
    let proj: import("../types.js").ProjectileEntity = {
      ...spawnProjectile(EntityId(1), {
        ownerId: PlayerId("shooter"),
        origin: { x: 60, y: 275 }, // would be a headshot line for a direct hit
        aimAngle: 0,
        speed: 900,
        damage: 20,
        lifetimeMs: 3000,
      }),
      impact: "explosive",
      impactRadiusPx: 60,
    };
    let rngState = 1;
    let hit: SimEvent | undefined;
    for (let tick = 0; tick < 60 && proj.x < 400 && !hit; tick++) {
      const result = stepProjectile(proj, {
        platforms: [],
        players,
        dtMs: DT_MS,
        tick: Tick(tick),
        rngState,
      });
      rngState = result.rngState;
      hit = result.events.find((e) => e.t === "hit-confirmed");
      if (result.expired || !result.projectile) break;
      proj = result.projectile;
    }
    expect(hit).toBeDefined();
    if (hit?.t !== "hit-confirmed") throw new Error("expected hit-confirmed");
    expect(hit.headshot).toBeFalsy();
  });
});
