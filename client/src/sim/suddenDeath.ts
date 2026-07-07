// Sudden-death shrinking arena (design pillars doc, "distinctive features").
// A pure DoT step, structurally identical to fire.ts's stepFirePatches: given
// the current round state + map size, damage every alive player standing
// outside a safe-zone circle that shrinks from SUDDEN_DEATH_SCALE_START to
// SUDDEN_DEATH_SCALE_END (fraction of the arena's half-diagonal) over the
// round timer. Triggering (isSuddenDeathRound) and the active flag live in
// round.ts; this file only enforces the damage once a round is flagged.
//
// Hard rules: no Phaser, no DOM, no wall-clock reads, no Math.random. Iterate
// players in id order for cross-runtime determinism.

import {
  ROUND_TIME_LIMIT_MS,
  SUDDEN_DEATH_SCALE_END,
  SUDDEN_DEATH_SCALE_START,
  SUDDEN_DEATH_STORM_DPS,
} from "./round.js";
import { PlayerId } from "./types.js";
import type { PlayerEntity, RoundState, SimEvent, Vec2 } from "./types.js";

export type StepSuddenDeathStormResult = {
  /** hit-confirmed events for the world to drain into player health, same
   *  shape/handling as fire.ts's output. */
  events: SimEvent[];
};

/**
 * Tick the sudden-death storm. No-op (empty events) unless
 * `round.suddenDeathActive` is true and the round is in `fighting` phase —
 * countdown/round-over/drafting freeze the storm same as they freeze combat.
 */
export function stepSuddenDeathStorm(
  players: Record<PlayerId, PlayerEntity>,
  round: RoundState,
  mapSize: Vec2,
  dtMs: number,
): StepSuddenDeathStormResult {
  if (!round.suddenDeathActive || round.phase !== "fighting") {
    return { events: [] };
  }

  const elapsedMs = ROUND_TIME_LIMIT_MS - round.countdownRemainingMs;
  const frac = Math.max(0, Math.min(1, elapsedMs / ROUND_TIME_LIMIT_MS));
  const scale = SUDDEN_DEATH_SCALE_START + (SUDDEN_DEATH_SCALE_END - SUDDEN_DEATH_SCALE_START) * frac;

  const centerX = mapSize.x / 2;
  const centerY = mapSize.y / 2;
  // Half-diagonal so scale=1.0 comfortably covers every corner of the arena
  // — nobody takes storm damage the instant sudden death triggers.
  const baseRadius = Math.hypot(mapSize.x, mapSize.y) / 2;
  const safeRadius = baseRadius * scale;
  const safeRadiusSq = safeRadius * safeRadius;

  const dtSec = dtMs / 1000;
  const events: SimEvent[] = [];

  const playerIds = (Object.keys(players) as PlayerId[]).sort();
  for (const pid of playerIds) {
    const p = players[pid]!;
    if (!p.alive) continue;
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    if (dx * dx + dy * dy <= safeRadiusSq) continue;
    events.push({
      t: "hit-confirmed",
      victimId: pid,
      damage: SUDDEN_DEATH_STORM_DPS * dtSec,
      sourceProjectileId: null,
    });
  }

  return { events };
}
