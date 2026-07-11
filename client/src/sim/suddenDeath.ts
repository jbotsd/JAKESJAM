// Sudden-death shrinking arena (design pillars doc, "distinctive features"),
// PLUS a gentler soft endgame zone in the last 15s of EVERY round (balance
// audit — timeout rewarded passive corner-camping since it resolved to
// most-health-remaining). A pure DoT step, structurally identical to
// fire.ts's stepFirePatches: given the current round state + map size,
// damage every alive player standing outside a safe-zone circle that
// shrinks over time. Triggering (isSuddenDeathRound) and the active flag
// live in round.ts; this file only enforces the damage once a round
// qualifies for one zone or the other. Full sudden death always takes
// precedence — the two never stack.
//
// Hard rules: no Phaser, no DOM, no wall-clock reads, no Math.random. Iterate
// players in id order for cross-runtime determinism.

import {
  ENDGAME_ZONE_SCALE_END,
  ENDGAME_ZONE_TRIGGER_MS,
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
 * Tick the shrink-zone storm. No-op (empty events) outside `fighting`
 * phase — countdown/round-over/drafting freeze it same as they freeze
 * combat. Two zones, mutually exclusive, sudden death wins ties:
 *   - Full sudden death (`round.suddenDeathActive`, a 2-2 game-point tie):
 *     shrinks the WHOLE round, START->END (harder, 0.6).
 *   - Soft endgame zone (every round, unconditionally): only active in the
 *     final ENDGAME_ZONE_TRIGGER_MS, eases from full coverage to a gentler
 *     ENDGAME_ZONE_SCALE_END (0.75) — pressure against timeout-camping
 *     without being a hard sudden-death punish.
 */
export function stepSuddenDeathStorm(
  players: Record<PlayerId, PlayerEntity>,
  round: RoundState,
  mapSize: Vec2,
  dtMs: number,
): StepSuddenDeathStormResult {
  if (round.phase !== "fighting") {
    return { events: [] };
  }

  let scale: number;
  if (round.suddenDeathActive) {
    const elapsedMs = ROUND_TIME_LIMIT_MS - round.countdownRemainingMs;
    const frac = Math.max(0, Math.min(1, elapsedMs / ROUND_TIME_LIMIT_MS));
    scale = SUDDEN_DEATH_SCALE_START + (SUDDEN_DEATH_SCALE_END - SUDDEN_DEATH_SCALE_START) * frac;
  } else if (round.countdownRemainingMs <= ENDGAME_ZONE_TRIGGER_MS) {
    // countdownRemainingMs IS the remaining round time during `fighting`.
    const localElapsedMs = ENDGAME_ZONE_TRIGGER_MS - round.countdownRemainingMs;
    const frac = Math.max(0, Math.min(1, localElapsedMs / ENDGAME_ZONE_TRIGGER_MS));
    scale = 1.0 + (ENDGAME_ZONE_SCALE_END - 1.0) * frac;
  } else {
    return { events: [] };
  }

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
      attackerId: null,
    });
  }

  return { events };
}
