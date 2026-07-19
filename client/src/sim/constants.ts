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
// Prism Fan (aoe role rework, 2026-07-18, docs/design-axioms.md A7): was a
// fan of GEO_PRISM_FAN_COUNT discrete projectiles (the "split-spam" pattern
// A7 already named and fixed once in the universal card-pool rework — same
// lever, different numbers, just wearing the aoe tag). Now an instant cone
// radius-check: everyone standing inside the cone at cast time takes the
// hit in one tick, no shard travel. GEO_PRISM_FAN_CONE_RADIANS keeps its
// old 50° width (the "still crystal munitions, just more of the angle"
// identity — a forward-aimed spray, not a 360 nova) and
// GEO_PRISM_FAN_DAMAGE_MULTIPLIER keeps its old value: previously a
// player's aim put the target in at most one shard's narrow path (an
// effectively-single hit despite 5 shards spawning), so a guaranteed
// single hit at the same multiplier is parity, not a buff.
export const GEO_PRISM_FAN_CONE_RADIANS = (50 * Math.PI) / 180;
export const GEO_PRISM_FAN_DAMAGE_MULTIPLIER = 0.5;
export const GEO_PRISM_FAN_RANGE_PX = 260;

// Lattice (aoe role rework, 2026-07-18): the case comment this ability
// shipped with already flagged the gap in its own words — "v1 = an instant
// 360° nova, not the doc's persisting damaging plane" — docs/class-ability-
// catalogs-v1.md's own effect text: "Place a brief damaging lattice plane".
// Tier B fix: a genuine lingering zone, built on the SAME primitive
// `firePatches`/`FireEntity` already provides (radius + damagePerSecond +
// remainingMs, ticked by `stepFirePatches` every tick against anyone
// overlapping, excluding the owner) — no new entity kind, no new Zig ABI
// surface (FireEntity's shape is untouched; this just spawns more instances
// of it). Pure damage, no status — "space denial, angle-first" reads as
// raw area-denial, not a debuff; that was Consecrated Field's job (a
// damage+slow zone, cut 2026-07-19 — see docs/class-ability-catalogs-v1.md's
// cut note), the differentiation axis between the two self-centered
// wizard/paladin zones while it existed. Total damage over a FULL dwell
// (radius × duration × dps) is a flat, build-independent number — matches
// how every other zone in this file (fire hazard) is tuned, a deliberate
// departure from the OLD per-shard build.damage-scaled shape now that the
// hit is guaranteed rather than a probabilistic shard graze.
export const GEO_LATTICE_ZONE_RADIUS_PX = 150;
export const GEO_LATTICE_ZONE_DURATION_MS = 2200;
export const GEO_LATTICE_ZONE_DPS = 11;
export const GEO_RETURN_GLASS_SHIELD_REFUND = 22;
export const GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER = 1.35;
export const GEO_OVERCLOCK_SPREAD_MULTIPLIER = 0.7;
export const GEO_SLIP_NODE_RANGE_PX = 280;
export const GEO_RECOIL_STEP_HOP_SPEED = 220;

/** Basic-fire ramping channel (weapon.ts stepWeaponNative, wizard-only —
 *  RELOCATED from Priest 2026-07-19. Original ask (still the mechanic's own
 *  origin story): "rework the basic priest spell to be more channely...
 *  take effects from cards but its like geometrician rn except with a
 *  better deck." Jake's follow-up redirect moved it: "the wizards hould
 *  have ramping fire rate to feel more glass canony" — Priest's basic fire
 *  is now the unrelated "oozing tendrils" mechanic (SYZ_TENDRIL_* below),
 *  built from the SAME low-aim/self-guiding throughline as Bleed Tithe
 *  instead. Mechanically this block is a pure class-relabel — every number
 *  and every line of behavior is unchanged from the original Priest
 *  version, only `classIdForArchetype(...) === "wizard"` (weapon.ts) and
 *  these two constant names moved.
 *
 *  Design direction (locked): a RAMPING STREAM, not a flat hold-to-stream
 *  and not a charge-then-release — holding Fire continuously fires (no
 *  discrete per-press gate change needed; stepWeapon already re-fires on
 *  cooldown expiry while held), and the longer Fire has been held on ONE
 *  continuous press, the faster the stream ticks. Releasing Fire resets
 *  instantly — "rewards sustained commitment to one target, punishes
 *  flicking between targets."
 *
 *  FIRE-RATE ramp only, no damage ramp — unchanged reasoning from the
 *  original Priest version, now read the other way round: a damage ramp
 *  reads as "charging a shot," which is Sunlance/Overchannel's OWN
 *  charge-and-release identity (docs/card-pool-v2.md's Wizard exclusives —
 *  hold-to-charge, release-for-burst); the BASIC gun ramping fire RATE
 *  instead of damage keeps it a mechanically distinct feel from those two
 *  ability cards even though it now lives on the same chassis, and reads as
 *  "spinning up a stream" rather than duplicating "charging a shot."
 *
 *  Glass-cannon framing (Jake's own words: "feel more glass canony," landed
 *  here 2026-07-19): the mechanic doesn't need an INVENTED drawback like
 *  extra damage taken while channeling — the existing tradeoff already
 *  reads as glass cannon on this chassis. A wizard who commits to holding
 *  Fire on one target is standing still relative to that decision, visibly
 *  telegraphing where the next shot is going, and forfeiting the
 *  flicking-between-targets flexibility every other basic-fire class keeps
 *  — rising output in exchange for growing predictability/exposure IS the
 *  glass-cannon read, made literal in the same input the player already
 *  holds. No separate damage-taken multiplier or defense penalty is added;
 *  that would be a second, redundant drawback bolted onto a mechanic whose
 *  drawback already exists by construction.
 *
 *  GEO_CHANNEL_RAMP_MS: time (holding Fire, ms) to reach max ramp — v1
 *  numeric guess (same "no need to agonize, balance-sim/playtest refines
 *  later" doctrine as every other GEO_/SYZ_/KIN_ constant), landed inside
 *  the "roughly 1.5-2.5s" range considered when this was still Priest's.
 *  GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX: fire-rate multiplier at max
 *  ramp — composes into weapon.ts's fireRate calc exactly like
 *  GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER/hasteFireRateMul (a multiplicative
 *  factor on top of build.fireRate), just driven by continuous-hold
 *  duration (ramping 1.0x → this ceiling) instead of a fixed timed window. */
export const GEO_CHANNEL_RAMP_MS = 2000;
export const GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX = 1.6;

// Kindled catalog v1 (docs/class-ability-catalogs-v1.md — the paladin's
// 10-ability class catalog; class-overhaul-workboard.md chunk 2.6). Same
// substrate-reuse discipline as the Geometrician block above: reuses
// tryDeflectDamage/isBodyInMeleeArc-style scans, the existing slow debuff
// (slowedUntilTick/slowMultiplier) for "stagger", and combat.ts's Ward
// machinery, rather than inventing new mechanics per button. Only 7 of the
// 10 catalog entries are wired this pass — see cardTypes.ts's AbilityKind
// header comment for which three are deferred and why. classId-gated to
// paladin only (round.ts enterDrafting); other chassis see zero
// catalog-sourced offers from this block.
//
// Numbers are calibrated against World.ts's Kindled Edge constants
// (EDGE_DAMAGE 32, EDGE_RANGE 84px, ~0.65s swing cycle ≈ 49 DPS) and
// combat.ts's Ward constants (WARD_MITIGATION_FRACTION 0.6, KINDLING_MAX
// 100) — first-draft/playtest-pending like every number this session.
/** Bastion Pulse: instant self-absorb tick, doubled while Ward is actively
 *  held at cast time ("stronger if Ward is held", doc). Base value matches
 *  GEO_RETURN_GLASS_SHIELD_REFUND's precedent (22) — a meaningful but not
 *  round-defining top-up; the Ward-synergy double (44) rewards pressing it
 *  mid-block rather than as a panic button. */
export const KIN_BASTION_PULSE_SHIELD_REFUND = 22;
export const KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER = 2.0;
/** Sunspike: aimed thrust, short windup. v1 = a single fast, narrow, short-
 *  range shot through the EXISTING projectile system (spawnProjectile),
 *  the same substrate-reuse shape Prism Fan/Lattice already prove for the
 *  Geometrician catalog — not a bespoke melee-hitbox FSM (no wave, no
 *  persisting phase, and critically no new cross-player write inside the
 *  per-player loop this activation runs in — see World.ts's "recorded
 *  deferral" note at the case site). Damage sits ABOVE EDGE_DAMAGE (32) —
 *  "high single" per the doc — but the ability pays a cooldown for it,
 *  unlike Edge's free-swing economy. KIN_SUNSPIKE_SPEED is high enough
 *  (range / speed ≈ 0.1s) that it arrives as a thrust, not a lobbed shot;
 *  the doc's "short windup" nuance is a recorded v1 deferral (instant
 *  cast, no telegraphed windup frame yet — same shape as Sunlance's own
 *  "burst window, not true charge-hold" gap). */
export const KIN_SUNSPIKE_DAMAGE = 40;
export const KIN_SUNSPIKE_RANGE_PX = 150;
export const KIN_SUNSPIKE_SPEED = 1500;
/** Judgment Line: mark duration + amp on the caster's OWN Kindled Edge /
 *  dash-bash hits against the marked target — same shape as GEO_FACET_
 *  BREAK_AMP_MULTIPLIER/RANGE/CONE (1.25×, 900px, 60°), narrowed to match
 *  Edge's own shorter reach (the mark is a duel tool for a melee class,
 *  not a poke-range wizard mark). */
export const KIN_JUDGMENT_AMP_MULTIPLIER = 1.3;
export const KIN_JUDGMENT_RANGE_PX = 420;
export const KIN_JUDGMENT_CONE_RADIANS = (60 * Math.PI) / 180;
/** Unbroken Seal: the NEXT Kindled Edge hit while the window lives is
 *  amplified and staggers the victim (heavy slow, not a full freeze —
 *  "big hit-stop + stagger" per the doc reads as knockdown-adjacent, not
 *  CC-lock). Amp sits below GEO_SUNLANCE_DAMAGE_MULTIPLIER (1.6) since
 *  Edge already hits harder than a wizard bolt; the stagger is the real
 *  payoff. Window is generous (5s) because it's consumed on the player's
 *  OWN next swing, not a self-expiring burst like Sunlance. */
export const KIN_SEAL_DAMAGE_MULTIPLIER = 1.45;
export const KIN_SEAL_STAGGER_MS = 900;
/** Heavier than the ordinary slow-field card's 0.58-0.68 multiplier
 *  (cards.ts) — a committed overhead's stagger should read as a real
 *  punish window, close to (not equal to) a full lock. */
export const KIN_SEAL_STAGGER_MULTIPLIER = 0.25;
// Consecrated Field (aoe role rework, 2026-07-18) used to be documented
// here — a genuine lingering damage+slow zone built on the same
// `firePatches`/`FireEntity` primitive Lattice's own zone uses. The ability
// was cut 2026-07-19 (role-redundant with Shock Ring — both "AOE damage
// zone near yourself"; see docs/class-ability-catalogs-v1.md's cut note),
// so its KIN_CONSECRATED_FIELD_* constants are gone too.
/** Aegis Share: brief window widening THIS player's team-peel eligibility
 *  radius (combat.ts's WARD_PEEL_RADIUS_PX) for allies checking whether
 *  this Ward-holder's shadow covers them — "projectiles that would hit
 *  allies in ward shadow also feed your Kindling" read as "the shadow
 *  reaches further while this is up," the honest v1 composition of the
 *  doc's rider onto the existing 2.4 peel mechanism rather than a second,
 *  parallel peel implementation. */
export const KIN_AEGIS_SHARE_RADIUS_MULTIPLIER = 1.6;
/** Aegis Share solo fallback (docs/axiom-deviations-audit.md "Kindled —
 *  two structural gaps", 2026-07-18: "no allies → Aegis still feeds
 *  Kindling"). A cast that finds no ally inside the SAME widened radius
 *  this ability actually affects (WARD_PEEL_RADIUS_PX *
 *  KIN_AEGIS_SHARE_RADIUS_MULTIPLIER, combat.ts/World.ts) grants the
 *  caster a flat Kindling tick instead of doing nothing — "reduced but
 *  real," the audit's own fix direction, not a rewrite of the team
 *  behavior (the window still opens either way, so an ally who wanders in
 *  later during the window still gets peeled for). Below one fully-covered
 *  Ward block's own grant (~13.2 Kindling, KINDLING_PER_DAMAGE_BLOCKED's
 *  doc comment, combat.ts) and below Bastion Pulse's shield-charge tick
 *  (22) — a consolation tick for pressing a team tool alone, not a second
 *  free resource engine alongside blocking. */
export const KIN_AEGIS_SHARE_SOLO_KINDLING_FEED = 12;
/** Plant Charge: a short board-first reposition (same farthest-collision-
 *  free-landing search shape as Slip Node/Shadow Step, shorter range —
 *  "plant-to-plant, not freeflow ninja"), plus a small shield-charge tick
 *  representing "ends in ward-ready stance" (the doc's exact stance/pose
 *  timing is a recorded v1 deferral — same shape as Return Glass's own
 *  "not gated behind a live parry yet" note). */
export const KIN_PLANT_CHARGE_RANGE_PX = 190;
export const KIN_PLANT_CHARGE_SHIELD_REFUND = 12;

// Kindled catalog v1 — originally 3 previously-deferred entries (class-
// overhaul-workboard.md chunk 2.6 fast-follow, 2026-07-18): Retribution
// Edge, Shock Ring, Rally Light. Same substrate-reuse discipline as the 7
// above; each comment documents the "thin layer over existing mechanism"
// it rides.
//
// Retribution Edge (block → amp+Kindling refund → more) was cut 2026-07-19
// rather than fixed — it carried the self-fueling-loop brake the axiom-
// deviations audit flagged (AX.3/D3) and never got the fix built, unlike
// the Syzygist class's equivalent gap this same session (which WAS fixed
// with a difference-fed brake). Removing it sidesteps the open design debt
// instead of building the brake first. Its KIN_RETRIBUTION_EDGE_* constants
// are gone too — see docs/class-ability-catalogs-v1.md's cut note.
/** Shock Ring: "keep hop modest — not sky-god" — the hop's upward velocity
 *  sits well under player.ts's own M.jumpVelocity (635 magnitude, ~134px
 *  apex): a shallower hop that still reads as a real leave-the-ground beat.
 *  Damage/radius sit at the same tier Consecrated Field used to occupy
 *  (18dmg/150px, before that ability was cut 2026-07-19) — a second
 *  self-centered nova would strictly dominate the first if it hit harder for
 *  free, so Shock Ring trades a LANDING-gated cast (must wait out the hop)
 *  for a slightly larger radius, not more damage. Arm window is generous
 *  (a full second and a half) so the hop's own airtime (well under 1s at
 *  this velocity) can never expire the window before landing. Aoe role
 *  rework (2026-07-18): landing now resolves as a single instant radius
 *  check (World.ts's instant-AoE pass) instead of a ring of GEO_LATTICE_
 *  COUNT discrete shards — same damage/radius, no status effect (a plain
 *  "space claim" thump, deliberately no stagger — Crater's damage+stagger
 *  and Consecrated Field's damage+slow were the points of comparison until
 *  both were cut, 2026-07-19). */
export const KIN_SHOCK_RING_HOP_VY = 420;
export const KIN_SHOCK_RING_ARM_WINDOW_MS = 1500;
export const KIN_SHOCK_RING_DAMAGE = 18;
export const KIN_SHOCK_RING_RADIUS_PX = 170;
/** Rally Light: v1 is a READ-ONLY continuous aura check (no cross-player
 *  WRITE — this is why it doesn't need the pendingSyzygistCasts deferred-
 *  queue shape: nothing ever mutates another player's entity, every reader
 *  only ever multiplies its OWN speed/damage after finding a live aura
 *  source nearby, the exact same "read `state.players`/`players`, only ever
 *  write your own copy" shape Judgment Line's mark-consumption and Aegis
 *  Share's radius-widen already prove safe). Solo/FFA clause (closes the
 *  axiom-deviations audit's AX.2 "Aegis Share + Rally Light are solo-dead"
 *  flag for this ability specifically): the aura ALWAYS covers its own
 *  caster (self counts as an eligible "ally" at distance 0, regardless of
 *  teamId), so a solo Kindled still gets a real button here, not just a
 *  team tool. Radius matches Bastion's card-pool-v2.md aura (220px, chosen
 *  for a consistent "heaven-tank aura" reading across the kit — Bastion
 *  itself was cut 2026-07-19, but the radius provenance stands). Multipliers are
 *  deliberately mild ("small damage amp + move tick" per the doc) — well
 *  under Haste Gift's 1.25x move multiplier and Judgment Line's 1.3x damage
 *  amp, because Rally Light is passive-while-cast (no target, no aim, no
 *  execution cost) rather than a precision tool. */
export const KIN_RALLY_LIGHT_RADIUS_PX = 220;
export const KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER = 1.12;
export const KIN_RALLY_LIGHT_MOVE_MULTIPLIER = 1.08;

// ── Kindled catalog v1 — coverage-floor + solo-viability fast-follow
// (docs/axiom-deviations-audit.md "Kindled (paladin) — two structural
// gaps", 2026-07-18). Two NEW abilities close the ≥2-per-role floor
// (buff×1/movement×1 → ×2 each, docs/classes-goal.md's coverage lock);
// Aegis Share's own solo-fallback constant lives with its Aegis Share
// siblings above (KIN_AEGIS_SHARE_SOLO_KINDLING_FEED) rather than here —
// this block is only the two genuinely NEW abilities. Catalog grows
// 10→12 (still inside the locked 8-12 range, docs/classes-goal.md
// "Catalog is full day one") rather than replacing two existing entries —
// the audit's own phrasing is "ADD a 2nd buff... ADD a 2nd movement", and
// the D2 sweep found Kindled "orthogonally fine" already (unlike
// Geometrician's confirmed Measure/Recoil Step filler) — nothing in the
// existing 10 is weak enough to warrant benching for a replacement.
/** Kindled Resolve (buff, self-only): spends Kindling for a self stagger-
 *  resist + small self-damage-amp window — "heaven-tank cashes in his
 *  block-meter for a stance." The first ability in the sim to actually
 *  SPEND Kindling rather than only ever grant it (Bastion Pulse/team-peel
 *  are pure sources — Retribution Edge was too, until it was cut
 *  2026-07-19; `grep kindling client/src/sim/
 *  World.ts` before this pass turns up zero subtraction sites) — the
 *  resource-sink the axiom-deviations audit's own fix direction calls for.
 *  Orthogonal to Rally Light (buff #1): Rally Light is a FREE, continuous,
 *  team-shareable aura (speed+damage, no resource cost, 9s CD); Kindled
 *  Resolve is a RESOURCE-GATED, self-only, burst defensive stance
 *  (damage+CC-resist, spends a meter, longer CD, no team reach at all) —
 *  a different KIND of buff (a resource sink vs a free aura), not a
 *  smaller Rally Light. Damage amp sits BELOW Rally Light's own 1.12 — a
 *  passive team aura earning a bigger number than a self-only resource
 *  spend would invert the two abilities' relative value; the resource
 *  cost is this ability's real payoff, not the multiplier. Stagger-resist
 *  blends the incoming stagger multiplier toward 1 (halves its severity)
 *  rather than granting full immunity — "resist", not "CC-immune", per the
 *  doc's own wording (a fully immune Paladin would trivialize Unbroken
 *  Seal/Flock Pulse's own stagger payoff for every other class that lands
 *  one on them). Kindling cost (40) is a meaningful fraction of
 *  KINDLING_MAX (100) — roughly 3 solid Ward blocks' worth
 *  (KINDLING_PER_DAMAGE_BLOCKED's own ~13.2-per-block reference,
 *  combat.ts) — so this reads as "you played defense, now cash in," not a
 *  free press. Insufficient Kindling is a dead press (legibility law: a
 *  press that does nothing burns no cooldown, same precedent as Shadow
 *  Step's blocked-blink / Judgment Line's no-target case, both above).
 *  Cooldown (12s) sits above every other Kindled active's (max 9s, Shock
 *  Ring/Rally Light) — the resource gate alone isn't trusted as the only
 *  brake; a hard CD backstops it even if Kindling regenerates fast off a
 *  block-heavy fight. First-draft/playtest-pending, like every number this
 *  session. */
// Window/cooldown (4s / 12s) live solely in cards.ts's `active` spec, same
// "one source of truth, no constants.ts duplicate" convention every other
// Kindled ability's window/cooldown already follows (KIN_SEAL_STAGGER_MS
// above is a DIFFERENT number — the stagger length applied to a VICTIM,
// not the window/cooldown cards.ts already owns).
export const KIN_KINDLED_RESOLVE_KINDLING_COST = 40;
export const KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER = 1.1;
/** Fraction of an incoming stagger's SEVERITY removed while Kindled
 *  Resolve is live: `resisted = mul + (1 - mul) * this`. At 0.5, Unbroken
 *  Seal's own 0.25 stagger multiplier (75% slow, KIN_SEAL_STAGGER_
 *  MULTIPLIER above) softens to 0.625 (37.5% slow) — halved, not
 *  negated. */
export const KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION = 0.5;
/** Bulwark Step (movement, self-only): a short reposition along the
 *  player's currently-HELD movement input (player.ts's own private
 *  Bit.Left/Bit.Right — the SAME bits, read locally in World.ts) — "board-
 *  facing shuffle-reposition" per the audit, not an aimed dash. The
 *  orthogonal axis versus Plant Charge (movement #1) is the TRIGGER SHAPE
 *  itself (input-directed vs aim/cursor-directed), not a smaller number:
 *  Plant Charge reads aimX/aimY (go where you're LOOKING); Bulwark Step
 *  reads currKeys (go where you're currently WALKING). Falls back to the
 *  caster's current horizontal velocity sign (or +X) when neither
 *  left/right is held — the same "always resolves a direction, never a
 *  dead press for lack of aim" contract Plant Charge's own dx0/dy0
 *  fallback uses. Horizontal-only (no vertical component, unlike Plant
 *  Charge's full-2D aim-follow) — a lateral shuffle, not a leap. Shorter
 *  range (110px vs Plant Charge's 190px) and shorter cooldown (4s vs 6s),
 *  with NO shield-charge refund — Plant Charge is the committed, aimed,
 *  rewarded charge that "ends in ward-ready stance"; Bulwark Step is the
 *  cheap, reflexive, unrewarded shuffle a Paladin throws out mid-block to
 *  not stand still, never a replacement for the charge. "Keeps Ward up"
 *  (the audit's own framing) turned out to already be a free property, not
 *  new work: World.ts's `tickShield` runs AFTER the entire ability-
 *  activation switch every tick and recomputes `shieldActive` purely from
 *  held input + charge, regardless of what any case in the switch did to
 *  `nextEntity` — no existing case (Plant Charge included) has ever been
 *  able to drop Ward by repositioning. Bulwark Step inherits that existing
 *  guarantee rather than building a new one. */
// Cooldown (4s) lives solely in cards.ts's `active` spec, same convention
// as every other Kindled ability (see the note above KIN_KINDLED_RESOLVE_
// KINDLING_COST).
export const KIN_BULWARK_STEP_RANGE_PX = 110;

// Paladin exclusives (docs/card-pool-v2.md #26-28: Crater/Retort/Bastion)
// were cut entirely 2026-07-19 — they leaked into the loadout station's
// catalog as 3 extra cards beyond the real 10-ability rack (13 shown
// instead of 10, a bug Jake caught live), so the whole KIN_CRATER_*/
// KIN_RETORT_*/KIN_BASTION_* (aura) constant group was removed along with
// the cards, cardTypes.ts's AbilityKind entry, World.ts's applyBastionAura/
// crater case/landing hook, and combat.ts's Retort bank. KIN_BASTION_
// PULSE_* just above is unrelated — that's Bastion Pulse, a real
// still-live rack ability, not this cut Bastion.

// Second Wind (universal card "double-jump") — Paladin classModifiers
// expression (docs/card-pool-v2.md: "the stomp-jump — his air jump deals 6
// damage in a 70px ring beneath him"). Triggers off the SAME air-jump-
// consumed-this-tick edge World.ts already reads for the ninja wall-kick
// energy grant (mem.airJumpsUsed before/after stepPlayer) — no new movement
// substrate, just a new consumer of an existing signal. Numbers are the
// doc's own.
export const KIN_STOMP_JUMP_DAMAGE = 6;
export const KIN_STOMP_JUMP_RADIUS_PX = 70;

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

// ── SYZYGIST STATUS SUBSTRATE (2026-07-18, class-overhaul-workboard.md
// chunk 3.1: "Status substrate extension (buffs, not just debuffs)") ──────
// Priest/Syzygist's opposite-polarity extension to the existing burn/
// freeze/slow DEBUFF substrate: regen (heal-over-time) and haste (move +
// fire-rate multiplier), the first BUFF fields any player's cast can write
// onto a DIFFERENT player's entity (an ally, gated by team.ts's `isAlly`).
// Infrastructure only — no real Priest ability catalog exists yet (that's
// chunk 3.4); these constants tune World.ts's `applyRegenToAlly`/
// `applyHasteToAlly` mechanism, exercised directly by this chunk's own
// tests, not by any wired card/input yet. First-draft numbers, like every
// other constant on this file.
/** Heal-per-second while a regen window is live. Roughly a third of burn's
 *  default DoT rate at Wizard's damage scale (World.ts stamps
 *  `burnDps: finalDamage * 0.4` off real hit damage, so there's no single
 *  "default burn number" to mirror 1:1) — enough to matter in a multi-
 *  second engagement without trivializing damage racing on its own. */
export const SYZ_REGEN_HPS_DEFAULT = 6;
/** Default regen window length, in ticks at STEP_MS (60Hz): ~4 seconds —
 *  long enough to matter mid-fight, short enough that it reads as a cast,
 *  not a permanent aura. */
export const SYZ_REGEN_DURATION_TICKS_DEFAULT = Math.round(4000 / STEP_MS);
/** Health ceiling regen clamps to. No shared MAX_HEALTH constant exists
 *  yet in this codebase (World.ts hardcodes `health: 100` at each of its
 *  three spawn sites) — scoped narrowly to the regen clamp rather than
 *  introducing a wider refactor this chunk doesn't need. */
export const SYZ_REGEN_HEALTH_CAP = 100;
/** Move-speed + fire-rate multiplier while a haste window is live. Between
 *  the pickup speed-boost's 1.4x and Overclock's 1.35x fire-rate bump —
 *  haste stacks both effects at once, so a milder single number keeps a
 *  hasted ally from reading as strictly better than either existing buff
 *  alone. */
export const SYZ_HASTE_MULTIPLIER_DEFAULT = 1.25;
/** Default haste window length, in ticks at STEP_MS (60Hz): ~5 seconds. */
export const SYZ_HASTE_DURATION_TICKS_DEFAULT = Math.round(5000 / STEP_MS);

// ── SYZYGIST DEVOTION RESOURCE (2026-07-18, class-overhaul-workboard.md
// chunk 3.2: "Devotion resource... generated by buff/heal uptime ON OTHERS
// (not self)"). A genuinely NEW resource-generation SHAPE — every other
// resource this session (energy, kindling) is hit/block-triggered, instant-
// event-based; devotion is a continuous per-tick COUNT of how many other
// allies currently carry this player's live regen/haste/Ward windows
// (World.ts's Devotion-accrual pass, gated by regenSourceId/hasteSourceId/
// wardAbsorbSourceId === this player's own id — see types.ts's devotion doc
// comment). Counting rule, chosen deliberately over the alternatives:
//   - "once per tick, scaled by dtMs" (chosen) vs "once per second, flat N"
//     (the burn/regen DoT convention): a per-second gate would make
//     Devotion feel like a slow drip disconnected from WHEN you cast;
//     continuous per-tick accrual means Devotion visibly starts climbing
//     the instant a buff lands and visibly stops the instant it (or the
//     ally) drops — "uptime maintenance IS the loop" (classes-goal.md's
//     Priest rotation-feel line) reads truer as a smooth rate than a
//     once-a-second tick.
//   - "count distinct BUFFED ALLIES, not distinct buff INSTANCES" — an
//     ally holding BOTH a live regen window AND a live haste window from
//     the same caster counts ONCE, not twice (World.ts dedupes by target
//     id before multiplying by the rate). Otherwise a caster could double
//     their own income for free by never letting a single-buff window
//     lapse, which isn't a real choice — it's just remembering to double-
//     tap the same ally.
//   - Scope (deliberate v1 cut, matching this session's every other
//     "recorded deferral"): counts ALLY buff uptime only (regen/haste/
//     Ward — the substrate chunks 3.1/3.3 actually build). classes-goal.md
//     also promises "Devotion from enemy DoTs/curses at a real rate" for
//     the solo-viability floor — that half is NOT implemented here: it
//     would require every debuff application site (burn/freeze/slow, a
//     substrate SHARED by every class's fire/ice cards, not Priest-
//     specific) to carry caster attribution, a broader blast-radius change
//     than this chunk's "add a Priest-only counting pass" scope allows.
//     Bleed Tithe/Severance (chunk 3.4) grant lifesteal DIRECTLY instead of
//     routing solo income through Devotion, so solo Syzygist still has a
//     real curse+lifesteal floor (chunk 0.3's original scope) without
//     solo Devotion income — flagged here, not silently dropped.
/** Devotion pool ceiling — same 0..100 scale convention as
 *  NINJA_ENERGY_MAX/KINDLING_MAX (every class resource on this additive-
 *  field substrate; class-overhaul-workboard.md chunk 1.2's generalization
 *  is still deferred, same reasoning as `kindling`'s own field comment). */
export const SYZ_DEVOTION_MAX = 100;
/** Devotion earned per second, PER distinct buffed ally (capped at
 *  SYZ_DEVOTION_MAX_COUNTED_SOURCES below), continuously while the window
 *  is live. Tuned so a single steadily-refreshed ally (one buff, kept up
 *  the whole engagement) fills the bar in ~50s — deliberately SLOW next to
 *  Kindling's "~8 blocks over one engagement" cadence, because Devotion
 *  income scales with ALLY COUNT (a duo with both windows up on the same
 *  ally earns no more than one; a hypothetical 3-person team maintaining
 *  buffs on two allies at once earns roughly double) rather than purely
 *  the caster's own actions — the resource rewards sustained team
 *  entanglement, not burst play, matching "uptime maintenance" being the
 *  class's whole rotation-feel target (classes-goal.md). First-draft,
 *  playtest-pending like every number this session. */
export const SYZ_DEVOTION_PER_BUFFED_ALLY_PER_SEC = 2.0;
/** Cap on how many distinct buffed allies count toward accrual per tick —
 *  ties directly to docs/card-pool-v2.md's Flock passive ("cap 4 sources"),
 *  authored as the SAME cap here rather than inventing a different number,
 *  so a future Flock card implementation reads as "removes/raises this
 *  cap" rather than introducing a brand-new one. Moot at today's max team
 *  size (Duos = 1 possible ally), but future-proofs larger team sizes
 *  without a silent uncapped-income exploit. */
export const SYZ_DEVOTION_MAX_COUNTED_SOURCES = 4;

// ── SYZYGIST SNOWBALL BRAKE (2026-07-18, D3 fix — docs/axiom-deviations-
// audit.md's Syzygist entry: "Bleed Tithe + Contagion + Flock Pulse... the
// single worst A3 hotspot in the game", fix direction "prefer difference-fed
// brakes: tie the friction to how far AHEAD the loop's owner is"). Scope
// note, read before touching either consumer below: as SHIPPED, only
// Devotion accrual and Flock Pulse's per-source damage actually share a
// mechanism — both dedupe-count the SAME "distinct other player currently
// carrying this caster's live regen/haste/Ward window" set (World.ts's
// Devotion-accrual pass and the flock-pulse case block). Bleed Tithe grants
// lifesteal DIRECTLY (SYZ_BLEED_TITHE_LEECH_FRACTION, on-hit, not routed
// through Devotion) and Contagion only copies an EXISTING burn onto a fresh
// target (no Devotion write, no Flock-Pulse-count interaction) — the
// "Devotion from enemy DoTs/curses" half of classes-goal.md's design that
// would have wired curses into this same engine is an explicit, already-
// recorded v1 deferral (see this file's SYZYGIST DEVOTION RESOURCE header
// note above, "that half is NOT implemented here"). So the audit's literal
// 4-ability closed loop does not exist in the shipped code today; what DOES
// exist is a real but already-partially-capped 2-ability loop (Devotion +
// Flock Pulse), and this brake targets exactly that shared mechanism — the
// same "one shared stopping mechanism... brakes [the connected ones] at
// once" fix direction the audit names, applied to what's actually wired
// rather than what the design doc still aspires to. Written so that IF a
// future chunk does wire curse-carriers into the same sourceCount (closing
// the doc's deferred half), the brake below already covers it too — it
// lives in the shared multiplier, not in either ability's own math.
/** Multiplier lost per whole kill of IN-ROUND lead over the field average
 *  (`state.round.roundKills`, already computed by World.ts every tick,
 *  reset every round — no new state). Difference-fed per A3's stated
 *  preference: a Syzygist even with or behind the round's average kill
 *  count pays this brake NOTHING (see `syzygistLeadBrakeMultiplier`'s
 *  `lead <= 0` early return) — the brake is invisible until this player is
 *  actually pulling ahead this round, then it firms up per kill of lead.
 *  0.25 chosen so a 3-kill in-round lead (a decisive, already-obviously-
 *  winning position for a single round) reaches the floor below. */
export const SYZ_SNOWBALL_BRAKE_PER_KILL_LEAD = 0.25;
/** Floor the brake multiplier can reach — never fully zeroes the bonus
 *  (matches design-pillars' "never silence the winner's draft" insight
 *  applied at the ability layer instead of the draft layer: brake the
 *  snowballing PORTION, don't delete the ability). Flock Pulse's own BASE
 *  damage (SYZ_FLOCK_PULSE_BASE_DAMAGE) is never touched by this brake at
 *  all — only the per-source bonus on top of it is — so even a maximally
 *  snowballing Syzygist keeps a real, functioning kit; the bonus just stops
 *  being worth stacking allies for. */
export const SYZ_SNOWBALL_BRAKE_FLOOR = 0.25;

// ── SYZYGIST WARD (2026-07-18, class-overhaul-workboard.md chunk 3.3:
// "Wards defense verb: small absorb barriers, castable on allies"). A flat
// absorb POOL (not a mitigation fraction like Paladin's WARD_MITIGATION_
// FRACTION, combat.ts) — "cast-and-forget... no aim/facing required after
// cast", the low-aim design direction applied to Priest's defense verb.
/** Default window length a Ward pool stays open before it lapses unspent —
 *  long enough to matter as a standing defensive commitment (a duo can
 *  plan around "the ward is up"), short enough that it reads as a cast,
 *  not a permanent aura. Matches SYZ_HASTE_DURATION_TICKS_DEFAULT's ~5s
 *  register, +1s since a barrier that expires unspent is a wasted cast in
 *  a way an expired haste buff (which was "spent" just by existing) isn't. */
export const SYZ_WARD_DURATION_TICKS_DEFAULT = Math.round(6000 / STEP_MS);
/** Default absorb pool size for `applyWardToAlly` when a caller doesn't
 *  pass one — same "mechanism has a sane default, content picks its own"
 *  shape as SYZ_REGEN_HPS_DEFAULT/SYZ_HASTE_MULTIPLIER_DEFAULT. Sits
 *  between Self-Lattice's weak self value and Glass Ward's stronger ally
 *  value (both below) since no ability actually calls the function without
 *  an explicit amount today — this exists for the direct-mechanism test
 *  coverage (mirrors syzygistBuffs.test.ts's own un-costed defaults). */
export const SYZ_WARD_ABSORB_DEFAULT = 30;
/** Self-Lattice (catalog, defense role): "deliberately WEAKER than ally
 *  ward — belief: invest outward" per the doc. Small enough that it's a
 *  genuine "solo still has a button" floor, not a competitive shield. */
export const SYZ_SELF_LATTICE_ABSORB = 20;
/** Glass Ward (catalog, defense role) on an ALLY: "stronger absorb... teams
 *  peak" per the doc. Roughly double Self-Lattice's self value AND
 *  Bastion Pulse's base shield-charge refund (KIN_BASTION_PULSE_SHIELD_
 *  REFUND, 22) — a real defensive commitment, not a token top-up. */
export const SYZ_GLASS_WARD_ALLY_ABSORB = 45;
/** Glass Ward cast with no ally in range: "on self if no ally in range, at
 *  reduced strength" per the doc — sits between Self-Lattice's dedicated
 *  weak value and the ally-strength value, since it's the SAME spent cast
 *  (cooldown/cost) as the ally version, just misdirected by circumstance
 *  rather than by choice. */
export const SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB = 28;

// ── SYZYGIST LOW-AIM AUTO-TARGET RANGES (2026-07-18, chunk 3.4 — Jake's
// live design direction: "needs like auras dude like tendrils that ooze
// out and self guide to its correct destination... less about aiming").
// Every ability below that targets "the nearest ally" or "the nearest
// enemy" reuses ONE shared search range per polarity rather than a
// per-ability tuned cone (unlike Facet Break/Judgment Line's hand-rolled,
// differently-tuned scans) — deliberate: those two are WEAPON-flavored
// marks with a real aim cone (a Wizard/Paladin choosing WHERE to point);
// every Priest ability below is explicitly aim-FREE by design, so sharing
// one range keeps "how far does the tendril reach" a single, consistent,
// re-tunable number instead of N near-duplicate constants that could drift
// out of sync with the class's own identity.
/** Ally auto-target search radius — matches Borrowed Time's own doc figure
 *  (320px) exactly, the widest-documented Priest ally range, so every
 *  ally-seeking ability reaches at least as far as the card doc specifies
 *  for the one ability it gives an explicit number for. */
export const SYZ_ALLY_SEARCH_RANGE_PX = 320;
/** Enemy auto-target search radius — narrower than the ally range: Priest's
 *  offense-lane abilities (Bleed Tithe, Severance) are still a "reach out
 *  and touch" verb, not a full-map snipe; sits close to GEO_FACET_BREAK_
 *  RANGE_PX (900) 's Wizard-mark range would be far too generous for a
 *  "detuned, modest" baseline chassis (classes-goal.md) — tuned down to
 *  Kindled Edge/Sunspike-adjacent territory instead. */
export const SYZ_ENEMY_SEARCH_RANGE_PX = 420;

// ── SYZYGIST CATALOG v1 (docs/class-ability-catalogs-v1.md — the priest's
// 10-ability class catalog; class-overhaul-workboard.md chunk 3.4). Same
// substrate-reuse discipline as the Geometrician/Kindled blocks above:
// reuses spawnProjectile, the existing fire-element burn-on-hit path, the
// existing leechFraction self-heal path, applyRegenToAlly/applyHasteToAlly/
// applyWardToAlly, and the Facet-Break-style caster-side mark pattern —
// rather than inventing new mechanics per button. All 10 are wired this
// pass (unlike Kindled's 7/10) because the low-aim auto-target helpers
// above let every ability reuse the SAME "nearest valid target" shape.
// classId-gated to priest only (round.ts enterDrafting).
/** Bleed Tithe (offense): instant fire-element shard, auto-targeted at the
 *  nearest enemy (SYZ_ENEMY_SEARCH_RANGE_PX) — reuses spawnProjectile +
 *  the existing element==="fire" burn-on-hit path (World.ts) AND
 *  leechFraction's existing self-heal-on-hit path (the SAME field Crimson
 *  Tithe/Stolen Fangs already use) for zero new hit-resolution code.
 *  Damage sits below KIN_SUNSPIKE_DAMAGE (40) — Priest's baseline
 *  projectile is explicitly "modest... detuned" (classes-goal.md), so its
 *  catalog offense shouldn't out-hit a dedicated melee-tank thrust. */
export const SYZ_BLEED_TITHE_DAMAGE = 26;
export const SYZ_BLEED_TITHE_LEECH_FRACTION = 0.35;
export const SYZ_BLEED_TITHE_SPEED = 1100;
/** Genuine homing (2026-07-18, Jake: "genu[in]e homing" — the v1 shipped
 *  as one-time auto-aim + `pathing: "straight"`, which reads as "auto-aim"
 *  not "self-guiding" the moment the target so much as steps out of the
 *  original line). Reuses `projectile.ts`'s existing `closestNonOwnerPlayer`
 *  re-target-every-tick homing (the exact machinery seeker-facets/micro-
 *  seekers already use) — zero new pathing code needed, just flip the
 *  card's own pathing + a turn-rate constant. Tighter than
 *  HOMING_TURN_RATE_DEFAULT (a wide-net swarm rate) since Bleed Tithe is a
 *  single precision shard, not a spray — first-draft/playtest-pending. */
export const SYZ_BLEED_TITHE_HOMING_STRENGTH = 5.5;
/** Severance (offense): instant shard auto-targeted at the nearest
 *  ALREADY-CURSED enemy (burn/freeze/slow active) within
 *  SYZ_ENEMY_SEARCH_RANGE_PX — "execute-adjacent; take polarity" per the
 *  doc. No target found = a dead press, no cooldown burn (Facet Break's
 *  "a press that does nothing is a dead press" legibility law). Damage
 *  sits above Bleed Tithe's (the payoff for needing a pre-cursed target)
 *  but still below Sunspike (40) — Priest's offense ceiling stays
 *  "modest" per the chassis doc even at its execute-adjacent best. */
export const SYZ_SEVERANCE_DAMAGE = 34;
export const SYZ_SEVERANCE_SPEED = 1300;
/** Borrowed Time (single, catalog AND Priest exclusive draft card —
 *  card-pool-v2.md #29, same shared `active.kind` shape Sunlance/Paper
 *  Double already prove for the other three classes' "main pride"
 *  ability cards — Crater used to be the fourth example until it was cut
 *  2026-07-19): instant heal to the nearest INJURED ally within
 *  SYZ_ALLY_SEARCH_RANGE_PX (auto-target — low-aim direction), self if
 *  none found. v1 drain-back is UNCONDITIONAL (no aggression-gate — see
 *  types.ts's debtUntilTick doc comment for why), so every number pair
 *  below is chosen to keep the cast strictly net-positive: heal always
 *  exceeds its own later drain. Self-cast is weaker on both ends, matching
 *  the doc's "solo/self: heal 15, drain-back 8" figures exactly. */
export const SYZ_BORROWED_TIME_HEAL_ALLY = 30;
export const SYZ_BORROWED_TIME_DRAIN_ALLY = 15;
export const SYZ_BORROWED_TIME_HEAL_SELF = 15;
export const SYZ_BORROWED_TIME_DRAIN_SELF = 8;
/** Delay before the drain lands — matches the doc's "over the next 6s"
 *  figure exactly. */
export const SYZ_BORROWED_TIME_DEBT_DELAY_TICKS = Math.round(6000 / STEP_MS);
/** Focus Hex (single): marks the nearest enemy within
 *  SYZ_ENEMY_SEARCH_RANGE_PX (no cone — omnidirectional auto-target,
 *  low-aim direction; unlike Facet Break/Judgment Line's aim-cone marks,
 *  a Priest's "tendril" doesn't need the player to be looking at the
 *  target). Amp sits between Facet Break's (1.25) and Judgment Line's
 *  (1.3) precedents — Priest's mark rides its own modest projectile, not
 *  a dedicated melee weapon, so it lands closer to the wizard's number. */
export const SYZ_FOCUS_HEX_AMP_MULTIPLIER = 1.28;
/** Contagion (aoe): instant pulse — every enemy within
 *  SYZ_CONTAGION_RADIUS_PX who is ALREADY burning has their burn "jump" to
 *  the nearest un-burning enemy within SYZ_CONTAGION_JUMP_RADIUS_PX (one
 *  jump per source, reusing the exact burnUntilTick/burnDps fields Cinder's
 *  card already writes — "touching only what the priest already lawfully
 *  applied" per the doc's own insidious-reading note, honoured literally:
 *  this only ever copies burns that some hit already, lawfully, placed). */
export const SYZ_CONTAGION_RADIUS_PX = 260;
export const SYZ_CONTAGION_JUMP_RADIUS_PX = 220;
/** Flock Pulse (aoe): instant nova scaled by the caster's OWN currently-
 *  entangled-ally count (the same dedup-by-target-id count Devotion's own
 *  accrual pass computes) — "scaling with # of entities currently entangled
 *  with you" per the doc. Base damage alone is deliberately weak ("weak
 *  cool-white damage" per the doc); the per-source bonus is what makes a
 *  teams-committed Syzygist's nova hit harder than a solo one's, without
 *  solo being damage-zero. Aoe role rework (2026-07-18): was a
 *  GEO_LATTICE-style ring of SYZ_FLOCK_PULSE_COUNT discrete shards (BASE +
 *  sourceCount×PER_SOURCE split evenly across them, so any one target
 *  usually only caught one shard's worth); now an instant radius check —
 *  the full (BASE + sourceCount×PER_SOURCE) total lands on every enemy in
 *  radius directly, no split, no travel. Carries the OLD slow-field tag
 *  (0.8 multiplier, "weak" — the mildest slow among the control-bearing aoe
 *  abilities this pass shipped; Crater's 0.3 stagger and Consecrated
 *  Field's 0.5 both used to sit below it until both were cut,
 *  2026-07-19), applied for SYZ_FLOCK_PULSE_SLOW_DURATION_MS. */
export const SYZ_FLOCK_PULSE_BASE_DAMAGE = 8;
export const SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE = 6;
export const SYZ_FLOCK_PULSE_RADIUS_PX = 170;
export const SYZ_FLOCK_PULSE_SLOW_MULTIPLIER = 0.8;
export const SYZ_FLOCK_PULSE_SLOW_DURATION_MS = 1200;
/** Haste Gift (buff): applyHasteToAlly on the nearest ally within
 *  SYZ_ALLY_SEARCH_RANGE_PX (auto-target), half-strength self-cast if none
 *  found — "self half if solo" per the doc, literally: half of
 *  SYZ_HASTE_MULTIPLIER_DEFAULT's own bonus-over-1.0 (0.25 → 0.125, i.e.
 *  1.125x), not half the raw multiplier (which would round-trip oddly
 *  close to 1.0 for a small base bonus). */
export const SYZ_HASTE_GIFT_SELF_MULTIPLIER = 1 + (SYZ_HASTE_MULTIPLIER_DEFAULT - 1) / 2;
/** Drift Step (movement): a short aim-directed reposition — the ONE
 *  catalog ability the doc itself tags "(player aim)", so it deliberately
 *  does NOT use the low-aim auto-target helpers above; same farthest-
 *  collision-free-landing search shape as Slip Node/Shadow Step/Plant
 *  Charge, shorter range than Slip Node (280) — "keep curse uptime; not
 *  Interstice speed" per the doc. The doc's "snap slightly toward/away an
 *  entangled entity" nuance is a recorded v1 deferral (would need a
 *  second, target-aware branch on top of the shared blink-search loop —
 *  same shape as Recoil Step's own recorded gap). */
export const SYZ_DRIFT_STEP_RANGE_PX = 210;

// ── SYZYGIST BASIC FIRE: OOZING TENDRILS OF FIRE (2026-07-19, priest-only —
// priestStarterWeapon, weapons.ts). Priest's basic-fire ramping channel
// (the block this replaces) got reassigned to Wizard mid-session (Jake:
// "the wizards hould have ramping fire rate to feel more glass canony" —
// see GEO_CHANNEL_RAMP_MS above); Priest needed "something completely
// different... oozing tendrils of fire." Built from the SAME
// low-aim/self-guiding throughline the SYZYGIST LOW-AIM AUTO-TARGET section
// above already established for Priest's ABILITIES (Bleed Tithe: "a homing
// shard that finds its own target rather than requiring precise aim"),
// extended here to Priest's BASIC weapon fire — every property below is
// baked directly into `priestStarterWeapon`'s `WeaponDefinition` (weapons.ts)
// so it flows through the EXACT same resolvePlayerBuild → stepWeaponNative
// → spawnProjectile path every other class's basic fire already uses; every
// card modifier (element override, +damage, +count, pierce, etc.) still
// composes on top unmodified, same "no bypass of the resolved build"
// guarantee the wizard ramp block above documents for itself.
//
// Design decision (locked): MULTI-tendril, not a single shard. "Tendrils"
// is plural — several small threads reaching out at once reads truer to the
// name than one bolt with a homing tag on it. `SYZ_TENDRIL_COUNT` tendrils
// spawn per shot (priestStarterWeapon.projectile.count), each one
// INDEPENDENTLY homing (`pathing: "homing"`; projectile.ts's
// `closestNonOwnerPlayer` re-targets every tendril every tick — the SAME
// per-tick re-target machinery Bleed Tithe/Stolen Fangs already use, no new
// targeting code) and independently fire-elemented (`element: "fire"`
// triggers World.ts's existing, fully generic element==="fire" burn-on-hit
// branch per hit — burnDps is already `finalDamage * 0.4` off whatever
// damage THAT hit actually lands, so a smaller per-tendril hit just
// produces a smaller burn tick; no separate SYZ_TENDRIL_BURN_DPS_FRACTION
// constant is needed or added, since the fraction isn't ability-specific,
// it's the sim's one shared burn formula).
//
// Total-damage bookkeeping (REVISED 2026-07-19, Jake live playtest: "the
// priest should be long range but weak on attack powerful on effects" —
// the original landing intentionally matched the old single-shot's total
// damage; that's now wrong on purpose). `SYZ_TENDRIL_COUNT × SYZ_TENDRIL_
// DAMAGE === 6`, a genuine ~33% cut below the prior 9-damage parity
// target (itself already a 25% detune off starterWeapon's 12) — basic
// fire is deliberately the WEAK part of this class's kit now, not a
// parity-preserved reskin of it. The class's actual power sits in its
// ability kit (Bleed Tithe/Focus Hex/Contagion's marks-and-DoT stack,
// Flock Pulse/Borrowed Time's ally-woven payoffs) — "powerful on
// effects," per Jake's own framing, not on the gun.
//
// Speed ("oozing" is a SPEED/character read before anything else — a fast,
// crisp shard reads as a bolt; a slow one reads as something reaching out):
// `SYZ_TENDRIL_SPEED` sits well below starterWeapon's 650 (Wizard's crisp,
// bolt-like feel) — well under half. `SYZ_TENDRIL_LIFETIME_SECONDS` was
// originally tuned to only *restore* rough range parity with the other
// classes' basic guns (780px); Jake's follow-up call is that Priest should
// be the LONGEST-range basic gun in the game, not merely parity — bumped
// further so effective range (speed × lifetime = 320 × 2.6 = 832px) clears
// starterWeapon's 780px outright. The extra hang time also gives the
// per-tick homing more real distance to actually curve — a shot that
// arrives before it can turn wouldn't read as self-guiding at all, and a
// longer flight window makes that curve-in read more deliberate at range,
// which is the whole "measured pace" identity this class is going for.
export const SYZ_TENDRIL_COUNT = 3;
/** 3 × 2.5 = 7.5 — deliberately BELOW the old single-shot's 9 (see the
 *  block comment above): Priest's basic fire is the weak, long-range,
 *  low-aim half of the kit on purpose; the ability rack is where the
 *  damage lives. Held at 2.5 rather than pushed lower still: at fireRate 4
 *  and count 3, `classExpression.test.ts`'s own combat-balance-ttk band
 *  (weaponBuild.ts's TTK_FLOOR_S/TTK_CEILING_S — "a real, functional gun,
 *  not gimped into unplayability") caps how far this can drop before the
 *  basic gun stops being a credible threat at all; 2.5 is the weakest value
 *  that still clears that floor. */
export const SYZ_TENDRIL_DAMAGE = 2.5;
export const SYZ_TENDRIL_SPEED = 320;
/** speed × lifetime = 832px — intentionally the longest basic-gun range of
 *  any class (starterWeapon's own 650×1.2 = 780px is the next-longest). */
export const SYZ_TENDRIL_LIFETIME_SECONDS = 2.6;
/** Widens the 3-tendril fan from starterWeapon's near-zero 0.03 rad spread
 *  so the tendrils visibly reach out in slightly different directions
 *  before homing curls them back onto one target — selling "several
 *  threads," not "one shot that happens to have count:3." Modest (~26°
 *  total, not a shotgun spray) since the homing turn is what's actually
 *  responsible for landing the hit; the spread is a presentation choice, not
 *  the accuracy mechanism. */
export const SYZ_TENDRIL_SPREAD_RADIANS = 0.45;
/** Turn-rate ceiling for the per-tick homing re-target (projectile.ts's
 *  `rotateVelocityToward`, the same knob `SYZ_BLEED_TITHE_HOMING_STRENGTH`
 *  tunes for the ability version). Sits close to that ability's 5.5 — both
 *  are the same "single precision shard" turn feel, not
 *  `HOMING_TURN_RATE_DEFAULT`'s wide-net swarm rate — tuned a hair gentler
 *  since three concurrent homing tendrils turning as sharply as one
 *  dedicated ability shard would read as unavoidable; playtest-pending like
 *  every number on this file. */
export const SYZ_TENDRIL_HOMING_STRENGTH = 5.0;
// Dual-target homing (REVISED 2026-07-19, Jake's redirect: "shooting
// projectiles not object avoiding tendrils that pulse attack or healing
// effects depending" — read together with this class's long-standing
// low-aim doctrine, "tendrils that ooze out and auto-home to the right
// target... ally=heal, enemy=curse"). Tendrils used to stamp
// `ProjectileEntity.enemyOnly` (types.ts) so the per-tick re-target
// (`closestNonOwnerPlayer`, projectile.ts) would skip the caster's own
// allies — correct for a PURELY offensive shot, but wrong once the same
// shot is meant to be dual-purpose. That stamp is gone: tendrils now rely
// on `closestNonOwnerPlayer`'s own DEFAULT behavior (no `enemyOnly` filter
// at all) — closest non-owner player, ally or enemy alike — the exact same
// generic re-target machinery every other homing WEAPON shot in the sim
// already uses (Stolen Fangs' proc, at this exact stepWeaponNative call
// site), so no new targeting code was needed, only the removal of the
// exclusion. World.ts's hit-confirm site is what actually decides heal-vs-
// damage from there (`ProjectileEntity.tendril` gates that branch — see
// types.ts's doc comment on that field for the full three-consumer list).
// Zero-allies-in-range fallback needs no special-casing: with no ally
// present, the closest non-owner player is necessarily an enemy (or nobody,
// in solo testing), so the tendril transparently behaves exactly like the
// old enemy-only version — "graceful fallback" falls out of the targeting
// pool being empty, not a branch that has to detect and handle it.
// Every other homing shot in the sim (Bleed Tithe, Stolen Fangs) is left
// completely untouched by this — none of them ever set `enemyOnly` or
// `tendril`, so this is zero behavior change for them either way.

/**
 * Priest tendril obstacle-avoidance steering ("object avoiding tendrils",
 * Jake's same redirect above) — Part 2 of the dual-purpose tendril rework.
 * Investigation finding: projectiles in this sim DO collide with platform
 * geometry (projectile.ts's stepProjectile, section "4. Platform
 * collision") and a non-bounce shard (tendrils use `pathing: "homing"`, not
 * `"bounce"`) EXPIRES outright on contact — so before this change, a
 * tendril flying anywhere near a wall/ledge on its way to a homing target
 * would simply die on the terrain instead of reaching it. "Object avoiding"
 * therefore means: steer the tendril's per-tick homing turn away from
 * nearby platform edges BEFORE it gets close enough to clip them, so it
 * organically curves around terrain it's "supposed to dodge" rather than
 * dying to it. `projectile.ts`'s `steerAwayFromNearestPlatform` is a
 * classic seek+avoid steering blend (Reynolds-style: a repulsion vector
 * blended into the desired-heading point, not a modified collision rule) —
 * reuses the SAME `StaticCollisionCache`/`queryGrid` spatial-grid query
 * World.ts's own player-movement collision resolution already relies on
 * (collision.ts), rather than a bespoke query.
 *
 * v1 SIMPLIFICATION (documented, not silent — this session's "honest
 * partial over padded" discipline): steers away from the SINGLE nearest
 * platform surface within the lookahead radius, not full multi-obstacle
 * avoidance or pathfinding. A tendril squeezed between two close obstacles
 * on both sides can still clip one of them — a real, accepted gap; full
 * multi-obstacle blending (summing every nearby surface's repulsion) is a
 * reasonable fast-follow if this reads as a problem in practice, not a
 * blocker for landing a genuine, working avoidance behavior now.
 */
/** How far ahead (px) the tendril "senses" platform geometry each tick.
 *  Platforms in this map set run ~100-300px wide (collision.ts's own
 *  SPATIAL_CELL_SIZE doc comment) — 80px gives the steering enough room to
 *  react before the shard is close enough to actually clip a typical edge
 *  (at SYZ_TENDRIL_SPEED × dtSec ≈ 5.3px/tick, that's ~15 ticks/0.25s of
 *  reaction window), without sensing distant, irrelevant geometry. */
export const SYZ_TENDRIL_AVOID_LOOKAHEAD_PX = 80;
/** How far (px) the steering target point gets pushed away from a sensed
 *  platform surface, at full strength (i.e. when the tendril is already at
 *  the lookahead boundary — see `steerAwayFromNearestPlatform`'s linear
 *  falloff, stronger the closer the shard gets). Deliberately larger than
 *  the lookahead radius itself: a push comparable to or smaller than the
 *  sensing radius reads as a barely-perceptible wobble once blended against
 *  a real homing target that may be hundreds of px away; 160 reliably bends
 *  the desired heading by a visually legible amount without so thoroughly
 *  dominating a close real target that the tendril appears to ignore it. */
export const SYZ_TENDRIL_AVOID_STRENGTH_PX = 160;

// ── Interstice catalog v1 (docs/class-ability-catalogs-v1.md — the ninja's
// 10-ability class catalog, 9 wired this pass; see cardTypes.ts's
// AbilityKind header comment for why "paper-double" is out of this union
// entirely). Same substrate-reuse discipline as the Geometrician/Kindled/
// Syzygist blocks above: reuses findNearestEnemy (Syzygist's own low-aim
// auto-target helper) + spawnProjectile for the offense/aoe entries, and
// the self-only-mark-on-caster shape (judgmentTargetId/sealUntilTick/
// focusHexMarkUntilTick's own precedent) for every window-buff entry —
// consumed at the NINJA MELEE section's own arc-hit/wave-spawn/wall-kick/
// dash-through sites (World.ts), never via a new cross-player deferred-
// write queue (audited case by case — this chassis's kit is self/AoE/
// projectile-flavored, not ally-buff/enemy-debuff-flavored like Syzygist's,
// so the pendingSyzygistCasts hazard that block's own comment documents
// never actually comes up here).
//
// Numbers calibrated against World.ts's existing ninja CHASSIS constants
// (SLASH_DAMAGE 22, WAVE_DAMAGE 10, SLASH_RANGE 78px, NINJA_ENERGY_MAX 100)
// — first-draft/playtest-pending like every number this session.
/** Undercut (offense): "below 15%" read against the codebase's existing
 *  hardcoded-100-max-health convention (e.g. every Borrowed Time/Bastion-
 *  style `Math.min(100, ...)` heal cap) rather than a per-build dynamic
 *  max — same simplification every other catalog ability's health-fraction
 *  math already makes. */
export const NINJA_UNDERCUT_HEALTH_THRESHOLD = 15;
/** Edge Storm (offense): charge bank consumed at the wave-spawn site, up to
 *  this many empowered waves per cast. The doc's "reduced cost" half is N/A
 *  in v1 — the base swing has no energy cost to reduce yet (see this file's
 *  NINJA_ENERGY header note: "nothing SPENDS energy yet") — only the
 *  "+wave damage" half is implemented. Multiplier sits well above 1 since
 *  WAVE_DAMAGE (10) is already the "lighter aftermath" hit; a modest bump
 *  wouldn't read as a genuine battery effect in a clip. */
export const NINJA_EDGE_STORM_CHARGES = 3;
export const NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER = 2.2;
/** Needle (single): auto-targeted gap-finish — spawns a real projectile
 *  (not a hand-rolled direct-damage write) so shield/parry/ward mitigation
 *  applies for free via the existing hit-resolution pass, the SAME shape
 *  Sunspike/Bleed Tithe/Severance already use. Range shorter than
 *  SYZ_ENEMY_SEARCH_RANGE_PX (420) — "gap-finish, tactile" reads as
 *  melee-adjacent, not a snipe. Damage sits between SLASH_DAMAGE (22) and
 *  KIN_SUNSPIKE_DAMAGE (40) — "high single damage" for a catalog button,
 *  but not above a dedicated melee-tank thrust. */
export const NINJA_NEEDLE_RANGE_PX = 300;
export const NINJA_NEEDLE_LUNGE_PX = 130;
export const NINJA_NEEDLE_DAMAGE = 36;
export const NINJA_NEEDLE_SPEED = 1400;
/** Read Mark (single): omnidirectional auto-target, mark lives on the
 *  CASTER (readTargetId/readMarkUntilTick — see that field's types.ts
 *  comment for the cross-player-write-hazard-avoidance reasoning). Amp
 *  sits close to Syzygist's Focus Hex (1.28) — a modest catalog-tier mark,
 *  not a dedicated melee-tank Judgment Line (1.3 on a much slower verb). */
export const NINJA_READ_MARK_RANGE_PX = 340;
export const NINJA_READ_MARK_AMP_MULTIPLIER = 1.28;
/** Razor Route (movement) reuses Read Mark's OWN readTargetId/
 *  readMarkUntilTick fields for its "marks Read on cross" line (the two
 *  abilities share one mark slot by design — see World.ts's razor-route
 *  case) — this is that byproduct mark's own (shorter, incidental)
 *  duration, distinct from a deliberate Read Mark cast. */
export const NINJA_RAZOR_ROUTE_READ_MARK_MS = 3000;
/** Shard Ring (aoe): full-circle "wave ring" — the blade's aftermath in
 *  every direction at once, not a generic nova (crystal-element, the wave's
 *  own element). Radius shorter than WAVE_RANGE (260) — "short radius" per
 *  the doc. Aoe role rework (2026-07-18): was a ring of NINJA_SHARD_RING_
 *  COUNT discrete shards (9 dmg each, so a target typically caught at most
 *  one); now an instant radius check — NINJA_SHARD_RING_DAMAGE lands once,
 *  guaranteed, on everyone in range. Pure damage, no status (the doc's
 *  "commit frames" framing reads as a raw punish, not a control tool —
 *  contrasts with Wall Bloom below, which trades a smaller radius/damage
 *  for near-zero commit since it rides an existing wall-kick). */
export const NINJA_SHARD_RING_RADIUS_PX = 150;
export const NINJA_SHARD_RING_DAMAGE = 14;
/** Wall Bloom (aoe): consumed at the existing wall-kick energy-grant site
 *  (World.ts) — a smaller burst than Shard Ring (map geometry as weapon,
 *  not a second nova button). Aoe role rework (2026-07-18): was a burst of
 *  NINJA_WALL_BLOOM_COUNT discrete shards (7 dmg each); now an instant
 *  radius check for NINJA_WALL_BLOOM_DAMAGE, guaranteed, centered on the
 *  wall-contact point (not the player's own position — the wall itself
 *  "blooms"). */
export const NINJA_WALL_BLOOM_RADIUS_PX = 110;
export const NINJA_WALL_BLOOM_DAMAGE = 10;
/** Second Wind (buff): consumed by the next landed arc hit within the
 *  window — small heal + a real energy dump (aggression-gated sustain, per
 *  the doc), on top of (not instead of) the ordinary NINJA_ENERGY_ON_MELEE_
 *  HIT grant. */
export const NINJA_SECOND_WIND_HEAL = 12;
export const NINJA_SECOND_WIND_ENERGY = 30;
/** Razor Route (movement): a TS-side additive velocity impulse along the
 *  dash direction, layered on top of whatever the movement backend (TS or
 *  wasm) already computed for THIS tick — the same "post-hoc velocity
 *  nudge" shape Recoil Step already proves out. Deliberately does NOT touch
 *  player.ts's DASH_SPEED/DASH_DURATION_MS (the Zig-mirrored dash physics
 *  itself) — six-axes-goal.md's "Zig line" doctrine keeps ability/window
 *  state off that surface; "longer" is approximated by added speed, not a
 *  longer active-frame window. The doc's "through-platforms soft" nuance is
 *  a recorded v1 deferral (a collision-layer change on the always-on dash,
 *  out of scope here). */
export const NINJA_RAZOR_ROUTE_BOOST_SPEED = 260;
/** Paper Double (movement, the catalog's 10th ability — docs/card-pool-
 *  v2.md "Paper Double", previously deferred pending a new decoy entity
 *  type; see types.ts's `PaperDoubleEntity` header for the full shape).
 *  CD matches the doc's "Energy 40, CD 9s" — the Energy half is N/A in v1
 *  for the SAME reason every other catalog ability's energy cost is N/A
 *  (this file's NINJA_ENERGY header note: "nothing SPENDS energy yet"),
 *  only the cooldown gate is implemented. Speed/lifetime/burst numbers are
 *  the doc's own literal values ("exactly run speed 362", "Lives 2.5s or
 *  20 damage", "bursts: 10 damage, 90px") — no first-draft guessing needed
 *  here, unlike most other catalog numbers this session. */
export const NINJA_PAPER_DOUBLE_CD_MS = 9000;
export const NINJA_PAPER_DOUBLE_SPEED = 362;
export const NINJA_PAPER_DOUBLE_MAX_HEALTH = 20;
export const NINJA_PAPER_DOUBLE_LIFETIME_MS = 2500;
export const NINJA_PAPER_DOUBLE_BURST_RADIUS_PX = 90;
export const NINJA_PAPER_DOUBLE_BURST_DAMAGE = 10;
/** Below this current HORIZONTAL velocity magnitude (|vx|, px/s), the
 *  caster is read as "not actually running" at cast time — the decoy's
 *  heading falls back to the full 2D aim direction instead (see World.ts's
 *  `"paper-double"` case). Deliberately checked against HORIZONTAL speed
 *  only, never the full (vx, vy) vector: `vy` is gravity-driven for most of
 *  a player's airtime (even a single tick of freefall from a dead stop
 *  picks up tens of px/s downward), so a full-vector check would read
 *  almost every airborne cast as "moving" in whatever direction gravity
 *  happened to be pulling that tick — nothing like "sprinting". A tiny
 *  threshold, not zero: a barely-drifting idle player (friction decay,
 *  sub-pixel jitter) should still read as "stationary", not lock onto a
 *  near-random near-zero horizontal velocity sign. */
export const NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX = 5;

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
