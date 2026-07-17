// Drafted-active slot vitals (six-axes-goal.md Layer 2): pure derivation
// from a player entity + the current tick into what the action bar draws —
// slot order is pick order (build.actives), readyFrac is the cooldown
// sweep, windowFrac is the live effect window (Tithe's crimson beat).
// Sibling of acquiredAbilities.ts: sim state in, display model out, no
// Phaser. The sim's cooldown VALIDATION lives in World.ts — this file only
// reads; it must never re-derive eligibility differently (one authority).

import { STEP_MS } from "../../sim/constants.js";
import { resolvePlayerBuild } from "../../sim/weapon.js";
import type { PlayerEntity } from "../../sim/types.js";
import type { ActiveSlotVital } from "./ActionBarSystem.js";

export function activeSlotVitals(
  player: PlayerEntity,
  tick: number,
): ActiveSlotVital[] {
  const build = resolvePlayerBuild(player);
  if (build.actives.length === 0) return [];
  const cooldownTicks = [
    player.slot1CooldownUntilTick,
    player.slot2CooldownUntilTick,
    player.slot3CooldownUntilTick,
    player.slot4CooldownUntilTick,
  ];
  return build.actives.map((active, i) => {
    const cdUntil = cooldownTicks[i];
    const cdTotal = Math.max(1, Math.ceil(active.cooldownMs / STEP_MS));
    const remaining = cdUntil !== undefined ? Math.max(0, cdUntil - tick) : 0;
    const readyFrac = 1 - Math.min(1, remaining / cdTotal);
    // Effect window per kind — each active's window rides its own sim
    // field (the sim is the authority; this only reads).
    const windowUntil =
      active.kind === "crimson-tithe"
        ? player.titheUntilTick
        : active.kind === "veil-of-nought"
          ? player.veilUntilTick
          : active.kind === "severing-answer"
            ? player.counterUntilTick
            : active.kind === "shelter-seal"
              ? player.wardShellUntilTick
              : undefined;
    let windowFrac = 0;
    if (
      active.durationMs > 0 &&
      windowUntil !== undefined &&
      windowUntil > tick
    ) {
      const durTotal = Math.max(1, Math.ceil(active.durationMs / STEP_MS));
      windowFrac = Math.min(1, (windowUntil - tick) / durTotal);
    }
    return {
      kind: active.kind,
      keyLabel: `${i + 1}`,
      readyFrac,
      windowFrac,
    };
  });
}
