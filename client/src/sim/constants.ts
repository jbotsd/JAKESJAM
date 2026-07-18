export const STEP_MS = 1000 / 60;

/**
 * Smallest platform height (px) we can author. Sub-stepping in stepPlayer
 * uses 0.6× this as the per-sub-step max displacement so the swept sweep
 * never has to span a thin platform in a single integration. 12 px is
 * generous — boxworks-mini's thinnest platform is 18 px.
 */
export const MIN_PLATFORM_H_PX = 12;
// Snapshot every 3rd sim tick — 20Hz authoritative state to clients.
//
// History: this was 1 (60Hz) while remote players rendered RAW snapshot
// positions — per-tick snapshots were masking the missing entity
// interpolation. Now that ClientLoop renders remotes from interpolation
// buffers ~100ms in the past (2 snapshot intervals at 20Hz), per-tick
// snapshots buy nothing visually and cost a LOT:
//   - client: applySnapshot runs hash-compare + structuredClone + full
//     rewind/replay per snapshot — at 60Hz this saturated slower machines
//     and inflated measured RTT (pongs queue behind snapshot processing).
//   - server: per-client AOI filter + delta encode per tick.
// 20Hz is the standard band for fast shooters (CS2 servers run 64-tick
// sim with lower-rate client updates; Fortnite/Apex send ~20-30Hz).
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_INTERVAL_TICKS = 3;

// ============================================================
// B2 prep — sim-level tuning constants extracted from sim/*.ts
// modules. The render layer + UI consume these directly; the sim
// modules also re-export them. When B2 deletes the sim modules,
// the re-exports go via this file.
//
// Keep the *exact* numeric values; if you tune them, the sim's
// behaviour changes — this is shared state with the wasm sim.
// ============================================================

// combat.ts
export const PARRY_ACTIVE_MS = 420;
export const PARRY_COOLDOWN_MS_DEFAULT = 1800;
export const PARRY_ARC_RADIANS = Math.PI / 3;
export const SHIELD_MAX_CHARGE_DEFAULT = 100;
export const SHIELD_DRAIN_PER_SECOND = 35;
export const SHIELD_RECHARGE_PER_SECOND = 14;
export const SHIELD_HIT_DRAIN_MULTIPLIER = 1.8;

// Stolen Fangs (legendary defense card, cards.ts id "stolen-fangs")
export const STOLEN_FANGS_MAX_CHARGES = 2;
export const STOLEN_FANGS_CHARGE_EXPIRY_MS = 4000;
export const STOLEN_FANGS_HOMING_STRENGTH = 5.0;
export const STOLEN_FANGS_DAMAGE_MULTIPLIER = 0.75;

// Emission Engine (docs/emission-engine-goal.md) — charge economy.
// abilityCharge fills from combat participation only (no passive trickle):
// dealt is the primary source, taken the lesser. Full bar ≈ ~200 damage
// dealt at the 0.5 rate (less in a real fight — taken-side fill mixes in).
// Charge persists through death and across rounds
// (respawnAll spreads the player and deliberately does not touch it);
// resets only at match creation (spawn sites init 0). Phase 3 of the goal
// owns retuning these numbers — do not tweak casually, the state hash
// mixes abilityCharge so TS and the opt-in Zig world must move together.
export const EMISSION_CHARGE_MAX = 100;
export const EMISSION_FILL_PER_DAMAGE_DEALT = 0.5;
export const EMISSION_FILL_PER_DAMAGE_TAKEN = 0.2;

// Drafted actives (docs/six-axes-goal.md Layer 2). Card data owns
// cooldown/duration (cards.ts `active` specs); sim effect magnitudes live
// here. The tune pass edits data, never logic (goal elegance bar).
export const ABILITY_TITHE_LEECH_FRACTION = 0.5;
export const ABILITY_STEP_RANGE_PX = 240;
export const ABILITY_COUNTER_RETURN_CAP = 35;

// Geometrician catalog v1 (docs/class-ability-catalogs-v1.md — the wizard's
// 10-ability class catalog, docs/classes-goal.md "Rotation system"). Each
// ability is a real, working v1 that reuses six-axes Layer 2 substrate as
// hard as possible (window buffs on the existing PlayerEntity tick-field
// pattern, the existing spawnProjectile burst shape, the existing ward
// shell); doc-spec fidelity gaps (true charge-hold, a persisting lattice
// plane, parry-hooked refunds) are RECORDED deferrals, same discipline as
// six-axes Phase 3's Shelter Seal fallback — never silently invented, never
// stubbed to a no-op. classId-gated to wizard only (round.ts enterDrafting);
// other chassis see zero catalog-sourced offers until their own catalogs are
// authored (classes-goal.md P2-P4).
export const GEO_SUNLANCE_DAMAGE_MULTIPLIER = 1.6;
export const GEO_FACET_BREAK_AMP_MULTIPLIER = 1.25;
export const GEO_FACET_BREAK_RANGE_PX = 900;
/** Half-cone width is half of this — mirrors combat.ts's PARRY_ARC_RADIANS
 *  convention (full arc constant, halved at the check site). */
export const GEO_FACET_BREAK_CONE_RADIANS = (60 * Math.PI) / 180;
export const GEO_PRISM_FAN_COUNT = 5;
export const GEO_PRISM_FAN_CONE_RADIANS = (50 * Math.PI) / 180;
export const GEO_PRISM_FAN_DAMAGE_MULTIPLIER = 0.5;
export const GEO_LATTICE_COUNT = 8;
export const GEO_LATTICE_DAMAGE_MULTIPLIER = 0.35;
export const GEO_LATTICE_RANGE_PX = 260;
export const GEO_RETURN_GLASS_SHIELD_REFUND = 22;
export const GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER = 1.35;
export const GEO_OVERCLOCK_SPREAD_MULTIPLIER = 0.7;
export const GEO_SLIP_NODE_RANGE_PX = 280;
export const GEO_RECOIL_STEP_HOP_SPEED = 220;

// Resonance (docs/classes-goal.md "Rotation system" — class-overhaul-
// workboard.md chunk 0.1: "chain unlike abilities for a bonus"). Every
// successful ability activation (six-axes Layer 2 actives above AND the
// Geometrician catalog v1 — same `active.kind` switch in World.ts) opens a
// resonance window naming itself. Casting a DIFFERENT kind while that
// window is still live consumes it for a bonus; the v1 bonus shape (picked
// from the three the design doc offers — empowered effect / CD refund /
// emission rider) is a flat fractional discount off the CONSUMING ability's
// own freshly-computed cooldown. Chosen because it's the only shape that
// applies uniformly to all 15 kinds without a bespoke per-case "empowered"
// branch in each switch arm (would 15x the surface area of this v1) and is
// trivially assertable in a test (compare the resulting cooldown tick to
// the un-resonated baseline). Casting the SAME kind again never resonates
// — "chain UNLIKE abilities" excludes same-ability spam by construction
// (see World.ts's activation block + resonanceUntilTick's field comment in
// types.ts for the exact check).
export const RESONANCE_WINDOW_MS = 2000;
export const RESONANCE_CD_REFUND_FRACTION = 0.3;

// Mid-round respawn (Jake ruled "A", 2026-07-17, reverting the venue-era
// bench-until-bell): death costs a short fixed delay, then you're back at
// a spawn seal — EXCEPT in sudden death, where last-one-standing is the
// whole point (design-pillars "money moment"). Arena ADMISSION stays
// boundary-only (venue-goal pillar 3 — that rule was always about joiners).
export const RESPAWN_DELAY_MS = 3000;

// satellite.ts
export const ORBIT_RADIUS_PX = 80;
export const ORBIT_RAD_PER_SEC = Math.PI / 1.5;
export const SATELLITE_FIRE_COOLDOWN_MS = 600;
export const SATELLITE_DAMAGE = 4;
export const SATELLITE_PROJECTILE_SPEED = 540;
export const SATELLITE_PROJECTILE_LIFETIME_MS = 700;
export const SATELLITE_PROJECTILE_RADIUS = 4;

// player.ts
export const KILL_PLANE_MARGIN_PX = 200;
export const JETPACK_MAX_FUEL = 125;
export const JETPACK_THRUST = 1480;
export const JETPACK_FUEL_DRAIN_PER_SECOND = 32;
export const JETPACK_GROUND_RECHARGE_PER_SECOND = 64;
export const JETPACK_AIR_RECHARGE_PER_SECOND = 10;
export const JETPACK_MIN_UPWARD_VELOCITY = -640;

// destructible.ts
export const EXPLOSION_RADIUS = 80;
export const EXPLOSION_DAMAGE = 28;
export const FIRE_PATCH_DEFAULT_LIFETIME_MS = 1800;
export const FIRE_PATCH_DEFAULT_RADIUS = 36;
export const FIRE_PATCH_DEFAULT_DPS = 14;
