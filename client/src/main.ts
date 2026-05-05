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
        <button data-options-back type="button">Back</button>
      </section>
    </div>
  </section>
  <main class="app-shell">
    <div id="game-root" class="game-root"></div>
    <aside class="lobby-panel" data-lobby-panel aria-label="Room controls">
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
`;

const game = new Phaser.Game(gameConfig);
// Diagnostic: expose the Phaser game on window so e2e specs can walk
// the scene's display list to find render-time leaks. No production
// behaviour depends on this — pure introspection hook.
(globalThis as { __jakesjam_game__?: Phaser.Game }).__jakesjam_game__ = game;
const lobbyController = new LobbyController(app);
const splash = queryRequired<HTMLElement>("[data-splash]");
const lobbyPanel = queryRequired<HTMLElement>("[data-lobby-panel]");
const optionsPanel = queryRequired<HTMLElement>("[data-options]");
const musicVolumeInput = queryRequired<HTMLInputElement>("[data-music-volume]");
const musicMutedInput = queryRequired<HTMLInputElement>("[data-music-muted]");
const menuMusic = new Audio(getMenuMusicUrl());

menuMusic.loop = true;
menuMusic.preload = "auto";
restoreOptions();

queryRequired<HTMLButtonElement>("[data-menu-world]").addEventListener("click", () => {
  startMenuMusic();
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
    startMenuMusic();
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

splash.addEventListener("pointerdown", () => startMenuMusic(), { once: true });

window.addEventListener("jakesjam:start-match", (event) => {
  const matchEvent = event as CustomEvent;
  stopMenuMusic();
  hideSplash();
  hideLobby();
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
  hideSplash();
  hideLobby();
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

function applyAudioOptions() {
  menuMusic.volume = Number(musicVolumeInput.value) / 100;
  menuMusic.muted = musicMutedInput.checked;
}

function startMenuMusic() {
  applyAudioOptions();
  void menuMusic.play().catch(() => undefined);
}

function stopMenuMusic() {
  menuMusic.pause();
  menuMusic.currentTime = 0;
}

function getMenuMusicUrl(): string {
  const assetBase = window.__JAKESJAM_ASSET_BASE__;
  if (assetBase) {
    return new URL("audio/menu-music.wav", assetBase).toString();
  }

  if (window.location.protocol === "file:") {
    return new URL("./audio/menu-music.wav", window.location.href).toString();
  }

  return `${window.location.origin}/audio/menu-music.wav`;
}
