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
import { presentationBudget } from "./presentationBudgets.js";
import { RenderTimeArbiter } from "./RenderTimeArbiter.js";
import { isAbilityKind } from "./abilityAnimation.js";

const SILENT_AUDIO: AudioPlayer = { play: () => undefined };
function evidenceEventsEnabled(): boolean {
  // Read at dispatch time. Dev HMR and in-place venue → arena handoffs can
  // outlive the module evaluation that first constructed this router; a
  // frozen top-level boolean made a valid ?evidence=1 session silently
  // record nothing even while authoritative presentation events fired.
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("evidence") === "1";
}

function emitEvidenceEvent(event: SimEvent, localPlayerId: PlayerId): void {
  if (!evidenceEventsEnabled()) return;
  const record = event as unknown as Record<string, unknown>;
  const actorId = record.attackerId ?? record.killerId ?? record.casterId ??
    record.warderId ?? record.playerId;
  const targetId = record.victimId ??
    (event.t === "syz-ward-absorbed" ? event.playerId : undefined);
  const identityValues = [
    record.playerId,
    record.attackerId,
    record.killerId,
    record.casterId,
    record.warderId,
    record.victimId,
  ].filter((value): value is string => typeof value === "string");
  const localActor = actorId === localPlayerId;
  const localTarget = targetId === localPlayerId;
  const metadata = event.t === "ability-activated"
    ? { abilityKind: event.kind }
    : event.t === "syz-ward-absorbed"
      ? { wardBroke: event.wardBroke }
      : event.t === "shot-fired"
        ? { projectileIds: event.projectileIds }
        : event.t === "hit-confirmed"
          ? { sourceProjectileId: event.sourceProjectileId }
          : {};
  window.dispatchEvent(new CustomEvent("jakesjam:presentation-event", {
    detail: {
      kind: event.t,
      atMs: performance.now(),
      atTick: event.atTick,
      localActor,
      localTarget,
      remoteOnly: identityValues.length > 0 && !localActor && !localTarget,
      ...metadata,
    },
  }));
}

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
      | "shield-break"
      | "dash",
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
  /** Shared render-clock owner. When present, hit-stop composes with slow-mo. */
  renderTime?: RenderTimeArbiter;

  /** Float a damage number above the victim's rig. */
  spawnDamageNumber: (victimId: PlayerId | string, damage: number, headshot?: boolean) => void;

  /** Float a damage number at an explicit world position — the
   *  destructible counterpart to `spawnDamageNumber` above (a destructible
   *  has no `PlayerId`/rig to look up, only its own `x`/`y`, carried on the
   *  `destructible-hit` event itself). Optional: scenes without the full
   *  juice stack (Tutorial, Replay) simply omit it, same precedent as
   *  `emissionCastFeel`. */
  spawnDamageNumberAt?: (x: number, y: number, damage: number) => void;

  /** Render-time impact blast at the player's last-known position. */
  spawnBlastAtPlayer: (
    playerId: PlayerId | string,
    radius: number,
    damage: number,
  ) => void;

  /** P3 cinematic kill moment (flash + zoom-punch + bloom). No-op when
   *  cinematics are disabled (Canvas fallback / ?fx=off). */
  killCinematic: (victimId: PlayerId | string) => void;

  /** Emission cast feel (emission-engine-goal P1/P2 UI contract): the
   *  scene draws the caster's dominant Coptic seal flashing at the vessel
   *  and punches the camera toward the cast. Optional — scenes without
   *  the full juice stack (Tutorial) simply omit it. */
  emissionCastFeel?: (
    casterId: PlayerId | string,
    x: number,
    y: number,
    element: string,
  ) => void;


  /** Resolve procedural-audio params (element/charge) for a shot by its
   *  firing player — the scene looks these up from sim state. */
  shotAudioParams?: (
    playerId: PlayerId | string,
  ) =>
    | { element?: string; charge?: number; heavy?: boolean; shape?: string; impact?: string; pathing?: string }
    | undefined;

  /** Warm-tint the platforms within blast range of `pos`. */
  spawnPlatformBlastTint: (pos: { x: number; y: number }) => void;

  /** Gold-forward absorb flash (Kindled Ward / team peel — class-overhaul-
   *  workboard.md chunk 2.7, the heaven-tank VFX pass). `isPeel` picks a
   *  distinct read: a self-Ward block flashes at the BLOCKER; a team peel
   *  flashes at the WARDER (the one whose light actually covered the hit)
   *  — position alone tells "blocked for themselves" from "saved a
   *  teammate" apart in a clip, no new asset needed. Optional — scenes
   *  without the full juice stack (Tutorial) simply omit it, same
   *  precedent as `emissionCastFeel`. */
  spawnWardAbsorbFlash?: (playerId: PlayerId | string, isPeel: boolean) => void;

  /** Cool-white Syzygist ward response. The source caster is passed separately
   * so ally wards remain attributable; `wardBroke` selects the louder shatter. */
  spawnSyzygistWardAbsorbFlash?: (
    playerId: PlayerId | string,
    casterId: PlayerId | string,
    wardBroke: boolean,
  ) => void;

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
  private readonly renderTime: RenderTimeArbiter;
  private ownsRenderTime: boolean;
  private hitStopSequence = 0;
  constructor(deps: SimEventRouterDeps) {
    this.deps = deps;
    this.renderTime = deps.renderTime ?? new RenderTimeArbiter(deps.scene);
    this.ownsRenderTime = deps.renderTime === undefined;
  }

  private holdHitStop(durationMs: number): void {
    if (!this.ownsRenderTime) {
      this.renderTime.hold("hit-stop", 0, durationMs);
      return;
    }
    // Standalone scenes without a frame-updated shared arbiter still get
    // overlap-safe holds: each callback releases only its own request.
    const source = `hit-stop:${this.hitStopSequence++}`;
    this.renderTime.hold(source, 0, durationMs);
    this.deps.scene.time.delayedCall(durationMs, () => this.renderTime.release(source));
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
    // Presentation must not disappear when WebAudio is unavailable or still
    // autoplay-gated. Only the audio channel degrades; visual/UI reactions run.
    const audio = d.audio ?? SILENT_AUDIO;
    const scene = d.scene;
    emitEvidenceEvent(event, d.localPlayerId);
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
          const budget = presentationBudget("action");
          d.safeShake(budget.shakeDurationMs * (2 / 3), budget.shakeIntensity * 0.375);
        }
        break;
      }
      case "hit-confirmed": {
        audio.play("hit", { intensity: Math.min(1, event.damage / 40) });
        // Hit-stop: freeze render tweens for 35–50ms on a heavy hit.
        // Per game-feel-juice/SKILL.md recipe 2 — render-only freeze, sim keeps ticking.
        const stopMs = presentationBudget(event.damage >= 30 ? "heavy" : "hit").hitStopMs;
        this.holdHitStop(stopMs);
        if (event.victimId === d.localPlayerId) {
          const budget = presentationBudget("hit");
          d.safeShake(budget.shakeDurationMs, budget.shakeIntensity);
        }
        d.spawnDamageNumber(event.victimId, event.damage, event.headshot);
        d.spawnBlastAtPlayer(event.victimId, 22, event.damage);
        const victimRig = d.playerRigs.get(event.victimId);
        if (victimRig) {
          const angle = Math.random() * Math.PI * 2;
          victimRig.triggerHit(Math.cos(angle), Math.sin(angle));
        }
        break;
      }
      case "player-killed": {
        const killStopMs = presentationBudget("kill").hitStopMs;
        this.holdHitStop(killStopMs);
        const killBudget = presentationBudget("kill");
        d.safeShake(killBudget.shakeDurationMs, killBudget.shakeIntensity);
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
      case "destructible-hit": {
        // The destructible counterpart to `hit-confirmed`'s damage-number
        // popup (2026-07-19, venue-lobby ability showcase) — same "hit"
        // cue at the same intensity curve, no hit-stop/camera-shake (a
        // dummy taking damage shouldn't jolt the camera the way a player
        // hit does; the number popping is the read here).
        audio.play("hit", { intensity: Math.min(1, event.damage / 40) });
        d.spawnDamageNumberAt?.(event.x, event.y, event.damage);
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
        this.holdHitStop(30);
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
      case "ready-toggled":
        // Hangout mode only — light confirmation cue; the hangout scene's
        // own totem visual carries the real feedback.
        audio.play("pickup");
        break;
      case "launch-requested":
        // Hangout mode only — no router-level feedback; the scene
        // transition itself (real match handoff) is the feedback.
        break;
      case "emission-cast":
        // The seal presses (Emission Engine P1/P2). Weight without a new
        // vocabulary — the heavy card cue CARRIES THE HAND'S ELEMENT (a
        // fire hand's cast sounds like fire; the procedural synth already
        // nuances cues by element), plus a real shake. The scene layers
        // the seal-flash + camera punch via emissionCastFeel (same split
        // as killCinematic vs the router's kill handling).
        audio.play("card", { heavy: true, element: event.element });
        d.safeShake(180, 0.012);
        d.emissionCastFeel?.(event.playerId, event.x, event.y, event.element);
        break;
      case "ability-activated": {
        // A drafted active fired (six-axes Layer 2). The router owns the
        // audio moment; the action-bar slot flash + buff chips carry the
        // sustained read (legibility law: every press has an instant cue).
        audio.play("card", { heavy: false });
        // Every catalog press moves the vessel through its authored physical
        // verb (plant, weave, guard, thrust, etc.). The event is authoritative;
        // the rig gesture is render-only and never delays the sim effect.
        if (isAbilityKind(event.kind)) {
          d.playerRigs.get(event.playerId)?.triggerAbility?.(event.kind);
        }
        if (event.playerId === d.localPlayerId) {
          d.safeShake(60, 0.004);
        }
        break;
      }
      case "resonance-triggered": {
        // Chain-unlike-abilities bonus fired (class-overhaul-workboard.md
        // chunk 0.1). Minimal audio accent on top of ability-activated's
        // own cue so a chain is at least AUDIBLE today — a bespoke world-
        // space read (nameplate chip / VFX) is Tier 4 polish
        // (class-overhaul-workboard.md 4.2), deliberately not built here.
        audio.play("card", { heavy: true });
        break;
      }
      case "emission-leech": {
        // Drain axis (six-axes-goal.md Layer 1): a shard fed its caster.
        // The crimson-thread world read lives in StatusVfxController (it
        // consumes the same event, beside its chain-arc sibling); the
        // router's share is the CASTER-side audio — a soft pickup cue for
        // the local leecher only. Victim-side hit audio already played
        // from hit-confirmed.
        if (event.casterId === d.localPlayerId) {
          audio.play("pickup");
        }
        break;
      }
      case "launch-pad-fired": {
        // Static map geometry threw a player (sim/launchPad.ts). Reuse the
        // dash whoosh — no bespoke launch SFX asset exists, and we never
        // synthesize new audio (hard rule); dash is the closest recorded
        // "body flung" read. TODO(audio): rip a dedicated launch cue.
        audio.play("dash", { intensity: 1 });
        // Kick VFX at the launched body so the impulse reads as a THROW.
        d.spawnBlastAtPlayer(event.playerId, 20, 8);
        if (event.playerId === d.localPlayerId) {
          d.safeShake(60, 0.004);
        }
        break;
      }
      case "slash-started": {
        // Ninja windup tell (2026-07-18, verb v1 — sim correctness pass,
        // minimal rendering per scope). No bespoke whoosh asset exists and
        // the hard rule is never synthesize audio (rip only) — left silent
        // rather than reusing an unrelated cue. Fast-follow: a real swing
        // SFX + rig animation once assets exist.
        break;
      }
      case "slash-hit": {
        // The landed-hit feedback (hit-stop, sound, damage number) already
        // comes from the paired `hit-confirmed` event this same tick (see
        // World.ts's NINJA MELEE section — every non-evaded slash-hit is
        // always emitted alongside one). This event exists so fast-follow
        // ninja-specific VFX (blade scrape / Read-tag flash) has a hook
        // without re-deriving "was this hit a ninja slash" from
        // hit-confirmed's generic shape.
        break;
      }
      case "wave-spawned": {
        // "The wave rides existing projectile tech" (classes-goal.md) —
        // reuse the ordinary shoot cue at reduced intensity rather than a
        // bespoke asset; the projectile itself renders via the normal
        // projectile pipeline (spawnProjectile), no special-casing needed.
        audio.play("shoot", { intensity: 0.6 });
        break;
      }
      case "dash-through": {
        // Body-cross tactile beat (character-sheets-v1.md: "energy tick
        // you can hear"). Reuse the dash whoosh at partial intensity, same
        // "closest recorded body-fling read" reasoning as launch-pad-fired.
        audio.play("dash", { intensity: 0.5 });
        break;
      }
      case "ward-absorbed": {
        // Kindled Ward absorb tell (2026-07-18, class-overhaul-workboard.md
        // chunk 2.2/2.3, VFX landed in chunk 2.7's heaven-tank pass). No
        // bespoke "shield-board catches a hit" audio asset exists and the
        // hard rule is never synthesize audio (rip only) — left silent;
        // the gold flash + a small local shake carry the read instead.
        d.spawnWardAbsorbFlash?.(event.playerId, false);
        if (event.playerId === d.localPlayerId) {
          d.safeShake(40, 0.003);
        }
        break;
      }
      case "team-peel-absorbed": {
        // Team peel tell (2026-07-18, class-overhaul-workboard.md chunk
        // 2.4, VFX landed in chunk 2.7's heaven-tank pass) — same "no
        // bespoke audio asset, never synthesize" silence as ward-absorbed
        // above. Flash lands at the WARDER (not the victim) so a clip
        // reads "that Paladin just saved their teammate" — see
        // `spawnWardAbsorbFlash`'s own doc comment.
        d.spawnWardAbsorbFlash?.(event.warderId, true);
        if (event.warderId === d.localPlayerId || event.victimId === d.localPlayerId) {
          d.safeShake(50, 0.004);
        }
        break;
      }
      case "syz-ward-absorbed": {
        d.spawnSyzygistWardAbsorbFlash?.(
          event.playerId,
          event.casterId,
          event.wardBroke,
        );
        if (
          event.playerId === d.localPlayerId ||
          event.casterId === d.localPlayerId
        ) {
          d.safeShake(event.wardBroke ? 70 : 40, event.wardBroke ? 0.006 : 0.003);
        }
        break;
      }
      default: {
        // Exhaustiveness check.
        const _exhaustive: never = event;
        void _exhaustive;
        break;
      }
    }
  }
}
