import Phaser from "phaser";
import "./style.css";
import { gameConfig } from "./game/GameConfig";
import { LobbyController } from "./game/ui/LobbyController";
import { SceneKeys } from "./game/scenes/SceneKeys";

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
        <button data-menu-practice type="button">Practice</button>
        <button data-menu-host type="button">Create Room</button>
        <button data-menu-join type="button">Join Room</button>
        <button data-menu-options type="button">Options</button>
      </div>
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

      <div class="room-actions">
        <button data-practice type="button">Practice</button>
        <button data-create-room type="button">Create Room</button>
      </div>

      <section class="player-connect">
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
        </div>
        <button data-ready-toggle type="button">Ready</button>
        <button data-start-match type="button">Start Match</button>
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
  showSplash();
  showLobby();
  startMenuMusic();
});

window.addEventListener("beforeunload", () => {
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
