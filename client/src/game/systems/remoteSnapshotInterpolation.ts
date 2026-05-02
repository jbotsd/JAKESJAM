// Pure interpolation helpers for remote-player snapshots. Lifted into its
// own module so it can be unit-tested without pulling Phaser through the
// RemotePlayerManager import chain (ProceduralPlayerRig depends on Phaser
// at module load).

import type { Vec2 } from "../types/game";
import type { MatchPlayerSnapshot } from "../types/net";

export const REMOTE_SMOOTHING = 0.26;
export const REMOTE_AIM_LERP_STEP = 0.35;

export function smoothSnapshot(
  previous: MatchPlayerSnapshot,
  next: MatchPlayerSnapshot,
): MatchPlayerSnapshot {
  return {
    ...next,
    position: lerpVec(previous.position, next.position, REMOTE_SMOOTHING),
    velocity: lerpVec(previous.velocity, next.velocity, REMOTE_SMOOTHING),
    aimAngle: rotateAngleTo(previous.aimAngle, next.aimAngle, REMOTE_AIM_LERP_STEP),
  };
}

function lerpVec(a: Vec2, b: Vec2, amount: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

/**
 * Bit-exact port of Phaser.Math.Angle.RotateTo (Phaser 4.1). Reproduced
 * inline so consumers don't need the Phaser runtime.
 */
function rotateAngleTo(currentAngle: number, targetAngle: number, lerp: number): number {
  if (currentAngle === targetAngle) {
    return currentAngle;
  }
  const TAU = Math.PI * 2;
  if (
    Math.abs(targetAngle - currentAngle) <= lerp ||
    Math.abs(targetAngle - currentAngle) >= TAU - lerp
  ) {
    return targetAngle;
  }
  let target = targetAngle;
  if (Math.abs(target - currentAngle) > Math.PI) {
    if (target < currentAngle) {
      target += TAU;
    } else {
      target -= TAU;
    }
  }
  if (target > currentAngle) {
    return currentAngle + lerp;
  }
  if (target < currentAngle) {
    return currentAngle - lerp;
  }
  return currentAngle;
}
