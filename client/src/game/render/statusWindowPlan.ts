// Pure Phaser-free planner for SELF-WINDOW body reads (Track L,
// docs/legibility-audit.md): ability/status windows that lived only as
// nameplate chips (or nowhere at all) get a world-space read at the
// fighter's own body for their whole duration. Same planner/painter split
// as veilReadPlan.ts / markReadPlan.ts — StatusVfxController consumes the
// plan and owns the painting, bun:test covers the decisions headlessly.
//
// Doctrine #10 (six-axes-goal.md): "at every point it should be clear
// what's going on" — an enemy shooting into a counter-stance, aiming at a
// Measure-perfect wizard, or standing inside an Aegis peel radius deserves
// to SEE the state they are playing against; a fighter wearing Vulnerability
// or Fooled deserves to see why the numbers got bigger. Chips supplement,
// never carry (nameplate chips are NOT site reads).
//
// Kind → sim field:
//   counter — counterUntilTick        (Severing Answer's armed stance)
//   seal    — sealUntilTick           (Unbroken Seal: next Kindled Edge amped)
//   tithe   — titheUntilTick          (Crimson Tithe's live leech window)
//   measure — measureUntilTick        (Measure: zero-spread + amp window)
//   surge   — speedBoostUntilTick     (stride surge / any speed boost)
//   vuln    — vulnerabilityUntilTick  (takes amplified damage)
//   jam     — blockJammerUntilTick    (shield + parry disabled)
//   fooled  — fooledUntilTick         (Paper Double's amp debuff)
//   aegis   — aegisShareUntilTick     (widened team-peel radius — the
//             painter draws the TRUE radius so the mechanic itself reads)
//   fangs   — pendingLockCharges/pendingLockExpiresAtTick (Stolen Fangs
//             banked lock charges; `count` carries the charge count)
//
// Expiry needs no frame-diff memo: the window stops planning and
// `intensity` eases to 0 over the final fade so the end reads instead of
// popping (the veilReadPlan contract).

import { STEP_MS } from "../../sim/constants.js";
import type { PlayerId, Vec2, WorldState } from "../../sim";

export type WindowKind =
  | "counter"
  | "seal"
  | "tithe"
  | "measure"
  | "surge"
  | "vuln"
  | "jam"
  | "fooled"
  | "aegis"
  | "fangs";

export type WindowRead = {
  id: string;
  kind: WindowKind;
  pos: Vec2;
  /** 1 for most of the window, easing to 0 over the kind's fade tail. */
  intensity: number;
  /** Sign of meaningful horizontal velocity (surge streaks trail BEHIND
   *  the mover); 0 when near-stationary. */
  vxSign: -1 | 0 | 1;
  /** Charge count for counted windows (fangs); 1 otherwise. */
  count: number;
};

/** Counter's whole window is only ~500ms — a long fade would read as the
 *  stance ending the moment it began, so it gets a short tail. */
const FADE_MS_DEFAULT = 300;
const FADE_MS_COUNTER = 150;

const SURGE_MIN_VX = 20;

export function planStatusWindows(
  state: WorldState,
  getPosition: (id: PlayerId) => Vec2 | undefined,
): WindowRead[] {
  const reads: WindowRead[] = [];
  for (const pidStr of Object.keys(state.players).sort()) {
    const player = state.players[pidStr as PlayerId]!;
    if (!player.alive) continue;
    const pos = getPosition(pidStr as PlayerId);
    if (!pos) continue;
    const vxSign: -1 | 0 | 1 =
      player.vx > SURGE_MIN_VX ? 1 : player.vx < -SURGE_MIN_VX ? -1 : 0;

    const push = (kind: WindowKind, until: number | undefined, fadeMs: number, count = 1): void => {
      if (until === undefined || until <= state.tick) return;
      const remainingMs = (until - state.tick) * STEP_MS;
      reads.push({
        id: pidStr,
        kind,
        pos,
        intensity: Math.min(1, remainingMs / fadeMs),
        vxSign,
        count,
      });
    };

    push("counter", player.counterUntilTick, FADE_MS_COUNTER);
    push("seal", player.sealUntilTick, FADE_MS_DEFAULT);
    push("tithe", player.titheUntilTick, FADE_MS_DEFAULT);
    push("measure", player.measureUntilTick, FADE_MS_DEFAULT);
    push("surge", player.speedBoostUntilTick, FADE_MS_DEFAULT);
    push("vuln", player.vulnerabilityUntilTick, FADE_MS_DEFAULT);
    push("jam", player.blockJammerUntilTick, FADE_MS_DEFAULT);
    push("fooled", player.fooledUntilTick, FADE_MS_DEFAULT);
    push("aegis", player.aegisShareUntilTick, FADE_MS_DEFAULT);
    if ((player.pendingLockCharges ?? 0) > 0) {
      push(
        "fangs",
        player.pendingLockExpiresAtTick,
        FADE_MS_DEFAULT,
        player.pendingLockCharges ?? 1,
      );
    }
  }
  return reads;
}
