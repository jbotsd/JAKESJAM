// Wizard basic-fire ramping channel (weapon.ts stepWeaponNative,
// constants.ts's GEO_CHANNEL_RAMP_MS doc comment has the full design
// rationale). RELOCATED from Priest to Wizard 2026-07-19 — Jake's redirect:
// "the wizards hould have ramping fire rate to feel more glass canony."
// (File renamed from priestChannelWeapon.test.ts; the mechanic itself is
// otherwise a pure class-relabel — same shape, same numbers, only the
// gating class and the constant names moved. Priest's basic fire is now
// the unrelated "oozing tendrils" mechanic — see priestTendrilWeapon.test.ts
// for its own coverage, INCLUDING the reverse-direction regression proof
// that Priest/Ninja/Paladin stay byte-identical to the wizard-only ramp.)
// Locked direction: holding Fire continuously fires (unchanged — stepWeapon
// already re-fires on cooldown expiry while held), and WIZARD'S fire-rate
// ramps 1.0x -> GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX the longer Fire
// has been held on one continuous press, resetting the instant Fire
// releases. Every other class must be completely unaffected — the single
// most important regression this suite proves.

import { describe, test, expect } from "bun:test";
import { stepWeapon, resolvePlayerBuild } from "../weapon.js";
import {
  GEO_CHANNEL_RAMP_MS,
  GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX,
} from "../constants.js";
import { EntityId, InputSeq, type PlayerEntity, type PlayerId } from "../types.js";

const DT_MS = 1000 / 60;

function mkPlayer(over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: "p1" as PlayerId,
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
    aimY: 0,
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
    ...over,
  };
}

/** Hold Fire continuously for `totalMs`, feeding the returned player state
 *  back in tick after tick (exactly how World.ts drives stepWeapon while
 *  the input bit stays down). Returns every tick where `fired === true`,
 *  in order, with the tick's elapsed-ms-since-start stamped on. */
function holdFire(
  start: PlayerEntity,
  totalMs: number,
): { player: PlayerEntity; firedAtMs: number[]; damages: number[]; elements: string[] } {
  let nextId = 1;
  let player = start;
  const firedAtMs: number[] = [];
  const damages: number[] = [];
  const elements: string[] = [];
  let elapsed = 0;
  while (elapsed < totalMs) {
    const result = stepWeapon(player, true, { x: player.x + 500, y: player.y }, DT_MS, () =>
      EntityId(nextId++),
    );
    player = result.player;
    elapsed += DT_MS;
    if (result.fired) {
      firedAtMs.push(elapsed);
      // Wizard's basic shot is true hitscan again (THE GEOMETRICIAN RULING,
      // 2026-07-24, weapons.ts), so collect from BOTH branches — pellets for
      // the raycast wizard, projectiles for the non-wizard control classes —
      // keeping the card-modifier assertions below real (never vacuously
      // green over an empty array) regardless of delivery.
      for (const proj of result.projectiles) {
        damages.push(proj.damage);
        elements.push(proj.element as string);
      }
      for (const pellet of result.hitscanPellets) {
        damages.push(pellet.damage);
        elements.push(pellet.element as string);
      }
    }
  }
  return { player, firedAtMs, damages, elements };
}

describe("Wizard channel ramp: class gating (the critical regression)", () => {
  // shielded=priest, sprinter=ninja, heavy=paladin (cardTypes.ts
  // ARCHETYPE_CLASS_ID) — every archetype EXCEPT wizard's own "balanced".
  const NON_WIZARD_CLASSES: PlayerEntity["characterId"][] = ["shielded", "sprinter", "heavy"];

  for (const characterId of NON_WIZARD_CLASSES) {
    test(`${characterId}: a single fire tick is byte-identical to the pre-channel formula`, () => {
      const player = mkPlayer({ characterId });
      const build = resolvePlayerBuild(player);
      let nextId = 1;
      const result = stepWeapon(player, true, { x: 500, y: 0 }, DT_MS, () => EntityId(nextId++));
      expect(result.fired).toBe(true);
      // Cooldown formula is EXACTLY build.fireRate — no channel multiplier
      // (chaos/overclock/haste are all neutral/absent here too).
      expect(result.player.fireCooldownMs).toBeCloseTo(1000 / build.fireRate, 10);
      // sprinter (ninja) shares Wizard's exact base-weapon object
      // (weapons.ts's `CLASS_BASE_WEAPON` deliberately has no ninja entry —
      // classExpression.test.ts asserts this by identity), so true hitscan
      // (2026-07-20) reaches it too: it fires via `hitscanPellets`, not
      // `projectiles`. shielded (priest) and heavy (paladin) both keep an
      // explicit `delivery: "projectile"` override, so they're unaffected.
      const dealtDamage =
        characterId === "sprinter" ? result.hitscanPellets[0]!.damage : result.projectiles[0]!.damage;
      expect(dealtDamage).toBe(build.damage);
      // The new field must never be written for a non-wizard class.
      expect(result.player.channelHoldMs).toBeUndefined();
    });

    test(`${characterId}: holding Fire for 3s never ramps fire rate (shot cadence stays flat)`, () => {
      const player = mkPlayer({ characterId });
      const { firedAtMs, player: finalPlayer } = holdFire(player, 3000);
      expect(firedAtMs.length).toBeGreaterThan(2);
      const intervals: number[] = [];
      for (let i = 1; i < firedAtMs.length; i += 1) {
        intervals.push(firedAtMs[i]! - firedAtMs[i - 1]!);
      }
      const first = intervals[0]!;
      const last = intervals[intervals.length - 1]!;
      // Flat cadence: last interval must be the same as the first (within
      // one tick's quantisation), never shrinking the way wizard's does.
      expect(Math.abs(last - first)).toBeLessThanOrEqual(DT_MS + 0.01);
      expect(finalPlayer.channelHoldMs).toBeUndefined();
    });
  }
});

describe("Wizard channel ramp: the ramp itself", () => {
  function wizardPlayer(over: Partial<PlayerEntity> = {}): PlayerEntity {
    return mkPlayer({ characterId: "balanced", ...over });
  }

  test("holding Fire continuously fires repeatedly with no discrete per-press gate", () => {
    const player = wizardPlayer();
    const { firedAtMs } = holdFire(player, 2500);
    // starterWeapon fireRate = 4/s baseline -> at LEAST ~10 shots in 2.5s
    // even before any ramp kicks in; the ramp only ever speeds this up.
    expect(firedAtMs.length).toBeGreaterThanOrEqual(9);
  });

  test("shot cadence measurably speeds up the longer Fire is held, and the ramp is bounded by the documented ceiling", () => {
    const player = wizardPlayer();
    const build = resolvePlayerBuild(player);
    const baselineIntervalMs = 1000 / build.fireRate;
    const rampedIntervalMs = baselineIntervalMs / GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX;

    const { firedAtMs } = holdFire(player, GEO_CHANNEL_RAMP_MS + 1500);
    const intervals: number[] = [];
    for (let i = 1; i < firedAtMs.length; i += 1) {
      intervals.push(firedAtMs[i]! - firedAtMs[i - 1]!);
    }
    const firstInterval = intervals[0]!;
    const lastInterval = intervals[intervals.length - 1]!;

    // First shot-to-shot gap is (close to) the unramped baseline cooldown —
    // "close to" because the cooldown gate only resolves once per tick, so
    // the measured gap is quantised up to the next DT_MS multiple.
    expect(Math.abs(firstInterval - baselineIntervalMs)).toBeLessThanOrEqual(DT_MS + 1);
    // Later, fully-ramped gap is measurably shorter than the first...
    expect(lastInterval).toBeLessThan(firstInterval);
    // ...and converges on the documented ceiling (1/GEO_CHANNEL_RAMP_FIRE_
    // RATE_MULTIPLIER_MAX x the baseline), never firing FASTER than the
    // ceiling allows (a full tick of quantisation slack either side).
    expect(lastInterval).toBeGreaterThanOrEqual(rampedIntervalMs - 1);
    expect(lastInterval).toBeLessThanOrEqual(rampedIntervalMs + DT_MS + 1);
  });

  test("releasing Fire resets the ramp instantly; re-holding starts back at baseline cadence", () => {
    let nextId = 1;
    const fire = (player: PlayerEntity, requested: boolean) =>
      stepWeapon(player, requested, { x: player.x + 500, y: player.y }, DT_MS, () =>
        EntityId(nextId++),
      );

    let player = wizardPlayer();
    const build = resolvePlayerBuild(player);
    const baselineIntervalMs = 1000 / build.fireRate;

    // Hold long enough to reach full ramp.
    let elapsed = 0;
    let lastFireGapMs = 0;
    let sinceLastFire = 0;
    while (elapsed < GEO_CHANNEL_RAMP_MS + 600) {
      const result = fire(player, true);
      player = result.player;
      elapsed += DT_MS;
      sinceLastFire += DT_MS;
      if (result.fired) {
        lastFireGapMs = sinceLastFire;
        sinceLastFire = 0;
      }
    }
    expect(player.channelHoldMs).toBeGreaterThan(0);
    // Confirms we actually reached a ramped cadence before release.
    expect(lastFireGapMs).toBeLessThan(baselineIntervalMs - 5);

    // Release for one tick — the channel must drop instantly.
    const released = fire(player, false);
    player = released.player;
    expect(player.channelHoldMs).toBeUndefined();

    // Let the cooldown from the last (ramped) shot fully drain while
    // released, so the next fire is gated purely by re-hold behavior, not
    // leftover cooldown.
    while (player.fireCooldownMs > 0) {
      player = fire(player, false).player;
    }
    expect(player.channelHoldMs).toBeUndefined();

    // Re-hold: the very next fire must reset to (essentially) baseline
    // cadence, not resume from the pre-release ramped rate.
    const resumed = fire(player, true);
    expect(resumed.fired).toBe(true);
    expect(Math.abs(resumed.player.fireCooldownMs - baselineIntervalMs)).toBeLessThanOrEqual(
      DT_MS + 1,
    );
  });
});

describe("Wizard channel ramp: card modifiers still fully apply to ramped shots", () => {
  test("Molten Core's element/impact-radius modifier survives on shots fired deep into the ramp", () => {
    const player = mkPlayer({ characterId: "balanced", cards: ["molten-core"] });
    const build = resolvePlayerBuild(player);
    expect(build.projectile.element).toBe("fire");
    expect(build.projectile.impactRadiusPx).toBe(42);

    const { firedAtMs, elements, damages } = holdFire(player, GEO_CHANNEL_RAMP_MS + 800);
    expect(firedAtMs.length).toBeGreaterThan(3);
    // Guard against vacuous green: the raycast wizard emits hitscan pellets,
    // and holdFire collects those too — this must never be an empty walk.
    expect(elements.length).toBeGreaterThan(3);
    // Every single shot across the whole hold — including the fully-ramped
    // tail — still carries the card's element. The ramp is a fire-rate
    // multiplier layered on top of the resolved build, never a bypass of
    // the spawnProjectile/ProjectileSpawnParams path the card modifier
    // flows through.
    for (const element of elements) {
      expect(element).toBe("fire");
    }
    for (const damage of damages) {
      expect(damage).toBe(build.damage);
    }
  });

  test("a non-wizard class holding the same card is unaffected by the channel machinery (control)", () => {
    // "heavy" (paladin) rather than "shielded" (priest) — priest's OWN
    // basic fire is separately reworked to a fire-element weapon this same
    // session (priestTendrilWeapon.test.ts), so paladin is the cleaner,
    // fully-untouched-by-either-change control here.
    const player = mkPlayer({ characterId: "heavy", cards: ["molten-core"] });
    const { elements } = holdFire(player, 1500);
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(element).toBe("fire");
    }
  });
});
