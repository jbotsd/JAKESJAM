// Launch pad system. Pure, deterministic, runtime-agnostic.
//
// Pads are STATIC map geometry (`MapDefinition.launchPads`) — the first
// movement-affecting sim entity since the Zig cutover, built with the same
// parity discipline as pickups (sim/src/world.zig §8c is the Zig mirror;
// every formula here must move in lock-step with it).
//
// ── Why pads carry ZERO WorldState bytes ─────────────────────────────────
// Platforms never ride the snapshot: both sides derive them from mapId.
// Pads earn the same treatment because their only would-be dynamic state
// (a retrigger cooldown) is expressible as a STATELESS condition on the
// player's CURRENT velocity:
//
//   fire ⇔ overlap ∧ vAlong < LAUNCH_RETRIGGER_FRACTION · |impulse|
//
// where vAlong = dot(playerVelocity, impulseDirection). Immediately after
// a launch, the player's velocity along the pad direction is ≥ |impulse|
// (see the formula below), so the gate is closed on the very next tick and
// stays closed until the pad has physically thrown them out of its AABB.
// No `lastFiredTick`, no per-player cooldown map, no worldStateBridge
// layout change, no wire/protocol implications.
//
// Known authoring edge: a pad firing straight into solid geometry (e.g. an
// up-pad under a low ceiling) has its launch velocity cancelled by the
// collision resolve, which re-opens the gate → it re-fires every other
// tick. That is deterministic (both sides agree) but noisy — don't author
// pads that fire into walls.
//
// ── The impulse formula (the "hitting a ramp at speed" feel) ─────────────
// Jake's ask is Tribes/ramp feel: approach speed must be REWARDED, never
// eaten. Decompose the player's velocity around the pad direction î:
//
//   vAlong  = dot(v, î)              (speed already going the pad's way)
//   vPerp   = v − vAlong·î           (everything else — fully preserved)
//   vAlong' = clamp(vAlong + |impulse|,
//                   min = |impulse|,                    (guaranteed launch)
//                   max = LAUNCH_ALONG_CAP_FACTOR·|impulse|)   (the cap)
//   v'      = vPerp + vAlong'·î
//
// ADD with a floor and a cap: a standing player gets exactly the pad's
// impulse; a player who arrives already moving the pad's way keeps that
// speed on top (capped at 1.35× so chained pads can't build unbounded
// velocity); a player who slams INTO the pad against its direction (hard
// fall onto an up-pad) still gets the full |impulse| launch — the pad
// absorbs the fall instead of producing a dead bounce. Perpendicular
// velocity passes through untouched, which is what preserves the approach
// run on a diagonal pad.
//
// NO RNG, no allocation-order sensitivity: pads iterate in map-array order
// (static, identical on both sides), players in sorted-id order — the same
// deterministic tie-break discipline as pickup.ts.

import { aabbOverlap } from "./collision.js";
import { EntityId, PlayerId } from "./types.js";
import type {
  LaunchPadDefinition,
  PlayerEntity,
  SimEvent,
  WorldState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants. MIRRORED in sim/src/world.zig §8c — change both or neither.
// ---------------------------------------------------------------------------

/** Player body half-extents for the pad overlap test (26w×56h body →
 *  the sim's canonical 15/28 halves, same as the Zig projectile/fire
 *  passes use — NOT pickup.ts's easy-grab 18px footprint: a movement
 *  trigger should match the body you steer, not a widened grab zone). */
export const LAUNCH_PLAYER_HALF_W = 15;
export const LAUNCH_PLAYER_HALF_H = 28;

/** Stateless retrigger gate: the pad only fires while the player's
 *  velocity along the pad direction is below this fraction of |impulse|.
 *  Post-launch vAlong ≥ |impulse| > this, so a fresh launch always closes
 *  the gate on the next tick. */
export const LAUNCH_RETRIGGER_FRACTION = 0.5;

/** Cap on the post-launch along-pad speed, as a multiple of |impulse| —
 *  the "ADD with a cap" half of the ramp feel. */
export const LAUNCH_ALONG_CAP_FACTOR = 1.35;

// ---------------------------------------------------------------------------
// Public step function. Pure relative to its inputs; returns a patch map of
// changed players + emitted events. Caller merges the patch (same contract
// as pickup.ts's applyPickup output).
// ---------------------------------------------------------------------------

export type StepLaunchPadsInput = {
  /** Static pad definitions from the map. Iterated in ARRAY ORDER —
   *  the map is byte-identical on both sides, so index order is the
   *  deterministic cross-host iteration order (pads have no numeric
   *  entity ids to sort by; their index IS their id on the wire). */
  pads: readonly LaunchPadDefinition[];
  players: WorldState["players"];
};

export type StepLaunchPadsResult = {
  /** Patch map: only players whose velocity changed this tick. */
  players: Record<PlayerId, PlayerEntity>;
  events: SimEvent[];
};

export function stepLaunchPads(input: StepLaunchPadsInput): StepLaunchPadsResult {
  const patch: Record<PlayerId, PlayerEntity> = {};
  const events: SimEvent[] = [];

  // Sorted player ids — deterministic inner iteration (pickup.ts pattern).
  // Unlike pickups there is no first-collector-wins: every overlapping
  // player launches (a pad is terrain, not a consumable).
  const sortedPlayerIds = Object.keys(input.players).sort();

  for (let padIndex = 0; padIndex < input.pads.length; padIndex++) {
    const pad = input.pads[padIndex]!;
    const magnitude = Math.sqrt(
      pad.impulse.x * pad.impulse.x + pad.impulse.y * pad.impulse.y,
    );
    if (magnitude <= 0) continue; // degenerate authoring — inert pad
    const ux = pad.impulse.x / magnitude;
    const uy = pad.impulse.y / magnitude;
    const retriggerGate = LAUNCH_RETRIGGER_FRACTION * magnitude;
    const alongCap = LAUNCH_ALONG_CAP_FACTOR * magnitude;

    for (const pid_ of sortedPlayerIds) {
      const pid = pid_ as PlayerId;
      // Read from the patch when a previous pad already launched this
      // player this tick — pads compose in pad-array order.
      const player = patch[pid] ?? input.players[pid]!;
      if (!player.alive) continue;
      if (!playerOverlapsPad(player, pad)) continue;

      const vAlong = player.vx * ux + player.vy * uy;
      if (vAlong >= retriggerGate) continue; // already launched / moving away

      // ADD with floor + cap; perpendicular velocity preserved (header).
      const vPerpX = player.vx - vAlong * ux;
      const vPerpY = player.vy - vAlong * uy;
      const boosted = Math.min(vAlong + magnitude, alongCap);
      const newAlong = Math.max(magnitude, boosted);
      patch[pid] = {
        ...player,
        vx: vPerpX + newAlong * ux,
        vy: vPerpY + newAlong * uy,
      };
      events.push({
        t: "launch-pad-fired",
        entityId: EntityId(padIndex),
        playerId: pid,
      });
    }
  }

  return { players: patch, events };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function playerOverlapsPad(
  player: PlayerEntity,
  pad: LaunchPadDefinition,
): boolean {
  return aabbOverlap(
    {
      x: player.x - LAUNCH_PLAYER_HALF_W,
      y: player.y - LAUNCH_PLAYER_HALF_H,
      w: LAUNCH_PLAYER_HALF_W * 2,
      h: LAUNCH_PLAYER_HALF_H * 2,
    },
    {
      x: pad.position.x - pad.size.x / 2,
      y: pad.position.y - pad.size.y / 2,
      w: pad.size.x,
      h: pad.size.y,
    },
  );
}
