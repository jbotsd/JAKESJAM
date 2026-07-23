// Day 1 sim contract. This file is imported by client prediction code and the
// authoritative Bun server, so changes here are protocol-sensitive.

declare const __brand: unique symbol;
export type EntityId = number & { readonly [__brand]: "EntityId" };
export type PlayerId = string & { readonly [__brand]: "PlayerId" };
export type Tick = number & { readonly [__brand]: "Tick" };
export type InputSeq = number & { readonly [__brand]: "InputSeq" };

/** Brand a number as a non-negative integer ID. Throws on NaN/Infinity/
 *  negatives/non-integers — those have always been bugs in this codebase
 *  (a corrupted spatial-grid key, an off-by-one tick, a parsed garbage
 *  ack). The throw makes them loud at the trust boundary. */
export const EntityId = (n: number): EntityId => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`EntityId: expected non-negative integer, got ${n}`);
  }
  return n as EntityId;
};
export const PlayerId = (s: string): PlayerId => {
  if (typeof s !== "string" || s.length === 0 || s.length > 64) {
    throw new Error(`PlayerId: expected non-empty string ≤64 chars, got ${JSON.stringify(s)}`);
  }
  return s as PlayerId;
};
export const Tick = (n: number): Tick => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Tick: expected non-negative integer, got ${n}`);
  }
  return n as Tick;
};
export const InputSeq = (n: number): InputSeq => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`InputSeq: expected non-negative integer, got ${n}`);
  }
  return n as InputSeq;
};

/** Typed iteration helpers — see .claude/skills/ts-pocock/SKILL.md §1.
 *  Use these instead of `Object.keys(...) as PlayerId[]`. */
export function playerIdsOf<T>(record: Record<PlayerId, T>): PlayerId[] {
  return (Object.keys(record) as PlayerId[]).sort();
}
export function entityIdsOf<T>(record: Record<EntityId, T>): EntityId[] {
  // Object.keys returns string[]; entity ids are stored as numeric strings,
  // so we coerce back through the EntityId constructor. Sorted numerically
  // for cross-host iteration parity (see game-sim-determinism §4).
  const out: EntityId[] = [];
  for (const k in record) out.push(EntityId(+k));
  return out.sort((a, b) => a - b);
}

/**
 * Bitfield layout, least significant bit first:
 *  0 left, 1 right, 2 up, 3 down, 4 jump,
 *  5 crouch, 6 fire, 7 ability, 8 shield, 9 dash,
 *  10..12 drafted ability slots 1..3 (six-axes-goal.md Layer 2; rack
 *  locked at exactly 3, docs/classes-goal.md "Rotation system" — bit 13
 *  is unused, no 4th slot), 13..15 reserved.
 */
export type InputBitfield = number;

export type InputFrame = {
  seq: InputSeq;
  tick: Tick;
  keys: InputBitfield;
  aimX: number;
  aimY: number;
  dtMs: number;
};

export type CharacterArchetype = 'balanced' | 'heavy' | 'sprinter' | 'shielded';

// NOTE: `shape` is packed into the shared Zig/TS WASM ABI as a byte index
// (weaponBuildParity.test.ts asserts it byte-for-byte) — it is NOT purely a
// render hint despite the historical "pure data, no Phaser refs" framing.
// Adding a new variant here requires updating the Zig-side shape table too,
// or parity breaks. The wizard's "shard" bullet silhouette (2026-07-20) is
// instead an ELEMENT-driven render override in ProjectileVfx.drawBody — see
// its own doc comment — leaving this union and the ABI untouched.
export type ProjectileShape =
  | 'circle'
  | 'triangle'
  | 'square'
  | 'hexagon'
  | 'orb'
  | 'x'
  | 'bar';

export type ProjectilePathing =
  | 'straight'
  | 'gravity'
  | 'bounce'
  | 'boomerang'
  | 'homing'
  | 'anti-homing'
  | 'float'
  | 'accelerate';

// 'electric' and 'toxic' were declared here with NO sim handler anywhere
// (World.ts's element switch has no branch for either) — a ghost a future
// card could accidentally reference and silently do nothing. Removed from
// the card-authoring-facing union so that mistake can't happen. The
// numeric wire slots (Zig ElementType enum, wasm index tables) are left
// untouched — no card can ever emit them now, so they're simply unused,
// not a renumbering hazard.
export type ElementType =
  | 'crystal'
  | 'neutral'
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'void'
  | 'radiant'
  | 'sticky'
  | 'explosive';

/**
 * Mirror of `ImpactBehavior` from `data/cardTypes.ts` — duplicated here to keep
 * the entity type self-contained (sim/types.ts must not import from data/).
 */
export type ProjectileImpact =
  | 'none'
  | 'explosive'
  | 'sticky'
  | 'pierce-chain'
  | 'slow-field';

// 'trainingDummy' (venue-lobby-tableau, 2026-07-18): the venue lobby's
// "bad" practice targets — behaves identically to 'box' (non-explosive,
// non-flammable, see server/src/venueHost.ts's dummy() helper), distinct
// only so the client can give it a hostile (rose/copper) tint instead of
// the neutral tan every other destructible kind gets — see
// OnlineMatchScene.ts's destructibleColor(). Map-editor-unreachable by
// design (not added to game/types/game.ts's ArenaForgeUI kind list) —
// this is lobby-only furniture, baked directly into venueLobbyMap(), never
// something a custom map author places.
export type DestructibleKind = 'barrel' | 'box' | 'mine' | 'cube' | 'trainingDummy';

/**
 * Pickup kinds known to the sim. The original three (health-shard, shield-cell,
 * overcharge-core) shipped first; the remaining members were added when the
 * full Boxworks pickup set was ported into the sim. Additive: existing
 * snapshots / older code that only reads the first three remain compatible.
 */
export type PickupKind =
  | 'health-shard'
  | 'shield-cell'
  | 'overcharge-core'
  | 'damage-amp'
  | 'speed-boost'
  | 'melee-mode'
  | 'slow-trap'
  | 'vulnerability-trap'
  | 'block-jammer'
  | 'boss-core'
  | 'card-cache';

/**
 * Round-state phases. Additive: the `'drafting'` phase was added on top of the
 * original three (countdown / fighting / round-over). Older snapshot consumers
 * that don't know about `'drafting'` simply read it as "no fighting" — input is
 * frozen, projectiles paused, players standing still while they pick a card.
 */
export type RoundPhase = 'countdown' | 'fighting' | 'round-over' | 'drafting';

/**
 * Sim mode, carried on `WorldRuntime` (host/client-local — NOT part of
 * `WorldState`, so it never needs wire-protocol/delta-snapshot changes).
 * `'combat'` is today's only behavior, unchanged. `'hangout'` (party
 * lobby walking space, graceful-gliding-flame plan A1) pins the round
 * machine to a permanent `'fighting'` phase (see `World.ts`'s
 * `stepWithRuntime`), no-ops `stepWeapon`, and treats the void kill-plane
 * as a respawn-in-place safety net instead of a death.
 */
export type WorldMode = 'combat' | 'hangout';

export type PlayerEntity = {
  id: PlayerId;
  characterId: CharacterArchetype;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  health: number;
  shieldActive: boolean;
  crouching: boolean;
  alive: boolean;
  weaponId: string;
  cards: string[];
  fireCooldownMs: number;
  ammo: number;
  abilityCharge: number;
  /**
   * Ninja class-resource pool (docs/classes-goal.md MANA section: "ninja =
   * energy, fast regen, melee hits restore"). 0..NINJA_ENERGY_MAX
   * (World.ts). Only ninja (classId) chassis ever move this off 0 — other
   * classes' resources (wizard mana, paladin resolve, priest devotion) are
   * future work on the same substrate shape, not this field. TS-owned:
   * mutated exclusively by World.ts combat code (melee-hit / dash-through /
   * wall-kick grants + passive regen), the same way abilityCharge is —
   * physics steps (TS or wasm) never touch it, just carry it through.
   * Optional/additive: absent/undefined reads as 0. Wire-mirrored in
   * world_state.zig's PlayerEntity.energy (appended field, 2026-07-18).
   */
  energy?: number;
  /**
   * Paladin/Kindled class-resource pool (docs/classes-goal.md MANA section:
   * "Resource: Kindling from blocked damage... Defense IS the engine",
   * class-overhaul-workboard.md chunk 2.3). 0..KINDLING_MAX
   * (combat.ts) — granted by `tryDeflectDamage`'s Kindled Ward branch,
   * proportional to the damage Ward actually blocked (KINDLING_PER_
   * DAMAGE_BLOCKED). Only paladin (classId) chassis ever move this off 0.
   * TS-owned, same contract as `energy`: mutated exclusively by sim combat
   * code, never touched by the physics step (TS or wasm), just carried
   * through. Optional/additive: absent/undefined reads as 0.
   *
   * Deliberately a SEPARATE field rather than a generalized "resource
   * pool" abstraction shared with `energy` — class-overhaul-workboard.md
   * chunk 1.2 asks for that decision to be made explicitly, not defaulted
   * into. Call: defer 1.2's generalization. Reasoning (full version in
   * this chunk's report): (1) this is a live, concurrently-edited repo —
   * refactoring the widely-referenced `energy` field for a purely
   * structural unification carries real blast-radius for zero functional
   * payoff (energy and kindling are used by mutually-exclusive
   * classId-gated code paths, so two separate fields can never collide);
   * (2) only 2 of the 4 planned resources exist even after this chunk
   * (energy, kindling) — Devotion's generation rule (chunk 3.2: "count how
   * many other players currently carry my effects") is a fundamentally
   * different SHAPE of rule (counting, not hit/block-accrual), so
   * generalizing now risks guessing the abstraction wrong before its
   * hardest case is even designed. Repeating the additive-tail pattern a
   * second time (as `energy` itself did after `teamId`) is cheap and
   * proven; unifying is better done once all four shapes are known.
   * Wire-mirrored in world_state.zig's PlayerEntity.kindling (appended
   * field, 2026-07-18).
   */
  kindling?: number;
  lastProcessedInputSeq: InputSeq;
  /**
   * Slow-field debuff. When set and `slowedUntilTick > state.tick`, the
   * player's movement should multiply by `slowMultiplier`. Additive contract
   * change — server and client both read these the same way; older snapshots
   * that omit the fields just see "no slow active".
   */
  slowedUntilTick?: Tick;
  slowMultiplier?: number;
  /**
   * Element status effects (Crystal Rounds card system). Same additive /
   * optional contract as the slow-field debuff above — older snapshots that
   * omit these read as "no element status active".
   *
   * - `burnUntilTick` / `burnDps` / `burnTickLastApplied`: fire-element DoT.
   *   Burn applies `burnDps` damage every 1 second (in sim ticks) until
   *   `burnUntilTick`. `burnTickLastApplied` is the last tick the DoT was
   *   credited on so the per-tick pass can rate-limit to once per second.
   * - `burnSourceId`: which caster's projectile ignited the CURRENTLY LIVE
   *   burn (class-overhaul-workboard.md's D3 Syzygist-brake fast-follow,
   *   2026-07-19 — "Devotion from enemy curses" was a recorded v1 deferral
   *   until this pass wired it). Stamped universally at the fire-hit site
   *   (World.ts) regardless of caster class — any fire-element source counts,
   *   not just Syzygist's Bleed Tithe — so a Syzygist's own devotion-accrual
   *   pass can answer "is this enemy currently burning from MY shot," the
   *   same shape `regenSourceId`/`hasteSourceId` already give the ALLY side
   *   of that same pass. Same contract as those two: TS-only, does NOT cross
   *   the WASM ABI, not hash-mixed, not delta-bit-tracked (covered by its
   *   numeric sibling `burnUntilTick` for both purposes — every full-
   *   prediction client replays the identical deterministic hit that set
   *   it).
   * - `freezeUntilTick` / `freezeMultiplier`: ice-element movement freeze.
   *   Composes alongside `slowMultiplier` at the movement site.
   */
  burnUntilTick?: Tick;
  burnDps?: number;
  burnTickLastApplied?: Tick;
  burnSourceId?: PlayerId;
  freezeUntilTick?: Tick;
  freezeMultiplier?: number;
  /**
   * Syzygist status substrate extension (class-overhaul-workboard.md chunk
   * 3.1, docs/classes-goal.md Priest/Syzygist: "extends the existing
   * status-effect substrate... add regen, haste"). Same additive/optional
   * contract as burnUntilTick/freezeUntilTick above, but OPPOSITE polarity
   * — these are BUFFS — and (the actually new capability this chunk adds)
   * a caster's ability can write them onto a DIFFERENT player's entity, not
   * just their own. Every window-buff field shipped before this chunk
   * (titheUntilTick, veilUntilTick, sunlanceUntilTick, overclockUntilTick,
   * resonanceUntilTick, judgment/seal/aegis) is self-only; regen/haste are
   * the first fields any player's cast can legally set on someone ELSE's
   * PlayerEntity — gated by `isAlly` (team.ts), never set on a non-ally.
   * See World.ts's `applyRegenToAlly`/`applyHasteToAlly` for the mutation
   * mechanism (deliberately unwired to any real input/card this chunk — no
   * Priest ability catalog exists yet, that's chunk 3.4) and World.ts's
   * per-tick regen block (mirrors the burn DoT tick pattern above) /
   * speedMul chain + weapon.ts's fire-rate composition (mirrors Overclock)
   * for how the numbers actually apply.
   *
   * - `regenUntilTick` / `regenHps` / `regenTickLastApplied`: heal-over-
   *   time. While `regenUntilTick > tick`, the player heals `regenHps` once
   *   per second of sim time (same once-per-second rate-limit convention as
   *   `burnDps`, via `regenTickLastApplied`), capped at max health.
   * - `hasteUntilTick` / `hasteMultiplier`: while live, multiplies the
   *   player's move speed (World.ts's speedMul chain, composing alongside
   *   slow/freeze/first-blood/card move-speed exactly like every other
   *   multiplier there) AND fire rate (weapon.ts, composing alongside
   *   Overclock) by `hasteMultiplier`. One multiplier drives both — "haste"
   *   reads as a single coherent buff, not two separately-tuned numbers.
   *
   * Wire-visibility / ABI call (made deliberately, not defaulted): unlike
   * the ability-window fields above (TS-only per six-axes-goal.md's "Zig
   * line" — resonanceUntilTick, judgmentMarkUntilTick, etc. never cross the
   * WASM ABI because they're ability/window state), regen/haste DO cross
   * into world_state.zig's PlayerEntity. An ally needs to SEE their own
   * buff status originating from ANOTHER player's cast — that's closer to
   * `wardShellUntilTick`'s "sim-read, cross-visible" precedent than
   * `sunlanceUntilTick`'s "self-only cosmetic tell" one. Hash-mixed
   * (hash.ts) and delta-bit-mixed (snapshotDeltaBits.ts/snapshotDelta.ts)
   * for the same reason. The Zig mirror itself is a structural/byte-layout
   * carry-through only (same contract as `energy`/`kindling`, NOT the
   * `burnUntilTick`/`freezeUntilTick` precedent): Zig's `step_world` does
   * not compute regen or haste — all mutation happens in TS (World.ts /
   * weapon.ts). Player-movement speed already crosses into the live wasm
   * physics backend (player.ts's `stepPlayer`, on by default per Phase F3)
   * via the existing `speedMultiplier` scalar parameter computed entirely
   * in TS at World.ts's speedMul chain — so folding `hasteMultiplier` in
   * there is sufficient for haste to affect movement identically on both
   * backends, with no Zig-side movement recomputation needed. (The OTHER
   * Zig entry point, the full `step_world` orchestrator that independently
   * recomputes its own speed_mul from flags like `has_speed_boost`, is not
   * the live path for production movement — see World.ts's file-header
   * comment; it is not touched by this chunk.)
   */
  regenUntilTick?: Tick;
  regenHps?: number;
  regenTickLastApplied?: Tick;
  hasteUntilTick?: Tick;
  hasteMultiplier?: number;
  /**
   * Attribution for the regen/haste windows immediately above (class-
   * overhaul-workboard.md chunk 3.2, "Devotion resource" — "count how many
   * OTHER players currently carry my effects"). Stamped by
   * `applyRegenToAlly`/`applyHasteToAlly` alongside the window fields they
   * already write — `regenSourceId`/`hasteSourceId` record WHICH caster
   * opened the currently-live window on this (the TARGET's) entity, so that
   * caster's own devotion-accrual pass (World.ts's per-tick Devotion block)
   * can answer "is this ally currently carrying MY buff, or someone else's"
   * without ambiguity in a 3+-person team. Deliberately NOT hash-mixed
   * (hash.ts) and NOT delta-bit-tracked (P_HI, snapshotDeltaBits.ts): the
   * devotion count is computed identically by every full-prediction client
   * from the SAME replayed cast input (the deterministic sim, not the wire),
   * so — like `facetTargetId`/`judgmentTargetId`'s existing "covered by a
   * numeric sibling" precedent — no wire visibility is needed for
   * correctness. The difference from that precedent: those two live on the
   * CASTER and are read only by the caster's own client; these live on the
   * TARGET, but are still only ever READ by the SOURCE caster's own
   * deterministic devotion pass, which every full-prediction client already
   * replays identically — so the same "no wire sync needed" conclusion
   * holds for a different reason. TS-only: does NOT cross the WASM ABI
   * (six-axes-goal.md "Zig line" — ability/window-adjacent bookkeeping,
   * never computed by `step_world`).
   */
  regenSourceId?: PlayerId;
  hasteSourceId?: PlayerId;
  /**
   * Syzygist Devotion — class-resource pool (class-overhaul-workboard.md
   * chunk 3.2, docs/classes-goal.md MANA section: "priest = devotion,
   * generated by buff/heal uptime on others... with a slow solo trickle").
   * 0..SYZ_DEVOTION_MAX (constants.ts). Mutated ONLY by World.ts's per-tick
   * Devotion-accrual pass (counts OTHER players currently carrying a live
   * regen/haste/Ward window sourced from THIS player, via
   * regenSourceId/hasteSourceId/wardAbsorbSourceId immediately above/below)
   * — same TS-owned-resource contract as `energy`/`kindling`: the physics
   * step never touches it, just carries it through. Only priest (classId)
   * chassis ever move this field off 0. Optional/additive: absent/undefined
   * reads as 0.
   *
   * Wire-visibility call (deliberate, matching energy/kindling's own
   * precedent exactly, NOT regen/haste's): hash-mixed (hash.ts, so a
   * divergence still triggers the reconcile-skip heuristic to fail safe)
   * but NOT delta-bit-tracked (snapshotDeltaBits.ts) — devotion is a
   * SELF-view HUD resource like energy/kindling (a Syzygist watches their
   * OWN meter; there is no "an ally needs to see my devotion" requirement
   * the way regen/haste's cross-player buff visibility has), and the local
   * owning client's own full-prediction replay already keeps it accurate
   * without needing a dedicated real-time wire channel — any drift from a
   * missed edge case self-corrects within the existing
   * FULL_RECONCILE_INTERVAL_MS safety sweep, exactly like energy/kindling
   * already accept. DOES cross into world_state.zig's PlayerEntity
   * (byte-layout carry-through only, no flag needed — `step_world` never
   * computes it, same "always-valid resource" contract as energy/kindling,
   * not the has_regen/has_haste "optional window" contract).
   */
  devotion?: number;
  /**
   * Syzygist Ward — small absorb barrier, cast-and-forget on self OR an
   * ally (class-overhaul-workboard.md chunk 3.3, docs/classes-goal.md
   * defense-verb section: "priest = wards, small absorb barriers, castable
   * on ALLIES — self-ward weak, team-ward real"). Opened by
   * `applyWardToAlly` (World.ts, the same isAlly-gated cross-player-write
   * shape as `applyRegenToAlly`/`applyHasteToAlly`), consumed by
   * `combat.ts`'s `tryDeflectDamage` — a flat absorb POOL (not a
   * mitigation FRACTION like Paladin's Kindled Ward): while
   * `wardAbsorbUntilTick > tick` and `wardAbsorbRemaining > 0`, an incoming
   * hit is reduced by `min(damage, wardAbsorbRemaining)`, draining the
   * pool; the ward breaks (fields cleared) the moment the pool hits 0, or
   * passively at `wardAbsorbUntilTick` if never fully spent. Deliberately
   * NO facing/aim requirement, unlike Kindled Ward's mandatory frontal
   * cone — "cast-and-forget... no aim/facing required after cast", the
   * low-aim design direction applied to Priest's whole kit.
   * `wardAbsorbSourceId` records which caster opened the window — read by
   * that caster's own devotion-accrual pass (same TS-only-for-ABI-purposes
   * shape as `regenSourceId`/`hasteSourceId`: does NOT cross the WASM ABI,
   * not hash-mixed, "covered by its numeric sibling" for hash purposes)
   * BUT, unlike those two, it rides the SAME wire delta bit as
   * `wardAbsorbUntilTick`/`wardAbsorbRemaining` below (see
   * snapshotDeltaBits.ts's `wardAbsorb` bit comment) — worth the free ride
   * since the warded ally's own client benefits from a legible "who gave me
   * this" read (the `syz-ward-absorbed` SimEvent's `casterId` reads this
   * same field), at zero extra bit cost.
   *
   * Wire-visibility call for `wardAbsorbUntilTick`/`wardAbsorbRemaining`
   * (deliberate, matching regen/haste's precedent, NOT energy/kindling's):
   * hash-mixed (`wardAbsorbUntilTick` only — see hash.ts's comment for why
   * `wardAbsorbRemaining` is deliberately excluded, the same "changes on
   * nearly every combat tick, delta-sync it instead" reasoning `shieldCharge`
   * already established) AND delta-bit-tracked (P_HI, snapshotDeltaBits.ts
   * — all three fields share ONE bit, `wardAbsorb`, a deliberate budget-
   * driven consolidation: P_HI had exactly one free bit left after the
   * Kindled/Syzygist-3.1 additions; see that file's comment). The warded
   * ally needs to SEE their own absorb pool deplete in real time — same "an
   * ally needs to see a buff originating from ANOTHER player's cast"
   * requirement regen/haste's own doc comment gives. DOES cross into
   * world_state.zig's PlayerEntity (byte-layout carry-through only, gated
   * by a new `PlayerFlags.has_syz_ward` bit — same "unset vs tick 0"
   * ambiguity every other optional `*_until_tick` field resolves with an
   * explicit flag, matching `has_regen`/`has_haste`'s precedent exactly;
   * `wardAbsorbSourceId` itself does NOT cross the ABI, matching
   * `facetTargetId`).
   */
  wardAbsorbUntilTick?: Tick;
  wardAbsorbRemaining?: number;
  wardAbsorbSourceId?: PlayerId;
  /**
   * Focus Hex mark (Syzygist catalog v1, single role, class-overhaul-
   * workboard.md chunk 3.4) — lives on the CASTER (not the victim), same
   * cross-player-write-hazard-avoidance shape as `facetTargetId`/
   * `judgmentTargetId`: while `focusHexMarkUntilTick > tick`, this player's
   * hits landing on `focusHexTargetId` are amplified
   * (SYZ_FOCUS_HEX_AMP_MULTIPLIER, constants.ts), checked at the same
   * post-mitigation projectile-hit site Facet Break's amp already uses.
   * TS-only ability state — does NOT cross the WASM ABI, matching
   * `facetTargetId`. Not hash-mixed for the identical "covered by its
   * numeric sibling" reason `facetTargetId` itself gives.
   */
  focusHexTargetId?: PlayerId;
  focusHexMarkUntilTick?: Tick;
  /**
   * Borrowed Time debt (Syzygist catalog v1 + Priest exclusive draft card,
   * class-overhaul-workboard.md chunk 3.4, docs/card-pool-v2.md "Borrowed
   * Time": "heal 30 instantly; over the next 6s, 15 of it drains back").
   * SELF-only bookkeeping (lives on whoever RECEIVED the heal, ally or
   * caster — never a cross-player write after the initial heal): at
   * `debtUntilTick`, World.ts's per-tick expiry pass subtracts `debtAmount`
   * from this player's own health (floor 0). v1 deliberately omits the
   * doc's "unless the target lands a hit every 2s" aggression-gate nuance
   * (no existing "last dealt damage" bookkeeping to hook — a recorded v1
   * deferral, same shape as Sunlance's "burst window, not true charge-hold"
   * gap) — the drain is unconditional, so every cast still nets strictly
   * positive health (heal amount always exceeds the later drain). TS-only,
   * does not cross the WASM ABI (self-only window-tick state, same
   * category as `sunlanceUntilTick`).
   */
  debtUntilTick?: Tick;
  debtAmount?: number;
  /**
   * Interstice catalog v1 (docs/class-ability-catalogs-v1.md, ninja-only) —
   * nine self-only window-buff/mark fields, consumed entirely inside
   * World.ts's NINJA MELEE section (arc-hit-resolution / wave-spawn /
   * wall-kick / dash-through sites) or (Ghost Guard only) combat.ts's
   * `tryDeflectDamage`. Same category as `judgmentMarkUntilTick`/
   * `sealUntilTick`/`focusHexMarkUntilTick` above: TS-only, does NOT cross
   * the WASM ABI (six-axes-goal.md "Zig line" — ability/window state, never
   * computed by `step_world`).
   *
   * The catalog's TENTH ability, Paper Double, is shipped too (previously
   * deferred — see the old paragraph this replaced, preserved in git
   * history, and cardTypes.ts's own updated deferral-turned-shipped note)
   * but deliberately has NO caster-side field here: unlike these nine, its
   * whole effect lives on a brand-new WorldState entity collection
   * (`PaperDoubleEntity` / `state.paperDoubles`, below) rather than a
   * window-buff/mark on the caster's own PlayerEntity — unavoidable, since
   * the decoy needs its own position/health/lifetime independent of the
   * caster who's still standing elsewhere. See `paperDouble.ts`'s header
   * for the full v1 shape (straight-line runner, no platform collision)
   * and World.ts's `"paper-double"` case for the cast-time spawn.
   *
   * Wire-visibility call: P_HI (snapshotDeltaBits.ts) had exactly ZERO free
   * bits left after Syzygist's `wardAbsorb` consumed the last one (bit 30 —
   * see that file's own "LAST free bit" comment) — so, matching
   * `focusHexMarkUntilTick`/`debtUntilTick`'s own established fallback
   * (the precedent set the moment the bit budget ran out), these nine are
   * NOT delta-bit-tracked and NOT hash-mixed. Every full-prediction client
   * replays the same cast input deterministically, and any drift self-
   * corrects within the existing FULL_RECONCILE_INTERVAL_MS safety sweep —
   * identical reasoning to `devotion`'s own "self-view resource, no
   * dedicated real-time wire channel needed" call, just applied to
   * self-only mark state instead of a self-view meter.
   *
   * - `undercutUntilTick`: Undercut's execute window — while live, a landed
   *   NINJA MELEE arc hit (wave excluded, a recorded v1 deferral — see
   *   World.ts's own case comment) against a victim already at or below
   *   `NINJA_UNDERCUT_HEALTH_THRESHOLD` becomes a guaranteed kill.
   * - `edgeStormUntilTick` / `edgeStormChargesRemaining`: Edge Storm's
   *   charge bank — while live and charges remain, the wave-off-swing spawn
   *   deals `NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER` damage, decrementing
   *   one charge per wave (cleared at 0, same as Judgment/Seal's "consumed
   *   on the landed hit, not just on timeout" convention).
   * - `readTargetId` / `readMarkUntilTick`: Read Mark's mark, lives on the
   *   CASTER (not the victim) — same cross-player-write-hazard-avoidance
   *   shape `facetTargetId`/`judgmentTargetId`/`focusHexTargetId` already
   *   establish: while `readMarkUntilTick > tick`, this player's NINJA
   *   MELEE arc hits landing on `readTargetId` amplify
   *   (`NINJA_READ_MARK_AMP_MULTIPLIER`). Razor Route (below) reuses this
   *   SAME pair of fields for its own "marks Read on cross" line — the two
   *   abilities share one mark slot by design, not an accident.
   * - `wallBloomUntilTick`: Wall Bloom's window — the NEXT wall-kick (the
   *   chassis's existing energy-grant site) also spawns a shard burst at
   *   the wall-contact point; single-use, cleared on that wall-kick.
   * - `ghostGuardChargeUntilTick`: Ghost Guard's banked evasion charge —
   *   consumed by `combat.ts`'s `tryDeflectDamage` (a new branch right
   *   after the always-on dash-i-frame check), not by anything in
   *   World.ts: one incoming hit becomes a near-miss if the player is
   *   currently moving (`NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD`,
   *   combat.ts), 1 charge.
   * - `secondWindUntilTick`: Second Wind's window — the NEXT landed NINJA
   *   MELEE arc hit within the window also heals
   *   (`NINJA_SECOND_WIND_HEAL`) and dumps bonus energy
   *   (`NINJA_SECOND_WIND_ENERGY`) on top of the ordinary energy-from-
   *   contact grant; single-use, cleared on that hit.
   * - `razorRouteUntilTick`: Razor Route's window — the NEXT dash-trigger
   *   (NINJA MELEE section's own dash-through detection) gets an additive
   *   velocity boost (`NINJA_RAZOR_ROUTE_BOOST_SPEED`) along the dash
   *   direction, plus a Read mark (above) on the first body crossed during
   *   that dash; single-use, cleared the moment the empowered dash starts.
   * - `fooledUntilTick`: Paper Double's burst debuff (2026-07-19 fast-follow
   *   — docs/card-pool-v2.md's own "Resonance:" line, a recorded v1 gap
   *   until now: "The burst leaves Fooled (2.0s) on those it catches;
   *   abilities cast into Fooled gain +25%"). Lives on the VICTIM (unlike
   *   every mark field above, which lives on the attacker/caster) — the
   *   opposite shape from `readTargetId`/`focusHexTargetId`/etc, since this
   *   is a status ANY attacker's ability can exploit, not a bond between one
   *   specific attacker and target. Checked by `fooledDamageMultiplier`
   *   (World.ts) at every ability-damage site (melee arc hits,
   *   `resolveInstantAoeCasts`) AND the generic projectile hit-confirm pass
   *   — the doc's "abilities" scoping is a v1 simplification: the codebase
   *   has no existing way to distinguish an ability-sourced projectile from
   *   a basic weapon shot at that shared hit-confirm site (Facet Break's own
   *   caster-side mark amp, right beside this check, has the identical
   *   scope already — it doesn't discriminate either), so Fooled amps ANY
   *   damage landing on the victim rather than "abilities" specifically.
   *   Recorded here, not silently narrowed or silently widened.
   *
   *   Wire-visibility call: NEITHER hash-mixed nor delta-bit-tracked —
   *   matches every sibling Interstice window field immediately above
   *   (`undercutUntilTick` through `razorRouteUntilTick`, none of which are
   *   in hash.ts or snapshotDeltaBits.ts either, unlike the Geometrician/
   *   Kindled/Syzygist window fields elsewhere in this file), not a new gap
   *   introduced here. Correctness doesn't depend on it regardless — the
   *   amp check reads the victim's own full-prediction state, already
   *   deterministic from synced burst-cast inputs on every client. Also
   *   moot on the wire-budget front: both P_LO and P_HI
   *   (snapshotDeltaBits.ts) are completely full (31/31 bits each), so
   *   adding tracking here would need a wire-protocol change regardless.
   */
  undercutUntilTick?: Tick;
  edgeStormUntilTick?: Tick;
  edgeStormChargesRemaining?: number;
  readTargetId?: PlayerId;
  readMarkUntilTick?: Tick;
  wallBloomUntilTick?: Tick;
  ghostGuardChargeUntilTick?: Tick;
  secondWindUntilTick?: Tick;
  razorRouteUntilTick?: Tick;
  fooledUntilTick?: Tick;
  /**
   * Jetpack fuel reservoir. Range [0, JETPACK_MAX_FUEL]; defaults to MAX
   * when absent (older snapshots) and is reset to MAX on respawn. Drains
   * while the jetpack is active and recharges otherwise. See `sim/player.ts`.
   */
  jetpackFuel?: number;
  /**
   * Parry + shield state. All optional / additive — older snapshots that omit
   * these read as "no parry active, no shield charge". See sim/combat.ts for
   * the timing/drain constants and the helpers that mutate these fields.
   * shieldCharge is also used by the shield-cell pickup as a numeric resource.
   */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** Tick (inclusive) at which the parry window expires. */
  parryActiveUntilTick?: Tick;
  /** Tick (inclusive) before which a fresh parry can't start. */
  parryCooldownUntilTick?: Tick;
  /** Aim direction (radians) captured the moment parry started. */
  parryFacing?: number;
  /**
   * Pickup-driven buffs / debuffs. All fields are additive and optional. When
   * the field is unset or its tick is `<= state.tick`, the buff is inactive.
   *
   * - overchargeUntilTick: damage + fire-rate buff (mirrors `overchargeMs`).
   * - damageAmpUntilTick: extra damage multiplier (mirrors `damageAmpMs`).
   * - speedBoostUntilTick: movement speed buff (mirrors `speedBoostMs`).
   * - meleeModeUntilTick: forces close-range / melee fire pattern.
   * - slowDebuffUntilTick: applied to OTHER players when this player picks up
   *   a slow-trap (the trap-victim debuff timer).
   * - vulnerabilityUntilTick: takes increased damage.
   * - blockJammerUntilTick: disables shield + parry while active.
   * - bossModeUntilTick: boss-mode buff (bigger / slower / more health / more
   *   damage). Picker-only.
   */
  overchargeUntilTick?: Tick;
  damageAmpUntilTick?: Tick;
  speedBoostUntilTick?: Tick;
  meleeModeUntilTick?: Tick;
  slowDebuffUntilTick?: Tick;
  vulnerabilityUntilTick?: Tick;
  blockJammerUntilTick?: Tick;
  bossModeUntilTick?: Tick;
  /**
   * Ward shell (six-axes-goal.md Layer 1): set at Emission cast when the
   * hand's Ward axis is charged. While `wardShellUntilTick > tick`, incoming
   * damage is multiplied by EMISSION_WARD_DAMAGE_MULT before shield absorb
   * (mitigation order: parry > shell > shield). Additive/optional — older
   * snapshots read "no shell". Hash-mixed (buff-tick precedent).
   */
  wardShellUntilTick?: Tick;
  /**
   * Drafted actives (six-axes-goal.md Layer 2) — per-slot cooldowns + the
   * Crimson Tithe window. All additive/optional (older snapshots read "no
   * cooldown, no window"), all hash-mixed. Slots map to input bits 10..12
   * in pick order; the slot's card lives in the resolved build's `actives`.
   * The rack is locked at exactly 3 slots (MAX_ABILITY_SLOTS,
   * docs/classes-goal.md "Rotation system") — `slot4CooldownUntilTick` is
   * kept as a reserved/inert wire field (never set by World.ts) rather
   * than removed, to avoid a protocol-shape change for a slot that will
   * never exist; it always reads `undefined`.
   */
  slot1CooldownUntilTick?: Tick;
  slot2CooldownUntilTick?: Tick;
  slot3CooldownUntilTick?: Tick;
  slot4CooldownUntilTick?: Tick;
  /** Crimson Tithe active window: while set and in the future, fired shots
   *  carry leechFraction (weapon.ts stamps it at spawn). */
  titheUntilTick?: Tick;
  /** Veil of Nought window: homing and satellites cannot target this
   *  player; firing ends it early (weapon fire clears it). */
  veilUntilTick?: Tick;
  /** Severing Answer stance: the next hit taken while live is negated and
   *  returned to the attacker (capped) — consumed on use. Mitigation
   *  order: parry > counter > ward shell > shield. */
  counterUntilTick?: Tick;
  /** Mid-round respawn timer: stamped when the player dies during the
   *  fighting phase; the sim respawns them at this tick (RESPAWN_DELAY_MS)
   *  unless sudden death is active (last-one-standing rounds never
   *  respawn). Cleared on respawn / round boundary. Additive/optional. */
  respawnAtTick?: Tick;
  /**
   * Geometrician catalog v1 (docs/class-ability-catalogs-v1.md, wizard-only
   * — classId-gated at the offer roll). All additive/optional, all
   * hash-mixed, same window-buff contract as titheUntilTick/veilUntilTick
   * above.
   *
   * - sunlanceUntilTick: Sunlance window — fired shots deal
   *   GEO_SUNLANCE_DAMAGE_MULTIPLIER while live (weapon.ts stamps it,
   *   mirrors the Crimson Tithe pattern exactly).
   * - facetTargetId / facetMarkUntilTick: Facet Break's mark, stored on the
   *   CASTER (not the victim — avoids a cross-player mid-loop write hazard
   *   in World.ts's per-player step). While live, a hit this player lands
   *   on `facetTargetId` is amplified (checked at the hit-confirmed site).
   * - overclockUntilTick: Overclock window — fire rate up / spread tighter
   *   while live (weapon.ts), ends naturally at the tick rather than early
   *   on a stop-shooting read (doc's "ends early" nuance is a deferred v2).
   * - measureUntilTick: Measure window (reworked 2026-07-19, docs/axiom-
   *   deviations-audit.md D2 — the ORIGINAL v1 was a flat +1 ammo grant,
   *   "cosmetic-heavy, small mechanical help" in the catalog doc's own
   *   words, a confirmed dominated filler pick). Same window-buff shape as
   *   overclockUntilTick/sunlanceUntilTick, but a genuinely different KIND
   *   of buff, not just a smaller one: while live, shots fired go dead-
   *   center (spread forced to 0, weapon.ts) with a modest damage amp — a
   *   short, deliberate "one precise shot" tool, not Overclock's sustained
   *   spray-faster window (the doc's own "true line" / "information and
   *   confidence" flavor, made mechanically real instead of cosmetic).
   * - recoilStepUntilTick: Recoil Step's rider window (reworked 2026-07-19,
   *   same D2 sweep — Recoil Step's own catalog doc text already named this
   *   exact effect, "next shot gets knock-self reduction," but v1 shipped
   *   only the hop and explicitly deferred it: "would need its own
   *   weapon.ts window field"). While live, this player's own recoil
   *   impulse from firing (weapon.ts) is reduced — the orthogonal reason
   *   Recoil Step needed against Slip Node (docs/axiom-deviations-audit.md
   *   D2: "likely dominated by Slip Node... needs a kite-specific payoff or
   *   it's a second filler"): Slip Node is a raw gap-crosser, Recoil Step is
   *   now a defensive KITE tool — hop away, then fire aggressively backward
   *   without being thrown further off your intended retreat line.
   *
   * Wire-visibility call for BOTH (deliberate, matching `devotion`'s own
   * precedent, NOT sunlanceUntilTick/overclockUntilTick's): hash-mixed
   * (hash.ts, so a divergence still fails safe) but NOT delta-bit-tracked
   * (snapshotDeltaBits.ts) — bitsHi is completely full (bits 0-30 all
   * spoken for; Ward's own fields already consolidated onto "the LAST free
   * bit" per that file's header note) and adding a 32nd/33rd tracked field
   * would need a wire-protocol change, well outside a filler-ability
   * rework's scope. Correctness doesn't need it: like `devotion`, this is a
   * SELF-view window (a Geometrician watches their own precision/kite tell,
   * there is no "an ally needs to see this" requirement Ward-style buffs
   * have), and the owning client's own full-prediction replay of its own
   * cast input already keeps it accurate without a dedicated wire channel.
   */
  sunlanceUntilTick?: Tick;
  facetTargetId?: PlayerId;
  facetMarkUntilTick?: Tick;
  overclockUntilTick?: Tick;
  measureUntilTick?: Tick;
  recoilStepUntilTick?: Tick;
  /**
   * Kindled catalog v1 (docs/class-ability-catalogs-v1.md, paladin-only —
   * classId-gated at the offer roll, class-overhaul-workboard.md chunk
   * 2.6). All additive/optional, all hash-mixed (except the id-typed
   * `judgmentTargetId`, same "covered by its numeric sibling" precedent as
   * `facetTargetId`), same window-buff contract as the Geometrician fields
   * immediately above.
   *
   * - judgmentTargetId / judgmentMarkUntilTick: Judgment Line's mark,
   *   stored on the CASTER (not the victim — same cross-player mid-loop
   *   write hazard `facetTargetId` avoids). While live, this player's
   *   Kindled Edge / dash-bash hits on `judgmentTargetId` are amplified
   *   (checked at each hit-resolution site in World.ts).
   * - sealUntilTick: Unbroken Seal window — the NEXT Kindled Edge hit this
   *   player lands is amplified + applies a stagger (heavy slow) to the
   *   victim, then the window is consumed early (on that hit), not just on
   *   timeout. "Big hit-stop" is render-only juice (character-sheets-v1.md
   *   Paladin ability feel contract), not sim state.
   * - aegisShareUntilTick: Aegis Share window — while live, THIS player's
   *   team-peel eligibility radius (combat.ts's WARD_PEEL_RADIUS_PX) is
   *   widened for allies checking whether this player's Ward shadow covers
   *   them (World.ts's `findTeamPeelWarder`).
   */
  judgmentTargetId?: PlayerId;
  judgmentMarkUntilTick?: Tick;
  sealUntilTick?: Tick;
  aegisShareUntilTick?: Tick;
  /**
   * Kindled catalog v1 fast-follow (class-overhaul-workboard.md chunk 2.6,
   * 2026-07-18) — originally 3 abilities the earlier pass deferred. All
   * additive/optional, TS-only ("the Zig line" — never cross the ABI, same
   * category as judgmentMarkUntilTick/sealUntilTick/aegisShareUntilTick
   * above), self-only fields (never written by another player's cast —
   * Rally Light and Shock Ring need no NEW fields beyond what's already
   * here or on other catalog entries).
   *
   * - shockRingArmedUntilTick: Shock Ring's cast-opened window, covering the
   *   hop's airtime. World.ts's per-player movement step detects "just
   *   landed" the same way it already detects "just wall-kicked" (grounded-
   *   before/after comparison around `stepPlayer`) and, while this window is
   *   live, fires the slam nova then clears the flag.
   *
   * (Retribution Edge's retributionArmedUntilTick/retributionReadyUntilTick
   * two-window pair — "cast to arm, block to ready, swing to consume" —
   * was removed 2026-07-19 along with the ability itself; see docs/class-
   * ability-catalogs-v1.md's cut note. It was cut for an unaddressed self-
   * fueling-loop brake gap, not fixed, so the fields aren't coming back.)
   */
  shockRingArmedUntilTick?: Tick;
  /**
   * Rally Light (Kindled catalog v1 fast-follow) — this player is an aura
   * SOURCE while live. Deliberately the ONLY field the ability needs: every
   * beneficiary (self or ally, World.ts's `hasRallyLightBoost`) reads this
   * field off a nearby player and multiplies its OWN speed/damage — nothing
   * ever WRITES a buff onto another player's entity, so this is safe to
   * read directly inside the main per-player loop (unlike the Syzygist
   * ally-buff fields, which need `pendingSyzygistCasts` because THEY write
   * cross-player). See constants.ts's KIN_RALLY_LIGHT_* header comment.
   */
  rallyLightUntilTick?: Tick;
  // (Crater/Retort — docs/card-pool-v2.md #26-27, exclusive: Paladin — used
  // craterArmedUntilTick/retortBank/retortBankUntilTick here. Cut entirely
  // 2026-07-19 alongside Bastion, their sibling exclusive; see cards.ts's
  // cut note above the old crater/retort/bastion card definitions. Fields
  // removed, not left undefined-but-declared.)
  /**
   * Kindled Resolve (Kindled catalog v1 coverage-floor fast-follow,
   * docs/axiom-deviations-audit.md, 2026-07-18) — self-only buff window
   * opened by spending Kindling (constants.ts's KIN_KINDLED_RESOLVE_*
   * header comment has the full design). While live: this player's
   * outgoing damage is amplified (World.ts's `kindledResolveDamageMultiplier`,
   * checked at every hit-resolution site rallyLightDamageMultiplier already
   * is) and incoming stagger/slow multipliers aimed at them are softened
   * toward 1 (`applyKindledResolveStaggerResist`, checked at every site
   * that WRITES a stagger onto a victim). Same TS-only, hash-mixed-not-
   * delta-synced contract as shockRingArmedUntilTick/rallyLightUntilTick
   * above (never crosses the Zig ABI).
   */
  kindledResolveUntilTick?: Tick;
  /**
   * Resonance (docs/classes-goal.md "Rotation system", class-overhaul-
   * workboard.md chunk 0.1 — "chain unlike abilities for a bonus").
   * `resonanceUntilTick`/`resonanceSourceKind` are stamped by EVERY
   * successful ability activation in World.ts's drafted-actives block
   * (six-axes Layer 2 kinds AND the Geometrician catalog v1 alike — the
   * mechanism reads `active.kind` off whichever ability just fired and is
   * otherwise class-blind, per the doc's "the mechanism itself must be
   * class-agnostic" requirement):
   *   - `resonanceSourceKind` = the `AbilityKind` that opened/most-recently
   *     refreshed the window.
   *   - `resonanceUntilTick` = the tick the window closes
   *     (RESONANCE_WINDOW_MS, constants.ts).
   * A cast resonates (consumes the window for the v1 bonus — a fractional
   * cooldown refund, RESONANCE_CD_REFUND_FRACTION) only when
   * `resonanceUntilTick > tick` AND the new cast's kind differs from
   * `resonanceSourceKind`. Casting the SAME kind twice in a row never
   * resonates — the field is simply overwritten with the same value, which
   * is indistinguishable from "no bonus" at the check site. This is the
   * literal enforcement of "chain UNLIKE abilities": same-ability spam is
   * excluded by the inequality check, not by a separate cooldown/flag.
   * "Resonance only chains across the equipped 3" (classes-goal.md) needs
   * no separate enforcement here: only kinds present in the resolved
   * build's `actives` (capped at MAX_ABILITY_SLOTS) ever reach the
   * activation switch that reads/writes these fields — an ability that
   * isn't equipped can never open or consume a window.
   * Additive/optional: older snapshots read "no window open" (matches
   * every other window-buff field on this type). Hash-mixed
   * (`resonanceUntilTick` only — `resonanceSourceKind` is a string set
   * deterministically from the same input edge both sides already replay,
   * the same "don't hash id-typed fields whose divergence is covered by a
   * numeric sibling" precedent as `facetTargetId`/`facetMarkUntilTick`
   * above). TS-only: does NOT cross the WASM ABI, matching every other
   * six-axes/catalog ability field — six-axes-goal.md's "The Zig line"
   * rules actives (and their window state) TS-authoritative, full stop;
   * the opt-in wasm dev step never sees ability state at all.
   */
  resonanceUntilTick?: Tick;
  resonanceSourceKind?: string;
  /**
   * Stolen Fangs (legendary defense card): banked lock charges from
   * absorbing a shielded hit. The next fired shot(s) consume one charge and
   * become homing at reduced damage (see sim/weapon.ts). Cap 2; expires
   * unspent at `pendingLockExpiresAtTick`. See sim/World.ts's shielded-hit
   * branch for where charges are granted.
   */
  pendingLockCharges?: number;
  pendingLockExpiresAtTick?: Tick;
  /**
   * True when the player's foot was touching a static at end-of-tick.
   * Sourced from `PlayerMovementMemory.groundedLastFrame` after the
   * collision resolve in `World.ts`. Render-only signal — sim correctness
   * code uses the host-only movement memory directly. Wire-encoded on the
   * snapshot so remote-rig render can suppress the walk-step foot lift
   * when the player is actually airborne. Optional/additive: older
   * snapshots omitting the field read as "unknown / treat as not grounded".
   */
  grounded?: boolean;
  /**
   * -1/0/+1: which side (if any) the player is currently touching/gripping
   * a wall on, at end-of-tick. Sourced from
   * `PlayerMovementMemory.touchingWallDir` in `World.ts`, same render-only
   * pattern as `grounded` above — sim correctness code uses the host-only
   * movement memory directly. Wire-encoded so remote rigs can render the
   * wall-slide/wall-jump pose. Optional/additive: omitted reads as 0 (not
   * touching a wall).
   */
  touchingWallDir?: number;
  /**
   * True while a dash is active, at end-of-tick. Sourced from
   * `PlayerMovementMemory.dashActiveMs > 0` in `World.ts`. Render-only
   * signal, same pattern as `grounded`/`touchingWallDir`. Optional/additive:
   * omitted reads as false.
   */
  dashing?: boolean;
  /**
   * Dash-bash readiness, 0 (just used) .. 1 (ready to fire again), at
   * end-of-tick. Sourced from `PlayerMovementMemory.dashCooldownMs` against
   * the effective (card-scaled) cooldown window in `player.ts`. Render-only
   * signal, same pattern as `dashing`/`touchingWallDir` above. Optional/
   * additive: omitted hides the HUD indicator rather than defaulting to
   * either state.
   */
  dashReadyFrac?: number;
  /**
   * Alternating throwing-hand parity (0 = lead, 1 = back) for the last shot.
   * Toggled per fire in stepWeapon so the muzzle + shot-fired event pick the
   * hand that matches the rig's alternating throw. Runtime-only cosmetic
   * field; not wire-encoded (the authoritative hand reaches remote clients
   * via the shot-fired event, and predicted-local parity self-corrects).
   */
  throwHandParity?: number;
  /**
   * Wizard-only basic-fire ramping channel (weapon.ts stepWeaponNative,
   * constants.ts's GEO_CHANNEL_RAMP_MS doc comment has the full design
   * rationale). RELOCATED from Priest to Wizard 2026-07-19 (Jake's redirect:
   * "the wizards hould have ramping fire rate to feel more glass canony" —
   * see GEO_CHANNEL_RAMP_MS's own comment for the full glass-cannon framing;
   * Priest's basic fire is now the unrelated "oozing tendrils" mechanic,
   * SYZ_TENDRIL_* in constants.ts). Milliseconds Fire has been CONTINUOUSLY
   * held by a wizard player — ticks up every tick `fireRequested` is true
   * and the player is alive, reset to `undefined` the instant
   * `fireRequested` goes false (or the player dies), so a release always
   * drops the ramp back to baseline immediately, matching the "punishes
   * flicking between targets" design intent. Only ever written for
   * `classIdForArchetype(characterId) === "wizard"` — every other class
   * never touches this field, so it always reads `undefined` for them
   * (purely additive, zero behavior change). Field NAME kept class-generic
   * (not renamed to e.g. `wizardChannelHoldMs`) — it was already
   * class-neutral before the relocation and renaming it would only churn
   * every read/write site for no behavioral gain.
   *
   * Runtime-only, same category as `throwHandParity` immediately above:
   * not wire-encoded and not mixed into `hash.ts`'s reconcile hash. The
   * ramp's actual EFFECT (faster shot cadence) is already fully visible to
   * remote clients through the wire-synced `fireCooldownMs` field and the
   * spawned projectiles themselves, so a remote observer never needs this
   * raw hold-duration counter to render correctly; and like
   * `throwHandParity`, it's deterministically derived from
   * `fireRequested`'s own input-bit history + dt, so predicted-local state
   * self-corrects without a wire channel.
   */
  channelHoldMs?: number;
  /**
   * Duos-queue team assignment (docs/classes-goal.md "Venue integration",
   * class-overhaul-workboard.md chunk 1.1 — "Team identity threading into
   * the sim"). Populated ONCE at entity construction from
   * `PlayerSpawnInfo.teamId` (World.create for the initial roster,
   * rosterOps.applyMidMatchJoin for mid-match joiners — the same shared
   * spawn code path both live host and replay re-sim use) and never
   * mutated afterward by any sim code. Absent = an ordinary FFA combatant,
   * same additive/optional contract as every other field on this type.
   * `team.ts`'s `isAlly(a, b)` is the one sanctioned way to read this pair-
   * wise; callers should not compare `.teamId` directly.
   *
   * Wire treatment (deliberately NOT the window-buff pattern most fields on
   * this type follow):
   *   - NOT hash-mixed (hash.ts): the hash exists to catch PREDICTION
   *     divergence from client-side ticking. teamId is never written by
   *     World.step / stepWithRuntime — it's an input, not simulation
   *     output — so it can't diverge the way x/health/cooldowns can. Same
   *     precedent as `characterId`/`weaponId` (also un-hashed): identity
   *     fields set from spawn data, not stepped.
   *   - NOT delta-bitmask-mixed (snapshotDeltaBits.ts P_LO/P_HI): it never
   *     changes after spawn, so there's no "update" to diff — it reaches a
   *     recipient once, in full, via whichever channel first hands them
   *     this entity (FullSnapshot's whole-`WorldState` spread, or a
   *     `CollectionDelta.added` entry, which copies the entire entity
   *     object rather than a bit-selected patch). Exactly how `characterId`
   *     already reaches clients today — no precedent-breaking here.
   *
   * ABI: DOES cross into `sim/src/world_state.zig`'s `PlayerEntity` (unlike
   * Resonance, which six-axes-goal.md's "Zig line" keeps TS-only because
   * it's ABILITY/window state). teamId is ROSTER/IDENTITY metadata — the
   * same category as `character_id`/`weapon_id_bytes`/`id_bytes`, which
   * already cross the ABI — not ability state, so the "Zig line" doesn't
   * exclude it. It needs to be visible to any future Zig-side combat code
   * (friendly-fire / ally-targeting checks physics-adjacent enough to ever
   * move into `step_world`), so it's mirrored as `team_id_len` +
   * `team_id_bytes` (+ `PlayerFlags.has_team_id`), appended after `energy`.
   */
  teamId?: string;
};

export type ProjectileEntity = {
  id: EntityId;
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  shape: ProjectileShape;
  radius: number;
  damage: number;
  lifetimeMs: number;
  pathing: ProjectilePathing;
  element: string;
  bouncesRemaining: number;
  pierceRemaining: number;
  /**
   * Optional pathing / impact extras. All fields are additive and default
   * to "no effect" when absent so older snapshots stay compatible. Populated
   * by `weapon.stepWeapon` from the resolved card build.
   */
  impact?: ProjectileImpact;
  impactRadiusPx?: number;
  splitCount?: number;
  slowMultiplier?: number;
  homingStrength?: number;
  accelerationMultiplier?: number;
  gravityScale?: number;
  rangePx?: number;
  /** Element-status duration multiplier applied at the hit site (Emission
   *  cast shards carry ×2, capped per-status — docs/emission-engine-goal.md).
   *  Absent/1 = ordinary gunfire statuses. Additive optional contract like
   *  every extra above; prediction-only nuance: snapshot-reconciled remote
   *  projectiles may omit it, but status OUTCOMES on players are server-
   *  authoritative fields anyway (burnUntilTick etc.), so the divergence
   *  window is a frame of local cosmetic prediction at most. */
  statusScale?: number;
  /** Six Axes shard extras (docs/six-axes-goal.md Layer 1) — spawn-time
   *  config from the caster's resolved EmissionConfig, same additive /
   *  statusScale contract (absent = ordinary gunfire, no axis expression).
   *  - leechFraction: Drain — post-mitigation damage healed to the owner.
   *  - executeBelowFrac: Technique — a hit on a player below this health
   *    fraction finishes them.
   *  - wrapShots: Mystery — the shard wraps the map rect instead of flying
   *    off it. */
  leechFraction?: number;
  executeBelowFrac?: number;
  wrapShots?: boolean;
  /** Generic per-tick `pathing: "homing"` re-target filter (projectile.ts's
   *  `closestNonOwnerPlayer`) — when true, also skips the owner's ALLIES,
   *  not just the owner. Absent/false = the homing re-target machinery's
   *  original behavior (closest non-owner PLAYER, ally or not) — every
   *  homing shot in the sim today (Bleed Tithe, Stolen Fangs, and — as of
   *  the Priest tendril dual-purpose rework below — Priest's own tendrils)
   *  leaves this unset, so this flag is currently dormant infrastructure,
   *  kept for a future "true enemy-seeking-only" homing source rather than
   *  removed outright. REVISED 2026-07-19: this field used to be stamped
   *  `true` on every Priest tendril (see git history) — Jake's redirect
   *  ("shooting projectiles... auto-home to the right target... ally=heal,
   *  enemy=curse") replaced that enemy-only restriction with dual-target
   *  homing (closest non-owner player of EITHER team), so tendrils no
   *  longer set this at all. See `tendril` below for the identity flag
   *  that replaced it at every gate site this field used to serve. */
  enemyOnly?: boolean;
  /** Priest/Syzygist's "oozing tendrils" basic fire — a pure IDENTITY flag
   *  (weapon.ts's `isPriestTendril` spawn site is the one place this is
   *  ever stamped `true`), deliberately decoupled from any TARGETING or
   *  BEHAVIOR flag so downstream consumers never break when this class's
   *  targeting/steering rules change independently (`enemyOnly` used to
   *  conflate identity with behavior — this field is the fix). Three
   *  consumers, all additive/optional-contract, all gated on this ONE
   *  field:
   *   - `client/src/game/render/renderContract.ts`'s `produceProjectiles`
   *     — opts the shot into the bespoke "oozing tendril" travel-phase
   *     trail (ProjectileVfx.ts) instead of a generic shape-based dot.
   *   - `World.ts`'s projectile hit-confirm site — a tendril that reaches
   *     an ALLY (`team.ts`'s `isAlly`) pulses a HEAL instead of damage +
   *     fire-burn (docs/classes-goal.md "priest = low-aim... ally=heal,
   *     enemy=curse"); every other class's fire-element hits on an ally
   *     (e.g. a duo Wizard's Molten Core) are completely unaffected since
   *     they never set this flag.
   *   - `projectile.ts`'s homing pathing step — blends a repulsion force
   *     away from the nearest platform surface into the per-tick homing
   *     turn (`steerAwayFromNearestPlatform`), so a tendril organically
   *     curves around terrain instead of dying on contact with it. Every
   *     other class's homing shot never calls this code path.
   *  Additive optional contract like every extra above: only ever `true`
   *  for a Priest tendril, so this is zero behavior change for anything
   *  else regardless of what `enemyOnly` above is ever set to. */
  tendril?: boolean;
  /** Interstice's small precision shots (2026-07-20, RENAMED from the
   *  narrower `ninjaWave` once a second ability needed the identical
   *  treatment — same pure-IDENTITY-flag shape as `tendril` above). Stamped
   *  `true` at TWO sites: the wave-off-swing (Edge Storm, "NINJA MELEE"
   *  section) and Needle's shard (both used to ride `element === "crystal"`
   *  alone for their render dispatch, reusing the Geometrician's own
   *  crystal-dart shape — "wizard's stuff" on a class whose whole identity
   *  is dual-blade insidious-precise, not crystal munitions). Opts a shot
   *  into a bespoke, smaller blade-sliver render (ProjectileVfx.ts's
   *  `drawBladeSliverBody`) and the Interstice cyan tint instead of the
   *  resolved element color — render-only, `element` itself is unchanged
   *  on both (damage/impact behavior untouched). One shared shape across
   *  both abilities is deliberate: a consistent "this is Interstice's
   *  blade-shard" signature reads better than two near-identical bespoke
   *  shapes with no real visual reason to differ. */
  ninjaBladeShard?: boolean;
  /** Kindled's Sunspike (2026-07-20) — same pure-IDENTITY-flag shape as
   *  `ninjaBladeShard` above, but deliberately a DIFFERENT silhouette, not
   *  a recolor of it: Sunspike was riding `element: build.projectile.element`
   *  (whatever the caster's own card loadout resolves to), so it read as
   *  "a faster, narrower copy of your basic shot" with no Kindled identity
   *  at all. Opts into a solid, SYMMETRIC gold spike (ProjectileVfx.ts's
   *  `drawSpikeBody`) — the class's "committed, not flicked" heaven-tank
   *  weight (chassis-design-axioms.md), as distinct from Interstice's
   *  asymmetric "insidious" blade-sliver as the two chassis are from each
   *  other. Render-only; `element` stays whatever the build resolves to. */
  kindledThrust?: boolean;
  /** Tracking state set/maintained by the projectile stepper. */
  ageMs?: number;
  traveledPx?: number;
  originX?: number;
  originY?: number;
  /** Boomerang-only: true once the shard has begun curving home. */
  returning?: boolean;
  /** Sticky-only: ms remaining before the stuck shard detonates. */
  stickyFuseMs?: number;
};

export type DestructibleEntity = {
  id: EntityId;
  kind: DestructibleKind;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  explosive: boolean;
  flammable: boolean;
};

export type FireEntity = {
  id: EntityId;
  x: number;
  y: number;
  radius: number;
  remainingMs: number;
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
  damagePerSecond: number;
};

export type PickupEntity = {
  id: EntityId;
  kind: PickupKind;
  x: number;
  y: number;
  radius: number;
  amount: number;
  active: boolean;
  respawnAtTick: Tick;
  /**
   * Optional buff duration (ms) carried from the source `PickupDefinition`.
   * Used by buff-style pickups (overcharge-core, damage-amp, speed-boost,
   * melee-mode, slow-trap, vulnerability-trap, block-jammer, boss-core).
   * Absent for instant pickups (health-shard, card-cache).
   */
  durationMs?: number;
  /**
   * Optional respawn time (ms) carried from the source `PickupDefinition` so
   * the pickup stepper can deterministically schedule respawns without the
   * map being passed in. Falls back to a default in `pickup.ts` when absent.
   */
  respawnMs?: number;
};

/**
 * Auto-firing companion that orbits its owner. Position is derived each tick
 * from owner.x/owner.y + (cos(angle), sin(angle)) * orbitRadius — the entity
 * stores only the orbit angle so a fresh angle deterministically reproduces
 * the position. Spawned by the `orbitingSatellites` weapon-card modifier.
 */
export type SatelliteEntity = {
  id: EntityId;
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
  /** Current orbit angle in radians; advanced each tick. */
  angle: number;
  /** Radius (px) the satellite orbits at, around owner.x/owner.y. */
  orbitRadius: number;
  /** Time until the satellite can fire again (ms). */
  fireCooldownMs: number;
  /** Remaining lifetime (ms). Use Infinity for permanent companions. */
  lifetimeMs: number;
};

/**
 * Paper Double's decoy runner (Interstice catalog v1, docs/card-pool-v2.md
 * "Paper Double" — the ninja's tenth ability, previously deferred because it
 * "needs a new decoy/summon ENTITY type in WorldState... a genuinely new
 * ABI-crossing entity concept none of the other 36 catalog abilities shipped
 * this session needed" — cardTypes.ts's own former deferral note, now
 * updated). Own hitbox (`paperDouble.ts`'s `paperDoubleAABB`, the same
 * PLAYER_BODY_WIDTH/HEIGHT box a real player uses — "same mass silhouette"
 * per the card's visual-read text), own health pool, own lifetime — a real
 * damageable body, not a caster-side buff window like every other Interstice
 * catalog field on PlayerEntity above.
 *
 * v1 simplifications (documented, not silent — same "honest partial over
 * padded" discipline this session's other v1 calls already use):
 *   - "sprinting your last input vector" is read as a STRAIGHT LINE at a
 *     fixed heading captured once at cast time (`vx`/`vy`, constant for the
 *     decoy's whole life) — not a full replay buffer of the caster's actual
 *     historical inputs. See World.ts's `"paper-double"` case for exactly
 *     how that heading is derived (current HORIZONTAL velocity only —
 *     gravity's vertical fall component doesn't count as "input", it would
 *     otherwise spawn a decoy diving into the floor mid-air — falling back
 *     to the full 2D aim direction if horizontally stationary).
 *   - No platform collision, no gravity: the decoy is a pure kinematic
 *     mover (position += velocity × dt every tick, unconditionally) for its
 *     whole 2.5s max life, not a full physics body. A decoy cast toward a
 *     wall/ledge visually "sprints" through it rather than colliding —
 *     acceptable for a body that's alive at most 2.5s and never fights back;
 *     a grounded/collidable mover is a fast-follow, not a blocker for the
 *     core damageable/lifetime/burst loop this ships.
 *   - Damage sources: enemy weapon fire (`paperDouble.ts`'s own projectile-
 *     collision loop, mirroring `destructible.ts`'s exactly) and melee (the
 *     ninja slash arc + paladin edge arc, mirroring their existing "arc
 *     hit-check vs. destructibles" blocks in World.ts) both apply. The
 *     owner's own projectiles/melee never damage their own decoy (mirrors
 *     `FireEntity`'s owner-exclusion in `fire.ts`).
 *
 * Wire-visibility call (deliberate, NOT matching the self-only ability-
 * window fields above): unlike `undercutUntilTick`/`readMarkUntilTick`/etc,
 * an enemy genuinely needs to SEE this entity to shoot it — it's a
 * cross-visible world entity, same category as `FireEntity`/
 * `SatelliteEntity`, not ability/window state. `state.paperDoubles` crosses
 * the network snapshot-delta wire (net/snapshotDelta.ts, net/
 * snapshotDeltaBits.ts's `PAPER_DOUBLE` bits) exactly like those two
 * collections do. It does NOT cross the WASM ABI (six-axes-goal.md "Zig
 * line" still applies — this is TS-only combat/ability state, not identity/
 * roster/resource state; the opt-in wasm physics dev step spreads
 * `...state` through untouched, matching every other collection it doesn't
 * know about).
 */
export type PaperDoubleEntity = {
  id: EntityId;
  /** The caster who cast Paper Double — never null, unlike FireEntity's
   *  world-owned option (a decoy always has a living owner; killing the
   *  owner doesn't currently despawn their decoy early — it just runs out
   *  its own clock, a deliberate small v1 simplification, not a hazard:
   *  the decoy can't be re-cast while alive anyway, CD (9s) exceeds max
   *  lifetime (2.5s) in every build). */
  ownerId: PlayerId;
  x: number;
  y: number;
  /** Fixed heading × NINJA_PAPER_DOUBLE_SPEED, captured once at cast —
   *  see this type's own header comment. Never changes over the decoy's
   *  life (no steering, no homing, no acceleration). */
  vx: number;
  vy: number;
  /** Remaining health; starts at NINJA_PAPER_DOUBLE_MAX_HEALTH (20, per the
   *  card's "Lives... 20 damage"), depletes on a landed hit, despawns
   *  (bursts) at 0 — same "damageable hull" contract as DestructibleEntity's
   *  own `health` field, not FireEntity's timer-only shape. */
  health: number;
  /** Lifetime countdown (ms); despawns (bursts) at 0 even if never
   *  damaged — same field/semantics as FireEntity's `remainingMs`. */
  remainingMs: number;
};

export type RoundState = {
  phase: RoundPhase;
  countdownRemainingMs: number;
  scores: Record<PlayerId, number>;
  roundIndex: number;
  winnerPlayerId: PlayerId | null;
  /**
   * Drafting phase bookkeeping. All optional / additive — older snapshots that
   * pre-date the rogue-lite draft phase simply omit them and the round state
   * machine treats that as "no draft in progress". See `sim/round.ts` for the
   * lifecycle: offers are rolled on `round-over → drafting`, picks land via
   * `applyCardPick` on the server, and drafting auto-resolves at expiry.
   *
   * - `draftingExpiresAtTick`: tick at which any unresolved offers auto-pick
   *   the leftmost candidate.
   * - `draftingPicked`: playerId → cardId for those who already picked this
   *   round. The round advances to countdown when all alive players have
   *   entries here OR the expiry tick is reached.
   * - `draftingOffers`: playerId → array of DRAFT_OFFER_COUNT cardIds offered
   *   to that player this round.
   */
  draftingExpiresAtTick?: Tick;
  draftingPicked?: Record<PlayerId, string>;
  draftingOffers?: Record<PlayerId, string[]>;
  /**
   * First-blood wager (design pillars doc, "distinctive features"): the
   * first player to land a hit on another player this round gets a temp
   * speed boost for the rest of the round (see FIRST_BLOOD_SPEED_MULTIPLIER
   * in World.ts). `undefined` = not yet claimed this round. Reset on every
   * round transition (round.ts).
   */
  firstBloodPlayerId?: PlayerId;
  /**
   * Per-round kill tally (fast-respawn ruling 2026-07-17 follow-up): playerId
   * → kills credited to that player THIS round. A kill = a `player-killed`
   * SimEvent whose `killerId` is non-null and differs from `victimId` —
   * suicides and attacker-less deaths (void plane, storm, unattributed burn)
   * credit nobody. Folded in by World.ts's stepWithRuntime from the tick's
   * events BEFORE stepRound runs; drives `decideRoundWinner`'s timeout /
   * force-resolve rule (most kills wins). Same lifecycle as
   * `firstBloodPlayerId`: reset when a round's fighting phase begins
   * (countdown → fighting) and wiped on every round transition. Optional /
   * additive — older snapshots simply omit it (treated as "no kills yet").
   */
  roundKills?: Record<PlayerId, number>;
  /**
   * Sudden-death shrinking arena (design pillars doc): set true when this
   * round begins with every scored player tied at `targetScore - 1` — a
   * true decider round. While true, `World.ts`'s sudden-death storm zone
   * (see `suddenDeath.ts`) damages players outside a safe radius that
   * shrinks from 1.0x to 0.6x of the arena over the round timer. Reset on
   * every round transition.
   */
  suddenDeathActive?: boolean;
};

export type WorldState = {
  tick: Tick;
  rngState: number;
  players: Record<PlayerId, PlayerEntity>;
  projectiles: Record<EntityId, ProjectileEntity>;
  destructibles: Record<EntityId, DestructibleEntity>;
  firePatches: Record<EntityId, FireEntity>;
  pickups: Record<EntityId, PickupEntity>;
  satellites: Record<EntityId, SatelliteEntity>;
  /**
   * Paper Double decoys (see `PaperDoubleEntity`'s own header comment for
   * the full design/simplification rationale). Optional/additive — unlike
   * `projectiles`/`destructibles`/`firePatches`/`pickups`/`satellites`
   * above (all required fields from Day 1), this was added long after
   * dozens of hand-built `WorldState` test literals already existed across
   * the repo; making it required would have forced editing every one of
   * them for a single new (usually-empty) collection. Matches this file's
   * own established "additive/optional, older snapshots read as absent"
   * contract (`chaosModifierIds`/`fireHazardTimerMs` immediately below use
   * the same pattern) — every read site defaults via `?? {}`.
   */
  paperDoubles?: Record<EntityId, PaperDoubleEntity>;
  round: RoundState;
  /**
   * Active chaos modifier ids for this match. Resolved per-tick via
   * `getChaosProfile(...)` in `sim/data/chaosModifiers.ts`. Optional and
   * additive — older snapshots that omit it are treated as "no modifiers".
   * Stable per match: set once at `World.create` time and not mutated by
   * `step` (round transitions don't touch it either).
   */
  chaosModifierIds?: string[];
  /**
   * Internal accumulator the World uses to throttle fire-hazard patch spawns
   * while the `fire-hazard` modifier is active. Reset to 0 on round transitions
   * so each round starts clean. Absent when no fire hazard is active.
   */
  fireHazardTimerMs?: number;
};

export type SimEvent = (
  | {
      t: 'shot-fired';
      playerId: PlayerId;
      x: number;
      y: number;
      hand?: 0 | 1;
      /** Projectiles born from this trigger pull. Additive because legacy and
       * WASM event sources may not know their entity ids. Presentation
       * evidence uses it to pair the exact anticipation with its impact. */
      projectileIds?: EntityId[];
      /** Real-time hit endpoints for any raycast-delivery pellets this shot
       * fired (2026-07-20, true hitscan — World.ts's `resolveHitscanShot`).
       * One entry per pellet, parallel to `projectileIds`'s shape but for a
       * delivery that never creates a `ProjectileEntity` at all — the render
       * layer draws an instant tracer to each point instead of animating a
       * traveling body. Additive; absent for every non-raycast weapon. */
      hitscanHits?: {
        x: number;
        y: number;
        hitPlayerId: PlayerId | null;
        /** True when the ray was stopped by terrain rather than a player,
         *  decoy, destructible, or reaching clean max range (2026-07-20,
         *  bullet-feel juice pass) — lets the render layer draw a wall-impact
         *  spark at `x`/`y` instead of a spark hanging in empty air on a
         *  clean miss. Additive; older events treat it as falsy/absent. */
        blockedByWall?: boolean;
      }[];
    }
  | {
      t: 'hit-confirmed';
      victimId: PlayerId;
      damage: number;
      sourceProjectileId: EntityId | null;
      /** Player credited with the damage (projectile owner / basher /
       *  burn igniter), or null/absent for environmental sources. Feeds
       *  the death-FX reward shards (damage-proportional). Additive wire
       *  field — old clients ignore it. */
      attackerId?: PlayerId | null;
      /** True when this hit landed in the victim's head zone (see
       *  isHeadshot/playerHitboxAABB, player.ts) — `damage` already has the
       *  slight boon baked in; this is purely for the renderer's distinct
       *  headshot VFX/audio cue. Additive wire field — old clients ignore it. */
      headshot?: boolean;
    }
  | { t: 'destructible-broken'; entityId: EntityId; x: number; y: number }
  | {
      /**
       * A destructible (training dummy / barrel / box) took damage that
       * DIDN'T break it — the destructible counterpart to `hit-confirmed`.
       * Added 2026-07-19 for the venue-lobby ability showcase (Jake: "we
       * need an area with the right bots... to test this"): before this,
       * a destructible taking non-lethal damage emitted NOTHING (only a
       * kill emitted `destructible-broken`), so a dummy being whittled
       * down had zero per-hit signal to key a damage-number popup off —
       * confirmed by grep, `destructible.health` mutation sites
       * (`destructible.ts`'s `stepDestructibles`, `World.ts`'s hangout
       * melee/instant-AOE block) previously pushed no event on a
       * non-fatal hit at all. `victimId` is deliberately absent (unlike
       * `hit-confirmed`) — a destructible has no `PlayerId`, so `x`/`y`
       * (the destructible's own position) is the only way a renderer can
       * place a floating number for it. Fires ALONGSIDE
       * `destructible-broken` on a killing blow too (not instead of) —
       * the death still deals damage worth reading a number for.
       */
      t: 'destructible-hit';
      entityId: EntityId;
      damage: number;
      x: number;
      y: number;
    }
  | { t: 'pickup-taken'; entityId: EntityId; playerId: PlayerId }
  | { t: 'round-end'; winnerId: PlayerId | null }
  | {
      t: 'player-slowed';
      victimId: PlayerId;
      multiplier: number;
      durationMs: number;
    }
  | {
      t: 'parry-deflected';
      playerId: PlayerId;
      projectileId: EntityId | null;
    }
  | {
      t: 'shield-popped';
      playerId: PlayerId;
      remainingCharge: number;
    }
  | {
      /**
       * Emitted exactly once when a player's `alive` flag transitions from
       * true to false. Distinct from `hit-confirmed` so the renderer can
       * drive the kill stack (hit-stop 80ms, kill shake, particle burst,
       * flash, killer camera kick) without polling `state.players[id].alive`.
       * `killerId` is the playerId whose projectile/effect caused the kill,
       * or null for environmental causes (void plane, fire patch DoT).
       */
      t: 'player-killed';
      victimId: PlayerId;
      killerId: PlayerId | null;
      /**
       * 'aoe' (2026-07-18, aoe role rework): the 9 "aoe"-tagged class
       * abilities' new instant radius-check resolution (World.ts's
       * pendingInstantAoe pass) — a null-projectile hit, same shape as
       * 'bash' (dash-bash/melee), just kill-feed-distinguishable from a
       * physical ram/slash.
       */
      cause: 'projectile' | 'void' | 'burn' | 'fire' | 'explosion' | 'chain-lightning' | 'storm' | 'bash' | 'aoe';
    }
  /**
   * Emitted exactly once per round when the first hit-confirmed of the
   * round lands with a resolvable attacker (see World.ts's per-projectile
   * hit-resolution loop). `playerId` is the attacker, not the victim —
   * matches how `player-killed.killerId` is named from the actor's side.
   */
  | { t: 'first-blood'; playerId: PlayerId }
  /**
   * Emitted when a player's Emission casts (docs/emission-engine-goal.md —
   * Ability input at full charge; charge consumed to 0 the same tick).
   * Drives the renderer's cast feel (seal-flash, camera punch, SFX);
   * the volley itself is ordinary projectiles already in the snapshot.
   * Additive wire type — old clients ignore unknown event tags.
   */
  | {
      t: 'emission-cast';
      playerId: PlayerId;
      x: number;
      y: number;
      element: ElementType;
      volleyCount: number;
    }
  /**
   * Emitted when a Stride-charged Emission cast actually refunds spent air
   * movement (six-axes-goal.md Layer 1: `stride.dashReset` zeroes the host
   * movement memory's airJumpsUsed/dashUsedInAir — the exact reset landing
   * performs). Only fires when something was really spent (a grounded /
   * fresh-countered cast refunds nothing and stays silent, doctrine #3), so
   * the read is honest: this marks the moment air movement CAME BACK, not
   * the axis merely existing. The refund itself lives in host-side movement
   * memory (never in the snapshot), so without this event no renderer can
   * see it — it was the only Layer-1 axis with no site read
   * (docs/legibility-audit.md). x/y = the caster at cast time; the site
   * read goes at the FEET (movement register). Additive wire type — old
   * clients ignore unknown event tags.
   */
  | { t: 'stride-refunded'; playerId: PlayerId; x: number; y: number }
  /**
   * Emitted when a drafted active fires (six-axes Layer 2: input bits
   * 10..13, validated against the slot's cooldown). Drives the router's
   * activation cue + the scene's slot flash; the effect itself is ordinary
   * sim state (buff ticks / entities) already in the snapshot. Additive
   * wire type — old clients ignore unknown event tags.
   */
  | {
      t: 'ability-activated';
      playerId: PlayerId;
      slot: number;
      kind: string;
      x: number;
      y: number;
    }
  /**
   * Emitted when an ability activation resonates (class-overhaul-
   * workboard.md chunk 0.1 — a DIFFERENT ability cast inside the previous
   * cast's resonance window, consuming it for the v1 bonus: a fractional
   * cooldown refund on `kind`, RESONANCE_CD_REFUND_FRACTION in
   * constants.ts). `sourceKind` is the ability that opened the window;
   * `kind` is the one that just consumed it. Fired alongside (immediately
   * after) the `ability-activated` event for the same press — spectator/
   * legibility read + test hook; the bonus itself is already reflected in
   * the entity's own cooldown field in the snapshot. Additive wire type —
   * old clients ignore unknown event tags. Render/audio treatment is
   * deferred (Tier 4 polish, class-overhaul-workboard.md 4.2 nameplate-
   * legibility gap) — this event exists so that pass has something to hook.
   */
  | {
      t: 'resonance-triggered';
      playerId: PlayerId;
      sourceKind: string;
      kind: string;
      x: number;
      y: number;
    }
  /**
   * Emitted when a Drain-axis Emission shard heals its caster at the hit
   * site (six-axes-goal.md Layer 1: leech reads the SAME post-mitigation
   * applied damage the charge fill reads). Drives the crimson-thread read —
   * the heal itself is already in the snapshot's health. Additive wire type.
   * fromX/fromY = victim (thread source), toX/toY = caster at heal time.
   */
  | {
      t: 'emission-leech';
      casterId: PlayerId;
      victimId: PlayerId;
      amount: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  /**
   * Emitted exactly once when a round enters sudden death (every scored
   * player tied at `targetScore - 1`). Purely informational — the actual
   * shrinking-storm damage is carried by ordinary `hit-confirmed` events
   * with `sourceProjectileId: null` and `player-killed.cause === 'storm'`.
   */
  | { t: 'sudden-death-started' }
  /**
   * Emitted when a player collects a `card-cache` pickup. The sim pre-rolls
   * the offered card ids deterministically (seeded RNG). The client overlay
   * consumes this event to show the draft UI; the actual card commit happens
   * via a separate input path (out of sim scope for this pass).
   */
  | { t: 'card-offered'; playerId: PlayerId; cardIds: string[] }
  /**
   * Emitted exactly once per (round, player) when their draft pick is recorded
   * by `stepRound`. `autoPicked` is true when the player did not commit a card
   * before `draftingExpiresAtTick` and the leftmost offer was selected on
   * their behalf, false when the pick arrived via a normal `card-pick` input.
   */
  | {
      t: 'draft-resolved';
      playerId: PlayerId;
      cardId: string;
      autoPicked: boolean;
    }
  /**
   * Emitted when a lightning-element projectile chains damage to a secondary
   * target. Carries world-space positions for the primary hit and chain target
   * so clients can draw a bolt arc without needing to look up player positions.
   * Deterministic: positions come from the player entities at hit-time.
   */
  | {
      t: 'chain-hit';
      victimId: PlayerId;
      chainTargetId: PlayerId;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      damage: number;
    }
  /**
   * Hangout mode only (graceful-gliding-flame plan A3): a player overlapped
   * the Ready totem. Server-only reaction — `matchHost.ts`'s hangout host
   * flips the room's `LobbyPlayer.ready` boolean directly; the client only
   * needs this for a local flash/SFX cue.
   */
  | { t: 'ready-toggled'; playerId: PlayerId }
  /**
   * Hangout mode only: a player overlapped the Launch totem. Server-only
   * reaction — triggers the existing `startPrivateMatch` handoff when the
   * gating (host + all-ready) is satisfied; a no-op event otherwise.
   */
  | { t: 'launch-requested'; playerId: PlayerId }
  /**
   * A launch pad fired (map-static geometry, `sim/launchPad.ts`): the
   * player overlapped the pad and passed the stateless retrigger gate, so
   * the impulse was applied this tick. Drives client SFX/VFX only — the
   * velocity change itself is ordinary player state already in the
   * snapshot. `entityId` is the pad's INDEX in `map.launchPads` (pads are
   * static map data, not WorldState entities, so the index is the stable
   * cross-host identifier). Additive wire type — old clients ignore
   * unknown event tags (same precedent as `emission-cast`).
   */
  | { t: 'launch-pad-fired'; entityId: EntityId; playerId: PlayerId }
  /**
   * NINJA MELEE (2026-07-18, docs/classes-goal.md ninja verb — the dual-
   * blade slash). A ninja's swing entered its ACTIVE (hit-check) frames —
   * fired once per swing at the windup→active transition, before any hits
   * resolve. Drives local wind-up/whiff SFX; no gameplay state change.
   * Additive wire type — old clients ignore unknown event tags.
   */
  | { t: 'slash-started'; playerId: PlayerId; x: number; y: number }
  /**
   * A ninja's melee arc landed on a player this tick (arc-vs-AABB test,
   * SLASH_RANGE/SLASH_ARC_RADIANS in World.ts). One event per victim hit —
   * the arc can hit several players in one active window. Damage already
   * reflects shield/parry mitigation (tryDeflectDamage) and evasion
   * (blocked hits never reach here). Additive wire type.
   */
  | { t: 'slash-hit'; attackerId: PlayerId; victimId: PlayerId; damage: number }
  /**
   * The short-range WAVE projectile spawned off a completed ninja swing
   * (docs: "wave is aftermath of contact... spawns from a swing that had
   * commit" — fires at the active→recovery transition regardless of
   * whether the arc landed a hit). `projectileId` is the spawned
   * ProjectileEntity's id (ordinary projectile — element/impact modifiers
   * compose onto it for free via the existing card system, fast-follow).
   * Additive wire type.
   */
  | { t: 'wave-spawned'; playerId: PlayerId; projectileId: EntityId; x: number; y: number }
  /**
   * Dash-through body-cross (docs: "Dash-through is a body-cross (hitbox
   * intersection), not a fog"): a ninja's dash swept their hitbox through
   * an enemy's this tick. v1 scope is detection + energy grant only — the
   * Read tag / +20% melee bonus that CONSUMES this event is Slipstream (a
   * card, fast-follow), not implemented here. Additive wire type.
   */
  | { t: 'dash-through'; attackerId: PlayerId; victimId: PlayerId }
  /**
   * KINDLED WARD (2026-07-18, docs/classes-goal.md Paladin/Kindled verb —
   * "directional frontal hold... generates Kindling on absorb",
   * class-overhaul-workboard.md chunks 2.2/2.3). Emitted once per hit that
   * Ward partially mitigated (WARD_MITIGATION_FRACTION, combat.ts) — a
   * warded hit still deals reduced damage (unlike `shield-popped`'s full
   * block), tracked here for clip legibility / the deferred VFX pass
   * (chunk 2.7) and as the Kindling-grant tell. `kindlingGranted` mirrors
   * the resource delta already reflected in `players[playerId].kindling`
   * in the snapshot — carried on the event too so a spectator overlay
   * doesn't need to diff two snapshots to show "+N". Additive wire type —
   * old clients ignore unknown event tags.
   */
  | {
      t: 'ward-absorbed';
      playerId: PlayerId;
      damageBlocked: number;
      kindlingGranted: number;
    }
  /**
   * TEAM PEEL (2026-07-18, class-overhaul-workboard.md chunk 2.4 — "block
   * for allies in ward shadow"). Emitted once per hit that a warding ally's
   * Kindled Ward mitigated on someone ELSE's behalf — distinct from
   * `ward-absorbed` (self-ward: the hit victim and the resource-earner are
   * the SAME player). Here `victimId` (whose damage was reduced) and
   * `warderId` (who was holding Ward, in cone+radius, and who banks the
   * Kindling) are two different players — always teammates, per `isAlly`
   * (team.ts) at the site that resolved this. Never fires for a solo/FFA
   * player (no `teamId` ⇒ `isAlly` is false for every pairing, so this
   * event tag is a true no-op outside team modes, same as every other
   * team-1.1-consuming chunk). Additive wire type — old clients ignore
   * unknown event tags, same precedent as `ward-absorbed`.
   */
  | {
      t: 'team-peel-absorbed';
      victimId: PlayerId;
      warderId: PlayerId;
      damageBlocked: number;
      kindlingGranted: number;
    }
  /**
   * SYZYGIST WARD (2026-07-18, class-overhaul-workboard.md chunk 3.3 —
   * "Wards defense verb: small absorb barriers, castable on allies").
   * Emitted once per hit that a Priest's Ward pool partially or fully
   * absorbed — the cast-and-forget, non-directional counterpart to
   * `ward-absorbed` (Paladin's Kindled Ward, which requires facing).
   * `casterId` is who OPENED the window (`wardAbsorbSourceId`) — may equal
   * `playerId` (self-cast) or differ (an ally cast it on them), giving
   * spectators a legible "who gave them that shield" read. `wardBroke` is
   * true when this hit exhausted the absorb pool (fields cleared this
   * tick). Additive wire type — old clients ignore unknown event tags,
   * same precedent as `ward-absorbed`/`team-peel-absorbed`.
   */
  | {
      t: 'syz-ward-absorbed';
      playerId: PlayerId;
      casterId: PlayerId;
      damageBlocked: number;
      wardBroke: boolean;
    }
) & {
  /** Authoritative simulation tick on which this event occurred. The server
   * adds it before snapshot-window batching; standalone/predicted sim callers
   * may omit it. Presentation evidence uses this to retain action rhythm when
   * several ticks arrive in one network message. */
  atTick?: Tick;
};

export type StepResult = {
  state: WorldState;
  events: SimEvent[];
  /**
   * True on the tick the match was decided (a player reached the target
   * score). The Bun server uses this to post the final result to Convex
   * exactly once. See `server/src/matchHost.ts` and `sim/round.ts`.
   */
  matchComplete: boolean;
};

/**
 * The vessel's 5 independently-recolorable channels (Vessel Creator design,
 * docs/vessel-creator-design.md §3/§6.1) — mirrors
 * ProceduralPlayerRigOptions' accentColor/visorColor/palmColor/jointColor/
 * auraColor exactly, but as wire-safe hex strings rather than Phaser's
 * numeric color. All optional and additive: an absent field (or an absent
 * `cosmetics` object entirely) renders identically to today, since the rig
 * itself already defaults every channel to accentColor when unset.
 */
export type VesselCosmetics = {
  accentColor?: string;
  visorColor?: string;
  palmColor?: string;
  jointColor?: string;
  auraColor?: string;
};

export type PlayerSpawnInfo = {
  playerId: PlayerId;
  characterId: CharacterArchetype;
  name: string;
  color: string;
  weaponId: string;
  cosmetics?: VesselCosmetics;
  /** Starter cards applied at insertion (venue-sprint2-goal S2.E — the
   *  lobby draft pick rides admission). Omitted = plain spawn. Replay-safe:
   *  the recorder serializes the whole spawn, so re-sims apply the same
   *  cards at the same join tick. */
  cards?: string[];
  /**
   * Duos-queue team assignment (docs/classes-goal.md "Venue integration":
   * "Duos queue: VenueHost bell admission gains a team variant... Elastic
   * bots respect team floors"). Stamped into `PlayerLobbyInfo` at spawn
   * (matchHost.ts) AND, since class-overhaul-workboard.md chunk 1.1,
   * mirrored onto the constructed `PlayerEntity.teamId` (World.create /
   * rosterOps.applyMidMatchJoin) — the sim itself can now answer
   * `isAlly(a, b)` (see `sim/team.ts`), including the wasm ABI
   * (`world_state.zig`'s `team_id_len`/`team_id_bytes`). Also consulted by
   * WorldHost's elastic-bot fill to pair opposing/ally bots into a matching
   * team — bots ride this exact same field (`worldHost.ts`'s `botSpawn`),
   * not a separate bot-only structure. Omitted = an ordinary FFA combatant
   * — every existing spawn path (private rooms, plain world joins, tests)
   * never sets this, so it's byte-for-byte unchanged there.
   */
  teamId?: string;
};

export type Vec2 = { x: number; y: number };

export type PlatformDefinition = {
  id: string;
  position: Vec2;
  size: Vec2;
  kind: 'floor' | 'wall' | 'platform';
};

export type DestructibleDefinition = {
  id: string;
  kind: DestructibleKind;
  health: number;
  position: Vec2;
  size: Vec2;
  explosive: boolean;
  flammable: boolean;
};

export type PickupDefinition = {
  id: string;
  kind: PickupKind;
  position: Vec2;
  radius: number;
  amount: number;
  respawnMs: number;
  durationMs?: number;
};

/**
 * Launch pad — STATIC map geometry (like platforms/pickups definitions).
 * A player overlapping the pad's AABB gets a velocity impulse along
 * `impulse` (see `sim/launchPad.ts` for the exact formula: additive along
 * the pad direction with a cap, approach speed preserved — the "hitting a
 * ramp at speed" feel).
 *
 * DELIBERATELY NOT part of `WorldState`: pads carry zero dynamic state.
 * The retrigger condition is STATELESS (derived from the player's current
 * velocity relative to the pad direction — see `launchPad.ts`), so pads
 * never ride the snapshot, never touch `worldStateBridge.ts`'s extern
 * layout, and imply no wire/protocol change. Both sides derive them from
 * the mapId, exactly like platforms.
 */
export type LaunchPadDefinition = {
  id: string;
  /** Center of the pad AABB (world px). */
  position: Vec2;
  /** Full width/height of the pad AABB (world px). */
  size: Vec2;
  /** Velocity impulse (px/s) applied along this vector's direction. */
  impulse: Vec2;
};

/**
 * True slope — STATIC angled ground (docs/map-design.md "Diagonals & sky":
 * the deliberately-deferred piece, greenlit 2026-07-17). Only TWO blessed
 * grades exist, each in two directions — a fixed grammar like the fixed
 * tier heights, never arbitrary angles:
 *
 *   grade "2:1" — run:rise 2:1 (rise = run / 2, ≈26.565°)
 *   grade "1:1" — run:rise 1:1 (rise = run,     45°)
 *
 * `base` is the BOTTOM corner of the walkable surface; the surface ascends
 * from it in direction `dir` over horizontal extent `run` (rise derives
 * from the grade). The derived surface line (y-down coordinates):
 *
 *   dir = +1 (ascends left→right):  x ∈ [base.x, base.x + run]
 *   dir = −1 (ascends right→left):  x ∈ [base.x − run, base.x]
 *   surfaceY(x) = base.y + dyDx · (x − base.x),  dyDx = −grade_t · dir
 *   (grade_t = 0.5 for "2:1", 1.0 for "1:1" — both exact in binary)
 *
 * ONE-WAY, walkable side up only — no slope ceilings/undersides. Collision
 * is a foot-point grounding pass inside `stepPlayer` (player.ts /
 * sim/src/player.zig), NOT an AABB shape: see SLOPE_* in collision.ts.
 *
 * DELIBERATELY NOT part of `WorldState` (launch-pad precedent): slopes are
 * pure static geometry with zero dynamic state, so they never ride the
 * snapshot, never touch worldStateBridge's extern layout, and imply no
 * wire/protocol change. Both sides derive them from the mapId, exactly
 * like platforms. They reach wasm via `world_state_set_slopes` (the
 * launch-pad module-level pattern).
 */
export type SlopeDefinition = {
  id: string;
  /** Bottom corner of the walkable surface (world px). */
  base: Vec2;
  /** Horizontal extent of the surface (px, > 0). Rise = run · grade_t. */
  run: number;
  /** Blessed grade — "2:1" (≈26.565°) or "1:1" (45°). Nothing else. */
  grade: '2:1' | '1:1';
  /** Ascent direction: +1 = ascends left-to-right, −1 = right-to-left. */
  dir: 1 | -1;
};

export type MapDefinition = {
  id: string;
  name: string;
  size: Vec2;
  spawns: Vec2[];
  platforms: PlatformDefinition[];
  destructibles?: DestructibleDefinition[];
  pickups?: PickupDefinition[];
  /**
   * Launch pads (optional / additive — maps without pads behave exactly
   * as before). Static geometry, never in `WorldState`; stepped by
   * `World.stepWithRuntime` §4a via `sim/launchPad.ts`.
   */
  launchPads?: LaunchPadDefinition[];
  /**
   * True slopes (optional / additive — maps without slopes step
   * byte-identically to before: the slope pass AND the slope-aware
   * sub-step guard are both gated on `slopes.length > 0`). Static
   * geometry, never in `WorldState`; resolved inside `stepPlayer` via
   * the collision cache (`buildStaticCache`'s `slopes` argument).
   */
  slopes?: SlopeDefinition[];
  /** Arena theme key from `ARENA_THEMES`. Defaults to voidVessel when omitted. */
  arenaTheme?:
    | "voidVessel"
    | "crystalDock"
    | "autogenesHull"
    | "jadeIsles"
    | "ivoryClouds"
    | "hangingWood";
};
