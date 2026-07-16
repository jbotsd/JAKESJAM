// Hangout-mode Ready/Launch totems (graceful-gliding-flame plan A3).
//
// Reuses `pickup.ts`'s exact per-tick circle-overlap-scan pattern (sorted
// player iteration, Minkowski circle-vs-AABB overlap test) — same math,
// same tick timing, same "emit a SimEvent on overlap" shape.
//
// Deliberately NOT wired into `World.ts`/`stepWithRuntime`: totems are a
// server-authoritative-only interaction (the reaction — flipping a lobby
// player's ready flag, or launching the real match — happens entirely
// server-side in `matchHost.ts`/`privateLobby.ts`), so there is nothing for
// client-side prediction to get right here. Keeping this out of the shared
// sim step means no `WorldState`/`PlayerEntity` field, no delta-snapshot
// changes, and no Zig parity surface at all — hangout matches are hard-
// pinned to the TS backend regardless (see matchHost.ts), so none of that
// would ever need a Zig mirror, but this way it's structurally impossible
// to need one.

import { aabbOverlap } from "./collision.js";
import { PlayerId, Tick } from "./types.js";
import type { MapDefinition, PlayerEntity, SimEvent, WorldState } from "./types.js";

export type TotemKind = "ready" | "launch";

export type TotemDefinition = {
  id: string;
  kind: TotemKind;
  x: number;
  y: number;
  radius: number;
};

/** Same footprint radius `pickup.ts` uses for the player-vs-circle Minkowski test. */
const PLAYER_FOOTPRINT_RADIUS = 18;

/**
 * Debounce window: standing on a totem re-triggers at most once per this
 * many ms, so a player who lingers doesn't spam-toggle ready every tick.
 * Walking off and back on re-triggers immediately (cooldown is per-overlap-
 * start in spirit, approximated here by a flat retrigger window — good
 * enough for a v1 diegetic toggle, no additional edge-detection state needed).
 */
const TOTEM_RETRIGGER_MS = 1200;

export type StepTotemsInput = {
  totems: readonly TotemDefinition[];
  players: WorldState["players"];
  tick: Tick;
  dtMs: number;
  /**
   * Host-local scratch (mirrors `WorldRuntime.movement` — mutated in place,
   * never part of `WorldState`). Caller owns the Map's lifetime; pass the
   * same instance every tick.
   */
  cooldowns: Map<PlayerId, Tick>;
};

export type StepTotemsResult = {
  events: SimEvent[];
};

export function stepTotems(input: StepTotemsInput): StepTotemsResult {
  const { totems, players, tick, dtMs, cooldowns } = input;
  const events: SimEvent[] = [];
  const retriggerTicks = Math.max(1, Math.ceil(TOTEM_RETRIGGER_MS / dtMs));

  for (const totem of totems) {
    const sortedPlayerIds = (Object.keys(players) as PlayerId[]).sort();
    for (const pid of sortedPlayerIds) {
      const player = players[pid]!;
      if (!player.alive) continue;
      if (!playerOverlapsTotem(player, totem)) continue;
      const cooldownUntil = cooldowns.get(pid) ?? Tick(0);
      if (cooldownUntil > tick) continue;
      cooldowns.set(pid, Tick((tick as number) + retriggerTicks));
      events.push(
        totem.kind === "ready"
          ? { t: "ready-toggled", playerId: pid }
          : { t: "launch-requested", playerId: pid },
      );
    }
  }

  return { events };
}

function playerOverlapsTotem(player: PlayerEntity, totem: TotemDefinition): boolean {
  const r = PLAYER_FOOTPRINT_RADIUS;
  return aabbOverlap(
    { x: player.x - r, y: player.y - r, w: r * 2, h: r * 2 },
    {
      x: totem.x - totem.radius,
      y: totem.y - totem.radius,
      w: totem.radius * 2,
      h: totem.radius * 2,
    },
  );
}

/** Standing height above a surface top — the same offset vessel-nexus's own
 *  spawn lattice uses (data/vessel-nexus.ts). */
const TOTEM_STAND_OFFSET = 68;

/**
 * Totem placement. vessel-nexus keeps its hand-tuned ground-band anchors;
 * every other map gets a VALIDATED placement — snapped onto a real
 * standable surface — instead of the old "generic center-ish guess" that
 * could float a totem over a pit (venue-goal Pillar 1.6, audit §9 gap #4).
 * Never throws: a map with no floors/platforms at all (shouldn't exist —
 * the validator requires standable ground) falls back to the old guess.
 */
export function resolveHangoutTotems(map: MapDefinition): TotemDefinition[] {
  if (map.id === "vessel-nexus") {
    const groundY = map.size.y - 36 - TOTEM_STAND_OFFSET; // FLOOR_H=36 (data/vessel-nexus.ts)
    return [
      { id: "totem-ready", kind: "ready", x: map.size.x * 0.42, y: groundY, radius: 70 },
      { id: "totem-launch", kind: "launch", x: map.size.x * 0.58, y: groundY, radius: 70 },
    ];
  }
  return [
    { id: "totem-ready", kind: "ready", radius: 70, ...snapToStandable(map, map.size.x * 0.42) },
    { id: "totem-launch", kind: "launch", radius: 70, ...snapToStandable(map, map.size.x * 0.58) },
  ];
}

/**
 * The public venue lobby's totem set (venue-sprint2-goal S2.B): ONE
 * arena-queue portal, not the room-hangout READY/LAUNCH pair — venue
 * queueing is a single toggle ("in at the next bell"), so a second totem
 * would be a second meaning with no second action. Kind "launch" keeps
 * the SimEvent vocabulary (`launch-requested` = queue toggle in venue
 * semantics; VenueHost maps it). Shared pure function: the server places
 * it, the client renders it at identical coordinates.
 */
export function resolveVenueTotems(map: MapDefinition): TotemDefinition[] {
  if (map.id === "vessel-nexus") {
    const groundY = map.size.y - 36 - TOTEM_STAND_OFFSET;
    return [{ id: "totem-bell", kind: "launch", x: map.size.x * 0.5, y: groundY, radius: 80 }];
  }
  return [{ id: "totem-bell", kind: "launch", radius: 80, ...snapToStandable(map, map.size.x * 0.5) }];
}

/**
 * Snap a target x onto the top of a real standable surface (floor or
 * platform — walls excluded). Preference order: surfaces in the map's
 * lower half (totems belong at ground level, not on a sky ledge), then
 * widest (room to stand and linger without flip-flopping the 1.2s
 * retrigger debounce), then nearest to the target x. The returned x is
 * clamped inside the surface's span with margin so the totem circle
 * doesn't hang off an edge.
 */
function snapToStandable(map: MapDefinition, targetX: number): { x: number; y: number } {
  const standable = map.platforms.filter((p) => p.kind !== "wall");
  if (standable.length === 0) {
    // Degenerate map — old center-ish guess rather than a throw.
    return { x: map.size.x / 2, y: map.size.y * 0.7 };
  }
  const lowerHalf = standable.filter((p) => p.position.y >= map.size.y * 0.5);
  const pool = lowerHalf.length > 0 ? lowerHalf : standable;
  let best = pool[0]!;
  let bestScore = -Infinity;
  for (const p of pool) {
    const centerX = p.position.x + p.size.x / 2;
    // Wide is good, near-target is good — width dominates so a sliver
    // ledge right at targetX doesn't beat the main floor.
    const score = Math.min(p.size.x, 800) - Math.abs(centerX - targetX) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  const margin = Math.min(80, best.size.x / 4);
  const x = Math.min(
    best.position.x + best.size.x - margin,
    Math.max(best.position.x + margin, targetX),
  );
  return { x, y: best.position.y - TOTEM_STAND_OFFSET };
}
