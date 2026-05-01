// Pickup system. Pure, deterministic, runtime-agnostic.
//
// Authority on the Bun server, replayed on the client for prediction. For each
// active pickup we test overlap against every alive player; on contact we
// apply the pickup's effect (instant heal / shield refill, buff timer, debuff
// for the rest of the room) and arm a respawn timer.
//
// Buff durations mirror the original MatchScene constants. The actual numeric
// values originally lived in `client/src/game/scenes/MatchScene.ts` as the
// `pickup.durationMs` carried by the boxworks `PickupDefinition`. We keep both
// paths working: callers may bake the duration into the pickup entity
// (preferred, see `World.create`) and we fall back to these constants when
// the field is absent so older snapshots still produce sensible buffs.

import { aabbOverlap } from "./collision.js";
import { crystalRoundsCards } from "./data/cards.js";
import { nextU32 } from "./rng.js";
import { EntityId, PlayerId, Tick } from "./types.js";
import type {
  PickupEntity,
  PlayerEntity,
  SimEvent,
  WorldState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants. Mirror the per-pickup `durationMs` baked into Boxworks pickup
// definitions, which themselves mirror the original MatchScene timings.
// ---------------------------------------------------------------------------

/** Overcharge buff (damage + fire rate). Mirror: pickup `overcharge-core`. */
export const OVERCHARGE_DURATION_MS = 8000;
/** Damage amplifier buff. Mirror: pickup `damage-amp`. */
export const DAMAGE_AMP_MS = 8000;
/** Movement speed buff. Mirror: pickup `speed-boost`. */
export const SPEED_BOOST_MS = 8000;
/** Forced melee/close-range buff. Mirror: pickup `melee-mode`. */
export const MELEE_MODE_MS = 9000;
/** Slow debuff applied to OTHERS by `slow-trap`. */
export const SLOW_DEBUFF_MS = 5500;
/** Vulnerability debuff applied to OTHERS by `vulnerability-trap`. */
export const VULNERABILITY_MS = 5500;
/** Block-jammer debuff applied to OTHERS by `block-jammer`. */
export const BLOCK_JAMMER_MS = 6500;
/** Boss-mode buff. Mirror: pickup `boss-core`. */
export const BOSS_MODE_MS = 16000;
/** Default respawn time when a pickup entity has no `respawnMs` baked in. */
export const DEFAULT_RESPAWN_MS = 20000;
/**
 * Pickup-overlap circle expansion. The original MatchScene treated player vs.
 * pickup contact as a circle vs circle test using half the player body width
 * (~30 / 2 = 15) plus the pickup radius. We keep ~18 as the rough player
 * "footprint radius" for the AABB-based test we run here, which is a slight
 * widening — pickups are intentionally easy to grab.
 */
export const PLAYER_FOOTPRINT_RADIUS = 18;
/** Slow / vulnerability multipliers to mirror MatchScene. */
export const SLOW_TRAP_MULTIPLIER = 0.62;
/** How many cards a `card-cache` offers per pickup. */
export const CARD_OFFER_COUNT = 3;

// ---------------------------------------------------------------------------
// Public step function. Pure relative to its inputs; returns next pickups +
// next players + emitted events. Caller is responsible for merging the
// returned `players` patch into world state.
// ---------------------------------------------------------------------------

export type StepPickupsInput = {
  pickups: WorldState["pickups"];
  players: WorldState["players"];
  tick: Tick;
  dtMs: number;
  /** Current RNG cursor; we advance and return the new cursor. */
  rngState: number;
};

export type StepPickupsResult = {
  pickups: WorldState["pickups"];
  players: WorldState["players"];
  events: SimEvent[];
  rngState: number;
};

export function stepPickups(input: StepPickupsInput): StepPickupsResult {
  const { dtMs, tick } = input;
  const events: SimEvent[] = [];
  let rngState = input.rngState;

  // Shallow-copy maps; entries we touch get replaced below.
  const nextPickups: WorldState["pickups"] = { ...input.pickups };
  const nextPlayers: WorldState["players"] = { ...input.players };

  // Stable iteration order (sorted ids) for determinism. This matches the
  // pattern used elsewhere in the sim (projectiles, satellites).
  const pickupIds: EntityId[] = Object.keys(nextPickups)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);

  for (const id of pickupIds) {
    const pickup = nextPickups[id]!;

    // Inactive pickups: respawn when the timer matures.
    if (!pickup.active) {
      if (pickup.respawnAtTick <= tick) {
        nextPickups[id] = { ...pickup, active: true, respawnAtTick: Tick(0) };
      }
      continue;
    }

    // Active: scan alive players for overlap. First-collector wins on the
    // (rare) double-overlap tick; deterministic via sorted player iteration.
    const sortedPlayerIds = Object.keys(nextPlayers).sort();
    let pickedBy: PlayerId | null = null;

    for (const pid_ of sortedPlayerIds) {
      const pid = pid_ as PlayerId;
      const player = nextPlayers[pid]!;
      if (!player.alive) continue;
      if (!playerOverlapsPickup(player, pickup)) continue;
      pickedBy = pid;
      break;
    }

    if (pickedBy === null) continue;

    // Apply effect to the picker (and side-effects to other players for
    // trap-style pickups). Deactivate this pickup and arm respawn.
    const applied = applyPickup({
      pickup,
      pickerId: pickedBy,
      players: nextPlayers,
      tick,
      dtMs,
      rngState,
    });
    rngState = applied.rngState;
    for (const [pid_, patched] of Object.entries(applied.players)) {
      nextPlayers[pid_ as PlayerId] = patched;
    }
    for (const ev of applied.events) {
      events.push(ev);
    }

    const respawnMs = pickup.respawnMs ?? DEFAULT_RESPAWN_MS;
    nextPickups[id] = {
      ...pickup,
      active: false,
      respawnAtTick: Tick(tick + Math.ceil(respawnMs / dtMs)),
    };
    events.push({ t: "pickup-taken", entityId: pickup.id, playerId: pickedBy });
  }

  return { pickups: nextPickups, players: nextPlayers, events, rngState };
}

// ---------------------------------------------------------------------------
// Per-tick maintenance: clear expired buff timer fields. Called from the
// World.stepWithRuntime cleanup pass so that a `players` map containing fully
// expired buffs reverts to `undefined` (so renderers don't display stale
// glow / VFX).
// ---------------------------------------------------------------------------

export function clearExpiredBuffs(
  players: WorldState["players"],
  tick: Tick,
): WorldState["players"] {
  const out: WorldState["players"] = {};
  for (const [pid_, player] of Object.entries(players)) {
    out[pid_ as PlayerId] = clearExpiredBuffsOnPlayer(player, tick);
  }
  return out;
}

type BuffField =
  | "overchargeUntilTick"
  | "damageAmpUntilTick"
  | "speedBoostUntilTick"
  | "meleeModeUntilTick"
  | "slowDebuffUntilTick"
  | "vulnerabilityUntilTick"
  | "blockJammerUntilTick"
  | "bossModeUntilTick";

const BUFF_FIELDS: readonly BuffField[] = [
  "overchargeUntilTick",
  "damageAmpUntilTick",
  "speedBoostUntilTick",
  "meleeModeUntilTick",
  "slowDebuffUntilTick",
  "vulnerabilityUntilTick",
  "blockJammerUntilTick",
  "bossModeUntilTick",
];

function clearExpiredBuffsOnPlayer(player: PlayerEntity, tick: Tick): PlayerEntity {
  let next: PlayerEntity = player;
  for (const field of BUFF_FIELDS) {
    const value = next[field];
    if (value !== undefined && value <= tick) {
      next = { ...next, [field]: undefined };
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function playerOverlapsPickup(player: PlayerEntity, pickup: PickupEntity): boolean {
  // Treat the player as a square AABB centered on (x, y) with side =
  // 2 * PLAYER_FOOTPRINT_RADIUS, and the pickup as a circle of given radius.
  // We expand the AABB by the pickup radius and test point-in-aabb (the
  // standard Minkowski circle-vs-aabb trick).
  const r = PLAYER_FOOTPRINT_RADIUS;
  return aabbOverlap(
    {
      x: player.x - r,
      y: player.y - r,
      w: r * 2,
      h: r * 2,
    },
    {
      x: pickup.x - pickup.radius,
      y: pickup.y - pickup.radius,
      w: pickup.radius * 2,
      h: pickup.radius * 2,
    },
  );
}

type ApplyPickupInput = {
  pickup: PickupEntity;
  pickerId: PlayerId;
  players: WorldState["players"];
  tick: Tick;
  dtMs: number;
  rngState: number;
};

type ApplyPickupOutput = {
  /** Patch map: only includes players who changed this tick. */
  players: Record<PlayerId, PlayerEntity>;
  events: SimEvent[];
  rngState: number;
};

function applyPickup(input: ApplyPickupInput): ApplyPickupOutput {
  const { pickup, pickerId, players, tick, dtMs } = input;
  let rngState = input.rngState;
  const patch: Record<PlayerId, PlayerEntity> = {};
  const events: SimEvent[] = [];
  const picker = players[pickerId]!;

  switch (pickup.kind) {
    case "health-shard": {
      const max = computeMaxHealth(picker);
      patch[pickerId] = {
        ...picker,
        health: Math.min(max, picker.health + pickup.amount),
      };
      return { players: patch, events, rngState };
    }

    case "shield-cell": {
      const current = picker.shieldCharge ?? 100;
      patch[pickerId] = {
        ...picker,
        shieldCharge: Math.min(100, current + pickup.amount),
      };
      return { players: patch, events, rngState };
    }

    case "overcharge-core": {
      patch[pickerId] = applyBuffField(
        picker,
        "overchargeUntilTick",
        tick,
        dtMs,
        pickup.durationMs ?? OVERCHARGE_DURATION_MS,
      );
      return { players: patch, events, rngState };
    }

    case "damage-amp": {
      patch[pickerId] = applyBuffField(
        picker,
        "damageAmpUntilTick",
        tick,
        dtMs,
        pickup.durationMs ?? DAMAGE_AMP_MS,
      );
      return { players: patch, events, rngState };
    }

    case "speed-boost": {
      patch[pickerId] = applyBuffField(
        picker,
        "speedBoostUntilTick",
        tick,
        dtMs,
        pickup.durationMs ?? SPEED_BOOST_MS,
      );
      return { players: patch, events, rngState };
    }

    case "melee-mode": {
      patch[pickerId] = applyBuffField(
        picker,
        "meleeModeUntilTick",
        tick,
        dtMs,
        pickup.durationMs ?? MELEE_MODE_MS,
      );
      return { players: patch, events, rngState };
    }

    case "slow-trap": {
      const durationMs = pickup.durationMs ?? SLOW_DEBUFF_MS;
      // Apply slow to ALL OTHER alive players. We update both
      // `slowDebuffUntilTick` (pickup-style timer) and the existing
      // `slowedUntilTick` / `slowMultiplier` fields used by movement, so
      // existing systems pick up the slow without changes.
      const sortedIds = Object.keys(players).sort();
      for (const otherId_ of sortedIds) {
        const otherId = otherId_ as PlayerId;
        if (otherId === pickerId) continue;
        const other = players[otherId]!;
        if (!other.alive) continue;
        const ticks = Math.ceil(durationMs / dtMs);
        const until = Tick(tick + ticks);
        const prevSlowUntil = other.slowedUntilTick ?? Tick(0);
        const prevSlowMul = other.slowMultiplier ?? 1;
        patch[otherId] = {
          ...other,
          slowDebuffUntilTick: Tick(Math.max(other.slowDebuffUntilTick ?? 0, until)),
          slowedUntilTick: Tick(Math.max(prevSlowUntil, until)),
          slowMultiplier: Math.min(prevSlowMul, SLOW_TRAP_MULTIPLIER),
        };
        events.push({
          t: "player-slowed",
          victimId: otherId,
          multiplier: SLOW_TRAP_MULTIPLIER,
          durationMs,
        });
      }
      return { players: patch, events, rngState };
    }

    case "vulnerability-trap": {
      const durationMs = pickup.durationMs ?? VULNERABILITY_MS;
      const sortedIds = Object.keys(players).sort();
      for (const otherId_ of sortedIds) {
        const otherId = otherId_ as PlayerId;
        if (otherId === pickerId) continue;
        const other = players[otherId]!;
        if (!other.alive) continue;
        patch[otherId] = applyBuffField(
          other,
          "vulnerabilityUntilTick",
          tick,
          dtMs,
          durationMs,
        );
      }
      return { players: patch, events, rngState };
    }

    case "block-jammer": {
      const durationMs = pickup.durationMs ?? BLOCK_JAMMER_MS;
      const sortedIds = Object.keys(players).sort();
      for (const otherId_ of sortedIds) {
        const otherId = otherId_ as PlayerId;
        if (otherId === pickerId) continue;
        const other = players[otherId]!;
        if (!other.alive) continue;
        // Jam blocks: clear shield to mirror MatchScene's instant cancel.
        const buffed = applyBuffField(
          other,
          "blockJammerUntilTick",
          tick,
          dtMs,
          durationMs,
        );
        patch[otherId] = { ...buffed, shieldActive: false };
      }
      return { players: patch, events, rngState };
    }

    case "boss-core": {
      patch[pickerId] = applyBuffField(
        picker,
        "bossModeUntilTick",
        tick,
        dtMs,
        pickup.durationMs ?? BOSS_MODE_MS,
      );
      return { players: patch, events, rngState };
    }

    case "card-cache": {
      // Roll a small deterministic offer of card ids using the seeded RNG.
      // The actual card commit happens client-side via a separate input
      // path — this is just the offer notification.
      const cardIds: string[] = [];
      const pool = crystalRoundsCards;
      if (pool.length > 0) {
        const offered = new Set<number>();
        const target = Math.min(CARD_OFFER_COUNT, pool.length);
        // Bounded loop guard: cap attempts so a small / sparse pool can't
        // spin. Each attempt advances the rng cursor — output stays
        // deterministic.
        let attempts = 0;
        while (offered.size < target && attempts < target * 8) {
          rngState = nextU32(rngState);
          const idx = rngState % pool.length;
          if (!offered.has(idx)) {
            offered.add(idx);
            cardIds.push(pool[idx]!.id);
          }
          attempts += 1;
        }
      }
      events.push({ t: "card-offered", playerId: pickerId, cardIds });
      // No PlayerEntity field changes — card commit is out of scope.
      return { players: patch, events, rngState };
    }
  }

  // Fallback: treat unknown kinds as overcharge so the pickup still does
  // something (and we don't silently swallow the collection event). Callers
  // that add a new kind should update this switch.
  patch[pickerId] = applyBuffField(
    picker,
    "overchargeUntilTick",
    tick,
    dtMs,
    pickup.durationMs ?? OVERCHARGE_DURATION_MS,
  );
  return { players: patch, events, rngState };
}

/**
 * Compute the player's effective max health. Matches the spec: `100 + buffs`.
 * For now we only adjust for active boss mode (which adds health bonus). Other
 * card-driven max-health additions live in WeaponBuild and aren't reachable
 * from sim/ — keep this conservative; it's only used to clamp `health-shard`
 * heals.
 */
function computeMaxHealth(player: PlayerEntity): number {
  const base = 100;
  // Boss mode adds +90 health while active (mirrors `BOSS_HEALTH_BONUS`).
  if (player.bossModeUntilTick !== undefined && player.bossModeUntilTick > 0) {
    return base + 90;
  }
  return base;
}

/**
 * Apply a "buff active until tick X" field. Stack policy: keep whichever ends
 * later (so a fresh pickup can extend an existing buff but never shorten it).
 */
function applyBuffField(
  player: PlayerEntity,
  field:
    | "overchargeUntilTick"
    | "damageAmpUntilTick"
    | "speedBoostUntilTick"
    | "meleeModeUntilTick"
    | "vulnerabilityUntilTick"
    | "blockJammerUntilTick"
    | "bossModeUntilTick",
  tick: Tick,
  dtMs: number,
  durationMs: number,
): PlayerEntity {
  const ticks = Math.ceil(durationMs / dtMs);
  const until = tick + ticks;
  const prev = (player[field] as Tick | undefined) ?? 0;
  return { ...player, [field]: Math.max(prev, until) };
}
