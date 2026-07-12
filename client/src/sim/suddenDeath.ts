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

/** Geometry of the shrink-zone storm for one tick — the render layer's
 *  single source of truth (renderContract.produceStormZone consumes this
 *  directly), so the boundary players SEE is bit-identical to the one
 *  that damages them. `null` when no zone is active this tick. */
export type StormZone = {
  centerX: number;
  centerY: number;
  radius: number;
  /** 1.0 = full arena coverage (safe), shrinks toward the round's END
   *  scale as the zone closes. Purely descriptive for the renderer. */
  scale: number;
  /** Which mechanic is driving the zone — colors/urgency differ. */
  kind: "endgame" | "sudden-death";
};

/**
 * Pure geometry, no player iteration — shared by `stepSuddenDeathStorm`
 * (damage) and `renderContract.produceStormZone` (the boundary ring every
 * client draws). No-op (`null`) outside `fighting` phase. Two zones,
 * mutually exclusive, sudden death wins ties:
 *   - Full sudden death (`round.suddenDeathActive`, a 2-2 game-point tie):
 *     shrinks the WHOLE round, START->END (harder, 0.6).
 *   - Soft endgame zone (every round, unconditionally): only active in the
 *     final ENDGAME_ZONE_TRIGGER_MS, eases from full coverage to a gentler
 *     ENDGAME_ZONE_SCALE_END (0.75) — pressure against timeout-camping
 *     without being a hard sudden-death punish.
 */
export function computeStormZone(round: RoundState, mapSize: Vec2): StormZone | null {
  if (round.phase !== "fighting") return null;

  let scale: number;
  let kind: StormZone["kind"];
  if (round.suddenDeathActive) {
    const elapsedMs = ROUND_TIME_LIMIT_MS - round.countdownRemainingMs;
    const frac = Math.max(0, Math.min(1, elapsedMs / ROUND_TIME_LIMIT_MS));
    scale = SUDDEN_DEATH_SCALE_START + (SUDDEN_DEATH_SCALE_END - SUDDEN_DEATH_SCALE_START) * frac;
    kind = "sudden-death";
  } else if (round.countdownRemainingMs <= ENDGAME_ZONE_TRIGGER_MS) {
    // countdownRemainingMs IS the remaining round time during `fighting`.
    const localElapsedMs = ENDGAME_ZONE_TRIGGER_MS - round.countdownRemainingMs;
    const frac = Math.max(0, Math.min(1, localElapsedMs / ENDGAME_ZONE_TRIGGER_MS));
    scale = 1.0 + (ENDGAME_ZONE_SCALE_END - 1.0) * frac;
    kind = "endgame";
  } else {
    return null;
  }

  // Half-diagonal so scale=1.0 comfortably covers every corner of the arena
  // — nobody takes storm damage the instant sudden death triggers.
  const baseRadius = Math.hypot(mapSize.x, mapSize.y) / 2;
  return {
    centerX: mapSize.x / 2,
    centerY: mapSize.y / 2,
    radius: baseRadius * scale,
    scale,
    kind,
  };
}

/**
 * Tick the shrink-zone storm: damage every alive player standing outside
 * `computeStormZone`'s boundary. Structurally identical to fire.ts's
 * stepFirePatches.
 */
export function stepSuddenDeathStorm(
  players: Record<PlayerId, PlayerEntity>,
  round: RoundState,
  mapSize: Vec2,
  dtMs: number,
): StepSuddenDeathStormResult {
  const zone = computeStormZone(round, mapSize);
  if (!zone) return { events: [] };

  const safeRadiusSq = zone.radius * zone.radius;
  const dtSec = dtMs / 1000;
  const events: SimEvent[] = [];

  const playerIds = (Object.keys(players) as PlayerId[]).sort();
  for (const pid of playerIds) {
    const p = players[pid]!;
    if (!p.alive) continue;
    const dx = p.x - zone.centerX;
    const dy = p.y - zone.centerY;
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
