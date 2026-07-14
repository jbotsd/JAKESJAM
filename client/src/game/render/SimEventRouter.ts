// Phase C2b of the architecture deepening plan
// (/home/jimothy/.claude/plans/enchanted-juggling-cocke.md).
//
// `SimEventRouter` owns the per-event dispatch from sim → audio +
// screen-shake + hit-stop + overlay state. Was a 120-line switch
// inline in OnlineMatchScene.handleSimEvents. Extraction lets the
// scene shrink + lets us test the routing logic in isolation
// (Phase D follow-up).
//
// Dependencies are injected via `SimEventRouterDeps` so the router
// stays scene-free at construction. The 12+ cross-cutting deps
// (audio, tweens, time, kill-streak, prevAlive, multiple overlays)
// all become explicit fields on the deps object — no more "what
// does this method touch" archaeology when reading the dispatch.

import type Phaser from "phaser";
import { announce } from "../audio/AnnouncerSystem.js";
import type { PlayerId, SimEvent } from "../../sim/types";
import type { CombatRig } from "../rendering/ProceduralPlayerRig";
import type { ParticlePool } from "../systems/ParticlePool";
import type { RenderLayer } from "./RenderLayer";

/**
 * Audio surface the router needs. Procedural synth: each cue takes optional
 * params (element / charge / intensity) so weapon + shield sounds are
 * nuanced by game state. Kept structural so unit tests can stub it.
 */
export type AudioPlayer = {
  play(
    cue:
      | "shoot"
      | "hit"
      | "explosion"
      | "pickup"
      | "card"
      | "parry"
      | "shield-break",
    params?: {
      element?: string;
      charge?: number;
      intensity?: number;
      heavy?: boolean;
      shape?: string;
      impact?: string;
      pathing?: string;
    },
  ): void;
};

/**
 * Inject-everything bag. The scene wires concrete refs at
 * construction; the router just dispatches.
 */
export type SimEventRouterDeps = {
  scene: Phaser.Scene;
  audio: AudioPlayer | null;
  localPlayerId: PlayerId;

  /** Camera-shake helper that already guards against stacking. */
  safeShake: (durationMs: number, intensity: number) => void;

  /** Float a damage number above the victim's rig. */
  spawnDamageNumber: (victimId: PlayerId | string, damage: number) => void;

  /** Render-time impact blast at the player's last-known position. */
  spawnBlastAtPlayer: (
    playerId: PlayerId | string,
    radius: number,
    damage: number,
  ) => void;

  /** P3 cinematic kill moment (flash + zoom-punch + bloom). No-op when
   *  cinematics are disabled (Canvas fallback / ?fx=off). */
  killCinematic: (victimId: PlayerId | string) => void;

  /** Resolve procedural-audio params (element/charge) for a shot by its
   *  firing player — the scene looks these up from sim state. */
  shotAudioParams?: (
    playerId: PlayerId | string,
  ) =>
    | { element?: string; charge?: number; heavy?: boolean; shape?: string; impact?: string; pathing?: string }
    | undefined;

  /** Warm-tint the platforms within blast range of `pos`. */
  spawnPlatformBlastTint: (pos: { x: number; y: number }) => void;

  /** Show the local card-draft overlay with the given offered ids. */
  showCardDraft: (cardIds: string[]) => void;

  /** Hide the local card-draft overlay (other player just picked). */
  hideCardDraft: () => void;

  // Structural (just `.get`), not a real Map<CombatRig> — TutorialScene
  // combines its hero/boss rigs AND its non-humanoid thrall rigs (two
  // differently-typed maps, see TutorialShardThrall.ts) into one lookup
  // without either map having to widen its own element type.
  playerRigs: { get(id: string): CombatRig | undefined };

  /** Pool gets `drainActive` called on round-end. */
  particlePool: ParticlePool | null;

  /** Renderer for explosion blasts (destructible-broken). */
  renderLayer: RenderLayer | null;

  /**
   * Round-end housekeeping: per-round kill streak counts + alive
   * snapshot. Cleared in `round-end` so the next round starts
   * clean.
   */
  killStreakCount: Map<string, number>;
  prevAlive: Set<string>;
};

/**
 * Stateless router (the deps hold all state). One method:
 * `dispatch(event)`. Caller iterates a per-frame buffer.
 */
export class SimEventRouter {
  private readonly deps: SimEventRouterDeps;
  constructor(deps: SimEventRouterDeps) {
    this.deps = deps;
  }

  /**
   * Dispatch one SimEvent. Audio + shake + overlay state mutate
   * via the deps.
   *
   * Mirrors the OnlineMatchScene.handleSimEvents switch one-for-one
   * so behaviour is byte-stable.
   */
  dispatch(event: SimEvent): void {
    const d = this.deps;
    const audio = d.audio;
    if (!audio) return;
    const scene = d.scene;
    switch (event.t) {
      case "shot-fired": {
        audio.play("shoot", d.shotAudioParams?.(event.playerId));
        // Throw the shot from the sim's authoritative hand (event.hand) so
        // the rig's throwing hand matches where the projectile spawned.
        // Every player's rig, not just the local one (remotes/bots throw
        // too). Previously triggerFire() was dead code.
        d.playerRigs.get(event.playerId)?.triggerFire(event.hand);
        if (event.playerId === d.localPlayerId) {
          // Tiny recoil shake on local-player fire — guard stacking.
          d.safeShake(40, 0.0015);
        }
        break;
      }
      case "hit-confirmed": {
        audio.play("hit", { intensity: Math.min(1, event.damage / 40) });
        // Hit-stop: freeze render tweens for 35–50ms on a heavy hit.
        // Per game-feel-juice/SKILL.md recipe 2 — render-only freeze, sim keeps ticking.
        const stopMs = event.damage >= 30 ? 50 : 35;
        scene.tweens.timeScale = 0;
        scene.time.delayedCall(stopMs, () => {
          scene.tweens.timeScale = 1;
        });
        if (event.victimId === d.localPlayerId) {
          d.safeShake(80, 0.008);
        }
        d.spawnDamageNumber(event.victimId, event.damage);
        d.spawnBlastAtPlayer(event.victimId, 22, event.damage);
        const victimRig = d.playerRigs.get(event.victimId);
        if (victimRig) {
          const angle = Math.random() * Math.PI * 2;
          victimRig.triggerHit(Math.cos(angle), Math.sin(angle));
        }
        break;
      }
      case "player-killed": {
        scene.tweens.timeScale = 0;
        scene.time.delayedCall(80, () => {
          scene.tweens.timeScale = 1;
        });
        d.safeShake(180, 0.012);
        d.spawnBlastAtPlayer(event.victimId, 36, 50);
        d.killCinematic(event.victimId);
        audio.play("explosion");
        audio.play("hit");
        if (event.killerId !== null) {
          // Earned reactive cosmetics (Vessel Creator §5) — the killer's
          // own palm glow + mad aura briefly overdrive. Every killer, not
          // just local, so watching a bot or a remote player score a kill
          // reads the same "vessel responds to you" moment they get.
          d.playerRigs.get(event.killerId)?.triggerKillPulse();
          if (event.killerId === d.localPlayerId) {
            d.safeShake(120, 0.006);
          }
        }
        break;
      }
      case "destructible-broken": {
        audio.play("explosion");
        d.safeShake(60, 0.0025);
        const bPos = { x: event.x, y: event.y };
        d.spawnPlatformBlastTint(bPos);
        d.renderLayer?.spawnExplosionBlast(bPos, 48, 30);
        break;
      }
      case "pickup-taken":
        audio.play("pickup");
        break;
      case "parry-deflected": {
        // The signature dash-bash moment (slide-parry reflect, timed parry, or a
        // bash clash). Was audio-only — the flash/ring/hit-stop make it READ.
        audio.play("parry");
        d.playerRigs.get(event.playerId)?.triggerParryFlash();
        // Micro hit-stop (shorter than a damage hit) — the "turn" registers
        // without interrupting the slide's flow.
        scene.tweens.timeScale = 0;
        scene.time.delayedCall(30, () => {
          scene.tweens.timeScale = 1;
        });
        if (event.playerId === d.localPlayerId) {
          d.safeShake(50, 0.004);
        }
        break;
      }
      case "shield-popped": {
        audio.play("shield-break", { intensity: 0.7 });
        d.spawnBlastAtPlayer(event.playerId, 36, 26);
        break;
      }
      case "round-end":
        audio.play("card");
        announce("round-over");
        d.particlePool?.drainActive(scene);
        d.killStreakCount.clear();
        d.prevAlive.clear();
        break;
      case "card-offered":
        if (event.playerId === d.localPlayerId) {
          d.showCardDraft(event.cardIds);
        }
        break;
      case "player-slowed":
        // Visual-only; no sound.
        break;
      case "draft-resolved":
        if (event.playerId === d.localPlayerId) {
          d.hideCardDraft();
        }
        audio.play("card");
        break;
      case "chain-hit": {
        audio.play("hit");
        if (
          event.victimId === d.localPlayerId ||
          event.chainTargetId === d.localPlayerId
        ) {
          d.safeShake(50, 0.004);
        }
        break;
      }
      case "first-blood":
        // Bright sting + Jake's announcer line (no-ops until recorded).
        audio.play("pickup");
        announce("first-blood");
        break;
      case "sudden-death-started":
        // The decider ("the money moment") — cue + voice.
        audio.play("card");
        announce("sudden-death");
        d.safeShake(150, 0.01);
        break;
      default: {
        // Exhaustiveness check.
        const _exhaustive: never = event;
        void _exhaustive;
        break;
      }
    }
  }
}
