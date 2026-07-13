// Scripted, song-time-keyed opponent AI for the Pretennoia tutorial's combat
// arenas. Goal-shaped like debug/botDriver.ts's BotGoal (moveTowardFoe/
// aimAtFoe/fire — same semantics) but NOT a reuse of that module, which is
// an explicitly debug-only singleton keyed to the online scene
// (window.__setBotInput) — hijacking a debug surface for production
// behavior would break the moment the debug harness also targets this scene.
// This is a small, fresh, purpose-built driver instead.
//
// The dummy visually reads as a fragment of the same seal geometry the
// player is learning to fight within (see TutorialDiegeticCues.ts) — the
// mode names below ("idle-flinch", "return-fire", "telegraphed-shot") are
// difficulty/teaching stages fired by SongDirector's "dummy:goal" cues, not
// a generic difficulty slider.

import { InputBit } from "../../net/protocol.js";
import type { PlayerEntity, Vec2 } from "../../sim/types.js";
import type { TutorialDuelInput } from "../../sim/tutorialDuel.js";

export type DummyGoalMode = "idle-flinch" | "return-fire" | "telegraphed-shot";

export type DummyGoal = {
  mode: DummyGoalMode;
  /** ms between fire pulses. Ignored for idle-flinch. */
  fireIntervalMs?: number;
  /** Stand-off distance from the hero. Default 260. */
  stopRangePx?: number;
};

const FIRE_PULSE_MS = 130; // long enough for stepWeapon's own cooldown gate to register one shot
// "telegraphed-shot" was previously code-identical to "return-fire" — same
// instant pulse-on-timer, zero visible difference — so the "teach dash-
// parry by consequence" design intent (tutorial-song.ts's own comment)
// never actually existed. This is the real fix: a genuine wind-up BEFORE
// the shot fires, long enough to read and react to (block with Shield, or
// dash through it with the Aegis power-slide), rendered by TutorialScene
// reading telegraphProgress() into the thrall's charge-up glow.
const TELEGRAPH_WINDUP_MS = 680;
// Jump tell: a held key only triggers ONE jump on the rising edge (same
// contract as a human's keypress — see stepPlayer's prevKeys/currKeys
// edge check), so this pulse just needs to outlast one physics tick; the
// cooldown after is what actually paces the hops.
const JUMP_PULSE_MS = 90;
const JUMP_COOLDOWN_MS = 420;
// How long horizontal input has to go unrewarded (near-zero vx while
// actively trying to move) before this reads as "blocked by a wall/ledge"
// rather than just normal accel ramp-up.
const STUCK_MS_THRESHOLD = 260;
const STUCK_VX_EPS = 12;
// Climb trigger: hero meaningfully above AND roughly in reach horizontally
// — a flat "chase the X position" AI would otherwise walk face-first into
// the platform below the hero forever instead of following up onto it.
const CLIMB_Y_THRESHOLD = 40;
const CLIMB_X_RANGE = 420;

export class TutorialDummyDirector {
  private goal: DummyGoal = { mode: "idle-flinch" };
  private fireTimerMs = 0;
  private firePulseRemainingMs = 0;
  private jumpPulseRemainingMs = 0;
  private jumpCooldownMs = 0;
  private stuckMs = 0;
  private telegraphMs = 0;
  private telegraphing = false;

  setGoal(goal: DummyGoal): void {
    this.goal = goal;
    this.fireTimerMs = 0;
    this.telegraphing = false;
    this.telegraphMs = 0;
  }

  /** 0 = not winding up; 1 = about to fire. Only "telegraphed-shot" mode
   *  ever winds up — return-fire and idle-flinch always report 0, so the
   *  render layer can tell "this shot is dodgeable/blockable, react now"
   *  apart from "this one wasn't telegraphed." */
  telegraphProgress(): number {
    if (!this.telegraphing) return 0;
    const t = this.telegraphMs / TELEGRAPH_WINDUP_MS;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** Advance the dummy's internal fire-cadence clock and compute this tick's
   *  input. `dummy`/`hero` are live snapshots from TutorialDuelController. */
  computeInput(dummy: PlayerEntity, hero: PlayerEntity, dtMs: number): TutorialDuelInput {
    let keys = 0;
    const aim: Vec2 = { x: hero.x, y: hero.y };

    if (!dummy.alive || !hero.alive) {
      return { keys: 0, aimX: dummy.aimX, aimY: dummy.aimY };
    }

    const stopRange = this.goal.stopRangePx ?? 260;
    const dx = hero.x - dummy.x;
    const wantsToMove = Math.abs(dx) > stopRange;
    if (wantsToMove) {
      keys |= dx > 0 ? InputBit.Right : InputBit.Left;
    }

    // Terrain navigation — "creep" over gaps and platform-height changes
    // instead of getting stuck walking face-first into a wall or ledge the
    // hero has already climbed past. Two independent triggers: BLOCKED
    // (wanted to move, barely moved — a wall or a drop the AI won't just
    // walk off) and CLIMB (the hero is up a level and roughly in reach).
    this.jumpCooldownMs = Math.max(0, this.jumpCooldownMs - dtMs);
    const grounded = dummy.grounded ?? true;
    if (wantsToMove && grounded && Math.abs(dummy.vx) < STUCK_VX_EPS) {
      this.stuckMs += dtMs;
    } else {
      this.stuckMs = 0;
    }
    const blocked = this.stuckMs >= STUCK_MS_THRESHOLD;
    const wantsToClimb =
      grounded &&
      hero.y < dummy.y - CLIMB_Y_THRESHOLD &&
      Math.abs(dx) < CLIMB_X_RANGE;
    if (this.jumpPulseRemainingMs > 0) {
      this.jumpPulseRemainingMs -= dtMs;
      keys |= InputBit.Jump;
    } else if (this.jumpCooldownMs <= 0 && (blocked || wantsToClimb)) {
      this.jumpPulseRemainingMs = JUMP_PULSE_MS;
      this.jumpCooldownMs = JUMP_COOLDOWN_MS;
      this.stuckMs = 0;
      keys |= InputBit.Jump;
    }

    if (this.goal.mode === "telegraphed-shot") {
      // The real fix: a genuine wind-up BEFORE the shot fires (aim locks
      // onto the hero — already true every frame, see `aim` above — while
      // telegraphProgress() climbs 0→1), long enough to read and answer
      // with Shield or the Aegis dash. Firing happens on windup completion,
      // not on the interval tick itself — the interval now paces GAPS
      // between windups, not raw shots.
      const interval = this.goal.fireIntervalMs ?? 2000;
      if (this.telegraphing) {
        this.telegraphMs += dtMs;
        if (this.telegraphMs >= TELEGRAPH_WINDUP_MS) {
          this.telegraphing = false;
          this.telegraphMs = 0;
          this.fireTimerMs = 0;
          this.firePulseRemainingMs = FIRE_PULSE_MS;
          keys |= InputBit.Fire;
        }
      } else {
        this.fireTimerMs += dtMs;
        if (this.firePulseRemainingMs > 0) {
          this.firePulseRemainingMs -= dtMs;
          keys |= InputBit.Fire;
        } else if (this.fireTimerMs >= interval) {
          this.telegraphing = true;
          this.telegraphMs = 0;
        }
      }
    } else if (this.goal.mode !== "idle-flinch") {
      const interval = this.goal.fireIntervalMs ?? 2000;
      this.fireTimerMs += dtMs;
      if (this.firePulseRemainingMs > 0) {
        this.firePulseRemainingMs -= dtMs;
        keys |= InputBit.Fire;
      } else if (this.fireTimerMs >= interval) {
        this.fireTimerMs = 0;
        this.firePulseRemainingMs = FIRE_PULSE_MS;
        keys |= InputBit.Fire;
      }
    }

    return { keys, aimX: aim.x, aimY: aim.y };
  }
}
