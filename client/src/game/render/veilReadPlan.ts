// Pure Phaser-free planner for the Veil-of-Nought body read (Track L,
// docs/legibility-audit.md): WHO is unmade this frame (shroud targets, with
// an expiry-fade intensity) and WHOSE veil just BROKE by firing (seam-snap
// targets). StatusVfxController consumes the plan and owns the painting —
// same planner/painter split entanglementPlan.ts established for the
// Syzygist tether, so bun:test can cover the decision logic headlessly.
//
// Doctrine #10 vs stealth: the audit's design intent is that a WATCHING
// enemy can tell who is veiled — Veil's power is homing/satellite
// blindness, not invisibility from humans. The shroud is therefore a
// quiet negative-space outline (the painter's job), but it must exist.
//
// Break detection (renderer-side frame-diff — no SimEvent exists): the
// sim's ONLY clear-to-undefined site is the break-on-firing (World.ts
// "Veil of Nought breaks on firing"); natural expiry leaves the stale
// past tick in place, and a fresh respawn entity can only drop the field
// while the window was already dead (a dead player is never "live" here).
// So "was live last frame AND the field is undefined now" is unambiguous
// — the same definedness reasoning ConstructVfxController's
// consumedThisFrame documents for Ghost Guard/Shock Ring/Wall Bloom.

import { STEP_MS } from "../../sim/constants.js";
import type { PlayerId, Vec2, WorldState } from "../../sim";

/** The shroud eases out over the window's final ms so expiry never pops —
 *  and a fading shroud doubles as the enemy's "the veil is ending" tell. */
const VEIL_FADE_MS = 300;

export type VeilReadMemo = {
  /** playerId → was their veil window LIVE (field defined, ahead of the
   *  tick, and alive) last frame. */
  wasLive: Map<string, boolean>;
};

export function makeVeilReadMemo(): VeilReadMemo {
  return { wasLive: new Map() };
}

export type VeilReadPlan = {
  /** Fighters currently unmade — shroud cadence targets. `intensity` is 1
   *  for most of the window, easing to 0 over the final VEIL_FADE_MS. */
  shrouds: Array<{ id: string; pos: Vec2; intensity: number }>;
  /** Fighters whose veil broke THIS frame (fired while unmade). */
  breaks: Array<{ id: string; pos: Vec2 }>;
};

export function planVeilRead(
  state: WorldState,
  getPosition: (id: PlayerId) => Vec2 | undefined,
  memo: VeilReadMemo,
): VeilReadPlan {
  const plan: VeilReadPlan = { shrouds: [], breaks: [] };
  const seen = new Set<string>();
  for (const [pidStr, player] of Object.entries(state.players)) {
    seen.add(pidStr);
    const live =
      player.alive &&
      player.veilUntilTick !== undefined &&
      player.veilUntilTick > state.tick;
    const wasLive = memo.wasLive.get(pidStr) ?? false;
    memo.wasLive.set(pidStr, live);
    const pos = getPosition(pidStr as PlayerId);
    if (!pos) continue;
    if (live) {
      const remainingMs =
        ((player.veilUntilTick as number) - state.tick) * STEP_MS;
      plan.shrouds.push({
        id: pidStr,
        pos,
        intensity: Math.min(1, remainingMs / VEIL_FADE_MS),
      });
    } else if (wasLive && player.veilUntilTick === undefined) {
      // Cleared-to-undefined while live = the break-on-firing site fired.
      // Natural expiry keeps the stale tick and lands in neither branch.
      plan.breaks.push({ id: pidStr, pos });
    }
  }
  // Roster hygiene: drop memo entries for players no longer in the state.
  for (const key of memo.wasLive.keys()) {
    if (!seen.has(key)) memo.wasLive.delete(key);
  }
  return plan;
}
