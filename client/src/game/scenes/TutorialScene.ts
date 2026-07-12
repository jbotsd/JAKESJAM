// The Pretennoia tutorial — a standalone, offline, music-synced cinematic
// scene. NOT an extension of MatchScene (Practice) or OnlineMatchScene — see
// docs/practice-zone-goal.md's "must never merge" rule and the plan doc for
// why this is genuinely new infrastructure. Composition:
//   - sim: TutorialDuelController (real physics + combat, no round/score)
//   - beat-sync: SongDirector reading a hand-authored cue table against
//     audio.currentTime (never a computed BPM grid — see tutorial-song.ts)
//   - camera: CinematicCameraDirector owns scripted beats; ActionCamera owns
//     interactive combat; ownership flips on "camera:handoff-*" cues
//   - rendering: EntityRenderCoordinator (projectiles/hits) + SimEventRouter
//     (combat event → audio/VFX) + two ProceduralPlayerRig instances,
//     reusing the exact composition OnlineMatchScene/ReplayScene already
//     prove for a WorldState-shaped duel
//   - narrative: TutorialDiegeticCues (ground glyphs, seal ignition, brief
//     Coptic flashes) + TutorialDummyDirector (the scripted opponent)
//
// Desktop keyboard + mouse only for this first cut — touch/mobile input is a
// known, deliberate gap (not wired to TouchControls yet), noted here rather
// than silently missing.

import Phaser from "phaser";
import { tutorialArena } from "../../sim/data/tutorial-arena.js";
import { tutorialSongCues, TUTORIAL_SONG_DURATION_SEC } from "../../sim/data/tutorial-song.js";
import { InputBit } from "../../net/protocol.js";
import type { Vec2 } from "../../sim/types.js";
import { TutorialDuelController, TUTORIAL_HERO_ID, TUTORIAL_DUMMY_ID } from "../systems/TutorialDuelController.js";
import { SongDirector, type SongCue } from "../systems/SongDirector.js";
import { CinematicCameraDirector } from "../systems/CinematicCameraDirector.js";
import { ActionCamera } from "../systems/ActionCamera.js";
import { TutorialDummyDirector } from "../systems/TutorialDummyDirector.js";
import { TutorialDiegeticCues } from "../ui/TutorialDiegeticCues.js";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator.js";
import { SimEventRouter } from "../render/SimEventRouter.js";
import { PlatformLayer } from "../render/PlatformPainter.js";
import { TutorialVesselMotif } from "../render/TutorialVesselMotif.js";
import { installTutorialVesselShader } from "../render/TutorialVesselShader.js";
import { TutorialAtmosphere } from "../render/TutorialAtmosphere.js";
import { TutorialDemiurgeSerpent } from "../render/TutorialDemiurgeSerpent.js";
import { ParticlePool } from "../systems/ParticlePool.js";
import { RenderLayer } from "../render/RenderLayer.js";
import { ProceduralAudio } from "../systems/ProceduralAudio.js";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig.js";
import { TutorialShardThrall, type ShardThrallTier } from "../render/TutorialShardThrall.js";
import { TutorialBeatQuantizer } from "../systems/TutorialBeatQuantizer.js";
import { drawGothicOrnament } from "../render/TutorialGothicOrnament.js";
import { TutorialSpiritDescent } from "../render/TutorialSpiritDescent.js";
import { ARENA_THEMES } from "../ui/palette.js";
import { getRenderScale } from "../render/renderResolution.js";
import { getAudioUrl } from "../audio/audioUrl.js";
import {
  projectileColorByElement,
  drawDestructible,
  drawFirePatch,
  drawPickup,
} from "./OnlineMatchScene.js";

const HERO_SPAWN: Vec2 = { x: 150, y: 900 };
const COMBAT_ZOOM = 1.05;

export class TutorialScene extends Phaser.Scene {
  private duel!: TutorialDuelController;
  private songDirector!: SongDirector;
  private cineCamera!: CinematicCameraDirector;
  private actionCamera!: ActionCamera;
  private dummyDirector!: TutorialDummyDirector;
  private diegeticCues!: TutorialDiegeticCues;
  private entityRender!: EntityRenderCoordinator;
  private simEventRouter!: SimEventRouter;
  private platformLayer!: PlatformLayer;
  private vesselMotif: TutorialVesselMotif | null = null;
  private vesselShader: ReturnType<typeof installTutorialVesselShader> = null;
  private atmosphere!: TutorialAtmosphere;
  private spiritDescent!: TutorialSpiritDescent;
  private serpent: TutorialDemiurgeSerpent | null = null;
  private musicCtx: AudioContext | null = null;
  private musicAnalyser: AnalyserNode | null = null;
  private musicBins: Uint8Array<ArrayBuffer> | null = null;
  private particlePool!: ParticlePool;
  private renderLayer!: RenderLayer;
  private audio!: ProceduralAudio;
  // Hero + Archon only — the full-featured humanoid rig (throw/parry/etc).
  private playerRigs = new Map<string, ProceduralPlayerRig>();
  // The Demiurge's brood — a DIFFERENT render class on purpose (see
  // TutorialShardThrall.ts): non-humanoid, so wave minions can't be
  // mistaken for palette-swapped players. Kept in its own map because its
  // update() pose shape is deliberately smaller than ProceduralPlayerPose.
  private thrallRigs = new Map<string, TutorialShardThrall>();
  private minionTiers = new Map<string, ShardThrallTier>();
  // Cascading threat: "kill one, two more arrive" — the realm escalating
  // faster than the player can clear it, on purpose, up to a hard cap
  // (never truly infinite — a capped snowball still resolves). Per-minion
  // so only shards actually spawned with a cascade rule (the finale waves)
  // ever chain; ordinary waves are unaffected.
  private minionCascade = new Map<
    string,
    { spawnOnDeath: number; maxGenerations: number; tier: ShardThrallTier; cards: string[]; fireIntervalMs: number; generation: number }
  >();
  // "TTK should feel locked to the music" — the sim's real health stays
  // instant/authoritative; this is the RENDER-FACING reveal, held back to
  // the next real onset (see TutorialBeatQuantizer). Hero excluded on
  // purpose: quantizing the PLAYER's own damage feedback would just read
  // as input lag, not rhythm.
  private readonly beatQuantizer = new TutorialBeatQuantizer();
  private displayedHealth = new Map<string, number>();
  private pendingHealthReveal = new Map<string, { value: number; revealAt: number }>();
  // Estaphaios is the "big battler" — a prominent boss bar, not just a
  // body-crack effect, so its beat-locked drops actually read. Also owns
  // the name label since the boss no longer has an in-world nameplate
  // (that was a ProceduralPlayerRig-only feature — see the thrallRigs move).
  private bossHealthBar: Phaser.GameObjects.Graphics | null = null;
  private bossNameLabel: Phaser.GameObjects.Text | null = null;
  // Real max health, not a hardcoded 100 — the climax fight sets this much
  // higher via dummy:spawn's `health` field (see respawnDummy). Read here
  // so the health bar / cohesion fraction reflect the ACTUAL pool instead
  // of misreporting a near-full boss as almost dead.
  private bossMaxHealth = 100;
  private songAudio!: HTMLAudioElement;
  private cameraOwner: "director" | "action" = "director";
  private keys!: {
    a: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    shift: Phaser.Input.Keyboard.Key;
    c: Phaser.Input.Keyboard.Key;
  };
  private killStreakCount = new Map<string, number>();
  private prevAlive = new Set<string>();
  private skipEl: HTMLButtonElement | null = null;
  private finished = false;
  /** Wave-spawned "archon shard" minions: per-minion scripted AI. Rigs for
   *  these are created lazily in updateRigs (OnlineMatchScene's pattern for
   *  late joiners) and destroyed on prune. */
  private minionDirectors = new Map<string, TutorialDummyDirector>();
  private minionCounter = 0;

  constructor() {
    super("TutorialScene");
  }

  create(): void {
    this.finished = false;
    this.cameraOwner = "director";

    // Dummy's REAL initial position doesn't matter — it's fully repositioned
    // and healed by the "dummy:spawn" cue (duel.respawnDummy) the moment it
    // actually enters the story at 32.2s. Spawning it far outside the arena
    // (not literally on top of the hero) is critical though: the two rigs
    // were previously stacking exactly at HERO_SPAWN from frame one, so
    // "The Vessel"'s nameplate silently occluded the player's own rig for
    // the entire Silence/First Word intro — nothing to see, nothing to
    // read as "you," before the dummy ever should have existed at all.
    const DUMMY_HOLDING_SPAWN = { x: HERO_SPAWN.x - 4000, y: HERO_SPAWN.y };
    this.duel = new TutorialDuelController(tutorialArena, HERO_SPAWN, DUMMY_HOLDING_SPAWN);
    this.songDirector = new SongDirector(tutorialSongCues);
    this.dummyDirector = new TutorialDummyDirector();
    this.diegeticCues = new TutorialDiegeticCues(this);
    // Solo scene, no shared-combat particle budget to conserve — the vessel
    // breathes continuously behind every beat of the song.
    this.diegeticCues.startAmbient(tutorialArena.size.x, tutorialArena.size.y);

    const cam = this.cameras.main;
    cam.setBackgroundColor(ARENA_THEMES.voidVessel.bg);
    cam.setBounds(-200, -200, tutorialArena.size.x + 400, tutorialArena.size.y + 400);
    this.actionCamera = new ActionCamera(cam);
    this.actionCamera.setBaseZoom(COMBAT_ZOOM * getRenderScale());
    this.cineCamera = new CinematicCameraDirector(cam);

    this.platformLayer = new PlatformLayer(this);
    this.platformLayer.repaint(tutorialArena.platforms, ARENA_THEMES.voidVessel);
    // Terrain edge-light: a hot gold hairline along every standable top
    // edge. The backdrop is a blazing light-show, and against it the
    // voidVessel theme's dark slabs read as holes — figure-ground
    // inversion ("no idea what's terrain"). One static Graphics pass
    // makes every surface you can stand on declare itself.
    {
      const edges = this.add.graphics();
      edges.setDepth(10);
      for (const p of tutorialArena.platforms) {
        if (p.kind === "wall") continue;
        const x0 = p.position.x - p.size.x / 2;
        const y0 = p.position.y - p.size.y / 2;
        edges.lineStyle(3, 0x8a7033, 0.9);
        edges.lineBetween(x0, y0 + 1, x0 + p.size.x, y0 + 1);
        edges.lineStyle(1, 0xffedb0, 0.95);
        edges.lineBetween(x0, y0, x0 + p.size.x, y0);
        // Tall/narrow platforms (cover pylons, the chimney columns) only
        // ever showed a thin top sliver — from a distance or at an angle
        // that's nearly invisible, so the shape read as unclear against
        // the busy backdrop. A faint vertical accent down BOTH long edges
        // makes the whole silhouette legible as a solid column, not just
        // its topmost pixel row.
        if (p.size.y > p.size.x * 2.2) {
          edges.lineStyle(2, 0x8a7033, 0.55);
          edges.lineBetween(x0 + 1, y0, x0 + 1, y0 + p.size.y);
          edges.lineBetween(x0 + p.size.x - 1, y0, x0 + p.size.x - 1, y0 + p.size.y);
        }
      }
    }
    // Gothic-crystalline architecture pass: pointed-arch niches, tracery
    // fans, and thorn finials — see TutorialGothicOrnament.ts for why this
    // is its own additive layer rather than a PlatformPainter rewrite
    // (that file is shared game-wide).
    drawGothicOrnament(this, tutorialArena.platforms);
    // ONE cosmic seal, not two: the GLSL shader (world-anchored with deep
    // parallax — a landmark you travel past, see TutorialVesselShader's
    // placement note) is the vessel's heart. The Graphics-based motif
    // exists ONLY as the Canvas-renderer fallback — running both at once
    // drew two overlapping ring systems at different centers, which was
    // most of the "what the flip is this meant to be" incoherence.
    this.vesselShader = installTutorialVesselShader(this);
    // The finishing pass — vignette, drawn by the CAMERA's own native
    // filter pipeline, NOT a Shader GameObject. The old TutorialPostFX
    // quad was the "pale quadrant" bug: bisected live (nofx/noseal kill
    // switches, headless captures), its MULTIPLY quad only ever composited
    // over ¾ of the frame, leaving the bottom-right quadrant un-graded —
    // a hard-edged brighter box from screen-center to the corner, camera-
    // fixed, in every report. Phaser 4's camera filter is true full-frame
    // post-processing: there is no quad geometry to misalign, at any
    // zoom/scroll/resize, ever.
    // Tuned against live captures: 0.58/0.42 crushed the whole frame into
    // murk — the filter's strength ramps far harder than the old shader's
    // gentle smoothstep did. Wide radius + light touch = a frame, not a fog.
    cam.filters.internal.addVignette(0.5, 0.5, 0.72, 0.18, 0x10141f);
    this.vesselMotif = this.vesselShader
      ? null
      : new TutorialVesselMotif(this, tutorialArena.size.x / 2, tutorialArena.size.y / 2);

    this.particlePool = new ParticlePool(this);
    this.renderLayer = new RenderLayer(this, this.particlePool);
    this.audio = new ProceduralAudio();
    this.atmosphere = new TutorialAtmosphere(this, tutorialArena.size.x, tutorialArena.size.y);

    this.playerRigs.set(
      TUTORIAL_HERO_ID as string,
      new ProceduralPlayerRig(this, { color: 0xe8e4d6, accentColor: 0xffedb0, name: "You", detail: "full" }),
    );
    // Opening beat: the player arrives AS the spirit that becomes the
    // vessel, not already standing there — see TutorialSpiritDescent.ts.
    // The real hero rig stays hidden (updateRigs gates it on
    // hasMaterialized()) until the light actually resolves into it.
    this.spiritDescent = new TutorialSpiritDescent(this, HERO_SPAWN.x, HERO_SPAWN.y);
    // Estaphaios is NOT a humanoid rig — "archons can't be ninjas too."
    // It's the top of the same thorn-cluster race as the wave minions (see
    // TutorialShardThrall's "estaphaios" tier), just pre-registered here
    // instead of lazily spawned so it exists from frame one. Named after
    // one of the lesser rulers subordinate to Yeldabaoth in the source
    // text this project already draws Coptic terms from — deliberately
    // NOT "Archon" (a generic title that explains itself; the game's own
    // house rule is to never explain the sigil).
    this.minionTiers.set(TUTORIAL_DUMMY_ID as string, "estaphaios");
    this.thrallRigs.set(TUTORIAL_DUMMY_ID as string, new TutorialShardThrall(this, "estaphaios"));

    this.entityRender = new EntityRenderCoordinator(
      this,
      {
        projectileColor: (element, ownerId) => projectileColorByElement(element, ownerId),
        drawDestructible: (g, obj, flashing) => drawDestructible(g, obj, flashing),
        drawFirePatch: (g, fire, nowMs) => drawFirePatch(g, fire, nowMs),
        drawPickup: (g, pickup, nowMs) => drawPickup(g, pickup, nowMs),
      },
      this.particlePool,
    );
    this.simEventRouter = new SimEventRouter({
      scene: this,
      audio: this.audio,
      localPlayerId: TUTORIAL_HERO_ID,
      safeShake: (ms, intensity) => cam.shake(ms, intensity),
      spawnDamageNumber: () => {},
      spawnBlastAtPlayer: () => {},
      killCinematic: () => {},
      spawnPlatformBlastTint: () => {},
      showCardDraft: () => {},
      hideCardDraft: () => {},
      // Hero/Archon and thrall rigs live in two differently-typed maps
      // (see the thrallRigs field docblock) — combine them into one lookup
      // for the router without widening either map's own element type.
      playerRigs: {
        get: (id: string) => this.playerRigs.get(id) ?? this.thrallRigs.get(id),
      },
      particlePool: this.particlePool,
      renderLayer: this.renderLayer,
      killStreakCount: this.killStreakCount,
      prevAlive: this.prevAlive,
    });

    this.bindKeys();
    this.buildSkipButton();
    this.bossHealthBar = this.add.graphics().setScrollFactor(0).setDepth(900);
    // Latin transliteration only — unlike the cue table's short common
    // Coptic words (already verified against the source text), I'm not
    // confident enough in Coptic orthography for this specific proper name
    // to render it as script without risking an invented-looking spelling.
    // Space Mono to match the reskinned nameplate/Skip button — same house
    // font, not a third disconnected UI voice.
    this.bossNameLabel = this.add
      .text(0, 0, "ESTAPHAIOS", {
        fontFamily: '"Space Mono", monospace',
        fontSize: "13px",
        fontStyle: "700",
        color: "#ffd0c0",
        letterSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(900)
      .setOrigin(0.5, 1)
      .setAlpha(0.9)
      .setShadow(0, 0, "#ffd0c0", 8, false, true)
      .setVisible(false);

    this.songAudio = new Audio(getAudioUrl("tutorial-theme.mp3"));
    this.songAudio.volume = 1;
    void this.songAudio.play().catch(() => {
      // Autoplay blocked (shouldn't happen — the menu click IS the
      // gesture) — the skip button still works, and a stray click
      // anywhere resumes it via the browser's own retry-on-gesture.
    });
    // Dev/verify seek: ?t=<seconds> jumps straight there on load — e.g.
    // jakesjam.elyad.io/?t=238 lands right at the outro's burst-out
    // instead of needing to sit through the full 4:06 to check one beat.
    // SongDirector reads currentTime fresh every frame (never accumulates),
    // so cues from before the seek point are simply skipped, not replayed —
    // exactly the behavior a scrub needs.
    const seekParam = new URLSearchParams(window.location.search).get("t");
    if (seekParam) {
      const seekSec = Number(seekParam);
      if (Number.isFinite(seekSec) && seekSec > 0) {
        this.songAudio.currentTime = Math.min(seekSec, TUTORIAL_SONG_DURATION_SEC - 0.2);
      }
    }
    // Live analyser off the scene's OWN audio element — same pattern the
    // boot-ident uses (client/src/main.ts's runIdent()), independent of the
    // shared worldMusic/SonicField graph so it can't fight the menu's own
    // music context. Feeds the vessel motif's fast per-beat pulse; the
    // slow structural "openness" arc is driven separately by zone cues.
    try {
      this.musicCtx = new AudioContext();
      const src = this.musicCtx.createMediaElementSource(this.songAudio);
      src.connect(this.musicCtx.destination);
      const an = this.musicCtx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      this.musicAnalyser = an;
      this.musicBins = new Uint8Array(an.frequencyBinCount);
    } catch {
      // Reactivity is garnish — the motif still runs on structural
      // openness + its own idle breathing if this fails.
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    this.keys = {
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      c: kb.addKey(Phaser.Input.Keyboard.KeyCodes.C),
    };
  }

  private buildSkipButton(): void {
    // Instrument-panel treatment matching the hull-chrome language
    // established everywhere else (PlatformPainter's gold corner
    // brackets/conduit ticks) — sharp edges instead of a rounded default
    // web button, a gold glow instead of a flat translucent fill, and
    // real corner-bracket accents via a layered box-shadow trick (no
    // pseudo-elements needed on an inline-styled element).
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "SKIP ▶";
    Object.assign(btn.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      zIndex: "50",
      padding: "9px 18px",
      background: "linear-gradient(180deg, rgba(20,16,8,0.82), rgba(8,6,3,0.88))",
      color: "#ffd76b",
      border: "1px solid rgba(255,215,107,0.55)",
      borderRadius: "2px",
      font: '12px "Space Mono", monospace',
      letterSpacing: "0.14em",
      cursor: "pointer",
      boxShadow: "0 0 14px rgba(255,215,107,0.18), inset 0 0 10px rgba(255,215,107,0.06)",
      transition: "box-shadow 140ms ease, border-color 140ms ease",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.boxShadow = "0 0 20px rgba(255,215,107,0.35), inset 0 0 14px rgba(255,215,107,0.12)";
      btn.style.borderColor = "rgba(255,215,107,0.9)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.boxShadow = "0 0 14px rgba(255,215,107,0.18), inset 0 0 10px rgba(255,215,107,0.06)";
      btn.style.borderColor = "rgba(255,215,107,0.55)";
    });
    btn.addEventListener("click", () => this.finish());
    document.body.appendChild(btn);
    this.skipEl = btn;
  }

  private readHeroInput(): { keys: number; aimX: number; aimY: number } {
    let keys = 0;
    if (this.keys.a.isDown) keys |= InputBit.Left;
    if (this.keys.d.isDown) keys |= InputBit.Right;
    if (this.keys.w.isDown || this.keys.space.isDown) keys |= InputBit.Jump;
    if (this.keys.s.isDown) keys |= InputBit.Down | InputBit.Crouch;
    if (this.keys.shift.isDown) keys |= InputBit.Shield;
    const pointer = this.input.activePointer;
    if (pointer.leftButtonDown()) keys |= InputBit.Fire;
    if (pointer.rightButtonDown() || this.keys.c.isDown) keys |= InputBit.Dash;

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { keys, aimX: world.x, aimY: world.y };
  }

  /** [bass, lead, scream] 0-1, same band-split convention as the boot-ident
   *  (client/src/main.ts's pump()) — sub/kick, ~1.2-4kHz presence, and the
   *  ~4-9.4kHz searing register. Returns zeros if the analyser never came up. */
  private readMusicBands(): [number, number, number] {
    if (!this.musicAnalyser || !this.musicBins) return [0, 0, 0];
    this.musicAnalyser.getByteFrequencyData(this.musicBins);
    let bass = 0, lead = 0, scream = 0;
    for (let i = 1; i < 7; i++) bass += this.musicBins[i]!;
    for (let i = 26; i < 86; i++) lead += this.musicBins[i]!;
    for (let i = 86; i < 200; i++) scream += this.musicBins[i]!;
    const pb = Math.min(1, bass / (6 * 255));
    const pl = Math.min(1, lead / (60 * 175));
    const psRaw = Math.min(1, scream / (114 * 130));
    return [pb, pl, psRaw * psRaw];
  }

  update(_time: number, deltaMs: number): void {
    if (this.finished) return;
    const nowMs = this.songAudio.currentTime * 1000;
    this.spiritDescent.update(this.songAudio.currentTime, this.cameras.main);
    const cues = this.songDirector.update(this.songAudio.currentTime);
    for (const cue of cues) this.handleCue(cue);

    const hero = this.duel.hero();
    // No control until the body exists: during the spirit-descent opening
    // the hero entity is a mote of light mid-assembly — input arriving the
    // same instant the rig materializes IS the "you may move" cue.
    const inputs: Record<string, { keys: number; aimX: number; aimY: number }> = {
      [TUTORIAL_HERO_ID as string]: this.spiritDescent.hasMaterialized()
        ? this.readHeroInput()
        : { keys: 0, aimX: hero.aimX, aimY: hero.aimY },
      [TUTORIAL_DUMMY_ID as string]: this.dummyDirector.computeInput(this.duel.dummy(), hero, deltaMs),
    };
    for (const [id, director] of this.minionDirectors) {
      const minion = this.duel.entity(id);
      if (!minion) continue;
      inputs[id] = director.computeInput(minion, hero, deltaMs);
    }
    const physicsStepMs = Math.min(deltaMs, 1000 / 30);
    const events = this.duel.step(inputs, physicsStepMs);
    for (const event of events) {
      this.simEventRouter.dispatch(event);
      this.handleCombatEvent(event);
    }

    const state = this.duel.snapshot();
    this.entityRender.update(state, deltaMs, nowMs);
    this.tickHealthQuantizer(state.players, this.songAudio.currentTime);
    this.atmosphere.beginShadowFrame();
    this.updateRigs(state.players, deltaMs);
    this.drawContactShadows(state.players);
    this.atmosphere.update(deltaMs, this.cameras.main);
    this.drawBossHealthBar(state.players);
    const [bandBass, bandLead, bandScream] = this.readMusicBands();
    this.vesselMotif?.update(deltaMs, bandBass, bandLead, bandScream);
    this.vesselShader?.update({ bass: bandBass, lead: bandLead, scream: bandScream });
    this.serpent?.update(deltaMs, bandBass, bandScream);

    if (this.cameraOwner === "action") {
      const h = this.duel.hero();
      // Frame the nearest living threats along with the hero — same "extra
      // subjects" trick OnlineMatchScene feeds ActionCamera so a wave fight
      // reads as one composed shot, not a hero closeup with off-screen
      // bullets arriving from nowhere. Wider radius and one more slot than
      // OnlineMatchScene's own 1100/2 — enemies here can now JUMP terrain
      // (TutorialDummyDirector's climb logic), so a threat a platform or
      // two above/below the hero must stay in frame instead of quietly
      // falling out of the tracked set the moment it climbs.
      const extra = this.duel
        .enemyIds()
        .map((id) => this.duel.entity(id)!)
        .map((e) => ({ e, d: Math.hypot(e.x - h.x, e.y - h.y) }))
        .filter(({ d }) => d < 1500)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map(({ e }) => ({ x: e.x, y: e.y }));
      this.actionCamera.update(deltaMs, {
        x: h.x,
        y: h.y,
        vx: h.vx,
        vy: h.vy,
        aimX: h.aimX,
        aimY: h.aimY,
        extra,
      });
    }

    if (this.songAudio.ended || this.songAudio.currentTime >= TUTORIAL_SONG_DURATION_SEC - 0.05) {
      this.finish();
    }
  }

  /** Narrative consequences of combat, on top of SimEventRouter's generic
   *  audio/VFX: shards dissolve back into light when broken; the hero's
   *  death is a stumble (respawn at the current zone's anchor), never a
   *  fail state — this is a scripted rite, not a roguelike. */
  private handleCombatEvent(event: { t: string } & Record<string, unknown>): void {
    if (event.t !== "player-killed") return;
    const victimId = String(event.victimId);
    if (victimId === (TUTORIAL_HERO_ID as string)) {
      this.cineCamera.flash(300, [216, 255, 246]);
      this.cineCamera.shake(280, 0.008);
      const anchor = this.currentZoneAnchor();
      this.diegeticCues.dummyDissolve(this.duel.hero().x, this.duel.hero().y);
      this.time.delayedCall(650, () => {
        if (this.finished) return;
        this.duel.respawnHero(anchor);
      });
      return;
    }
    const victim = this.duel.entity(victimId);
    if (victim) this.diegeticCues.dummyDissolve(victim.x, victim.y);
    if (victimId !== (TUTORIAL_DUMMY_ID as string)) {
      // Cascade: this kill spawns MORE, escalating — fires immediately
      // (not after the prune delay) so the threat is visibly compounding
      // the instant a kill lands, not on a delay that reads as unrelated.
      const cascade = this.minionCascade.get(victimId);
      if (cascade && cascade.generation < cascade.maxGenerations && victim) {
        const nextGen = cascade.generation + 1;
        // Fire cadence tightens each generation — the escalation should be
        // FELT getting worse, not just numerically bigger.
        const nextInterval = Math.max(500, cascade.fireIntervalMs * Math.pow(0.8, nextGen));
        for (let i = 0; i < cascade.spawnOnDeath; i++) {
          const childId = `archon-shard-${this.minionCounter++}`;
          const jitter = (i - (cascade.spawnOnDeath - 1) / 2) * 140;
          const cx = victim.x + jitter;
          this.minionTiers.set(childId, cascade.tier);
          this.duel.addMinion(
            childId,
            { x: cx, y: victim.y },
            { health: cascade.tier === "facet" ? 55 : 24, cards: cascade.cards },
          );
          const director = new TutorialDummyDirector();
          director.setGoal({ mode: "return-fire", fireIntervalMs: nextInterval, stopRangePx: 280 });
          this.minionDirectors.set(childId, director);
          this.diegeticCues.dummyDissolve(cx, victim.y, true);
          this.minionCascade.set(childId, { ...cascade, generation: nextGen });
        }
      }
      // Prune the shard after its rig has had a beat to hide + the
      // dissolve has played — keeps state.players from accumulating
      // corpses across five waves.
      this.time.delayedCall(1200, () => {
        this.minionDirectors.delete(victimId);
        const rig = this.thrallRigs.get(victimId);
        if (rig) {
          rig.destroy();
          this.thrallRigs.delete(victimId);
        }
        this.minionTiers.delete(victimId);
        this.displayedHealth.delete(victimId);
        this.pendingHealthReveal.delete(victimId);
        this.minionCascade.delete(victimId);
        this.duel.removeEntity(victimId);
      });
    }
  }

  /** Where the spark re-forms if the vessel is broken — the current zone's
   *  entry point, judged by song time (the authoritative clock everywhere
   *  else in this scene too). */
  private currentZoneAnchor(): { x: number; y: number } {
    const t = this.songAudio.currentTime;
    if (t < 32.5) return { x: 150, y: 900 };
    if (t < 96) return { x: 1400, y: 900 };
    if (t < 139) return { x: 3450, y: 900 };
    if (t < 186) return { x: 4700, y: 900 };
    return { x: 6150, y: 900 };
  }

  /** Advance the beat-locked health reveal for every non-hero entity. The
   *  sim's `p.health` is already the true, instant, authoritative value —
   *  this only decides when that drop becomes VISIBLE. */
  private tickHealthQuantizer(
    players: Record<string, { health: number; alive: boolean }>,
    songTimeSec: number,
  ): void {
    for (const [pid, p] of Object.entries(players)) {
      if (pid === (TUTORIAL_HERO_ID as string)) continue;
      const trueH = p.health;
      const disp = this.displayedHealth.get(pid) ?? trueH;
      const pending = this.pendingHealthReveal.get(pid);
      if (trueH < disp) {
        if (!pending) {
          this.pendingHealthReveal.set(pid, { value: trueH, revealAt: this.beatQuantizer.resolveAt(songTimeSec) });
        } else if (trueH < pending.value) {
          // More damage landed before the previous reveal fired — carry
          // the newest (lower) value but keep the ORIGINAL revealAt, so
          // rapid-fire hits can't keep pushing the reveal further out.
          pending.value = trueH;
        }
      }
      const p2 = this.pendingHealthReveal.get(pid);
      if (p2 && songTimeSec >= p2.revealAt) {
        this.displayedHealth.set(pid, p2.value);
        this.pendingHealthReveal.delete(pid);
      } else if (!this.displayedHealth.has(pid)) {
        this.displayedHealth.set(pid, trueH);
      }
      if (!p.alive) {
        // Death itself is never held back — the dissolve VFX already
        // fires immediately elsewhere; the bar should agree with it.
        this.displayedHealth.set(pid, 0);
        this.pendingHealthReveal.delete(pid);
      }
    }
  }

  /** Estaphaios's health bar — big, screen-space, quantized to the same
   *  beat-locked reveal as the thralls' body-crack cohesion, so a hit
   *  reads as landing WITH the music instead of whenever it happened to
   *  connect. Hidden until Estaphaios actually exists in this zone. */
  private drawBossHealthBar(players: Record<string, { health: number; alive: boolean }>): void {
    const bar = this.bossHealthBar;
    if (!bar) return;
    bar.clear();
    const boss = players[TUTORIAL_DUMMY_ID as string];
    if (!boss || !boss.alive) {
      this.bossNameLabel?.setVisible(false);
      return;
    }
    const shown = this.displayedHealth.get(TUTORIAL_DUMMY_ID as string) ?? boss.health;
    const frac = Phaser.Math.Clamp(shown / this.bossMaxHealth, 0, 1);
    const cam = this.cameras.main;
    // Same zoom-drift bug as TutorialPostFX's quad, same fix: scrollFactor(0)
    // cancels panning but NOT the camera's zoom transform, so a scrollFactor(0)
    // Graphics object drawn in raw screen-pixel coordinates drifts/shrinks the
    // instant the combat camera zooms. Countering the object's own scale by
    // 1/zoom cancels it exactly (object stays anchored at world-origin, so its
    // absolute-pixel draw commands render at their true intended screen size).
    const zoom = cam.zoom || 1;
    bar.setScale(1 / zoom);
    const w = Math.min(560, cam.width * 0.5);
    const x = cam.width / 2 - w / 2;
    const y = 28;
    const h = 14;
    bar.fillStyle(0x1a1024, 0.75);
    bar.fillRect(x - 3, y - 3, w + 6, h + 6);
    bar.fillStyle(0x3a2a52, 0.9);
    bar.fillRect(x, y, w, h);
    bar.fillStyle(0xd08a5a, 0.95);
    bar.fillRect(x, y, w * frac, h);
    bar.lineStyle(2, 0xffd0c0, 0.9);
    bar.strokeRect(x, y, w, h);
    // Text objects need BOTH corrections: scale (font size drifts with
    // zoom same as the bar) AND position (setPosition targets are world
    // coords, so they get re-multiplied by zoom on render — dividing by
    // zoom up front cancels that out, same logic as TutorialPostFX's fit()).
    this.bossNameLabel
      ?.setScale(1 / zoom)
      .setPosition(cam.width / (2 * zoom), (y - 6) / zoom)
      .setVisible(true);
  }

  /** Soft ellipse under every grounded, living entity — the single
   *  fastest way a silhouette reads as standing IN the scene instead of
   *  pasted over a flat backdrop (audit item: "zero contact shadows
   *  anywhere"). Skipped while airborne — a shadow floating mid-jump
   *  reads as a bug, not weight. */
  private drawContactShadows(
    players: Record<string, { x: number; y: number; grounded?: boolean; alive: boolean }>,
  ): void {
    for (const [pid, p] of Object.entries(players)) {
      if (!p.alive || p.grounded === false) continue;
      // Hero excluded: ProceduralPlayerRig already draws its OWN contact
      // shadow (draw()'s "0a. Contact shadow" step, pose-integrated —
      // predates this atmosphere layer, I just hadn't found it yet). This
      // atmosphere shadow was stacking a second one under the hero only
      // (thralls/boss have no native shadow, so no duplication there) —
      // likely also the actual source of the earlier "ambiguous ring at
      // the player's feet" critique: the native shadow's low alpha read as
      // unclear against a busy background, then got a second layer on top.
      if (pid === (TUTORIAL_HERO_ID as string)) continue;
      const isBoss = pid === (TUTORIAL_DUMMY_ID as string);
      const isThrall = this.thrallRigs.has(pid);
      const halfWidth = isBoss ? 70 : isThrall ? 26 : 20;
      const alpha = isBoss ? 0.5 : 0.38;
      this.atmosphere.drawContactShadow(p.x, p.y, halfWidth, alpha);
    }
  }

  private updateRigs(players: Record<string, { x: number; y: number; vx: number; vy: number; aimX: number; aimY: number; grounded?: boolean; crouching: boolean; health: number; alive: boolean; touchingWallDir?: number; dashing?: boolean }>, deltaMs: number): void {
    for (const pid of Object.keys(players)) {
      // Hero + Archon are pre-registered in create(); anything new here is
      // a wave minion — a non-humanoid thrall (see thrallRigs docblock),
      // never a recolored player rig.
      if (this.playerRigs.has(pid) || this.thrallRigs.has(pid)) continue;
      this.thrallRigs.set(pid, new TutorialShardThrall(this, this.minionTiers.get(pid) ?? "splinter"));
    }
    for (const [pid, rig] of this.playerRigs) {
      const p = players[pid];
      if (!p) continue;
      // The hero rig stays hidden until the opening spirit-descent has
      // actually resolved into it — see TutorialSpiritDescent.ts. Any
      // OTHER alive entry in playerRigs (there is only ever the hero)
      // still follows the normal alive/dead visibility below.
      const isHero = pid === (TUTORIAL_HERO_ID as string);
      if (!p.alive || (isHero && !this.spiritDescent.hasMaterialized())) {
        rig.setVisible(false);
        continue;
      }
      rig.setVisible(true);
      // Only the hero lives in playerRigs now (Estaphaios moved to
      // thrallRigs) — feedback stays instant, never beat-quantized:
      // quantizing YOUR OWN damage would just read as lag.
      rig.update(deltaMs, {
        position: { x: p.x, y: p.y },
        velocity: { x: p.vx, y: p.vy },
        aimTarget: { x: p.aimX, y: p.aimY },
        grounded: p.grounded ?? true,
        crouching: p.crouching,
        health: p.health,
        maxHealth: 100,
        touchingWallDir: p.touchingWallDir ?? 0,
        dashing: p.dashing ?? false,
      });
    }
    for (const [pid, rig] of this.thrallRigs) {
      const p = players[pid];
      if (!p) continue;
      if (!p.alive) {
        rig.setVisible(false);
        continue;
      }
      rig.setVisible(true);
      // Cohesion/destabilization reveal is beat-quantized too — the shard
      // visibly "comes apart" ON a hit, not the instant the sim resolves
      // it. Estaphaios uses the REAL current max health (bossMaxHealth —
      // see respawnDummy/dummy:spawn, much bigger at the climax than the
      // early teaching fights); wave minions are the flat 24-hp fodder.
      const isEstaphaios = pid === (TUTORIAL_DUMMY_ID as string);
      rig.update(deltaMs, {
        position: { x: p.x, y: p.y },
        velocity: { x: p.vx, y: p.vy },
        aimTarget: { x: p.aimX, y: p.aimY },
        health: this.displayedHealth.get(pid) ?? p.health,
        maxHealth: isEstaphaios ? this.bossMaxHealth : 24,
        shield: this.duel.shieldState(pid),
      });
    }
  }

  /** Structural open/close arc for the vessel motif — the slow narrative
   *  breath across the whole song (see TutorialVesselMotif's own docblock
   *  for how this differs from the fast per-beat pulse). Tight and dim
   *  through the intro, most unfurled at the extraction climax, settling
   *  (not fully closing) on the way out — matches "we get out," not
   *  "we go back to how it was." */
  private static readonly ZONE_OPENNESS: Record<string, number> = {
    Silence: 0.08,
    "First Word": 0.16,
    "The Voice Speaks": 0.32,
    breather: 0.26,
    "The Response": 0.46,
    "The Three Forms": 0.58,
    "The Turn": 0.4,
    "The Vessel Answers": 1.0,
    "Silence, again": 0.5,
  };

  private handleCue(cue: SongCue): void {
    const data = (cue.data ?? {}) as Record<string, number | string | undefined>;
    switch (cue.kind) {
      case "zone:enter": {
        const openness = TutorialScene.ZONE_OPENNESS[String(data.name ?? "")];
        if (openness !== undefined) {
          this.vesselMotif?.setOpenness(openness);
          this.vesselShader?.setOpenness(openness);
        }
        break;
      }
      case "vessel:gasp": {
        // One-shot recognition spike — the vessel is momentarily seen fully
        // unfurled, then recedes to the zone's actual target as the real
        // fight approaches. Not a new power arriving; the realization it
        // was always whole.
        this.vesselMotif?.setOpenness(1.0);
        this.vesselShader?.setOpenness(1.0);
        this.cineCamera.flash(260);
        this.cineCamera.shake(260, 0.006);
        this.time.delayedCall(820, () => {
          const target = TutorialScene.ZONE_OPENNESS["The Turn"] ?? 0.4;
          this.vesselMotif?.setOpenness(target);
          this.vesselShader?.setOpenness(target);
        });
        break;
      }
      case "camera:snap":
        this.cineCamera.snap(Number(data.x), Number(data.y), data.zoom !== undefined ? Number(data.zoom) : undefined);
        break;
      case "camera:pan":
        void this.cineCamera.panTo(
          Number(data.x),
          Number(data.y),
          Number(data.ms ?? 2000),
          (data.ease as "Sine.easeInOut" | "Sine.easeIn" | "Sine.easeOut" | "Linear") ?? "Sine.easeInOut",
          data.zoom !== undefined ? Number(data.zoom) : undefined,
        );
        break;
      case "camera:pull-back":
        void this.cineCamera.zoomTo(Number(data.zoom ?? 1), Number(data.ms ?? 2000));
        break;
      case "camera:shake":
        this.cineCamera.shake(300, Number(data.amount ?? 0.5) * 0.015);
        break;
      case "camera:flash":
        this.cineCamera.flash(Number(data.ms ?? 200));
        break;
      case "camera:handoff-action": {
        this.cameraOwner = "action";
        const hero = this.duel.hero();
        this.actionCamera.snap(hero.x, hero.y);
        this.actionCamera.setBaseZoom(COMBAT_ZOOM * getRenderScale());
        break;
      }
      case "camera:handoff-director":
        this.cameraOwner = "director";
        break;
      case "dummy:spawn":
        if (data.health !== undefined) this.bossMaxHealth = Number(data.health);
        this.duel.respawnDummy({ x: Number(data.x), y: Number(data.y) }, Number(data.health ?? 100));
        this.diegeticCues.dummyDissolve(Number(data.x), Number(data.y), true); // arrival burst — same light, arriving instead of leaving
        break;
      case "dummy:goal":
        this.dummyDirector.setGoal({
          mode: (data.mode as "idle-flinch" | "return-fire" | "telegraphed-shot") ?? "idle-flinch",
          fireIntervalMs: data.fireIntervalMs !== undefined ? Number(data.fireIntervalMs) : undefined,
          stopRangePx: data.stopRangePx !== undefined ? Number(data.stopRangePx) : undefined,
        });
        break;
      case "dummy:cards":
        // The Vessel's spell loadout escalates per extraction stage — real
        // card ids (sim/data/cards.ts), so homing/fan/fire/explosive shots
        // come from the SAME build resolver live matches use.
        this.duel.setDummyCards((data.cards as unknown as string[]) ?? []);
        break;
      case "dummy:shield":
        // A scripted ability PHASE, not a static trait: the fight's climax
        // needs rhythm (press → forced pause → press again), not a flat DPS
        // race against a bigger health pool. See tutorial-song.ts's
        // vessel-shield-* cues for where this fires during the fight.
        this.duel.setShield(TUTORIAL_DUMMY_ID as string, Number(data.on ?? 0) === 1);
        break;
      case "horde:wave": {
        // A wave of archon shards — the realm noticing the theft. Each
        // shard is a real sim entity with real (weak) health and its own
        // scripted AI; fire cadences are deliberately staggered per shard
        // so a wave reads as a crowd, not a metronome firing squad.
        const count = Number(data.count ?? 2);
        const xMin = Number(data.xMin ?? this.duel.hero().x + 500);
        const xMax = Number(data.xMax ?? xMin + 600);
        const interval = Number(data.fireIntervalMs ?? 2400);
        const cards = (data.cards as unknown as string[] | undefined) ?? [];
        // "facet" tier (bigger, slower-spinning, more thorns) marks the
        // later, tougher escalation waves — the visual rank is BACKED by
        // real HP now (was a flat 24 regardless of tier, which made the
        // bigger-looking wave no actually harder — a decorative escalation,
        // not a real one). Difficulty scales through health/cadence, never
        // through slowing down how much damage the player can land.
        const tier = (String(data.tier ?? "splinter") as ShardThrallTier) ?? "splinter";
        // Warder's a squad piece, not fodder — real HP so flanking (not
        // just outlasting it) is the actual solve.
        const tierDefaultHealth: Record<ShardThrallTier, number> = {
          splinter: 24,
          facet: 55,
          warder: 60,
          estaphaios: 100,
        };
        // Cascading escalation ("kill one, two more arrive"): opt-in per
        // cue via data.cascade — only the finale waves carry it. Capped
        // (maxGenerations) so it's a real snowball with an end, not
        // infinite — the player should feel "I need to run," not "this
        // never stops."
        const cascade = data.cascade as
          | { spawnOnDeath?: number; maxGenerations?: number }
          | undefined;
        for (let i = 0; i < count; i++) {
          const id = `archon-shard-${this.minionCounter++}`;
          const x = xMin + ((xMax - xMin) * (count === 1 ? 0.5 : i / (count - 1)));
          this.minionTiers.set(id, tier);
          this.duel.addMinion(
            id,
            { x, y: 900 },
            { health: Number(data.health ?? tierDefaultHealth[tier]), cards, shielded: tier === "warder" },
          );
          const director = new TutorialDummyDirector();
          director.setGoal({
            mode: "return-fire",
            fireIntervalMs: interval + i * 340,
            stopRangePx: 300 + i * 90,
          });
          this.minionDirectors.set(id, director);
          this.diegeticCues.dummyDissolve(x, 900, true); // arrival burst
          if (cascade) {
            this.minionCascade.set(id, {
              spawnOnDeath: cascade.spawnOnDeath ?? 2,
              maxGenerations: cascade.maxGenerations ?? 2,
              tier,
              cards,
              fireIntervalMs: interval,
              generation: 0,
            });
          }
        }
        break;
      }
      case "demiurge:manifest":
        // Yeldabaoth's presence over the level — first a faint distant
        // shape (stage 0, Response zone, unnamed), re-anchored and grown
        // through each zone the player crosses, until it's undeniable and
        // named at the finale. Re-manifesting at a fresh anchor per zone
        // (rather than one static point) is what keeps it a FELT presence
        // across most of the run instead of a finale-only cameo.
        this.serpent?.destroy();
        this.serpent = new TutorialDemiurgeSerpent(this, Number(data.x ?? 6800), Number(data.y ?? 450));
        break;
      case "demiurge:stage":
        this.serpent?.setStage(Number(data.stage ?? 1) as 0 | 1 | 2 | 3);
        break;
      case "demiurge:banish":
        this.serpent?.banish();
        break;
      case "hero:victory-pose":
        // The induction beat — arms raised overhead, held through the
        // outro hold. Sephia's recruitment physically sealed, not just a
        // power flex (see COPTIC_SEPHIA's gasp-beat naming).
        this.playerRigs.get(TUTORIAL_HERO_ID as string)?.triggerVictoryPose(Number(data.holdMs ?? 6000));
        break;
      case "horde:clear": {
        // The board wipes — every remaining shard returns to light at once
        // (pre-finale clarity: the last beat belongs to the Vessel alone).
        for (const id of this.duel.enemyIds()) {
          if (id === (TUTORIAL_DUMMY_ID as string)) continue;
          const e = this.duel.entity(id);
          if (e) this.diegeticCues.dummyDissolve(e.x, e.y);
          this.duel.killEntity(id);
        }
        break;
      }
      case "diegetic:move-invite":
        this.diegeticCues.moveInvite(Number(data.fromX), Number(data.toX), 930);
        break;
      case "diegetic:jump-invite":
        this.diegeticCues.jumpInvite(Number(data.atX), 930);
        break;
      case "diegetic:coptic-flash":
        this.diegeticCues.copticFlash(String(data.text ?? ""), String(data.translit ?? ""), String(data.gloss ?? ""));
        break;
      case "diegetic:seal-closing":
        this.diegeticCues.sealClosing(this.duel.hero().x, this.duel.hero().y - 200);
        break;
      case "diegetic:seal-collapse":
        this.diegeticCues.sealCollapse(this.duel.dummy().x, this.duel.dummy().y - 150, Number(data.stage) as 1 | 2 | 3);
        break;
      case "diegetic:dummy-dissolve":
        this.diegeticCues.dummyDissolve(this.duel.dummy().x, this.duel.dummy().y);
        // Actually END the Vessel too — previously this only played the VFX
        // and left the boss rig standing through the whole outro.
        this.duel.killEntity(TUTORIAL_DUMMY_ID as string);
        break;
      case "diegetic:shaft-ignite":
        this.diegeticCues.shaftIgnite(4850, Number(data.y), Number(data.form) as 1 | 2 | 3);
        break;
      case "duel:complete":
        this.finish();
        break;
      default:
        break;
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const fade = (): void => {
      this.songAudio.pause();
      window.dispatchEvent(new CustomEvent("jakesjam:tutorial-exit"));
    };
    const iv = window.setInterval(() => {
      this.songAudio.volume = Math.max(0, this.songAudio.volume - 0.1);
      if (this.songAudio.volume <= 0.01) {
        window.clearInterval(iv);
        fade();
      }
    }, 40);
  }

  private teardown(): void {
    this.skipEl?.remove();
    this.skipEl = null;
    this.songAudio?.pause();
    this.diegeticCues?.destroy();
    this.vesselMotif?.destroy();
    this.vesselShader?.destroy();
    this.atmosphere?.destroy();
    this.spiritDescent?.destroy();
    this.serpent?.destroy();
    this.serpent = null;
    void this.musicCtx?.close().catch(() => {});
    this.musicCtx = null;
    this.musicAnalyser = null;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    for (const rig of this.thrallRigs.values()) rig.destroy();
    this.thrallRigs.clear();
    this.minionTiers.clear();
    this.minionCascade.clear();
    this.minionDirectors.clear();
    this.displayedHealth.clear();
    this.pendingHealthReveal.clear();
    this.bossHealthBar?.destroy();
    this.bossHealthBar = null;
    this.bossNameLabel?.destroy();
    this.bossNameLabel = null;
    this.particlePool?.destroy();
    this.entityRender?.destroy();
  }
}
