import Phaser from "phaser";
import "./style.css";
import { gameConfig } from "./game/GameConfig";
import { LobbyController } from "./game/ui/LobbyController";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root element.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="play-surface" aria-label="Game preview">
      <div id="game-root" class="game-root"></div>
    </section>

    <aside class="lobby-panel" aria-label="Room controls">
      <div class="brand-row">
        <div>
          <h1>JAKESJAM</h1>
          <p class="status-line" data-status>Booting client...</p>
        </div>
        <span class="build-tag">M9</span>
      </div>

      <section class="role-box" aria-label="Client mode">
        <h2>Client</h2>
        <label><input data-client-role type="radio" name="client-role" value="host" /> Host</label>
        <label><input data-client-role type="radio" name="client-role" value="player" /> Player</label>
      </section>

      <form class="player-form" data-player-form>
        <label>
          Name
          <input data-player-name maxlength="24" autocomplete="nickname" />
        </label>
        <label>
          Colour
          <input data-player-color type="color" value="#50e3c2" />
        </label>
        <label data-character-field>
          Character
          <select data-player-character>
            <option value="balanced">Balanced</option>
            <option value="heavy">Heavy</option>
            <option value="sprinter">Sprinter</option>
            <option value="shielded">Shielded</option>
          </select>
        </label>
      </form>

      <section class="server-panel" data-server-panel>
        <h2>Host / Server Client</h2>
        <div class="join-address">
          <label>
            IP Address
            <input data-host-address readonly />
          </label>
          <label>
            Port
            <input data-host-port readonly />
          </label>
        </div>
      </section>

      <div class="room-actions" data-host-actions>
        <button data-practice type="button">Practice</button>
        <button data-create-room type="button">Host Game</button>
      </div>

      <section class="player-connect" data-player-connect>
        <h2>Join Server</h2>
        <div class="join-row">
          <input data-join-host placeholder="IP ADDRESS" aria-label="Host IP address" />
          <input data-join-port placeholder="PORT" aria-label="Host port" />
        </div>
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

      <section class="chaos-box" data-host-settings aria-label="Party modifiers">
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

window.addEventListener("jakesjam:start-match", (event) => {
  const matchEvent = event as CustomEvent;
  game.scene.start("MatchScene", matchEvent.detail);
});

window.addEventListener("jakesjam:chaos-change", (event) => {
  const matchEvent = event as CustomEvent;
  game.scene.start("MainMenuScene", matchEvent.detail);
});

window.addEventListener("beforeunload", () => {
  lobbyController.destroy();
  game.destroy(true);
});
