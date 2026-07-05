// Shared ResolvedFireConfig resolution + byte-writing, used by BOTH the client
// host (wasmHost) and the server host (serverWasmHost). Extracted so the two
// cutover paths can never drift on the struct layout or the build resolution —
// a divergence there would desync client prediction from server authority
// exactly on card-carrying players (the pure-Zig cutover's highest risk).

import type { PlayerId, WorldState } from "../types.js";
import type { ResolvedFireConfigBytes } from "./wasmHost.js";
import { createWeaponBuild } from "../data/weaponBuild.js";
import { starterWeapon, weapons } from "../data/weapons.js";
import { crystalRoundsCards } from "../data/cards.js";
import { packResolvedFireConfig } from "../data/packResolvedFireConfig.js";

const cache = new Map<string, { signature: string; bytes: ResolvedFireConfigBytes }>();

/**
 * Resolve per-player ResolvedFireConfigBytes for `state`, in sorted-playerId
 * order (matches packPlayer + writePlayerInputs). Card-signature cached so
 * re-resolution only happens on a card pick. Pure w.r.t. wasm memory.
 */
export function resolveFireConfigsForState(
  state: WorldState,
): Array<ResolvedFireConfigBytes | null> {
  const sortedPids = Object.keys(state.players).sort();
  const out: Array<ResolvedFireConfigBytes | null> = [];
  for (const pid of sortedPids) {
    const player = state.players[pid as PlayerId];
    if (!player) {
      out.push(null);
      continue;
    }
    const cardSig = `${player.weaponId}|${player.cards.join(",")}`;
    const cached = cache.get(pid);
    if (cached && cached.signature === cardSig) {
      out.push(cached.bytes);
      continue;
    }
    const baseWeapon = weapons.find((w) => w.id === player.weaponId) ?? starterWeapon;
    const cardDefs = player.cards
      .map((id) => crystalRoundsCards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    const bytes = packResolvedFireConfig(createWeaponBuild(baseWeapon, cardDefs));
    cache.set(pid, { signature: cardSig, bytes });
    out.push(bytes);
  }
  return out;
}

/** Test-only: clear the resolution cache. */
export function clearFireConfigResolveCache(): void {
  cache.clear();
}

/**
 * Write one ResolvedFireConfig record (weapon stats + card augments) into a
 * DataView at byte `off`. Field order/offsets mirror
 * sim/src/world_state.zig `ResolvedFireConfig`.
 */
export function writeResolvedFireConfigBytes(
  view: DataView,
  off: number,
  cfg: ResolvedFireConfigBytes,
): void {
  view.setFloat64(off + 0, cfg.damage, true);
  view.setFloat64(off + 8, cfg.fireRate, true);
  view.setFloat64(off + 16, cfg.projectileSpeed, true);
  view.setFloat64(off + 24, cfg.projectileLifetimeSeconds, true);
  view.setFloat64(off + 32, cfg.spreadRadians, true);
  view.setFloat64(off + 40, cfg.rangePx, true);
  view.setFloat64(off + 48, cfg.homingStrength, true);
  view.setFloat64(off + 56, cfg.accelerationMultiplier, true);
  view.setFloat64(off + 64, cfg.gravityScale, true);
  view.setFloat64(off + 72, cfg.slowMultiplier, true);
  view.setFloat64(off + 80, cfg.impactRadiusPx, true);
  view.setFloat64(off + 88, cfg.sizeMultiplier, true);
  view.setFloat64(off + 96, cfg.speedMultiplier, true);
  view.setFloat64(off + 104, cfg.lifetimeMultiplier, true);
  view.setUint32(off + 112, cfg.projectileCount >>> 0, true);
  view.setUint32(off + 116, cfg.bounces >>> 0, true);
  view.setUint32(off + 120, cfg.pierceCount >>> 0, true);
  view.setUint32(off + 124, cfg.splitCount >>> 0, true);
  view.setUint8(off + 128, cfg.shapeIdx);
  view.setUint8(off + 129, cfg.elementIdx);
  view.setUint8(off + 130, cfg.pathingIdx);
  view.setUint8(off + 131, cfg.impactIdx);
  view.setUint8(off + 132, 1); // valid
  view.setUint8(off + 133, 0);
  view.setUint8(off + 134, 0);
  view.setUint8(off + 135, 0);
  // Card augments (offset 136+).
  view.setFloat64(off + 136, cfg.moveSpeedMultiplier, true);
  view.setFloat64(off + 144, cfg.gravityMultiplier, true);
  view.setFloat64(off + 152, cfg.jumpMultiplier, true);
  view.setFloat64(off + 160, cfg.wallJumpMultiplier, true);
  view.setFloat64(off + 168, cfg.wallSlideMultiplier, true);
  view.setFloat64(off + 176, cfg.shieldChargeMultiplier, true);
  view.setFloat64(off + 184, cfg.shieldRechargeMultiplier, true);
  view.setFloat64(off + 192, cfg.parryCoverMultiplier, true);
  view.setFloat64(off + 200, cfg.parryCooldownMultiplier, true);
  view.setFloat64(off + 208, cfg.maxHealthAdd, true);
  view.setUint32(off + 216, cfg.airJumps >>> 0, true);
  view.setUint32(off + 220, cfg.dashCharges >>> 0, true);
  view.setUint8(off + 224, cfg.mirrorShield ? 1 : 0);
  view.setUint8(off + 225, cfg.directionalShield ? 1 : 0);
}

/**
 * Write an array of per-player configs into a fire-config array region.
 * `null` entries mark the slot invalid (valid=0 → world.zig uses starter base).
 */
export function writeFireConfigsInto(
  view: DataView,
  baseOffset: number,
  recordSize: number,
  configs: ReadonlyArray<ResolvedFireConfigBytes | null>,
): void {
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const off = baseOffset + i * recordSize;
    if (!cfg) {
      view.setUint8(off + 132, 0);
      continue;
    }
    writeResolvedFireConfigBytes(view, off, cfg);
  }
}
