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
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator";
import { PlatformLayer } from "../render/PlatformPainter";
import { CosmicArenaLayer } from "../render/CosmicArenaLayer";
import { ParticlePool } from "../systems/ParticlePool";
import {
  makeCombatFxState,
  produceCombatFx,
  PARRY_ARC,
  PARRY_RANGE,
  SHIELD_RADIUS,
  type CombatFxRenderModel,
} from "../render/renderContract";
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

const PLAYER_VISUAL_SCALE = 0.78;
const RENDER_FPS = 30;
const TICKS_PER_FRAME = 2; // 60Hz sim → 30fps video
const CLIP_BITRATE = 16_000_000;

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
  private playbackAccumulatorMs = 0;
  private done = false;

  private director: DirectorState = createDirectorState();
  private rigs = new Map<string, ProceduralPlayerRig>();
  private entityRender: EntityRenderCoordinator | null = null;
  private combatFx: Phaser.GameObjects.Graphics | null = null;
  private readonly combatFxState = makeCombatFxState();
  private readonly combatFxModels: CombatFxRenderModel[] = [];
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

  constructor() {
    super(SceneKeys.Replay);
  }

  async create(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("replay") ?? "latest";
    this.renderMode = params.get("render") === "1";
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
    const fromTick = Math.max(0, Number(params.get("from") ?? 0) || 0);
    const rangeTicks = Number(params.get("ticks") ?? 0) || 0;
    if (fromTick > 0) {
      while ((this.state.tick as number) < Math.min(fromTick, this.totalTicks)) {
        this.stepTicks(60);
      }
    }
    if (rangeTicks > 0) {
      this.totalTicks = Math.min(this.totalTicks, (this.state.tick as number) + rangeTicks);
    }

    if (this.renderMode) this.startEncoder();
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
      const events = this.stepTicks(TICKS_PER_FRAME);
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

  /** Step N ticks (roster events + inputs applied like the live host). */
  private stepTicks(n: number): SimEvent[] {
    let events: SimEvent[] = [];
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
      events = result.events;
      this.director = stepSpectatorDirector(this.director, this.state, events, STEP_MS / 1000);
    }
    return events;
  }

  private renderState(deltaMs: number, _events: SimEvent[]): void {
    const state = this.state;
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

    this.entityRender!.update(state, deltaMs, performance.now());
    this.drawCombatFx(state);

    // Spectator auto-camera (same director the arena stream uses).
    const pose = directorToPose(this.director);
    const cam = this.cameras.main;
    cam.setZoom(pose.z);
    cam.centerOn(pose.x, pose.y);
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
    platforms.repaint(this.map.platforms, theme);
    const cosmic = new CosmicArenaLayer(this);
    cosmic.spawn(width, height);

    this.cameras.main.setBounds(
      -width / 6,
      -height / 6,
      width + width / 3,
      height + height / 3,
    );
    this.cameras.main.setRoundPixels(false);
  }

  // ── Offline render (WebCodecs worker — same one the live recorder uses) ──

  private startEncoder(): void {
    this.encoder = new Worker(
      new URL("../highlights/clipEncoderWorker.ts", import.meta.url),
      { type: "module" },
    );
    this.encoder.onmessage = (e: MessageEvent) => {
      const msg = e.data as { t: string; buffer?: ArrayBuffer; width?: number; height?: number; message?: string };
      if (msg.t === "file" && msg.buffer) void this.uploadRender(msg.buffer, msg.width ?? 0, msg.height ?? 0);
      if (msg.t === "error") this.publish({ status: "error", message: msg.message });
    };
    this.encoder.onerror = (e: ErrorEvent) =>
      this.publish({ status: "error", message: `worker: ${e.message}` });
    this.encoder.postMessage({
      t: "begin",
      width: this.game.canvas.width || 1280,
      height: this.game.canvas.height || 720,
      bitrate: CLIP_BITRATE,
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
    this.encoder?.postMessage({ t: "finish" });
  }

  private async uploadRender(buffer: ArrayBuffer, w: number, h: number): Promise<void> {
    try {
      const blob = new Blob([buffer], { type: "video/mp4" });
      const form = new FormData();
      form.append("file", blob, "replay-render.mp4");
      form.append("focusTrace", JSON.stringify([{ t: 0, x: Math.round(w / 2) }]));
      form.append("srcW", String(w));
      form.append("srcH", String(h));
      const res = await fetch("/clips/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const { url, verticalUrl } = (await res.json()) as { url: string; verticalUrl?: string };
      this.publish({ status: "done", url, verticalUrl, frames: this.frameIndex, bytes: blob.size });
    } catch (err) {
      this.publish({ status: "error", message: String(err) });
    }
  }

  private publish(v: Record<string, unknown>): void {
    (window as unknown as { __replayRender?: unknown }).__replayRender = v;
    console.log("[replay]", JSON.stringify(v));
  }
}
