// ReplayScene — deterministic replay playback + offline clip rendering
// (RENDER_OVERHAUL_PLAN Phase 5; the visual half over the proven substrate).
//
// Two modes, selected by URL:
//   ?replay=<file|latest>            watch: re-sims in realtime and renders
//                                    with the live game's own systems.
//   ?replay=<...>&render=1           offline render: steps the sim 2 ticks
//                                    per displayed frame (60Hz sim → 30fps
//                                    video), captures each frame into the
//                                    SAME WebCodecs worker the live clip
//                                    recorder uses, uploads through
//                                    /clips/upload, and publishes progress
//                                    on window.__replayRender for the
//                                    headless harness.
//
// The renderer reuses the LIVE pieces wholesale: World.step + rosterOps
// (identical code path to the host), PlatformLayer/CosmicArenaLayer arena,
// ProceduralPlayerRig, EntityRenderCoordinator (contract-backed), the
// combat-FX contract producer, and the spectator director (the same
// auto-camera the server drives for the arena stream). No HUD — clips
// read clean, broadcast-style.

import Phaser from "phaser";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { STEP_MS, World, stepSpectatorDirector, createDirectorState, directorToPose } from "../../sim";
import { createRuntime, stepWithRuntime } from "../../sim/World";
import { resolveMap } from "../../sim/data/maps";
import { applyMidMatchJoin, applyRosterLeave } from "../../sim/rosterOps";
import type {
  InputFrame,
  MapDefinition,
  PlayerId,
  SimEvent,
  WorldState,
} from "../../sim/types";
import type { DirectorState } from "../../sim/spectatorDirector";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { BakedPlayerRig } from "../rendering/BakedPlayerRig";
import { ProceduralAudio } from "../systems/ProceduralAudio";
import { SimEventRouter } from "../render/SimEventRouter";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator";
import { PlatformLayer } from "../render/PlatformPainter";
import { CosmicArenaLayer } from "../render/CosmicArenaLayer";
import { ParticlePool } from "../systems/ParticlePool";
import {
  makeCombatFxState,
  makeDeathFxState,
  makeStormZoneModel,
  noteDeathEvents,
  produceCombatFx,
  produceDeathFx,
  produceDeathShards,
  produceSpawnFx,
  produceStormZone,
  setDeathFxTarget,
  PARRY_ARC,
  PARRY_RANGE,
  SHIELD_RADIUS,
  type CombatFxRenderModel,
  type ShardRenderModel,
  type SoulRenderModel,
  type UploadRenderModel,
} from "../render/renderContract";
import { drawDeathFx, drawDeathShards, drawSpawnUploads } from "../render/deathFxPainter";
import { drawStormZone } from "../render/stormZonePainter";
import { drawPlayerPresence } from "../render/presencePainter";
import { getQualityProfile } from "../render/qualityProfile";
import {
  drawDestructible,
  drawFirePatch,
  drawPickup,
  projectileColorByElement,
} from "./OnlineMatchScene";

import { BOT_RIG_COLOR, botLabel, isBotId } from "../ui/botIdentity";
import { characters } from "../data/characters";
import { ARENA_THEMES, PALETTE } from "../ui/palette";
import { SceneKeys } from "./SceneKeys";
import { getWasmSim } from "../../sim/wasm/runtime";
import { installHudCamera } from "../systems/HudCamera.js";
import {
  killBeatEnvelope,
  makeHighlightCamState,
  slowMoTickRange,
  stepHighlightCamera,
  type HighlightCamState,
} from "../render/highlightCamera.js";

const PLAYER_VISUAL_SCALE = 0.78;
const RENDER_FPS = 30;
const TICKS_PER_FRAME = 2; // 60Hz sim → 30fps video
// ≤9Mbps is the probe-clip gate (clip-goal CL.A/H); dark arena content
// looks identical at 7.5 vs the old 16 — the studied artifacts shipped
// 10-13Mbps for nothing.
const CLIP_BITRATE = 7_500_000;
/** The broadcast box (clip-goal CL.A): render mode pins the canvas to
 *  exactly this, independent of window/page layout — the production
 *  headless capture came out 1920×937 because the canvas inherited the
 *  page's shell chrome layout. */
const RENDER_W = 1920;
const RENDER_H = 1080;

type ReplayFile = {
  header: {
    matchId: string;
    mapId: string;
    rngSeed: number;
    totalTicks: number;
    chaosModifierIds: readonly string[];
    simBackend?: string;
    players: Array<{
      playerId: string;
      characterId: string;
      name: string;
      color: string;
      weaponId: string;
    }>;
  };
  inputs: Array<{ atTick: number; playerId: string; frame: InputFrame }>;
  rosterEvents?: Array<
    | { atTick: number; t: "join"; spawn: { playerId: string; characterId: string; name?: string; color?: string; weaponId: string } }
    | { atTick: number; t: "leave"; playerId: string }
  >;
};

export class ReplayScene extends Phaser.Scene {
  private map!: MapDefinition;
  private state!: WorldState;
  private runtime!: ReturnType<typeof createRuntime>;
  private inputsByTick = new Map<number, Array<{ playerId: string; frame: InputFrame }>>();
  private rosterByTick = new Map<number, NonNullable<ReplayFile["rosterEvents"]>>();
  private totalTicks = 0;
  private renderMode = false;
  /** &follow=<playerId|first> locks the camera on one player (rig A/B). */
  private followId: string | null = null;
  private followZoom = 2.4;
  private playbackAccumulatorMs = 0;
  private done = false;

  private director: DirectorState = createDirectorState();
  private rigs = new Map<string, ProceduralPlayerRig>();
  private entityRender: EntityRenderCoordinator | null = null;
  private combatFx: Phaser.GameObjects.Graphics | null = null;
  private readonly combatFxState = makeCombatFxState();
  private readonly combatFxModels: CombatFxRenderModel[] = [];
  private presence: Phaser.GameObjects.Graphics | null = null;
  private stormZone: Phaser.GameObjects.Graphics | null = null;
  private readonly stormZoneModel = makeStormZoneModel();
  /** Soul-return death sequences — SAME producer+painter as live play. */
  private deathFx: Phaser.GameObjects.Graphics | null = null;
  private readonly deathFxState = makeDeathFxState();
  private readonly deathFxModels: SoulRenderModel[] = [];
  private readonly deathShardModels: ShardRenderModel[] = [];
  private readonly spawnFxModels: UploadRenderModel[] = [];
  private readonly rigPose = {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    aimTarget: { x: 0, y: 0 },
    grounded: true,
    crouching: false,
    health: 100 as number | undefined,
    maxHealth: 100 as number | undefined,
    touchingWallDir: 0 as number | undefined,
    dashing: false as boolean | undefined,
  };

  // Offline render state
  private encoder: Worker | null = null;
  private frameIndex = 0;
  private capturePending = false;
  // Offline clip audio (clip-goal CL.B): the game's own audio engine driven
  // from the replay's events into an OfflineAudioContext, rendered to PCM
  // at finish and muxed as the clip's AAC track. Sync is by construction —
  // both clocks are `(tick − startTick)/60`.
  private offlineAudio: ProceduralAudio | null = null;
  private offlineAudioCtx: OfflineAudioContext | null = null;
  private audioRouter: SimEventRouter | null = null;
  private renderStartTick = 0;
  /** Kill ticks relative to the window start (&kills= from the queue). */
  private killTicks: number[] = [];
  // Highlight camera (clip-goal CL.E) — render-mode follow becomes a
  // beat-aware camera: star↔victim framing, kill punch-ins, and a 2×
  // slow-mo stretch around the final kill (1 sim tick per frame across
  // slowMo's range; frame count grows by exactly SLOWMO_EXTRA_FRAMES,
  // which the duration gate accounts for).
  private highlightCam: HighlightCamState | null = null;
  private slowMo: { start: number; end: number } | null = null;
  /** Victim hold: last engaged/killed opponent position lingers briefly
   *  so the camera doesn't snap away the instant they die. */
  private victimHold: { x: number; y: number; untilFrame: number } | null = null;
  // Clip chrome (clip-goal CL.D) — broadcast dressing owned by the clip,
  // not a spectator's HUD: ~4% letterbox, corner watermark, and a
  // lower-third (star + feat) that enters on the first kill and leaves
  // before the out-point. Render mode only; the live game never sees any
  // of this (regression firewall by construction).
  private lowerThird: Phaser.GameObjects.Container | null = null;
  private lowerThirdVisible = false;

  constructor() {
    super(SceneKeys.Replay);
  }

  async create(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("replay") ?? "latest";
    this.renderMode = params.get("render") === "1";
    if (this.renderMode) {
      // Pin the canvas to the broadcast box BEFORE any camera/layout math
      // (Scale.NONE → resize sets game size + backing store directly).
      // Everything downstream (cameras, capture) reads the final size.
      this.scale.resize(RENDER_W, RENDER_H);
    }
    this.publish({ status: "loading" });

    // DETERMINISM GATE: the TS sim's trig delegates to Math.sin/cos until
    // the wasm LUT tables install (the documented pre-wasm fallback hole).
    // A replay stepped on the fallback diverges from one stepped on the
    // LUT — caught red-handed 2026-07-10 when two renders of the SAME
    // slice framed different bot positions. Never step before the LUT.
    await getWasmSim();

    let file: ReplayFile;
    try {
      const res = await fetch(`/replays/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`replay fetch ${res.status}`);
      file = msgpackDecode(new Uint8Array(await res.arrayBuffer())) as ReplayFile;
    } catch (err) {
      this.publish({ status: "error", message: String(err) });
      return;
    }

    const { header } = file;
    this.totalTicks = header.totalTicks;
    this.map = resolveMap(header.mapId);
    const spawns = header.players.map(
      (p) =>
        ({
          playerId: p.playerId,
          characterId: p.characterId,
          name: p.name,
          color: p.color,
          weaponId: p.weaponId,
        }) as unknown as import("../../sim/types").PlayerSpawnInfo,
    );
    this.state = World.create(this.map, spawns, header.rngSeed, [
      ...header.chaosModifierIds,
    ]);
    this.runtime = createRuntime(this.map);
    for (const e of file.inputs) {
      let b = this.inputsByTick.get(e.atTick);
      if (!b) this.inputsByTick.set(e.atTick, (b = []));
      b.push(e);
    }
    for (const e of file.rosterEvents ?? []) {
      let b = this.rosterByTick.get(e.atTick);
      if (!b) this.rosterByTick.set(e.atTick, (b = []));
      b.push(e);
    }

    this.buildArena();
    const pool = new ParticlePool(this);
    this.entityRender = new EntityRenderCoordinator(
      this,
      {
        projectileColor: (element, ownerId) => projectileColorByElement(element, ownerId),
        drawDestructible: (g, obj, flashing) => drawDestructible(g, obj, flashing),
        drawFirePatch: (g, fire, nowMs) => drawFirePatch(g, fire, nowMs),
        drawPickup: (g, pickup, nowMs) => drawPickup(g, pickup, nowMs),
      },
      pool,
    );

    // Clip-range rendering: &from=<tick>&ticks=<n> renders a slice — the
    // fast-forward to `from` runs at re-sim speed (hundreds × realtime).
    const followParam = params.get("follow");
    if (followParam) {
      this.followId =
        followParam === "first"
          ? (header.players[0]?.playerId ?? null)
          : followParam;
      const z = Number(params.get("zoom"));
      if (Number.isFinite(z) && z > 0.2) this.followZoom = z;
    }
    const fromTick = Math.max(0, Number(params.get("from") ?? 0) || 0);
    const rangeTicks = Number(params.get("ticks") ?? 0) || 0;
    // Cluster kill ticks relative to `from` (clip-goal CL.C) — the queue
    // computes them from the trim window; the lower-third + probes key
    // off these (published as frame indexes in every status).
    this.killTicks = (params.get("kills") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (fromTick > 0) {
      while ((this.state.tick as number) < Math.min(fromTick, this.totalTicks)) {
        this.stepTicks(60);
      }
    }
    if (rangeTicks > 0) {
      this.totalTicks = Math.min(this.totalTicks, (this.state.tick as number) + rangeTicks);
    }

    if (this.renderMode) {
      this.renderStartTick = this.state.tick as number;
      this.slowMo = slowMoTickRange(this.killTicks, this.totalTicks - this.renderStartTick);
      // Chrome rides the house HUD-camera split (HudCamera.ts): the follow
      // camera's zoom would otherwise scale the scroll-fixed letterbox/
      // watermark/lower-third straight off the broadcast box. Replay's
      // world layers use scrollFactors 0.65–1, never 0, so the partition
      // rule captures exactly the chrome.
      installHudCamera(this);
      this.buildClipChrome(file.header.players);
      await this.startOfflineAudio();
      this.startEncoder();
    }
    this.publish({ status: this.renderMode ? "rendering" : "playing", startTick: this.state.tick as number, totalTicks: this.totalTicks });
  }

  update(_time: number, deltaMs: number): void {
    if (this.done || !this.state || !this.entityRender) return;

    if (this.renderMode) {
      // One displayed frame per rAF: step TICKS_PER_FRAME, render, capture
      // in POST_RENDER (same-task guarantee, like the live recorder).
      if (this.capturePending) return; // last frame not captured yet
      if (this.state.tick >= this.totalTicks) {
        this.finishRender();
        return;
      }
      // Slow-mo (CL.E): 1 sim tick per frame across the final-kill span —
      // 2× time dilation, +SLOWMO_EXTRA_FRAMES on the clip, offline-free.
      const relTick = (this.state.tick as number) - this.renderStartTick;
      const inSlowMo =
        this.slowMo !== null && relTick >= this.slowMo.start && relTick < this.slowMo.end;
      const events = this.stepTicks(inSlowMo ? 1 : TICKS_PER_FRAME);
      // Clip audio: schedule this frame's cues at the VIDEO clock (CL.B/E)
      // — frameIndex/fps, not sim time, so the slow-mo stretch can never
      // desync later cues.
      if (this.audioRouter && this.offlineAudio) {
        this.offlineAudio.setOfflineTime(this.frameIndex / RENDER_FPS);
        for (const e of events) this.audioRouter.dispatch(e);
      }
      this.updateClipChrome();
      this.renderState(deltaMs, events);
      this.capturePending = true;
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        this.captureFrame();
        this.capturePending = false;
      });
      return;
    }

    // Realtime playback.
    this.playbackAccumulatorMs += Math.min(deltaMs, 100);
    let events: SimEvent[] = [];
    while (this.playbackAccumulatorMs >= STEP_MS && this.state.tick < this.totalTicks) {
      this.playbackAccumulatorMs -= STEP_MS;
      events = this.stepTicks(1);
    }
    if (this.state.tick >= this.totalTicks) this.done = true;
    this.renderState(deltaMs, events);
  }

  /** Step N ticks (roster events + inputs applied like the live host).
   *  Returns ALL ticks' events — a 2-tick frame step used to return only
   *  the last tick's, silently dropping half the audio/fx cues (CL.B). */
  private stepTicks(n: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < n && this.state.tick < this.totalTicks; i++) {
      const roster = this.rosterByTick.get(this.state.tick as number);
      if (roster) {
        for (const ev of roster) {
          this.state =
            ev.t === "join"
              ? applyMidMatchJoin(
                  this.state,
                  this.map,
                  ev.spawn as unknown as import("../../sim/types").PlayerSpawnInfo,
                )
              : applyRosterLeave(this.state, ev.playerId);
        }
      }
      const inputs: Record<PlayerId, InputFrame | null> = {};
      for (const e of this.inputsByTick.get(this.state.tick as number) ?? []) {
        inputs[e.playerId as PlayerId] = e.frame;
      }
      const result = stepWithRuntime(this.state, this.runtime, inputs, STEP_MS);
      this.state = result.state;
      events.push(...result.events);
      this.director = stepSpectatorDirector(this.director, this.state, result.events, STEP_MS / 1000);
    }
    return events;
  }

  private renderState(deltaMs: number, events: SimEvent[]): void {
    const state = this.state;
    // Death sequences are event-driven (dead players are skipped by state
    // scans) — this consume makes replay-rendered clips show the same
    // soul-return rite as live play.
    noteDeathEvents(state, events, this.deathFxState);
    // Rigs (lite detail — replay is a broadcast view).
    const seen = new Set<string>();
    for (const pid in state.players) {
      const p = state.players[pid as PlayerId]!;
      seen.add(pid);
      let rig = this.rigs.get(pid);
      if (!rig) {
        const character =
          characters.find((c) => (c.id as string) === p.characterId) ?? characters[0]!;
        const rigOverride = new URLSearchParams(window.location.search).get("rig");
        const RigClass = rigOverride === "baked" ? BakedPlayerRig : ProceduralPlayerRig;
        rig = new RigClass(this, {
          color: isBotId(pid) ? BOT_RIG_COLOR : 0x8ff8ff,
          name: isBotId(pid) ? botLabel(pid) : pid.slice(-4),
          scale: PLAYER_VISUAL_SCALE * character.sizeScale,
          detail: "lite",
        });
        this.rigs.set(pid, rig);
      }
      if (!p.alive) {
        rig.setVisible(false);
        continue;
      }
      rig.setVisible(true);
      const pose = this.rigPose;
      pose.position.x = p.x;
      pose.position.y = p.y;
      pose.velocity.x = p.vx;
      pose.velocity.y = p.vy;
      pose.aimTarget.x = p.aimX;
      pose.aimTarget.y = p.aimY;
      pose.grounded = p.grounded ?? true;
      pose.crouching = p.crouching;
      pose.health = p.health;
      pose.touchingWallDir = p.touchingWallDir ?? 0;
      pose.dashing = p.dashing ?? false;
      rig.update(deltaMs, pose);
    }
    for (const [pid, rig] of this.rigs) {
      if (!seen.has(pid)) {
        rig.destroy();
        this.rigs.delete(pid);
      }
    }

    if (!this.stormZone) this.stormZone = this.add.graphics().setDepth(8);
    this.stormZone.clear();
    produceStormZone(state, this.map.size, this.stormZoneModel);
    drawStormZone(this.stormZone, this.stormZoneModel, state.tick, 2);

    if (!this.presence) this.presence = this.add.graphics().setDepth(11.5);
    this.presence.clear();
    drawPlayerPresence(this.presence, state, this.followId, 2);
    this.entityRender!.update(state, deltaMs, performance.now());
    this.drawCombatFx(state);
    this.drawDeathFxLayer(state, deltaMs);

    // Camera: highlight camera in render mode (CL.E — star↔victim
    // framing, kill punch-ins, final-kill slow-mo pairing); realtime
    // playback keeps the plain follow-cam (rig showcases) / director.
    const cam = this.cameras.main;
    if (this.renderMode && this.followId) {
      const star = state.players[this.followId as PlayerId];
      if (star) {
        // Engaged victim: nearest living opponent; a fresh corpse holds
        // the camera's attention briefly (kill framing must not snap).
        let victim: { x: number; y: number } | null = null;
        let best = Infinity;
        for (const pid in state.players) {
          if (pid === (this.followId as string)) continue;
          const p = state.players[pid as PlayerId]!;
          if (!p.alive) continue;
          const d = Math.hypot(p.x - star.x, p.y - star.y);
          if (d < best && d < 1500) {
            best = d;
            victim = { x: p.x, y: p.y };
          }
        }
        if (victim) {
          this.victimHold = { ...victim, untilFrame: this.frameIndex + 18 };
        } else if (this.victimHold && this.frameIndex < this.victimHold.untilFrame) {
          victim = { x: this.victimHold.x, y: this.victimHold.y };
        }
        const beat = killBeatEnvelope(this.frameIndex, this.killVideoFrames());
        if (!this.highlightCam) this.highlightCam = makeHighlightCamState(star.x, star.y - 20);
        this.highlightCam = stepHighlightCamera(
          this.highlightCam,
          { star: { x: star.x, y: star.y }, victim, punch: beat.punch, finalPunch: beat.finalPunch },
          RENDER_W,
          RENDER_H,
        );
        cam.setZoom(this.highlightCam.zoom);
        cam.centerOn(this.highlightCam.x, this.highlightCam.y);
      }
    } else if (this.followId) {
      const target = state.players[this.followId as PlayerId];
      if (target) {
        cam.setZoom(this.followZoom);
        cam.centerOn(target.x, target.y - 20);
      }
    } else {
      const pose = directorToPose(this.director);
      cam.setZoom(pose.z);
      cam.centerOn(pose.x, pose.y);
    }
  }

  /** Kill ticks mapped to VIDEO frames, slow-mo stretch included — the
   *  beat envelope and the probe surface both use this mapping. */
  private killVideoFrames(): number[] {
    return this.killTicks.map((t) => {
      if (!this.slowMo || t <= this.slowMo.start) return Math.floor(t / TICKS_PER_FRAME);
      const inSpan = Math.min(t, this.slowMo.end) - this.slowMo.start;
      const after = Math.max(0, t - this.slowMo.end);
      return Math.floor(this.slowMo.start / TICKS_PER_FRAME + inSpan + after / TICKS_PER_FRAME);
    });
  }

  /** Soul-return death sequences (shared painter). Offline renders always
   *  get the full fx tier — the clip is painted by the host GPU, and a
   *  headless chromium can misdetect as potato via its renderer string. */
  private drawDeathFxLayer(state: WorldState, deltaMs: number): void {
    if (!this.deathFx) {
      this.deathFx = this.add
        .graphics()
        .setDepth(13)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
    const g = this.deathFx;
    g.clear();
    const fx = this.renderMode ? 2 : getQualityProfile().fxLevel;
    const souls = produceDeathFx(state, deltaMs, this.deathFxState, this.deathFxModels);
    if (souls > 0) drawDeathFx(g, this.deathFxModels, souls, fx);
    const shards = produceDeathShards(state, deltaMs, this.deathFxState, this.deathShardModels);
    if (shards > 0) drawDeathShards(g, this.deathShardModels, shards, fx);
    const uploads = produceSpawnFx(state, deltaMs, this.deathFxState, this.spawnFxModels);
    if (uploads > 0) drawSpawnUploads(g, this.spawnFxModels, uploads, fx);
  }

  private drawCombatFx(state: WorldState): void {
    if (!this.combatFx) this.combatFx = this.add.graphics().setDepth(12);
    const g = this.combatFx;
    g.clear();
    const count = produceCombatFx(state, this.combatFxState, this.combatFxModels);
    for (let i = 0; i < count; i++) {
      const m = this.combatFxModels[i]!;
      if (m.shieldActive) {
        g.fillStyle(0x93c5fd, 0.08 + m.shieldFlash * 0.28);
        g.fillCircle(m.x, m.y, SHIELD_RADIUS);
        g.lineStyle(2 + m.shieldFlash * 3, 0x93c5fd, 0.62 + m.shieldFlash * 0.38);
        g.strokeCircle(m.x, m.y, SHIELD_RADIUS);
      }
      if (m.parryActive) {
        g.fillStyle(0xf7fbff, 0.13);
        g.slice(m.x, m.y, PARRY_RANGE, m.parryFacing - PARRY_ARC / 2, m.parryFacing + PARRY_ARC / 2, false);
        g.fillPath();
      }
    }
  }

  private buildArena(): void {
    const { x: width, y: height } = this.map.size;
    const theme = ARENA_THEMES[(this.map.arenaTheme ?? "voidVessel") as keyof typeof ARENA_THEMES] ?? Object.values(ARENA_THEMES)[0]!;
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(0x0a101c, 1);
    g.fillRect(0, 0, width, height);
    g.fillGradientStyle(0x101a30, 0x101a30, 0x0a101c, 0x0a1420, 0.9, 0.9, 1, 1);
    g.fillRect(0, 0, width, height);
    const gridGold = typeof theme.gold === "number" ? theme.gold : PALETTE.hullGold;
    g.lineStyle(1, gridGold, 0.03);
    for (let gx = 0; gx <= width; gx += 96) g.lineBetween(gx, 0, gx, height);
    for (let gy = 0; gy <= height; gy += 96) g.lineBetween(0, gy, width, gy);

    const platforms = new PlatformLayer(this);
    platforms.repaint(this.map.platforms, theme, this.map.launchPads, this.map.slopes);
    const cosmic = new CosmicArenaLayer(this);
    cosmic.spawn(width, height);
    setDeathFxTarget(this.deathFxState, width * 0.5, height * 0.5);

    this.cameras.main.setBounds(
      -width / 6,
      -height / 6,
      width + width / 3,
      height + height / 3,
    );
    this.cameras.main.setRoundPixels(false);
  }

  // ── Clip chrome (clip-goal CL.D) ────────────────────────────────────────

  /** Letterbox bar height — 4% of the broadcast box per side. */
  private static readonly LETTERBOX_H = Math.round(RENDER_H * 0.04);

  /** Broadcast dressing: letterbox + watermark built once; the lower-third
   *  is built hidden and toggled by the kill timeline in update(). */
  private buildClipChrome(players: ReplayFile["header"]["players"]): void {
    const depth = 5000; // above everything the world draws
    const g = this.add.graphics().setScrollFactor(0).setDepth(depth);
    g.fillStyle(0x000000, 1);
    g.fillRect(0, 0, RENDER_W, ReplayScene.LETTERBOX_H);
    g.fillRect(0, RENDER_H - ReplayScene.LETTERBOX_H, RENDER_W, ReplayScene.LETTERBOX_H);

    // Watermark — house instrument ink, quiet, lives inside the bottom bar
    // (≤4% screen height by construction: the bar IS 4%).
    this.add
      .text(RENDER_W - 18, RENDER_H - ReplayScene.LETTERBOX_H / 2, "JAKESJAM · play.elyad.io", {
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "17px",
        color: "#897f69",
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1);

    // Lower-third: star callsign + feat, house ink/gold. Hidden until the
    // first kill lands; removed shortly before the out-point.
    const starName =
      players.find((p) => p.playerId === this.followId)?.name ??
      (this.followId ?? "").slice(-4).toUpperCase();
    const feat =
      this.killTicks.length >= 4
        ? "MULTI KILL"
        : this.killTicks.length === 3
          ? "TRIPLE KILL"
          : this.killTicks.length === 2
            ? "DOUBLE KILL"
            : "THE KILL";
    const lt = this.add.container(36, RENDER_H - ReplayScene.LETTERBOX_H - 64).setDepth(depth + 1);
    // Children are built UNPARENTED (`add: false`): objects created via
    // this.add fire ADDED_TO_SCENE and the HudCamera partition classifies
    // them by their own scrollFactor (1 = world) — which camera-filtered
    // these texts away from the HUD cam even after reparenting into the
    // container (found via cameraFilter=2 on the children, 2026-07-17).
    const nameText = this.make
      .text({
        x: 0,
        y: 0,
        text: starName.toUpperCase(),
        style: {
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontStyle: "bold",
          fontSize: "30px",
          color: "#e8ecf4",
          stroke: "#05080f",
          strokeThickness: 5,
        },
        add: false,
      })
      .setOrigin(0, 1);
    const featText = this.make
      .text({
        x: 2,
        y: 6,
        text: feat,
        style: {
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontSize: "17px",
          color: "#aa9e7f",
          stroke: "#05080f",
          strokeThickness: 4,
        },
        add: false,
      })
      .setOrigin(0, 0);
    lt.add([nameText, featText]);
    lt.setScrollFactor(0);
    lt.setAlpha(0);
    this.lowerThird = lt;
  }

  /** Kill-timeline chrome: lower-third enters on the first kill (300ms
   *  fade via per-frame step — offline render, wall clock is meaningless),
   *  exits 0.6s before the out-point. */
  private updateClipChrome(): void {
    if (!this.lowerThird || this.killTicks.length === 0) return;
    const rel = (this.state.tick as number) - this.renderStartTick;
    const clipTicks = this.totalTicks - this.renderStartTick;
    const shouldShow = rel >= this.killTicks[0]! && rel < clipTicks - 36;
    this.lowerThirdVisible = shouldShow;
    const target = shouldShow ? 1 : 0;
    // ~300ms fade at 30fps render cadence = ~0.11/frame.
    const a = this.lowerThird.alpha;
    this.lowerThird.setAlpha(a + Math.sign(target - a) * Math.min(0.12, Math.abs(target - a)));
  }

  // ── Offline render (WebCodecs worker — same one the live recorder uses) ──

  /** Build the clip's audio pipeline (clip-goal CL.B): the game's own
   *  ProceduralAudio + SampleEngine on an OfflineAudioContext sized to the
   *  clip exactly, events routed through the same SimEventRouter mapping
   *  live play uses (visual deps stubbed — HangoutScene precedent). Any
   *  failure degrades to a silent clip, never a failed render. */
  private async startOfflineAudio(): Promise<void> {
    try {
      const clipTicks = Math.max(1, this.totalTicks - this.renderStartTick);
      const sampleRate = 48_000;
      // Video duration = frames/fps — the slow-mo stretch (CL.E) adds
      // frames, and audio schedules on the VIDEO clock, so size for it.
      const slowMoExtra = this.slowMo ? (this.slowMo.end - this.slowMo.start) / 2 : 0;
      const videoS = (clipTicks / TICKS_PER_FRAME + slowMoExtra) / RENDER_FPS;
      const ctx = new OfflineAudioContext(2, Math.ceil(videoS * sampleRate), sampleRate);
      const audio = new ProceduralAudio(ctx);
      await audio.prepareOffline();
      this.offlineAudioCtx = ctx;
      this.offlineAudio = audio;
      this.audioRouter = new SimEventRouter({
        scene: this,
        audio,
        localPlayerId: (this.followId ?? "") as PlayerId,
        safeShake: () => {},
        spawnDamageNumber: () => {},
        spawnBlastAtPlayer: () => {},
        killCinematic: () => {},
        spawnPlatformBlastTint: () => {},
        showCardDraft: () => {},
        hideCardDraft: () => {},
        playerRigs: { get: () => undefined },
        particlePool: null,
        renderLayer: null,
        killStreakCount: new Map(),
        prevAlive: new Set(),
      });
    } catch (err) {
      console.warn("[replay] offline audio unavailable — rendering silent:", err);
      this.offlineAudioCtx = null;
      this.offlineAudio = null;
      this.audioRouter = null;
    }
  }

  private startEncoder(): void {
    this.encoder = new Worker(
      new URL("../highlights/clipEncoderWorker.ts", import.meta.url),
      { type: "module" },
    );
    this.encoder.onmessage = (e: MessageEvent) => {
      const msg = e.data as { t: string; buffer?: ArrayBuffer; width?: number; height?: number; message?: string };
      if (msg.t === "file" && msg.buffer) void this.uploadRender(msg.buffer);
      if (msg.t === "error") this.publish({ status: "error", message: msg.message });
    };
    this.encoder.onerror = (e: ErrorEvent) =>
      this.publish({ status: "error", message: `worker: ${e.message}` });
    // The broadcast box, not the canvas's current size: the canvas was
    // pinned to RENDER_W×RENDER_H in create(), and declaring the box
    // explicitly means even a rogue late resize gets normalized by the
    // worker's transform instead of changing the output container.
    this.encoder.postMessage({
      t: "begin",
      width: RENDER_W,
      height: RENDER_H,
      bitrate: CLIP_BITRATE,
      // Track registration must precede Output.start(); the PCM itself
      // arrives at finish (startOfflineAudio decides whether audio exists).
      audio: this.offlineAudioCtx !== null,
    });
  }

  private captureFrame(): void {
    if (!this.encoder) return;
    try {
      const frame = new VideoFrame(this.game.canvas, {
        timestamp: Math.round((this.frameIndex / RENDER_FPS) * 1_000_000),
      });
      this.frameIndex += 1;
      this.encoder.postMessage({ t: "frame", frame }, [frame as unknown as Transferable]);
    } catch (err) {
      this.publish({ status: "error", message: String(err) });
    }
    if (this.frameIndex % 300 === 0) {
      this.publish({ status: "rendering", tick: this.state.tick as number, totalTicks: this.totalTicks });
    }
  }

  private finishRender(): void {
    if (this.done) return;
    this.done = true;
    this.publish({ status: "encoding", frames: this.frameIndex });
    void this.finalizeEncode();
  }

  /** Render the scheduled audio graph to PCM, hand it to the muxer, then
   *  finish. Audio failure ships a silent clip rather than no clip. */
  private async finalizeEncode(): Promise<void> {
    try {
      if (this.offlineAudioCtx) {
        const buf = await this.offlineAudioCtx.startRendering();
        const channels: Float32Array[] = [];
        for (let c = 0; c < buf.numberOfChannels; c++) {
          channels.push(buf.getChannelData(c));
        }
        this.encoder?.postMessage(
          { t: "audio", sampleRate: buf.sampleRate, channels },
          channels.map((ch) => ch.buffer as ArrayBuffer),
        );
      }
    } catch (err) {
      console.warn("[replay] audio render failed — shipping silent:", err);
    }
    this.encoder?.postMessage({ t: "finish" });
  }

  private async uploadRender(buffer: ArrayBuffer): Promise<void> {
    try {
      const blob = new Blob([buffer], { type: "video/mp4" });
      const form = new FormData();
      form.append("file", blob, "replay-render.mp4");
      const res = await fetch("/clips/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      this.publish({ status: "done", url, frames: this.frameIndex, bytes: blob.size });
    } catch (err) {
      this.publish({ status: "error", message: String(err) });
    }
  }

  private publish(v: Record<string, unknown>): void {
    const enriched = {
      ...v,
      // Probe surface (clip-goal CL.C.4): where the cluster's kills land,
      // as encoded-frame indexes.
      killFrames: this.killVideoFrames(),
      slowMoExtraFrames: this.renderMode && this.slowMo ? (this.slowMo.end - this.slowMo.start) / 2 : 0,
      // Chrome contract (CL.D): what the clip is dressed with.
      chrome: this.renderMode
        ? { hud: false, letterbox: true, watermark: true, lowerThird: this.lowerThirdVisible }
        : null,
    };
    (window as unknown as { __replayRender?: unknown }).__replayRender = enriched;
    console.log("[replay]", JSON.stringify(enriched));
  }
}
