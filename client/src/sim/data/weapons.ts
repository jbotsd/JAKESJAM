// Weapon definitions. Pure data. Lives in sim/ so authority + prediction
// share one source of truth for base weapon stats.

import type { ClassId, WeaponDefinition } from "./cardTypes.js";
import {
  SYZ_TENDRIL_COUNT,
  SYZ_TENDRIL_DAMAGE,
  SYZ_TENDRIL_SPEED,
  SYZ_TENDRIL_LIFETIME_SECONDS,
  SYZ_TENDRIL_SPREAD_RADIANS,
  SYZ_TENDRIL_HOMING_STRENGTH,
} from "../constants.js";

export const starterWeapon: WeaponDefinition = {
  id: "starter-pistol",
  name: "Crystal Blaster / Scrap Rifle",
  weaponClass: "baseline",
  // TRUE hitscan (2026-07-20, Jake: "no real hhiscan please" — real, not the
  // fast-projectile shortcut). Resolved same-tick, no ProjectileEntity, via
  // World.ts's `resolveHitscanShot` + `resolveRangedHit` — see weapon.ts's
  // `HitscanPelletSpec` doc comment for the full call chain. Every other
  // consumer of "raycast" delivery (weaponBuild.ts's `applyDeliveryFeel`,
  // e.g. the "Raycast Prism" card) already re-tunes speed/lifetime/range for
  // this value; those numbers are now simply UNUSED by the wizard's own hit
  // resolution (it never reads speed/lifetime), but `rangePx`'s floor bump
  // (880, from that same function) still applies and IS read — it's the
  // hitscan's actual max trace distance.
  delivery: "raycast",
  // Bumped 10->12 (balance audit): round-1, pre-card duels sat at a
  // 10-shot/2.25s sustained TTK — spongy next to the genre (Duck
  // Game/Towerfall are one-hit; Stick Fight is 3-5 hits). 12 dmg = 8
  // shots/~1.75s, snappier without touching card-curve pacing (the max
  // damage-stack path stays well clear of the 1.5s TTK guardrail).
  damage: 12,
  fireRate: 4,
  magazineSize: 8,
  reloadSeconds: 1.1,
  // REVERTED speed bump attempt (2026-07-20). Jake asked "is it faster and
  // more shot like" — tried 950, then 800, then even a modest 700 (~8% over
  // baseline): ALL THREE broke ninjaCatalog.test.ts's decoy sub-lethal-hit
  // case IDENTICALLY (the decoy takes zero damage across a 30-tick budget,
  // not partial/rare — a clean binary threshold, not a gradual tunneling
  // risk that scales with speed). Only the exact original 650 passes. That
  // rules out my first hypothesis (simple per-tick tunneling margin) — this
  // looks like a real, pre-existing fragility in how projectile-vs-entity
  // overlap resolves against a fast-closing target within the fixed-tick
  // pipeline (ordering/staleness of positions, not raw distance), not
  // something a "safer" speed number sidesteps. Left at 650 (known-good)
  // rather than shipping an unverified value; the collision path itself
  // needs a real investigation (or a proper swept/continuous check) before
  // this speed can safely move, which is a bigger change than this pass.
  projectileSpeed: 650,
  projectileLifetimeSeconds: 1.2,
  spreadRadians: 0.03,
  recoilImpulse: 95,
  knockbackImpulse: 120,
  projectile: {
    // Reverted "shard" attempt (2026-07-20) — `shape` is Zig/TS ABI-packed
    // (weaponBuildParity.test.ts), not a pure render hint. The wizard's
    // elongated-dart bullet is instead an ELEMENT-driven override in
    // ProjectileVfx.drawBody (element === "crystal"), so this stays
    // "hexagon" and the ABI is untouched.
    shape: "hexagon",
    count: 1,
    rangePx: 720,
    speedMultiplier: 1,
    sizeMultiplier: 1,
    recoilMultiplier: 1,
    pathing: "straight",
    element: "crystal",
    impact: "none",
    lifetimeMultiplier: 1,
    gravityScale: 0,
    homingStrength: 0,
    accelerationMultiplier: 0,
    bounces: 0,
    impactRadiusPx: 0,
    pierceCount: 0,
    splitCount: 0,
    slowMultiplier: 1,
  },
};

/**
 * Wizard / Geometrician baseline (2026-07-22, Jake, live playtest: wants the
 * hitscan basic attack changed back to a projectile). `starterWeapon` above
 * is still shared by Ninja (`baseWeaponForClass` has no ninja entry —
 * classExpression.test.ts's own object-identity assertion), so flipping
 * `starterWeapon.delivery` itself would silently revert Ninja's gun too.
 * Same override pattern as `priestStarterWeapon`/`paladinStarterWeapon`
 * below: same wire id, same stats, ONLY `delivery` diverges — Wizard fires a
 * real `ProjectileEntity` again (travel time, dodgeable) instead of an
 * instant same-tick raycast. `applyDeliveryFeel`'s raycast branch no longer
 * applies, so the base 650/1.2s/720px numbers (already balance-tested pre-
 * hitscan, see the speed-bump-revert comment above) govern the shot as-is —
 * no retuning needed.
 */
export const wizardStarterWeapon: WeaponDefinition = {
  ...starterWeapon,
  delivery: "projectile",
};

/**
 * Priest / Syzygist baseline (docs/classes-goal.md "Priest / Syzygist":
 * "Baseline attack: modest projectile (wizard's starter, detuned)"; docs/
 * class-overhaul-workboard.md chunk 0.3). Started as a copy of
 * `starterWeapon` with damage cut from 12 to 9 (25% detune) — REWORKED
 * 2026-07-19 into "oozing tendrils of fire" (constants.ts's SYZ_TENDRIL_*
 * doc comment has the full design rationale) after the original basic-fire
 * ramping-channel mechanic got reassigned to Wizard mid-session. Same
 * hexagon shape, same fire rate as `starterWeapon` — the identity now lives
 * in the projectile config: SYZ_TENDRIL_COUNT small homing, fire-element
 * shards per shot instead of one straight crystal bolt, each individually
 * weaker (SYZ_TENDRIL_DAMAGE × SYZ_TENDRIL_COUNT === the old single-shot 9,
 * so a volley that lands every tendril is total-damage parity, not a buff —
 * see the constants.ts comment for the full bookkeeping), slower
 * (SYZ_TENDRIL_SPEED, well under starterWeapon's 650) with a longer fuse
 * (SYZ_TENDRIL_LIFETIME_SECONDS) to keep effective range comparable despite
 * the lower speed. Neutral TTK if every tendril of every volley connects is
 * unchanged from the pre-rework figure (~2.78s, same 9-damage/4rps math),
 * still comfortably inside the 1.8-3.5s combat-balance-ttk band
 * (weaponBuild.ts TTK_FLOOR_S/TTK_CEILING_S) — this weapon is intentionally
 * excluded from that band's own iterated test (weaponBuild.test.ts only
 * walks the class-blind `weapons` export below, never this one, same as
 * before the rework) since a per-tendril hit-or-miss weapon doesn't reduce
 * to one clean number the way a single-shot gun does; classExpression.test.ts
 * still asserts it's a real, lower-damage, same-shape gun. The honest cost
 * of a kit whose real power lives in curses + lifesteal, not the bolt.
 * Keeps the SAME wire id ("starter-pistol") — this is a base-STAT reskin
 * selected by class, not a second weapon slot — so it never appears in the
 * `weapons` export below (weaponDataParity.test.ts asserts
 * `weapon_count() === 1`; that Zig-side count is unaffected, since Zig only
 * ever sees the packed, already-class-resolved fire config — see
 * sim/src/world.zig's "parity with the TS orchestrator's resolvePlayerBuild"
 * comment — and never mirrored the channel ramp OR the tendril rework:
 * both are TS-only combat/projectile state, confirmed by grepping the Zig
 * sim source for either mechanic before this rework).
 */
export const priestStarterWeapon: WeaponDefinition = {
  ...starterWeapon,
  // Explicit override, NOT inherited (2026-07-20) — `starterWeapon.delivery`
  // is now `"raycast"` for the wizard's true-hitscan basic attack, but this
  // weapon's whole identity is homing tendrils, which need real travel time
  // to curve in. Without this override, the `...starterWeapon` spread would
  // silently inherit raycast delivery too, and weaponBuild.ts's own
  // `applyDeliveryFeel` would force this tendril's speed 320→1024px/s
  // (3.2x) and lifetime 2.6s→0.91s (0.35x) — inverting the entire "slower
  // because it's homing, longer fuse to compensate" balance below.
  delivery: "projectile",
  damage: SYZ_TENDRIL_DAMAGE,
  projectileSpeed: SYZ_TENDRIL_SPEED,
  projectileLifetimeSeconds: SYZ_TENDRIL_LIFETIME_SECONDS,
  spreadRadians: SYZ_TENDRIL_SPREAD_RADIANS,
  projectile: {
    ...starterWeapon.projectile,
    count: SYZ_TENDRIL_COUNT,
    pathing: "homing",
    element: "fire",
    homingStrength: SYZ_TENDRIL_HOMING_STRENGTH,
  },
};

/**
 * Paladin/Kindled baseline (class-overhaul-workboard.md chunk 2.5,
 * docs/classes-goal.md "E-KEY RULING": the ultimate IS the composed
 * Emission through the resolved build). Kindled Edge REPLACES this weapon
 * entirely for Paladin's actual Fire input (World.ts: "Ninja/Paladin: Fire
 * is the SAME 'primary attack' input as every other class, but the chassis
 * verb is a melee arc... this branch captures the rising edge for loop 2's
 * FSM instead of ever calling stepWeapon") — so `paladinStarterWeapon`'s
 * ONLY live consumer is `resolveEmission` (verified class-aware wiring,
 * emissionClassAware.test.ts / 0.2), which reads the resolved build
 * regardless of whether the chassis ever fires it conventionally. A copy
 * of `starterWeapon` re-tuned toward "heavier, slower, bigger" — the task
 * brief's explicit "heavier/tankier cast" ask — rather than the wizard's
 * fast/light bolt: damage 12→15, fireRate 4→3 (TTK stays inside the
 * combat-balance-ttk band: 100/(15×3)≈2.22s, same neighbourhood as
 * starterWeapon's ~2.08s — weaponBuild.ts's TTK_FLOOR_S/TTK_CEILING_S,
 * verified even though Paladin never actually fires this weapon, the same
 * "still a real, functional gun" discipline priestStarterWeapon's own test
 * applies), projectileSpeed 650→520 (a heavier bolt arrives slower),
 * sizeMultiplier 1→1.15 (reads bigger). Same SAME-wire-id contract as
 * priestStarterWeapon (never appears in the `weapons` export below;
 * weaponDataParity.test.ts's `weapon_count() === 1` is unaffected).
 */
export const paladinStarterWeapon: WeaponDefinition = {
  ...starterWeapon,
  // Explicit override, NOT inherited (2026-07-20) — same reasoning as
  // priestStarterWeapon's own override above. Paladin never actually fires
  // this weapon conventionally (Kindled Edge replaces Fire's chassis verb),
  // but `resolveEmission` still resolves it as a real build, and the "still
  // a real, functional gun" discipline this weapon's own doc comment already
  // holds it to means its delivery shouldn't silently drift just because the
  // shared base weapon's did.
  delivery: "projectile",
  damage: 15,
  fireRate: 3,
  projectileSpeed: 520,
  projectile: { ...starterWeapon.projectile, sizeMultiplier: 1.15 },
};

/**
 * Class-gated base-weapon selection. Same doctrine as `classModifiers` on
 * CardDefinition (cardTypes.ts header: "REPLACES wholesale... class-blind
 * fallback is total and silent-by-design") applied one level up — to the
 * WEAPON a class starts with, since the baseline has no card in hand to
 * hang a `classModifiers` entry off. Omitted/unknown class or any class
 * with no authored entry here falls back to `starterWeapon`, byte-identical
 * to every existing call site that resolves a class-blind build today.
 * Ninja deliberately has NO entry here (classExpression.test.ts's own
 * "baseWeaponForClass falls back to starterWeapon for Ninja" asserts
 * object-identity equality, not just same stats) — Ninja still shares
 * `starterWeapon`'s raycast/hitscan basic gun untouched. Wizard split off
 * into its own `wizardStarterWeapon` entry 2026-07-22 (see that weapon's own
 * doc comment) specifically so Geometrician's basic attack could revert to
 * a real projectile without dragging Ninja's back with it.
 */
const CLASS_BASE_WEAPON: Partial<Record<ClassId, WeaponDefinition>> = {
  wizard: wizardStarterWeapon,
  priest: priestStarterWeapon,
  paladin: paladinStarterWeapon,
};

export function baseWeaponForClass(classId?: ClassId): WeaponDefinition {
  if (classId) {
    const override = CLASS_BASE_WEAPON[classId];
    if (override) return override;
  }
  return starterWeapon;
}

export const weapons = [starterWeapon] as const;
