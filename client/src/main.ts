import Phaser from "phaser";
import "./style.css";
import { buildGameConfig } from "./game/GameConfig";
import { installRenderResolution, getRenderScale } from "./game/render/renderResolution";
import {
  getQualityProfile,
  isTouchMobile,
  probeRendererString,
  setQualityTier,
  type QualityTier,
} from "./game/render/qualityProfile";
import { crumb, installTelemetry, watchContextLoss } from "./telemetry";
import { announce, setAnnouncerVolume, silenceAnnouncer } from "./game/audio/AnnouncerSystem";
import { LobbyController } from "./game/ui/LobbyController";
import { MatchStatusBadge } from "./game/ui/MatchStatusBadge";
import { fetchWorldSummary } from "./net/worldClient";
import { SceneKeys } from "./game/scenes/SceneKeys";
import {
  applyWasmCollisionFlag,
  applyWasmPlayerFlag,
  applyWasmRngFlag,
  getWasmSim,
  startWasmCanary,
} from "./sim/wasm/runtime";
import { installWindowProbe } from "./debug/wasmStateProbe";
import { installBotDriver } from "./debug/botDriver";
import {
  isClipsConsentStored,
  isClipsEnabled,
  setClipsEnabled,
} from "./game/highlights/clipConsent";
import { ShellController } from "./shell/ShellController";
import {
  emitClipSaveNow,
  emitClipsConsentChanged,
  emitMatchStarted,
  ShellEvents,
} from "./shell/events";
import { showClipShareToast } from "./game/ui/ClipShareToast";
import { globalClipSession } from "./shell/clipSession";
import {
  applyWasmWorldFlag,
  applyWasmWorldStepFullSync,
  applyWasmWorldStepSync,
  isWasmWorldReady,
  preloadWasmWorldSim,
  setWorldStatics as setWorldStaticsImport,
} from "./sim/wasm/worldWasmBackend";
import {
  isVoiceWanted,
  startVoiceReactive,
  tickVoiceReactive,
  writeMusicBands,
} from "./game/systems/SonicField";

// Phase F3 Zig→WASM substrate. RNG, collision, and player physics
// run in Zig wasm by DEFAULT. Boot-load the wasm sim ASAP so it's
// warm before any match starts.
//   ?wasm-canary=1      → 30s of TS↔wasm RNG parity probes (debug).
//   ?wasm-rng=0         → opt OUT of wasm RNG.
//   ?wasm-collision=0   → opt OUT of wasm collision.
//   ?wasm-player=0      → opt OUT of wasm player physics.
// See docs/zig-wasm-migration.md and ADR-0006.
void getWasmSim();
startWasmCanary();
void applyWasmRngFlag();
void applyWasmCollisionFlag();
void applyWasmPlayerFlag();

// Install the deterministic-state probe globals. Scenes register
// their state getter when they own a WorldState. See
// client/src/debug/wasmStateProbe.ts.
installWindowProbe();
installBotDriver();

// Phase J0 — opt-in wasm orchestrator shim. `?wasm-world=1` lets
// step_world drive the round phase machine, fire-patch lifetime,
// projectile lifecycle, and projectile×destructible HP each tick.
// Default OFF until full parity lands.
void applyWasmWorldFlag();

// Eagerly preload the wasm orchestrator's sim instance so the
// sync variant `applyWasmWorldStepSync` is callable from the
// netcode loop's sync `stepWithRuntime` path. Fire-and-forget —
// the netcode loop falls back to the async variant if preload
// hasn't finished by the first sim tick.
void preloadWasmWorldSim().then(() => {
  // Expose the sync API on globalThis so World.ts maybeWasmActual
  // (J1-actual ?wasm-world=2 path) can pick it up without a
  // circular import. Sync from then on; preload guarantees ready.
  type WB = {
    isWasmWorldReady(): boolean;
    applyWasmWorldStepSync: typeof applyWasmWorldStepSync;
    applyWasmWorldStepFullSync: typeof applyWasmWorldStepFullSync;
    setWorldStatics: typeof setWorldStaticsImport;
  };
  (globalThis as { __jakesjam_wasm_backend__?: WB }).__jakesjam_wasm_backend__ = {
    isWasmWorldReady,
    applyWasmWorldStepSync,
    applyWasmWorldStepFullSync,
    setWorldStatics: setWorldStaticsImport,
  };
  // Flush any pending static-AABB cache that was queued before the
  // backend was ready. The clientLoop's createRuntime fires on the
  // first ServerHello, which can land BEFORE this preload-then
  // resolves — before this fix, setWorldStatics dropped silently and
  // the wasm sim ran with empty statics → player fell through every
  // platform.
  void import("./sim/World.js").then((m) => m.flushPendingStaticsToWasm());
});

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root element.");
}

// ── Kiosk / stream shell ──────────────────────────────────────────────
// Chromium --app= + Hyprland fullscreen already hide OS/browser chrome.
// ?kiosk=1 tightens the web surface: no cursor idle noise, Fullscreen API,
// canvas edge-to-edge. Used by stream-kit/launch-game-kiosk.sh.
const isKioskMode = (() => {
  try {
    return new URLSearchParams(window.location.search).get("kiosk") === "1";
  } catch {
    return false;
  }
})();
if (isKioskMode) {
  document.documentElement.classList.add("kiosk");
  document.body.classList.add("kiosk");
  document.title = "JAKESJAM";
  let cursorTimer = 0;
  const hideCursor = () => {
    document.body.classList.remove("kiosk-show-cursor");
  };
  const bumpCursor = () => {
    document.body.classList.add("kiosk-show-cursor");
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(hideCursor, 1800);
  };
  window.addEventListener("pointermove", bumpCursor, { passive: true });
  window.addEventListener("pointerdown", bumpCursor, { passive: true });
  // Fullscreen API (hides remaining shell if any) after first gesture.
  const enterFs = () => {
    const el = document.documentElement;
    const req =
      el.requestFullscreen?.bind(el) ??
      (el as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.bind(el);
    try {
      void req?.();
    } catch {
      /* ignore */
    }
    window.removeEventListener("pointerdown", enterFs);
    window.removeEventListener("keydown", enterFs);
  };
  window.addEventListener("pointerdown", enterFs, { once: true });
  window.addEventListener("keydown", enterFs, { once: true });
}

app.innerHTML = `
  <section class="splash-screen" data-splash data-shell-home>
    <div class="splash-stage">
      <p class="splash-kicker">ELYAD</p>
      <h1>JAKESJAM</h1>
      <p class="splash-copy">Crystal-tech arena. Draft between rounds. Spawn in seconds.</p>
      <div class="splash-name">
        <label for="jj-name" class="splash-name-label">CALLSIGN</label>
        <input
          id="jj-name"
          data-player-name
          type="text"
          maxlength="14"
          autocomplete="nickname"
          placeholder="choose your name"
          spellcheck="false"
        />
      </div>
      <div class="splash-actions splash-actions--primary">
        <button data-menu-world type="button" class="primary shell-cta-primary">Hot Lobby</button>
      </div>
      <div class="splash-actions splash-actions--secondary">
        <button data-menu-practice type="button" class="shell-btn-secondary">Practice</button>
        <button data-menu-host type="button" class="shell-btn-secondary">Private room</button>
        <button data-menu-join type="button" class="shell-btn-secondary">Join room</button>
        <button data-menu-clips type="button" class="shell-btn-secondary">Clips</button>
        <button data-menu-options type="button" class="shell-btn-secondary">Settings</button>
      </div>
      <div class="splash-status-slot" data-world-status></div>
    </div>
  </section>
  <section class="shell-layer options-panel" data-options data-shell-settings hidden>
    <div class="shell-frame">
      <p class="shell-kicker">VESSEL</p>
      <h2>Settings</h2>
      <div class="shell-section">
        <h3>Audio</h3>
        <label>
          Music Volume
          <input data-music-volume type="range" min="0" max="100" value="65" />
        </label>
        <label class="option-check">
          <input data-music-muted type="checkbox" />
          Mute Music
        </label>
      </div>
      <div class="shell-section">
        <h3>Clips</h3>
        <label class="option-check">
          <input data-clips-enabled type="checkbox" />
          Auto-clip my highlights
        </label>
        <p class="shell-hint">Records your gameplay to this server for shareable vertical video. On by default — uncheck to opt out.</p>
        <button data-open-clips type="button" class="shell-btn-secondary">Open clips</button>
      </div>
      <div class="shell-section">
        <h3>Graphics</h3>
        <label>
          Quality
          <select data-quality-tier>
            <option value="auto">Auto</option>
            <option value="potato">Potato (Pi / weak GPU)</option>
            <option value="phone">Phone</option>
            <option value="standard">Standard</option>
            <option value="ultra">Ultra (supersampled)</option>
          </select>
        </label>
        <label>
          Resolution scale
          <input data-render-scale type="range" min="50" max="200" step="5" />
          <span data-render-scale-value></span>
        </label>
        <p class="shell-hint" data-quality-hint></p>
      </div>
      <div class="shell-section">
        <h3>Controls</h3>
        <p class="shell-hint">Move WASD · Aim mouse · Fire left-click · Parry right-click · Jump space</p>
        <p class="shell-hint">Touch: left stick move · right zone aim/fire · on-screen parry/jump</p>
      </div>
      <button data-options-back type="button" class="shell-btn-secondary">Back</button>
    </div>
  </section>
  <section class="shell-layer clips-panel" data-shell-clips hidden>
    <div class="shell-frame">
      <p class="shell-kicker">HIGHLIGHTS</p>
      <h2>Clips</h2>
      <p class="shell-hint" data-clips-save-status>
        Auto: multi-kill / parry-kill / chain · or tap Save clip now in Hot Lobby.
      </p>
      <button data-clips-save-now type="button" class="primary">Save clip now</button>
      <div data-clips-list class="shell-clips-list"></div>
      <button data-clips-back type="button" class="shell-btn-secondary">Back</button>
    </div>
  </section>
  <section class="shell-layer pause-panel" data-shell-pause hidden>
    <div class="shell-frame">
      <p class="shell-kicker">APERTURE</p>
      <h2>Paused</h2>
      <p class="shell-hint">You are still in Hot Lobby. Resume to keep playing, or leave.</p>
      <p class="shell-hint" data-pause-clips-status>Clips: off</p>
      <div class="shell-pause-actions">
        <button data-pause-resume type="button" class="primary">Resume</button>
        <button data-pause-toggle-clips type="button" class="shell-btn-secondary">Enable auto-clips</button>
        <button data-pause-save-clip type="button" class="shell-btn-secondary">Save clip now</button>
        <button data-pause-settings type="button" class="shell-btn-secondary">Settings</button>
        <button data-pause-clips type="button" class="shell-btn-secondary">Clip library</button>
        <button data-pause-leave type="button" class="btn-danger">Leave</button>
      </div>
      <p class="shell-hint">Tip: Esc · Save clip now (manual) · multi-kill/parry/chain auto-toast.</p>
    </div>
  </section>
  <!-- Always-on match chrome: world auto-join skips HOME, so clips must be reachable here. -->
  <div class="match-chrome" data-match-chrome hidden>
    <button type="button" class="match-chrome-btn" data-match-menu title="Menu (Esc)">Menu</button>
    <button type="button" class="match-chrome-btn match-chrome-clips" data-match-clips title="Clips">
      <span class="match-chrome-dot" data-match-clips-dot></span>
      <span data-match-clips-label>Clips off</span>
    </button>
  </div>
  <main class="app-shell">
    <div id="game-root" class="game-root"></div>
    <aside class="lobby-panel lobby-panel--hidden shell-room" data-lobby-panel data-shell-room aria-label="Private room">
      <div class="shell-frame shell-frame--room">
        <p class="shell-kicker">PRIVATE CHANNEL</p>
        <h2>Private Room</h2>
        <p class="status-line" data-status>Booting channel...</p>

        <form class="player-form" data-player-form>
          <label>
            Callsign
            <input data-player-name maxlength="24" autocomplete="nickname" />
          </label>
          <label>
            Accent
            <input data-player-color type="color" value="#50e3c2" />
          </label>
          <label>
            Vessel
            <select data-player-character>
              <option value="balanced">Balanced</option>
              <option value="heavy">Heavy</option>
              <option value="sprinter">Sprinter</option>
              <option value="shielded">Shielded</option>
            </select>
          </label>
        </form>

        <div class="room-actions" data-room-actions>
          <button data-create-room type="button" class="primary">Host private room</button>
          <button data-back-to-splash type="button" class="shell-btn-secondary">← Home</button>
        </div>
        <!-- hidden practice hook for legacy LobbyController (practice is on HOME) -->
        <button data-practice type="button" hidden>Practice</button>

        <section class="player-connect" data-player-connect>
          <h3 class="shell-section-title">Join with code</h3>
          <div class="join-row">
            <input data-room-code maxlength="6" placeholder="CODE" aria-label="Room code" autocomplete="off" />
            <button data-join-room type="button" class="shell-btn-secondary">Join</button>
          </div>
          <p class="shell-hint">Share link or 6-letter code. No Convex — runs on this server.</p>
        </section>

        <section class="active-room" data-active-room hidden>
          <div class="room-code-row">
            <span>Channel</span>
            <strong data-active-code>------</strong>
            <button data-room-share type="button" class="shell-btn-secondary room-share-btn">Copy link</button>
          </div>
          <div class="room-status-slot" data-room-status></div>
          <div class="shell-pause-actions">
            <button data-ready-toggle type="button" class="shell-btn-secondary">Ready</button>
            <button data-start-match type="button" class="primary">Start match</button>
            <button data-leave-room type="button" class="btn-danger">Leave</button>
          </div>
        </section>

        <section class="map-picker-box" data-map-picker aria-label="Map selection"></section>

        <section class="chaos-box" aria-label="Party modifiers">
          <h3 class="shell-section-title">Chaos</h3>
          <label><input data-chaos-modifier type="checkbox" value="low-gravity" /> Low Grav</label>
          <label><input data-chaos-modifier type="checkbox" value="slow-motion" /> Slo Mo</label>
          <label><input data-chaos-modifier type="checkbox" value="golden-gun" /> Golden Gun</label>
          <label><input data-chaos-modifier type="checkbox" value="slappers-only" /> Slappers Only</label>
          <label><input data-chaos-modifier type="checkbox" value="fire-hazard" /> Fire Hazard</label>
          <label><input data-chaos-modifier type="checkbox" value="random-shapes" /> Random Shapes</label>
          <label><input data-chaos-modifier type="checkbox" value="max-recoil" /> Max Recoil</label>
        </section>

        <section class="players-box" aria-label="Players in room">
          <h3 class="shell-section-title">Squad</h3>
          <ul data-player-list></ul>
        </section>
      </div>
    </aside>
  </main>
`;

// Vite HMR guard: `main.ts` has no accept boundary, so a change anywhere in
// its import graph (which is most of the game — this bit us during the
// practice-zone rework, where dozens of MatchScene.ts edits under `bun run
// dev:client` each re-executed this module) re-runs this file WITHOUT
// tearing down the previous `Phaser.Game`. Without a dispose guard that
// stacks a new game on top of the old one every reload — duplicate
// canvases, both instances' keyboard capture fighting, movement that looks
// dead because input is going to the instance you can't see.
//
// The same re-execution ALSO recreates menuMusic/worldMusic as brand new
// `Audio` elements below. A JS reference going out of scope does NOT stop a
// currently-playing HTMLAudioElement — the browser keeps it alive and
// audible with no reference to it at all — so the previous execution's
// tracks kept playing right alongside the new ones: reported as "double
// music", reproducing specifically while iterating on the practice zone
// (i.e. exactly the dev:client HMR churn this comment already warned about).
// Stash the old elements on the same global slot so this run can pause them
// before creating their replacements.
const globalWithGame = globalThis as {
  __jakesjam_game__?: Phaser.Game;
  __jakesjam_music__?: HTMLAudioElement[];
  __jakesjam_ctxmenu__?: boolean;
};
globalWithGame.__jakesjam_game__?.destroy(true);
globalWithGame.__jakesjam_music__?.forEach((audio) => {
  audio.pause();
  audio.currentTime = 0;
});

const game = new Phaser.Game(buildGameConfig());
// Scale.NONE does no automatic window tracking — this owns it (backing
// store = CSS × renderScale; see game/render/renderResolution.ts).
installRenderResolution(game);

// Sovereign telemetry (docs/TELEMETRY.md): global error capture + boot
// facts. Installed after profile detection so the boot event carries the
// tier decision; the canvas watch attaches once Phaser has one.
{
  const profile = getQualityProfile();
  installTelemetry({
    tier: profile.tier,
    rendererString: probeRendererString(),
    touch: isTouchMobile(),
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    if (game.canvas) watchContextLoss(game.canvas);
    crumb("boot", `phaser ready rs=${getRenderScale()}`);
  });
}

// PWA installability (public/sw.js is a deliberate no-cache pass-through —
// a stale bundle is worse than a slow one for a live multiplayer game).
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
// Diagnostic: expose the Phaser game on window so e2e specs can walk
// the scene's display list to find render-time leaks. No production
// behaviour depends on this — pure introspection hook.
globalWithGame.__jakesjam_game__ = game;

// Right-click is the PRIMARY combat action (the aegis power-slide), so the
// browser context menu must NEVER appear — anywhere. The previous
// canvas/#game-root-scoped version still let the menu through in some real
// cases (overlays, drag targets), so this is UNCONDITIONAL: a game has no
// use for the OS right-click menu on any element. Belt-and-suspenders —
// window + document, capture phase, plus a body-level handler and the
// on-canvas suppressor below — so nothing can slip past.
const killContextMenu = (e: Event) => e.preventDefault();
window.addEventListener("contextmenu", killContextMenu, { capture: true });
document.addEventListener("contextmenu", killContextMenu, { capture: true });
document.body.addEventListener("contextmenu", killContextMenu);
document.body.oncontextmenu = () => false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy(true);
    if (globalWithGame.__jakesjam_game__ === game) {
      globalWithGame.__jakesjam_game__ = undefined;
    }
  });
}

// Landscape and portrait are BOTH first-class on touch (2026-07-11): the
// old "hold your phone upright" overlay + join-time orientation lock are
// gone — the layout follows the hold, live.
function isTouchDevice(): boolean {
  return (
    (navigator.maxTouchPoints ?? 0) > 0 &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

// Kill the mobile browser chrome ("massive banner") on first tap: request
// fullscreen + lock portrait. Best-effort, once, touch devices only.
if (isTouchDevice()) {
  const goFullscreen = () => {
    void import("./game/input/mobile").then((m) => m.enterFullscreenPortrait());
    window.removeEventListener("pointerdown", goFullscreen);
  };
  window.addEventListener("pointerdown", goFullscreen);
}

// Chosen callsign — persisted, sanitized, rides the world join.
const playerNameInput = app.querySelector<HTMLInputElement>("[data-player-name]");
if (playerNameInput) {
  playerNameInput.value = localStorage.getItem("jakesjam.playerName") ?? "";
  playerNameInput.addEventListener("input", () => {
    const clean = playerNameInput.value.replace(/[^\w \-.']/g, "").slice(0, 14);
    if (clean !== playerNameInput.value) playerNameInput.value = clean;
    localStorage.setItem("jakesjam.playerName", clean.trim());
  });
}

const lobbyController = new LobbyController(app);
const splash = queryRequired<HTMLElement>("[data-splash]");
const lobbyPanel = queryRequired<HTMLElement>("[data-lobby-panel]");
const optionsPanel = queryRequired<HTMLElement>("[data-options]");
const clipsPanel = queryRequired<HTMLElement>("[data-shell-clips]");
const pausePanel = queryRequired<HTMLElement>("[data-shell-pause]");
const clipsListEl = queryRequired<HTMLElement>("[data-clips-list]");
const musicVolumeInput = queryRequired<HTMLInputElement>("[data-music-volume]");
const musicMutedInput = queryRequired<HTMLInputElement>("[data-music-muted]");

const shell = new ShellController({
  dom: {
    home: splash,
    room: lobbyPanel,
    settings: optionsPanel,
    clips: clipsPanel,
    pause: pausePanel,
    clipsList: clipsListEl,
  },
  onEnterWorld: () => joinWorld(),
  onEnterPractice: () => {
    startMenuMusic();
    shell.setMatchMode("practice");
    lobbyController.startPracticeFromMenu();
  },
  onEnterRoom: (mode) => {
    startMenuMusic();
    shell.goto("room");
    if (mode === "host") lobbyController.focusCreateRoom();
    else lobbyController.focusJoinRoom();
  },
  onLeaveMatch: () => leaveMatchToHome(),
});
// ── Soundtrack state ─────────────────────────────────────────────────────
// Two tracks that CROSSFADE rather than hard-cut: the "Jakes Jam" theme
// underscores menu/lobby; the "bassradian" loops drive world/match. A context
// flag decides which is live; a per-element RAF fade smooths every transition
// (menu↔world and loop→loop) so nothing clicks or drops out — the main
// game-feel win over the initial hard-switch.
type MusicContext = "menu" | "world";
let musicContext: MusicContext = "menu";
const CROSSFADE_MS = 900;
const musicFades = new WeakMap<HTMLAudioElement, number>();
// Which context playCurrentMusic() last actually kicked off successfully.
// Every entry point that "makes sure music is playing" (a menu button's own
// click handler, the splash's own pointerdown-once listener, and the global
// armSoundtrackOnFirstGesture safety net) can all fire off the SAME single
// user gesture — clicking "Practice" hit all three. Without this guard each
// one re-entered playCurrentMusic() and scheduled its own competing fade-up
// on the SAME <audio> element, which is what read as "double music" /
// distortion: not two tracks overlapping, but 2-3 fade animations racing
// each other on one track before the crossfade to world settled it down.
let musicStartedForContext: MusicContext | null = null;

// Menu/lobby theme — the "Jakes Jam" track, looped.
const menuMusic = new Audio(getAudioUrl("jakes-jam-theme.mp3"));
menuMusic.loop = true;
menuMusic.preload = "auto";

// In-world / match soundtrack — the three "bassradian" epic loops, cycled for
// variety (advance on `ended`, wrap around) so a long session doesn't hear the
// same 2 minutes on repeat.
const WORLD_MUSIC_TRACKS = ["epic-loop-1.mp3", "epic-loop-2.mp3", "epic-loop-3.mp3"] as const;
let worldTrackIdx = 0;
const worldMusic = new Audio(getAudioUrl(WORLD_MUSIC_TRACKS[0]));
worldMusic.preload = "auto";
worldMusic.addEventListener("ended", () => {
  worldTrackIdx = (worldTrackIdx + 1) % WORLD_MUSIC_TRACKS.length;
  worldMusic.src = getAudioUrl(WORLD_MUSIC_TRACKS[worldTrackIdx]!);
  worldMusic.muted = musicMutedInput.checked;
  if (musicContext === "world") {
    // Fade the next loop up from silence so the seam between tracks doesn't
    // click — the loops don't share a bar boundary, so a hard cut is audible.
    worldMusic.volume = 0;
    void worldMusic.play().then(() => fadeMusic(worldMusic, musicVol(), 700)).catch(() => undefined);
  }
});
// So the NEXT HMR re-execution (see the guard above) can find and pause
// these before creating their replacements.
globalWithGame.__jakesjam_music__ = [menuMusic, worldMusic];
restoreOptions();

// ── Action-intensity → music reactivity ─────────────────────────────────
// Scenes dispatch `jakesjam:intensity` (throttled, see ActionIntensity
// consumers) with a 0-1 "how much is happening" score. Rather than
// analyzing the actual audio (fussy autoplay-gated AudioContexts, and it'd
// sync to what the track's bassline happens to be doing rather than to
// gameplay), the SAME score modulates the currently-playing world track
// directly — tempo and bass, the two levers that read as "the music going
// wild" without needing per-track metadata (there's no way to programmatically
// judge whether epic-loop-2 "sounds heavier" than epic-loop-1; this works
// on whichever one is playing). Menu music never modulates — intensity is a
// gameplay-only concept there's nothing of in the lobby.
const audioCtx = new AudioContext();
const worldBassFilter = audioCtx.createBiquadFilter();
worldBassFilter.type = "lowshelf";
worldBassFilter.frequency.value = 150;
worldBassFilter.gain.value = 0;
// A dedicated gain node for the intensity loudness-swell, kept SEPARATE
// from the element's own `.volume` (which the crossfade system owns — see
// fadeMusic). Multiplying here instead of touching `.volume` means the two
// don't fight.
const worldSwellGain = audioCtx.createGain();
worldSwellGain.gain.value = 1;
// Safety limiter on the master world-music bus so NOTHING clips, ever — the
// bass shelf boost + loudness swell can push peaks past 0 dBFS on
// bass-heavy passages, which would clip hard at the destination. A
// near-brickwall compressor catches only those peaks and is transparent
// below threshold, so the output stays clean at any intensity.
const worldLimiter = audioCtx.createDynamicsCompressor();
worldLimiter.threshold.value = -3;
worldLimiter.knee.value = 3;
worldLimiter.ratio.value = 20;
worldLimiter.attack.value = 0.003;
worldLimiter.release.value = 0.25;
// Analyser for arena juice (CosmicArenaLayer) — frequency bands + beat.
// Sits after swell so we hear the same mix the player hears.
const musicAnalyser = audioCtx.createAnalyser();
musicAnalyser.fftSize = 256;
// Low smoothing → snappy arena response (was 0.72, laggy).
musicAnalyser.smoothingTimeConstant = 0.35;
const musicFreqBins = new Uint8Array(musicAnalyser.frequencyBinCount);
const musicTimeBins = new Uint8Array(musicAnalyser.fftSize);

// Graph: element → bass shelf → swell gain → analyser → limiter → out.
audioCtx
  .createMediaElementSource(worldMusic)
  .connect(worldBassFilter)
  .connect(worldSwellGain)
  .connect(musicAnalyser)
  .connect(worldLimiter)
  .connect(audioCtx.destination);
// menuMusic doesn't need the filter graph, but once ANY element on the page
// is routed through an AudioContext, browsers still play unrouted elements
// fine — no need to touch menuMusic at all.

let targetIntensity = 0;
window.addEventListener("jakesjam:intensity", (event) => {
  const detail = (event as CustomEvent<{ intensity: number }>).detail;
  if (typeof detail?.intensity === "number") {
    targetIntensity = Math.max(0, Math.min(1, detail.intensity));
  }
});

// Intensity → music is EXTREMELY SUBTLE and NEVER changes tempo (speeding
// the track up was too much — it's gone entirely; playbackRate stays 1.0).
// All that moves is a faint low-end lift and a barely-there loudness swell,
// off a quieter resting baseline. Should register as "the mix warms up a
// touch" under heavy action, not as an obvious effect. The limiter keeps
// the loud end clean.
const MAX_BASS_GAIN_DB = 3; // faint low-end lift at peak
const REST_SWELL = 0.8; // resting loudness (quieter when calm)
const PEAK_SWELL = 0.9; // barely louder at peak
// Asymmetric smoothing: ease up (0.10) a little quicker than down (0.03),
// but both gentle so even this subtle move never pumps.
const INTENSITY_ATTACK = 0.1;
const INTENSITY_RELEASE = 0.03;
let smoothedIntensity = 0;
// Smoothed bands for arena pulse (published via SonicField.writeMusicBands).
let smBass = 0;
let smMid = 0;
let smHigh = 0;
let smRms = 0;
let prevBass = 0;
let beatEnv = 0;

function bandMean(data: Uint8Array, i0: number, i1: number): number {
  let s = 0;
  const a = Math.max(0, i0 | 0);
  const b = Math.min(data.length, i1 | 0);
  if (b <= a) return 0;
  for (let i = a; i < b; i++) s += data[i]!;
  return s / (b - a) / 255;
}

function tickMusicIntensity() {
  const k = targetIntensity > smoothedIntensity ? INTENSITY_ATTACK : INTENSITY_RELEASE;
  smoothedIntensity += (targetIntensity - smoothedIntensity) * k;
  // Tempo is deliberately never touched — the element stays at its natural
  // 1.0 playbackRate.
  if (musicContext === "world" && !worldMusic.paused) {
    worldBassFilter.gain.value = smoothedIntensity * MAX_BASS_GAIN_DB;
    worldSwellGain.gain.value = REST_SWELL + smoothedIntensity * (PEAK_SWELL - REST_SWELL);

    // ── Live amplitude for cosmic arena (bass / mid / high / beat) ──
    if (audioCtx.state === "running") {
      musicAnalyser.getByteFrequencyData(musicFreqBins);
      musicAnalyser.getByteTimeDomainData(musicTimeBins);
      const n = musicFreqBins.length;
      // fftSize 256 → ~86 Hz/bin at 44.1k; bands approximate
      const bass = bandMean(musicFreqBins, 1, Math.max(2, Math.floor(n * 0.08)));
      const mid = bandMean(musicFreqBins, Math.floor(n * 0.08), Math.floor(n * 0.35));
      const high = bandMean(musicFreqBins, Math.floor(n * 0.35), Math.floor(n * 0.75));
      let peak = 0;
      for (let i = 0; i < musicTimeBins.length; i++) {
        const v = Math.abs((musicTimeBins[i]! - 128) / 128);
        if (v > peak) peak = v;
      }
      const rms = peak;
      // Expand quiet tracks; gamma < 1 lifts lows for responsive geometry.
      const lift = (v: number) => Math.min(1, Math.pow(Math.max(0, v) * 1.55, 0.62));
      const bL = lift(bass);
      const mL = lift(mid);
      const hL = lift(high);
      const rL = lift(rms);
      // Near-instant attack, still soft release (hits land in 1–2 frames).
      smBass += (bL - smBass) * (bL > smBass ? 0.92 : 0.22);
      smMid += (mL - smMid) * (mL > smMid ? 0.9 : 0.2);
      smHigh += (hL - smHigh) * (hL > smHigh ? 0.94 : 0.24);
      smRms += (rL - smRms) * (rL > smRms ? 0.92 : 0.22);
      const bassDelta = Math.max(0, smBass - prevBass);
      prevBass = smBass;
      // Beat: hard attack, medium decay
      beatEnv = Math.max(beatEnv * 0.72, Math.min(1, bassDelta * 28 + (bL > 0.55 ? bL * 0.35 : 0)));
      const pulse = Math.min(1, smBass * 0.48 + smRms * 0.28 + beatEnv * 0.55 + smMid * 0.18);
      // Mutable sonic field first (arena hot path — no event alloc required).
      writeMusicBands({
        bass: smBass,
        mid: smMid,
        high: smHigh,
        rms: smRms,
        pulse,
        beat: beatEnv,
      });
      // (MusicAmplitude reads the SonicField directly now — the legacy
      // CustomEvent dispatch here allocated an event+detail EVERY frame.)
    }
    // Mic sample every frame while audio graph is live (cheap if no stream).
    tickVoiceReactive();
  } else {
    worldBassFilter.gain.value = 0;
    worldSwellGain.gain.value = REST_SWELL;
    smBass *= 0.9;
    smMid *= 0.9;
    smHigh *= 0.9;
    smRms *= 0.9;
    beatEnv *= 0.85;
    writeMusicBands({
      bass: smBass,
      mid: smMid,
      high: smHigh,
      rms: smRms,
      pulse: Math.min(1, smBass * 0.5 + smRms * 0.3 + beatEnv * 0.4),
      beat: beatEnv,
    });
    tickVoiceReactive();
  }
  requestAnimationFrame(tickMusicIntensity);
}
requestAnimationFrame(tickMusicIntensity);

queryRequired<HTMLButtonElement>("[data-menu-world]").addEventListener("click", () => {
  joinWorld();
});

// Live status pill on the splash. Polls /world/summary every 3s — if the
// world is mid-round, we show how far through; if joinable we light the
// "Join" CTA. The "Copy link" button copies a `?world=1` shareable URL.
const worldStatusMount = queryRequired<HTMLElement>("[data-world-status]");
const worldShareUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}/?world=1`;
const worldStatusBadge = new MatchStatusBadge({
  mount: worldStatusMount,
  title: "Hot Lobby",
  shareUrl: worldShareUrl,
  fetchSummary: () => fetchWorldSummary(),
  onJoin: () => {
    joinWorld();
    worldStatusBadge.refresh();
  },
});

queryRequired<HTMLButtonElement>("[data-menu-practice]").addEventListener("click", () => {
  startMenuMusic();
  shell.setMatchMode("practice");
  lobbyController.startPracticeFromMenu();
});

queryRequired<HTMLButtonElement>("[data-menu-host]").addEventListener("click", () => {
  startMenuMusic();
  shell.goto("room");
  lobbyController.focusCreateRoom();
});

queryRequired<HTMLButtonElement>("[data-menu-join]").addEventListener("click", () => {
  startMenuMusic();
  shell.goto("room");
  lobbyController.focusJoinRoom();
});

queryRequired<HTMLButtonElement>("[data-menu-options]").addEventListener("click", () => {
  startMenuMusic();
  shell.goto("settings");
  optionsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

queryRequired<HTMLButtonElement>("[data-menu-clips]").addEventListener("click", () => {
  startMenuMusic();
  shell.goto("clips");
});

queryRequired<HTMLButtonElement>("[data-options-back]").addEventListener("click", () => {
  shell.closeLayer();
});

queryRequired<HTMLButtonElement>("[data-clips-back]").addEventListener("click", () => {
  shell.closeLayer();
});

queryRequired<HTMLButtonElement>("[data-open-clips]").addEventListener("click", () => {
  shell.goto("clips");
});

queryRequired<HTMLButtonElement>("[data-pause-resume]").addEventListener("click", () => {
  shell.closeLayer();
});

queryRequired<HTMLButtonElement>("[data-pause-settings]").addEventListener("click", () => {
  shell.goto("settings");
});

queryRequired<HTMLButtonElement>("[data-pause-clips]").addEventListener("click", () => {
  shell.goto("clips");
});

queryRequired<HTMLButtonElement>("[data-pause-leave]").addEventListener("click", () => {
  if (confirm("Leave Hot Lobby? It keeps running without you.")) {
    leaveMatchToHome();
  }
});

// Clip toast when match emits jakesjam:clip-uploaded (session list is ShellController).
const pendingToast: { vertical?: string; original?: string; timer?: number } = {};
window.addEventListener(ShellEvents.CLIP_UPLOADED, ((e: CustomEvent) => {
  const d = e.detail as { url?: string; kind?: string };
  if (!d?.url) return;
  if (d.kind === "vertical") pendingToast.vertical = d.url;
  if (d.kind === "original") pendingToast.original = d.url;
  const flush = () => {
    if (pendingToast.timer) window.clearTimeout(pendingToast.timer);
    pendingToast.timer = undefined;
    const v = pendingToast.vertical;
    const o = pendingToast.original;
    pendingToast.vertical = undefined;
    pendingToast.original = undefined;
    if (v) showClipShareToast(v, o);
    else if (o) showClipShareToast(o);
  };
  if (pendingToast.vertical && pendingToast.original) flush();
  else {
    if (pendingToast.timer) window.clearTimeout(pendingToast.timer);
    pendingToast.timer = window.setTimeout(flush, 5000);
  }
}) as EventListener);

musicVolumeInput.addEventListener("input", () => {
  localStorage.setItem("jakesjam.musicVolume", musicVolumeInput.value);
  setAnnouncerVolume(Number(musicVolumeInput.value) / 100);
  applyAudioOptions();
});

musicMutedInput.addEventListener("change", () => {
  localStorage.setItem("jakesjam.musicMuted", JSON.stringify(musicMutedInput.checked));
  applyAudioOptions();
});

// ── Graphics quality (QualityProfile) ────────────────────────────────────
// Context flags + boot-sized systems depend on these, so changes apply via
// a reload. The user's explicit choice always wins over auto-detection.
{
  const tierSelect = queryRequired<HTMLSelectElement>("[data-quality-tier]");
  const scaleInput = queryRequired<HTMLInputElement>("[data-render-scale]");
  const scaleValue = queryRequired<HTMLElement>("[data-render-scale-value]");
  const hint = queryRequired<HTMLElement>("[data-quality-hint]");

  const storedTier = localStorage.getItem("jj_quality_tier");
  tierSelect.value = storedTier ?? "auto";
  const profile = getQualityProfile();
  scaleInput.value = String(Math.round(getRenderScale() * 100));
  scaleValue.textContent = `${scaleInput.value}%`;
  hint.textContent =
    storedTier === null
      ? `Auto picked: ${profile.tier} (fps ${profile.fpsLimit || "uncapped"}). Changes reload the game.`
      : `Changes reload the game.`;

  let reloadTimer: number | null = null;
  const scheduleReload = () => {
    hint.textContent = "Applying — reloading…";
    if (reloadTimer !== null) window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 650);
  };

  tierSelect.addEventListener("change", () => {
    setQualityTier(tierSelect.value === "auto" ? null : (tierSelect.value as QualityTier));
    // A tier choice supersedes any raw scale override.
    localStorage.removeItem("jj_render_scale");
    scheduleReload();
  });

  scaleInput.addEventListener("change", () => {
    localStorage.setItem("jj_render_scale", String(Number(scaleInput.value) / 100));
    scaleValue.textContent = `${scaleInput.value}%`;
    scheduleReload();
  });
  scaleInput.addEventListener("input", () => {
    scaleValue.textContent = `${scaleInput.value}%`;
  });
}

// Highlight-clip consent toggle (see game/highlights/clipConsent.ts —
// capture NEVER activates without this or the ?clips=1 dev override).
// Takes effect on the next world join; no live re-wiring needed since
// OnlineMatchScene reads consent once in create().
const clipsEnabledInput = queryRequired<HTMLInputElement>("[data-clips-enabled]");
const clipsSaveStatus = queryRequired<HTMLElement>("[data-clips-save-status]");
clipsEnabledInput.checked = isClipsConsentStored();
clipsEnabledInput.addEventListener("change", () => {
  setClipsEnabled(clipsEnabledInput.checked);
  emitClipsConsentChanged(clipsEnabledInput.checked);
  syncClipsChrome();
});

// ── In-match clips chrome (visible during world/practice/private) ────────
const matchChrome = queryRequired<HTMLElement>("[data-match-chrome]");
const matchClipsLabel = queryRequired<HTMLElement>("[data-match-clips-label]");
const matchClipsDot = queryRequired<HTMLElement>("[data-match-clips-dot]");
const pauseClipsStatus = queryRequired<HTMLElement>("[data-pause-clips-status]");
const pauseToggleClips = queryRequired<HTMLButtonElement>("[data-pause-toggle-clips]");

function applyClipsConsent(enabled: boolean): void {
  setClipsEnabled(enabled);
  clipsEnabledInput.checked = enabled;
  emitClipsConsentChanged(enabled);
  syncClipsChrome();
}

function requestSaveClipNow(): void {
  if (!isClipsEnabled()) {
    applyClipsConsent(true);
  }
  clipsSaveStatus.textContent =
    "Capturing… toast + library entry in ~3–12s (stay in Hot Lobby, tab focused).";
  emitClipSaveNow();
  // Brief status refresh after upload window
  window.setTimeout(() => syncClipsChrome(), 4_000);
  window.setTimeout(() => syncClipsChrome(), 14_000);
}

function syncClipsChrome(): void {
  const on = isClipsEnabled();
  const n = globalClipSession.list().length;
  clipsEnabledInput.checked = isClipsConsentStored();
  matchClipsDot.classList.toggle("is-on", on);
  matchClipsLabel.textContent = on
    ? n > 0
      ? `Clips · ${n}`
      : "Clips on"
    : "Clips off";
  pauseClipsStatus.textContent = on
    ? n > 0
      ? `Clips: on · ${n} this session`
      : "Clips: on · Save clip now, or multi-kill / parry / chain auto"
    : "Clips: off · enable or Save clip now (turns on)";
  pauseToggleClips.textContent = on ? "Disable auto-clips" : "Enable auto-clips";
  if (n > 0) {
    clipsSaveStatus.textContent = `${n} clip file(s) this session — Watch / Copy / Share below.`;
  } else if (on) {
    clipsSaveStatus.textContent =
      "Auto: multi-kill / parry / chain · or Save clip now in Hot Lobby.";
  } else {
    clipsSaveStatus.textContent =
      "Clips off. Save clip now turns them on and captures the current moment.";
  }
}

function showMatchChrome(show: boolean): void {
  matchChrome.hidden = !show;
  if (show) syncClipsChrome();
}

queryRequired<HTMLButtonElement>("[data-match-menu]").addEventListener("click", () => {
  shell.goto("pause");
  syncClipsChrome();
});

queryRequired<HTMLButtonElement>("[data-match-clips]").addEventListener("click", () => {
  if (!isClipsEnabled()) {
    // One-tap enable from match chrome (tap = explicit consent) + hot-start recorder
    applyClipsConsent(true);
  }
  shell.goto("clips");
  shell.refreshClipsList();
  syncClipsChrome();
});

pauseToggleClips.addEventListener("click", () => {
  applyClipsConsent(!isClipsConsentStored());
});

queryRequired<HTMLButtonElement>("[data-clips-save-now]").addEventListener("click", () => {
  requestSaveClipNow();
});

queryRequired<HTMLButtonElement>("[data-pause-save-clip]").addEventListener("click", () => {
  requestSaveClipNow();
  shell.goto("clips");
});

// Keep chrome in sync with shell match mode
window.addEventListener(ShellEvents.MATCH_STARTED, () => {
  showMatchChrome(true);
  syncClipsChrome();
});
window.addEventListener(ShellEvents.MATCH_ENDED, () => {
  showMatchChrome(false);
});
window.addEventListener(ShellEvents.CLIP_UPLOADED, () => {
  syncClipsChrome();
});
// leaveMatchToHome hides chrome when returning home (defined below).

splash.addEventListener("pointerdown", () => startMenuMusic(), { once: true });

// Soundtrack autoplay is blocked until a user gesture. The splash handler
// above covers the menu path, but the primary entry is now the `?world=1`
// share link, which hides the splash immediately and never fires it. So
// arm a GLOBAL one-time gesture starter: the player's first click or key
// anywhere (including their first move/shoot in-world) starts the song.
// No-op if already playing or muted.
function armSoundtrackOnFirstGesture(): void {
  const start = () => {
    // Play whichever track the current context wants — a bare `?world=1`
    // auto-join has already flipped the context to "world" by now.
    playCurrentMusic();
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };
  window.addEventListener("pointerdown", start);
  window.addEventListener("keydown", start);
}
armSoundtrackOnFirstGesture();

window.addEventListener("jakesjam:start-match", (event) => {
  const matchEvent = event as CustomEvent<{
    mode?: string;
    matchId?: string;
    matchToken?: string;
    localPlayerId?: string;
  }>;
  startWorldMusic();
  const detailMode = matchEvent.detail?.mode;
  const matchMode =
    detailMode === "practice"
      ? "practice"
      : detailMode === "world"
        ? "world"
        : matchEvent.detail?.matchId
          ? "private"
          : "private";
  emitMatchStarted(matchMode);
  game.scene.stop(SceneKeys.MainMenu);
  // Private rooms always use OnlineMatch + server token (no Convex).
  if (matchEvent.detail?.matchId && matchEvent.detail?.matchToken) {
    game.scene.start(SceneKeys.OnlineMatch, {
      mode: "private",
      matchId: matchEvent.detail.matchId,
      matchToken: matchEvent.detail.matchToken,
      localPlayerId: matchEvent.detail.localPlayerId ?? localPlayerId(),
    });
    return;
  }
  // Legacy Convex private path (opt-in ?netcode=new)
  if (shouldUseNewNetcode() && matchEvent.detail?.matchId) {
    game.scene.start(SceneKeys.OnlineMatch, {
      matchId: matchEvent.detail.matchId,
      localPlayerId: matchEvent.detail.localPlayerId,
      convexUrl:
        import.meta.env.VITE_CONVEX_URL ??
        import.meta.env.CONVEX_URL ??
        "",
    });
    return;
  }
  game.scene.start(SceneKeys.Match, matchEvent.detail);
});

function shouldUseNewNetcode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("netcode") === "new";
}

const PLAYER_ID_KEY_FALLBACK = "jakesjam.playerId";
const SESSION_SUFFIX_KEY = "jakesjam.sessionSuffix";

/**
 * Per-TAB player id. Combines a stable localStorage base (so a single
 * tab keeps the same id across reloads — reconnect grace works) with a
 * sessionStorage suffix that's unique per tab. Two tabs of the same
 * browser get DIFFERENT effective ids and can therefore both join the
 * same world/room without one kicking the other.
 *
 * The server treats the combined string as opaque, so the suffix
 * effectively makes each tab a distinct player from the host's
 * perspective.
 */
function localPlayerId(): string {
  let base = localStorage.getItem(PLAYER_ID_KEY_FALLBACK);
  if (!base) {
    base = `player_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PLAYER_ID_KEY_FALLBACK, base);
  }
  let suffix = sessionStorage.getItem(SESSION_SUFFIX_KEY);
  if (!suffix) {
    suffix = Math.random().toString(36).slice(2, 6);
    sessionStorage.setItem(SESSION_SUFFIX_KEY, suffix);
  }
  return `${base}_${suffix}`;
}

/**
 * Hot Lobby (product name) — io-style direct join into the always-on
 * singleton WorldHost. Internal mode remains `"world"` / `?world=1` /
 * `/world-token` so deep links and server routes stay stable.
 */
/**
 * Go fullscreen on touch devices when entering a match. Android Chrome
 * supports the Fullscreen API from a user gesture (joinWorld is always
 * gesture-initiated from a button/tap path); iPhone Safari doesn't — there
 * the PWA install is the fullscreen story. No-ops silently on desktop,
 * already-fullscreen, and standalone/installed contexts.
 */
function requestGameFullscreen(): void {
  try {
    const touch = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    if (!touch || standalone || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  } catch {
    // Fullscreen denied/unsupported — the browser chrome stays; not fatal.
  }
}

// ── Fullscreen toggle — all modes, all devices ─────────────────────────
// A small persistent control (plus the auto-enter on touch join). Enter
// AND exit both work everywhere the Fullscreen API exists; on iPhone
// Safari (no API) the button hides itself — PWA install is that story.
function installFullscreenToggle(): void {
  const el = document.documentElement;
  const supported = Boolean(
    el.requestFullscreen ??
      (el as HTMLElement & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen,
  );
  if (!supported) return;
  const btn = document.createElement("button");
  btn.className = "fs-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "Toggle fullscreen");
  const paint = (): void => {
    btn.textContent = document.fullscreenElement ? "⤢" : "⛶";
    btn.title = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  };
  paint();
  btn.addEventListener("click", () => {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      } else {
        void el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
      }
    } catch {
      // Denied — leave the browser chrome alone.
    }
  });
  document.addEventListener("fullscreenchange", paint);
  document.body.appendChild(btn);
}
installFullscreenToggle();

// ── Announcer (Jake's voice; no-ops until files are recorded) ─────────
{
  const stored = Number(localStorage.getItem("jakesjam.musicVolume") ?? "65");
  setAnnouncerVolume(stored / 100);
  // The lore diatribe: once per session, from the title screen, on the
  // first gesture (autoplay policy needs one). Joining silences it.
  let loreStarted = false;
  window.addEventListener(
    "pointerdown",
    () => {
      const splashVisible = !document.querySelector("[data-splash]")?.closest("[hidden]");
      if (!loreStarted && splashVisible && !new URLSearchParams(location.search).has("world")) {
        loreStarted = true;
        announce("lore-intro");
      }
    },
    { once: true },
  );
}

function joinWorld(): void {
  // Soundtrack for Hot Lobby. Plays immediately if a gesture already
  // happened (e.g. the click that hit "Hot Lobby"); for bare `?world=1`
  // the global first-gesture starter picks up the first in-match input.
  startWorldMusic();
  silenceAnnouncer(); // cut the diatribe if it's mid-flight
  announce("welcome");
  requestGameFullscreen();
  // Bare `?world=1` auto-joins with no gesture (fullscreen rejects) — the
  // first in-match touch retries once.
  window.addEventListener("pointerdown", () => requestGameFullscreen(), {
    once: true,
    capture: true,
  });
  emitMatchStarted("world");
  game.scene.stop(SceneKeys.MainMenu); // see start-match handler note
  document.title = "JAKESJAM — Hot Lobby";
  game.scene.start(SceneKeys.OnlineMatch, {
    mode: "world",
    localPlayerId: localPlayerId(),
  });
}

function leaveMatchToHome(): void {
  if (game.scene.isActive(SceneKeys.Match)) {
    game.scene.stop(SceneKeys.Match);
  }
  if (game.scene.isActive(SceneKeys.OnlineMatch)) {
    game.scene.stop(SceneKeys.OnlineMatch);
  }
  if (!game.scene.isActive(SceneKeys.MainMenu)) {
    game.scene.start(SceneKeys.MainMenu);
  }
  document.title = "JAKESJAM";
  shell.setMatchMode("none");
  shell.goto("home");
  showMatchChrome(false);
  startMenuMusic();
}

// Auto-join Hot Lobby when the URL says so (`?world=1` / `/world`).
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("replay")) {
  // Replay playback / offline render (ReplayScene) — no netcode, no lobby.
  shell.goto("home");
  document.title = "JAKESJAM — Replay";
  setTimeout(() => {
    game.scene.stop(SceneKeys.MainMenu);
    game.scene.start(SceneKeys.Replay);
  }, 0);
} else if (urlParams.get("world") === "1" || window.location.pathname === "/world") {
  // Defer one tick so Phaser has a chance to register the scene.
  setTimeout(() => joinWorld(), 0);
} else if (urlParams.get("room") || urlParams.get("code")) {
  // Shared room link → open lobby and auto-join the room (idempotent on server).
  shell.goto("room");
  setTimeout(() => lobbyController.autoJoinFromUrl(), 0);
}

// Back-to-splash button in the lobby panel → shell home.
window.addEventListener("jakesjam:back-to-splash", () => {
  shell.goto("home");
  startMenuMusic();
});

// Tab title reflects which room the player is in (item 9).
window.addEventListener("jakesjam:room-joined", (event) => {
  const code = (event as CustomEvent<{ code: string }>).detail.code;
  document.title = `JAKESJAM — Lobby ${code}`;
});

window.addEventListener("jakesjam:room-left", () => {
  document.title = "JAKESJAM";
});

window.addEventListener("jakesjam:chaos-change", (event) => {
  const matchEvent = event as CustomEvent;
  game.scene.start(SceneKeys.MainMenu, matchEvent.detail);
});

// Fired by MatchScene's results overlay when the player picks "Back to
// Lobby" after a match.
window.addEventListener("jakesjam:return-to-lobby", () => {
  leaveMatchToHome();
});

window.addEventListener(ShellEvents.REQUEST_LEAVE_MATCH, () => {
  leaveMatchToHome();
});

window.addEventListener("beforeunload", () => {
  worldStatusBadge.destroy();
  lobbyController.destroy();
  shell.destroy();
  game.destroy(true);
});

function queryRequired<T extends HTMLElement>(selector: string): T {
  const element = app?.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

function restoreOptions() {
  musicVolumeInput.value = localStorage.getItem("jakesjam.musicVolume") ?? "65";
  musicMutedInput.checked = localStorage.getItem("jakesjam.musicMuted") === "true";
  applyAudioOptions();
}

function musicVol(): number {
  return Number(musicVolumeInput.value) / 100;
}

/** RAF volume ramp on an Audio element; pauses it when it reaches silence.
 *  Cancels any in-flight fade on the same element so transitions don't fight. */
function fadeMusic(el: HTMLAudioElement, to: number, ms: number): void {
  const prev = musicFades.get(el);
  if (prev !== undefined) cancelAnimationFrame(prev);
  const from = el.volume;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) {
      musicFades.set(el, requestAnimationFrame(tick));
    } else {
      musicFades.delete(el);
      if (to <= 0.001) el.pause();
    }
  };
  musicFades.set(el, requestAnimationFrame(tick));
}

function applyAudioOptions() {
  const muted = musicMutedInput.checked;
  menuMusic.muted = muted;
  worldMusic.muted = muted;
  // Live slider: jump the ACTIVE track to the new level (unless it's mid-fade,
  // where the fade already targets the current level).
  const active = musicContext === "world" ? worldMusic : menuMusic;
  if (!musicFades.has(active)) active.volume = musicVol();
}

function playCurrentMusic() {
  // Every music start traces back to a user gesture (splash click, menu
  // button, etc.) — this is the one choke point they all go through, so
  // it's the safe place to resume the AudioContext the bass filter lives
  // in (browsers create it suspended until a gesture happens). Resuming an
  // already-running context is a harmless no-op.
  void audioCtx.resume();
  // Arm mic for gnostic geometry (same gesture). Failures are silent.
  if (isVoiceWanted()) {
    void startVoiceReactive(audioCtx);
  }
  const requestedContext = musicContext;
  const active = requestedContext === "world" ? worldMusic : menuMusic;
  const other = requestedContext === "world" ? menuMusic : worldMusic;
  // Already settled on this exact context — see musicStartedForContext's
  // doc comment. Only skip once the track is actually audibly running
  // (not just non-paused): if an earlier attempt is still stuck mid-way
  // (autoplay block, slow promise), let this call retry for real rather
  // than silently no-op forever.
  if (musicStartedForContext === requestedContext && !active.paused) {
    return;
  }
  musicStartedForContext = requestedContext;
  menuMusic.muted = musicMutedInput.checked;
  worldMusic.muted = musicMutedInput.checked;
  // Crossfade: bring the active track up from wherever it is, fade the other
  // out (and pause it at the end).
  if (active.paused) active.volume = 0;
  void active
    .play()
    .then(() => {
      // The context can flip again before this promise resolves (Practice's
      // launch flow calls startMenuMusic() then startWorldMusic() almost
      // back-to-back) — fading this element UP after it's no longer the
      // active track is exactly how two tracks end up audible at once.
      if (musicContext === requestedContext) {
        fadeMusic(active, musicVol(), CROSSFADE_MS);
      }
    })
    .catch(() => undefined);
  if (!other.paused) fadeMusic(other, 0, CROSSFADE_MS);
}

function startMenuMusic() {
  musicContext = "menu";
  playCurrentMusic();
}

function startWorldMusic() {
  musicContext = "world";
  playCurrentMusic();
}

function getAudioUrl(file: string): string {
  const assetBase = window.__JAKESJAM_ASSET_BASE__;
  if (assetBase) {
    return new URL(`audio/${file}`, assetBase).toString();
  }
  if (window.location.protocol === "file:") {
    return new URL(`./audio/${file}`, window.location.href).toString();
  }
  return `${window.location.origin}/audio/${file}`;
}
