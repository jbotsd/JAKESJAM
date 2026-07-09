import Phaser from "phaser";
import "./style.css";
import { gameConfig } from "./game/GameConfig";
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
import { isClipsConsentStored, setClipsEnabled } from "./game/highlights/clipConsent";
import {
  applyWasmWorldFlag,
  applyWasmWorldStepFullSync,
  applyWasmWorldStepSync,
  isWasmWorldReady,
  preloadWasmWorldSim,
  setWorldStatics as setWorldStaticsImport,
} from "./sim/wasm/worldWasmBackend";

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

app.innerHTML = `
  <section class="splash-screen" data-splash>
    <div class="splash-stage">
      <p class="splash-kicker">BOXWORKS ONLINE</p>
      <h1>JAKESJAM</h1>
      <p class="splash-copy">Practice solo, create a room, or jump into one with a code.</p>
      <div class="splash-actions">
        <button data-menu-world type="button" class="primary">Join World</button>
        <button data-menu-practice type="button">Practice</button>
        <button data-menu-host type="button">Create Room</button>
        <button data-menu-join type="button">Join Room</button>
        <button data-menu-options type="button">Options</button>
      </div>
      <div class="splash-status-slot" data-world-status></div>
      <section class="options-panel" data-options hidden>
        <h2>Options</h2>
        <label>
          Music Volume
          <input data-music-volume type="range" min="0" max="100" value="65" />
        </label>
        <label class="option-check">
          <input data-music-muted type="checkbox" />
          Mute Music
        </label>
        <label class="option-check">
          <input data-clips-enabled type="checkbox" />
          🎬 Auto-clip my highlights (records your play, share-ready vertical video)
        </label>
        <button data-options-back type="button">Back</button>
      </section>
    </div>
  </section>
  <main class="app-shell">
    <div id="game-root" class="game-root"></div>
    <aside class="lobby-panel lobby-panel--hidden" data-lobby-panel aria-label="Room controls">
      <div class="brand-row">
        <div>
          <h1>JAKESJAM</h1>
          <p class="status-line" data-status>Booting client...</p>
        </div>
        <span class="build-tag">M9</span>
      </div>

      <form class="player-form" data-player-form>
        <label>
          Name
          <input data-player-name maxlength="24" autocomplete="nickname" />
        </label>
        <label>
          Colour
          <input data-player-color type="color" value="#50e3c2" />
        </label>
        <label>
          Character
          <select data-player-character>
            <option value="balanced">Balanced</option>
            <option value="heavy">Heavy</option>
            <option value="sprinter">Sprinter</option>
            <option value="shielded">Shielded</option>
          </select>
        </label>
      </form>

      <div class="room-actions" data-room-actions>
        <button data-practice type="button">Practice</button>
        <button data-create-room type="button">Create Room</button>
        <button data-back-to-splash type="button" class="btn-ghost">← Splash</button>
      </div>

      <section class="player-connect" data-player-connect>
        <h2>Join Room</h2>
        <div class="join-row">
          <input data-room-code maxlength="6" placeholder="ROOM CODE" aria-label="Room code" />
          <button data-join-room type="button">Join</button>
        </div>
      </section>

      <section class="active-room" data-active-room hidden>
        <div class="room-code-row">
          <span>Room</span>
          <strong data-active-code>------</strong>
          <button data-room-share type="button" class="room-share-btn">Copy link</button>
        </div>
        <div class="room-status-slot" data-room-status></div>
        <button data-ready-toggle type="button">Ready</button>
        <button data-start-match type="button">Start Match</button>
        <button data-leave-room type="button" class="btn-danger">Leave Room</button>
      </section>

      <section class="map-picker-box" data-map-picker aria-label="Map selection"></section>

      <section class="chaos-box" aria-label="Party modifiers">
        <h2>Chaos</h2>
        <label><input data-chaos-modifier type="checkbox" value="low-gravity" /> Low Grav</label>
        <label><input data-chaos-modifier type="checkbox" value="slow-motion" /> Slo Mo</label>
        <label><input data-chaos-modifier type="checkbox" value="golden-gun" /> Golden Gun</label>
        <label><input data-chaos-modifier type="checkbox" value="slappers-only" /> Slappers Only</label>
        <label><input data-chaos-modifier type="checkbox" value="fire-hazard" /> Fire Hazard</label>
        <label><input data-chaos-modifier type="checkbox" value="random-shapes" /> Random Shapes</label>
        <label><input data-chaos-modifier type="checkbox" value="max-recoil" /> Max Recoil</label>
      </section>

      <section class="players-box" aria-label="Players in room">
        <h2>Players</h2>
        <ul data-player-list></ul>
      </section>
    </aside>
  </main>
  <div class="orientation-hint" data-orientation-hint aria-hidden="true">
    <div class="rotate-icon">📱</div>
    <h2>Hold your phone upright</h2>
    <p>JAKESJAM is built for portrait.</p>
    <p class="orientation-hint-dismiss">tap to play sideways anyway</p>
  </div>
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

const game = new Phaser.Game(gameConfig);
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

// Mobile is PORTRAIT-first (game on top, controls in a bottom band). Nudge to
// rotate upright when a touch device is held sideways. Purely a hint.
const orientationHint = app.querySelector<HTMLElement>("[data-orientation-hint]");
function isTouchDevice(): boolean {
  return (
    (navigator.maxTouchPoints ?? 0) > 0 &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
// The hint is dismissible: it's a full-screen opaque overlay, so without a
// dismiss it doesn't "nudge" — it hard-blocks landscape play entirely.
// Dismissing sticks for the whole session (the player has made their choice).
let orientationHintDismissed = false;
function updateOrientationHint(): void {
  if (!orientationHint) return;
  const landscape = window.innerWidth > window.innerHeight;
  orientationHint.classList.toggle(
    "show",
    isTouchDevice() && landscape && !orientationHintDismissed,
  );
}
orientationHint?.addEventListener("pointerdown", () => {
  orientationHintDismissed = true;
  updateOrientationHint();
});
updateOrientationHint();
window.addEventListener("resize", updateOrientationHint);
window.addEventListener("orientationchange", updateOrientationHint);

// Kill the mobile browser chrome ("massive banner") on first tap: request
// fullscreen + lock portrait. Best-effort, once, touch devices only.
if (isTouchDevice()) {
  const goFullscreen = () => {
    void import("./game/input/mobile").then((m) => m.enterFullscreenPortrait());
    window.removeEventListener("pointerdown", goFullscreen);
  };
  window.addEventListener("pointerdown", goFullscreen);
}

const lobbyController = new LobbyController(app);
const splash = queryRequired<HTMLElement>("[data-splash]");
const lobbyPanel = queryRequired<HTMLElement>("[data-lobby-panel]");
const optionsPanel = queryRequired<HTMLElement>("[data-options]");
const musicVolumeInput = queryRequired<HTMLInputElement>("[data-music-volume]");
const musicMutedInput = queryRequired<HTMLInputElement>("[data-music-muted]");
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
// Graph: element → bass shelf → swell gain → limiter → out.
audioCtx
  .createMediaElementSource(worldMusic)
  .connect(worldBassFilter)
  .connect(worldSwellGain)
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
function tickMusicIntensity() {
  const k = targetIntensity > smoothedIntensity ? INTENSITY_ATTACK : INTENSITY_RELEASE;
  smoothedIntensity += (targetIntensity - smoothedIntensity) * k;
  // Tempo is deliberately never touched — the element stays at its natural
  // 1.0 playbackRate.
  if (musicContext === "world" && !worldMusic.paused) {
    worldBassFilter.gain.value = smoothedIntensity * MAX_BASS_GAIN_DB;
    worldSwellGain.gain.value = REST_SWELL + smoothedIntensity * (PEAK_SWELL - REST_SWELL);
  } else {
    worldBassFilter.gain.value = 0;
    worldSwellGain.gain.value = REST_SWELL;
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
  title: "Live World",
  shareUrl: worldShareUrl,
  fetchSummary: () => fetchWorldSummary(),
  onJoin: () => {
    joinWorld();
    worldStatusBadge.refresh();
  },
});

queryRequired<HTMLButtonElement>("[data-menu-practice]").addEventListener("click", () => {
  startMenuMusic();
  hideSplash();
  hideLobby();
  lobbyController.startPracticeFromMenu();
});

queryRequired<HTMLButtonElement>("[data-menu-host]").addEventListener("click", () => {
  startMenuMusic();
  hideSplash();
  showLobby();
  lobbyController.focusCreateRoom();
});

queryRequired<HTMLButtonElement>("[data-menu-join]").addEventListener("click", () => {
  startMenuMusic();
  hideSplash();
  showLobby();
  lobbyController.focusJoinRoom();
});

queryRequired<HTMLButtonElement>("[data-menu-options]").addEventListener("click", () => {
  startMenuMusic();
  optionsPanel.hidden = false;
});

queryRequired<HTMLButtonElement>("[data-options-back]").addEventListener("click", () => {
  optionsPanel.hidden = true;
});

musicVolumeInput.addEventListener("input", () => {
  localStorage.setItem("jakesjam.musicVolume", musicVolumeInput.value);
  applyAudioOptions();
});

musicMutedInput.addEventListener("change", () => {
  localStorage.setItem("jakesjam.musicMuted", JSON.stringify(musicMutedInput.checked));
  applyAudioOptions();
});

// Highlight-clip consent toggle (see game/highlights/clipConsent.ts —
// capture NEVER activates without this or the ?clips=1 dev override).
// Takes effect on the next world join; no live re-wiring needed since
// OnlineMatchScene reads consent once in create().
const clipsEnabledInput = queryRequired<HTMLInputElement>("[data-clips-enabled]");
clipsEnabledInput.checked = isClipsConsentStored();
clipsEnabledInput.addEventListener("change", () => {
  setClipsEnabled(clipsEnabledInput.checked);
});

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
  const matchEvent = event as CustomEvent;
  // Keep the soundtrack running INTO the match — it's the game's only
  // music, and cutting it on match start is what made the song "stop"
  // once world/room play became the main flow. It still respects the
  // mute toggle and volume slider via applyAudioOptions().
  startWorldMusic();
  hideSplash();
  hideLobby();
  // game.scene.start() does NOT stop other running scenes (unlike a
  // scene-local this.scene.start), so the menu scene kept rendering its
  // footer text ("Practice starts locally...") under the match.
  game.scene.stop(SceneKeys.MainMenu);
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
 * io-style direct join: skip lobby + Convex matchmaker, go straight
 * into the singleton WorldHost. Token mint hits the bun server's
 * `/world-token` endpoint. Reachable via the splash "Join World"
 * button or the URL query `?world=1` (auto-fired below).
 */
function joinWorld(): void {
  // Start the soundtrack for the world (the main entry path). Plays
  // immediately if a gesture already happened (e.g. the click that hit
  // "Join World"); for a bare `?world=1` auto-join the global first-gesture
  // starter picks up the player's first in-world input.
  startWorldMusic();
  hideSplash();
  hideLobby();
  game.scene.stop(SceneKeys.MainMenu); // see start-match handler note
  document.title = "JAKESJAM — In World";
  game.scene.start(SceneKeys.OnlineMatch, {
    mode: "world",
    localPlayerId: localPlayerId(),
  });
}

// Auto-join the world when the URL says so. Useful for "open this
// link to spawn into the live game" sharing.
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("world") === "1" || window.location.pathname === "/world") {
  // Defer one tick so Phaser has a chance to register the scene.
  setTimeout(() => joinWorld(), 0);
} else if (urlParams.get("room") || urlParams.get("code")) {
  // Shared room link → open lobby and auto-join the room (idempotent on server).
  hideSplash();
  showLobby();
  setTimeout(() => lobbyController.autoJoinFromUrl(), 0);
}

// Back-to-splash button in the lobby panel.
window.addEventListener("jakesjam:back-to-splash", () => {
  showSplash();
  hideLobby();
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
// Lobby" after a match. We stop the match scene, surface the splash, and
// re-bind the menu music. The lobby controller keeps its own state, so the
// player lands back on the same room/character/chaos config they started
// from.
window.addEventListener("jakesjam:return-to-lobby", () => {
  if (game.scene.isActive(SceneKeys.Match)) {
    game.scene.stop(SceneKeys.Match);
  }
  if (game.scene.isActive(SceneKeys.OnlineMatch)) {
    game.scene.stop(SceneKeys.OnlineMatch);
  }
  // Match-start paths stop the menu scene (it kept rendering its footer
  // under matches); bring it back with the splash.
  if (!game.scene.isActive(SceneKeys.MainMenu)) {
    game.scene.start(SceneKeys.MainMenu);
  }
  document.title = "JAKESJAM";
  showSplash();
  showLobby();
  startMenuMusic();
});

window.addEventListener("beforeunload", () => {
  worldStatusBadge.destroy();
  lobbyController.destroy();
  game.destroy(true);
});

function queryRequired<T extends HTMLElement>(selector: string): T {
  const element = app?.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

function hideSplash() {
  splash.hidden = true;
}

function showSplash() {
  splash.hidden = false;
}

function hideLobby() {
  lobbyPanel.classList.add("lobby-panel--hidden");
}

function showLobby() {
  lobbyPanel.classList.remove("lobby-panel--hidden");
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
