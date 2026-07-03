// In-page bot autopilot for combat probing.
//
// The combat probe originally drove players via CDP keyboard/mouse events.
// On a loaded host, CDP round-trips stall for seconds and the "players"
// wedge mid-walk or miss the 420ms parry window entirely. This driver moves
// the control loop INTO the page: the probe sets a small goal object via
// `window.__setBotInput(...)`, and OnlineMatchScene translates it into an
// input bitfield every sim frame at full rate, no matter how slow the
// harness outside is.
//
// Debug-only surface: nothing in the game calls __setBotInput; a null goal
// (the default) means human input passes through untouched.

import { InputBit } from "../net/protocol.js";
import type { PlayerId, WorldState } from "../sim/types.js";

export type BotGoal = {
  /** Walk toward the nearest other player, stopping inside stopRangePx. */
  moveTowardFoe?: boolean;
  /** Stand-off distance for moveTowardFoe. Default 220. */
  stopRangePx?: number;
  /** Aim at the nearest other player every frame. */
  aimAtFoe?: boolean;
  /** Hold primary fire. */
  fire?: boolean;
  /** Hold shield. */
  shield?: boolean;
  /**
   * Parry trigger: bump this number to fire ONE parry. The driver holds the
   * Ability bit for a few frames (the sim triggers on the rising edge) and
   * then releases until the token changes again.
   */
  parryToken?: number;
};

let goal: BotGoal | null = null;
let lastParryToken = 0;
let parryHoldFrames = 0;

type BotWindow = { __setBotInput?: (g: BotGoal | null) => void };

export function installBotDriver(): void {
  (window as unknown as BotWindow).__setBotInput = (g) => {
    goal = g;
    if (g === null) {
      lastParryToken = 0;
      parryHoldFrames = 0;
    }
  };
}

/**
 * Compute this frame's bot input, or null when no goal is set (human plays).
 * Called by OnlineMatchScene.update() with the current render state.
 */
export function computeBotInput(
  state: WorldState,
  localId: PlayerId,
): { keys: number; aimX: number; aimY: number } | null {
  if (!goal) return null;
  const self = state.players[localId];
  if (!self) return null;

  let foe: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const [pid, p] of Object.entries(state.players)) {
    if (pid === localId || !p.alive) continue;
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (d < bestDist) {
      bestDist = d;
      foe = { x: p.x, y: p.y };
    }
  }

  let keys = 0;
  let aimX = self.aimX;
  let aimY = self.aimY;

  if (foe && goal.aimAtFoe) {
    aimX = foe.x;
    aimY = foe.y;
  }
  if (foe && goal.moveTowardFoe) {
    const stopRange = goal.stopRangePx ?? 220;
    const dx = foe.x - self.x;
    if (Math.abs(dx) > stopRange) {
      keys |= dx > 0 ? InputBit.Right : InputBit.Left;
    }
  }
  if (goal.fire) keys |= InputBit.Fire;
  if (goal.shield) keys |= InputBit.Shield;

  if (goal.parryToken !== undefined && goal.parryToken !== lastParryToken) {
    lastParryToken = goal.parryToken;
    // Hold long enough that at least one sim step sees the rising edge
    // even if render frames outpace sim steps.
    parryHoldFrames = 4;
  }
  if (parryHoldFrames > 0) {
    parryHoldFrames -= 1;
    keys |= InputBit.Ability;
  }

  return { keys, aimX, aimY };
}
