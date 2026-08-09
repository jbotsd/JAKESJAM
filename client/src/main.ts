import Phaser from "phaser";
import "./style.css";
import { buildGameConfig } from "./game/GameConfig";
import { installRenderResolution, getRenderScale } from "./game/render/renderResolution";
import { attachGlobalRenderGovernor } from "./game/render/renderGovernor";
import {
  getQualityProfile,
  isTouchMobile,
  probeRendererString,
  setQualityTier,
  type QualityTier,
} from "./game/render/qualityProfile";
import { crumb, installTelemetry, watchContextLoss } from "./telemetry";
import { installRendererRecovery } from "./shell/rendererRecovery";
import { announce, setAnnouncerVolume, silenceAnnouncer } from "./game/audio/AnnouncerSystem";
import { setSfxVolume01 } from "./game/audio/sfxVolume";
import { LobbyController } from "./game/ui/LobbyController";
import { loadPlayerStats, statLines } from "./shell/playerStats";
import { fetchVenueSummary } from "./net/worldClient";
import { sanitizePlayerName, stripDisallowedChars } from "./net/playerName";
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
import { installEmailGate } from "./shell/emailGate";
// Track P1 — the funnel instrument (docs: gospel-goal Track P).
import { funnel, initFunnel, flushWrongInputs } from "./shell/funnel";
// One source of naming — venue-goal Pillar 6.1.
import { VENUE_CTA, VENUE_TITLE, ARENA_TITLE } from "./venueNames";
// Doors 1.8 — one class presentation, shared with the venue station.
import { buildClassPicker } from "./game/ui/classPicker";
import { characters } from "./game/data/characters";
import { sanitizeCharacterId } from "./net/playerCharacter";
import {
  clearInMatch,
  resumableMatch,
  startResumeHeartbeat,
  type MatchPlace,
} from "./shell/matchResume";
import { installIdentShader, loadIdentStems, type IdentStems, type IdentStemName } from "./shell/identShader";
import { getAudioUrl } from "./game/audio/audioUrl";
import {
  emitClipSaveNow,
  emitClipsConsentChanged,
  emitMatchStarted,
  ShellEvents,
} from "./shell/events";
import { showClipShareToast } from "./game/ui/ClipShareToast";
import { globalClipSession } from "./shell/clipSession";
import {
  applyMusicMute,
  activeTrack,
  inactiveTracks,
  type MusicContext,
} from "./shell/musicMute";
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
// ?ui=instant — skip title-screen animations (dev/screenshot hook).
try {
  if (new URLSearchParams(window.location.search).get("ui") === "instant") {
    document.documentElement.classList.add("ui-instant");
  }
} catch { /* ignore */ }

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
      (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }).webkitRequestFullscreen?.bind(el);
    try {
      // requestFullscreen() returns a Promise — a bare try/catch around an
      // un-awaited call only catches SYNCHRONOUS throws, not the rejection
      // (e.g. a Permissions-Policy denial under --app=/kiosk launch flags),
      // which surfaces as an unhandled rejection instead. Every OTHER
      // fullscreen call site in this file already chains .catch(() => {})
      // (see requestGameFullscreen/installFullscreenToggle below) — this
      // one was the sole omission, confirmed by a live telemetry report
      // ("Permissions check failed", source: unhandledrejection).
      void req?.()?.catch?.(() => {});
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
    <!-- No autoplay (open-doors 0.4): autoplay forces the whole 4 MB
         fetch at boot, ahead of the bundle and the wasm sim, on every
         phone. The poster is the first paint; playback starts on the
         click-to-initiate gesture (startSplashVideo), which the gate
         requires anyway. -->
    <video
      class="splash-bg-video"
      src="/video/splash-loop.mp4"
      poster="/video/splash-poster.jpg"
      preload="metadata"
      muted
      loop
      playsinline
      aria-hidden="true"
    ></video>
    <div class="splash-crt" aria-hidden="true"></div>
    <div class="boot-gate" data-boot-gate>
      <img class="boot-gate-sigil" src="/img/seal-vessel.svg" alt="" />
      <p class="boot-gate-line">CLICK TO INITIATE</p>
    </div>
    <div class="boot-ident" data-boot-ident hidden aria-hidden="true">
      <div class="boot-ident-rays" data-ident-rays-glow></div>
      <canvas class="ident-shader" data-ident-shader aria-hidden="true"></canvas>
      <div class="ident-quake" data-ident-quake>
      <svg class="ident-seal" viewBox="0 0 1000 1000" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="liqGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8a6a2a" />
            <stop offset="45%" stop-color="#c9a84c" />
            <stop offset="52%" stop-color="#ffedb0" />
            <stop offset="60%" stop-color="#c9a84c" />
            <stop offset="100%" stop-color="#7a5c22" />
            <animateTransform attributeName="gradientTransform" type="rotate"
              from="0 0.5 0.5" to="360 0.5 0.5" dur="9s" repeatCount="indefinite" />
          </linearGradient>
          <linearGradient id="liqTeal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#2e8f7a" />
            <stop offset="48%" stop-color="#7fe8d8" />
            <stop offset="54%" stop-color="#d8fff6" />
            <stop offset="62%" stop-color="#50e3c2" />
            <stop offset="100%" stop-color="#2e8f7a" />
            <animateTransform attributeName="gradientTransform" type="rotate"
              from="360 0.5 0.5" to="0 0.5 0.5" dur="6s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        <g class="is-hebdomad">
          <circle class="is-h is-h1" cx="500" cy="500" r="95" />
          <circle class="is-h is-h2" cx="500" cy="500" r="128" />
          <circle class="is-h is-h3" cx="500" cy="500" r="160" />
          <circle class="is-h is-h4" cx="500" cy="500" r="196" />
          <circle class="is-h is-h5" cx="500" cy="500" r="238" />
          <circle class="is-h is-h6" cx="500" cy="500" r="286" />
          <circle class="is-h is-h7" cx="500" cy="500" r="340" />
        </g>
        <path class="is-boundary" d="M 545.9 11.6 A 490 490 0 1 1 454.1 11.6" />
        <line class="is-radius" x1="500" y1="500" x2="500" y2="10" />
        <circle class="is-dot" cx="500" cy="500" r="8" />
        <!-- THE CRYSTAL: large inscribed diamond (rotated square), vertices
             on the cardinal axes, inscribed exactly in the r=340 seventh
             ring — avionics/crystal-munitions read, drawn edge by edge in
             the same choreography slot the old centerpiece occupied.
             Owner's hard line (docs/IDENT-GRAMMAR.md): no eye-under/inside-
             triangle, no triangle over radial focal geometry, no hexagram. -->
        <polygon class="is-gem" points="500,160 840,500 500,840 160,500" />
        <circle class="is-gem-loop" cx="840" cy="500" r="16" />
        <g class="is-ticks" data-ident-ticks></g>
        <g class="is-vowels" data-ident-vowels></g>
        <g class="is-rays" data-ident-rays></g>
        <g class="is-diamonds">
          <polygon points="500,-8 520,12 500,32 480,12" />
          <polygon points="1008,480 1028,500 1008,520 988,500" />
          <polygon points="500,968 520,988 500,1008 480,988" />
          <polygon points="-8,480 12,500 -8,520 -28,500" />
        </g>
      </svg>
      <div class="ident-glow" data-ident-glow aria-hidden="true"></div>
      <div class="ident-pulse" data-ident-pulse aria-hidden="true"></div>
      <img class="ident-shimmer" data-ident-shimmer src="/img/seal-vessel.svg" alt="" aria-hidden="true" />
      <p class="ident-name">JAKESJAM</p>
      <img class="ident-ca ident-ca-r" src="/img/logo-jakesjam-gothic.png" alt="" aria-hidden="true" />
      <img class="ident-ca ident-ca-c" src="/img/logo-jakesjam-gothic.png" alt="" aria-hidden="true" />
      <img class="ident-logo" src="/img/logo-jakesjam-gothic.png" alt="" />
      <img class="ident-plate" src="/img/logo-intrepid-gothic.png" alt="" />
      </div>
      <p class="ident-skip-hint">press any key to skip</p>
      <div class="boot-ident-flash"></div>
      <div class="ident-bridge" data-ident-bridge aria-hidden="true"></div>
    </div>
    <div class="splash-stage">
      <p class="splash-kicker splash-kicker--studio">INTREPID DEVELOPMENT PRESENTS</p>
      <h1 class="splash-title">
        <img class="splash-logo" src="/img/logo-jakesjam-gothic.png" alt="JAKESJAM" />
      </h1>
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
        <button data-menu-world type="button" class="primary shell-cta-primary">Lobby</button>
      </div>
      <div class="splash-actions splash-actions--secondary">
        <button data-menu-practice type="button" class="shell-btn-secondary btn-inset-frame">Practice</button>
        <button data-menu-join type="button" class="shell-btn-secondary btn-inset-frame">Join room</button>
        <button data-menu-host type="button" class="shell-btn-secondary btn-inset-frame">Private room</button>
      </div>
      <div class="splash-actions splash-actions--ghost">
        <button data-menu-options type="button" class="shell-btn-quiet">Settings</button>
        <button data-menu-clips type="button" class="shell-btn-quiet">Clips</button>
        <button data-menu-forge type="button" class="shell-btn-quiet">Forge</button>
        <button data-menu-tutorial type="button" class="shell-btn-quiet">Showcase</button>
        <button data-menu-intro type="button" class="shell-btn-quiet">Intro</button>
        <button data-menu-credits type="button" class="shell-btn-quiet">Credits</button>
      </div>
      <!-- Community CTA: Fight Night organises on Discord (rounds get pinged
           there), so this sits with the menu rather than as chrome. Plain
           anchor — new tab, no JS wiring, works even if the bundle wedges. -->
      <div class="splash-actions splash-actions--community">
        <a
          class="shell-btn-discord"
          href="https://discord.gg/XrRgTsXWzJ"
          target="_blank"
          rel="noopener"
        >◆ DISCORD — FIGHT NIGHT HQ</a>
      </div>
      <!-- Player record (replaced the world status badge — Jake,
           2026-07-16: "remove this add player stats"). Rendered from
           shell/playerStats.ts on load + every return home. -->
      <div class="splash-stats" data-player-stats aria-label="Your record"></div>
      <button type="button" class="splash-cta-blink" data-splash-cta>
        ▶ ${VENUE_CTA} · FIGHT NIGHT EVERY FRIDAY ◀
      </button>
    </div>
  </section>
  <section class="shell-layer options-panel" data-options data-shell-settings hidden>
    <div class="shell-frame">
      <p class="shell-kicker">VESSEL</p>
      <h2>Settings</h2>
      <!-- Doors 1.8 — class selection ON THE MAIN PATH. The rich picker
           already existed at the venue loadout station, but reaching it
           meant walking to a totem; since 1.1 landed players in the venue
           by default and 1.6 can queue them for the bell on arrival, a
           player could fight forever as the default class without ever
           seeing it. Settings is two keystrokes from anywhere (Menu/Esc),
           so the choice now follows the player instead of sitting in one
           corner of one room. Same module, same persisted key, kept in
           step by the jakesjam:class-change event. -->
      <div class="shell-section">
        <h3>Class</h3>
        <div data-settings-character-picker></div>
        <p class="shell-hint">Your class picks your body, your kit and your ability catalog. Change it any time — it applies to your next bout.</p>
      </div>
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
        <label>
          Sound Effects Volume
          <input data-sfx-volume type="range" min="0" max="100" value="65" />
        </label>
        <label class="option-check">
          <input data-sfx-muted type="checkbox" />
          Mute Sound Effects
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
        Auto: multi-kill / parry-kill / chain · or tap Save clip now in the Arena.
      </p>
      <button data-clips-save-now type="button" class="primary shell-cta-primary">Save clip now</button>
      <div data-clips-list class="shell-clips-list"></div>
      <button data-clips-back type="button" class="shell-btn-secondary">Back</button>
    </div>
  </section>
  <section class="shell-layer credits-panel" data-shell-credits hidden>
    <div class="shell-frame credits-frame">
      <p class="shell-kicker">INTREPID DEVELOPMENT</p>
      <h2>Credits</h2>
      <div class="credits-scroll">
        <div class="credits-block">
          <h3>JAKESJAM</h3>
          <p class="credits-role">Senior Game Developer &amp; CTO — Peak Engineer</p>
          <p class="credits-name">Jake Colson</p>
          <p class="credits-role">Studio</p>
          <p class="credits-name">Intrepid Development</p>
        </div>
        <div class="credits-block">
          <h3>Origin</h3>
          <p class="credits-hint">
            Born at a game jam we hosted. The jam ended. The game refused to.
          </p>
        </div>
        <div class="credits-block">
          <h3>Game Development &amp; Engineering</h3>
          <p class="credits-name">Jay Huxtable</p>
          <p class="credits-role">
            <a href="https://www.oraclesound.com/" target="_blank" rel="noopener noreferrer" class="credits-link">Oracle Sound</a>
          </p>
        </div>
        <div class="credits-block">
          <h3>Testing</h3>
          <p class="credits-name">Ryan Kelly</p>
          <p class="credits-name">Jordie Grasso</p>
        </div>
        <div class="credits-block">
          <h3>Music</h3>
          <p class="credits-role">Original Score &amp; Sound</p>
          <p class="credits-name">BassRadian</p>
        </div>
        <div class="credits-block">
          <h3>Built With</h3>
          <p class="credits-hint">
            Zig &amp; WebAssembly (deterministic simulation) · Phaser 4 (render) ·
            Bun (server &amp; tooling) · Convex (rooms &amp; matchmaking) ·
            TypeScript throughout.
          </p>
        </div>
        <div class="credits-block">
          <h3>Special Thanks</h3>
          <p class="credits-hint">
            Every player who joined the Lobby before there was a reason to.
            The Order of Perpetual Respawn. You, right now, reading this.
          </p>
        </div>
        <div class="credits-block">
          <h3>Legal</h3>
          <p class="credits-role">
            <a href="/privacy" target="_blank" rel="noopener noreferrer" class="credits-link">Privacy Policy</a>
            &nbsp;·&nbsp;
            <a href="/terms" target="_blank" rel="noopener noreferrer" class="credits-link">Terms of Service</a>
          </p>
        </div>
        <div class="credits-block credits-seal-mark" aria-hidden="true">
          <img src="/img/seal-vessel.svg" alt="" />
        </div>
      </div>
      <button data-credits-back type="button" class="shell-btn-secondary">Back</button>
    </div>
  </section>
  <section class="shell-layer pause-panel" data-shell-pause hidden>
    <div class="shell-frame">
      <p class="shell-kicker">APERTURE</p>
      <h2>Paused</h2>
      <p class="shell-hint">The game keeps running without you.</p>
      <button data-pause-resume type="button" class="primary shell-cta-primary shell-pause-resume">Resume</button>
      <p class="shell-hint shell-pause-esc-hint">Esc resumes too</p>

      <div class="shell-section shell-section--pause">
        <h3 class="shell-section-title">Clips</h3>
        <p class="shell-hint" data-pause-clips-status>Clips: off</p>
        <div class="shell-pause-row">
          <button data-pause-toggle-clips type="button" class="shell-btn-secondary">Enable auto-clips</button>
          <button data-pause-save-clip type="button" class="shell-btn-secondary">Save now</button>
        </div>
        <button data-pause-clips type="button" class="shell-btn-secondary shell-btn-ghost">Clip library</button>
      </div>

      <div class="shell-pause-footer">
        <button data-pause-settings type="button" class="shell-btn-secondary shell-btn-ghost">Settings</button>
        <button data-pause-leave type="button" class="btn-danger shell-btn-ghost">Leave</button>
      </div>
      <!-- In-shell leave confirm (venue-goal Pillar 0.7): replaces the native
           browser confirm() — the only OS-chrome dialog in an otherwise fully
           art-directed shell. Hidden until Leave is clicked; axiom B4 keeps
           the destructive confirm spatially separated on its own row. -->
      <div class="shell-pause-leave-confirm" data-pause-leave-confirm hidden>
        <p class="shell-hint">Leave? It keeps running without you.</p>
        <div class="shell-pause-row">
          <button data-pause-leave-confirm-yes type="button" class="btn-danger">Leave</button>
          <button data-pause-leave-confirm-no type="button" class="shell-btn-secondary">Stay</button>
        </div>
      </div>
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
    <!-- Private room — full-viewport composition (Jake, 2026-07-16:
         "redesign from the ground up to maximise screen size"). Was a
         440px centered sausage floating in a void; now a three-column
         grid: IDENTITY (who you are) · ARENA (what you'll fight in —
         widest column, the map picker is the visual star) · SESSION
         (host/join/squad — the one Primary CTA lives here, axiom B1).
         Column wrappers are layout-only; every data-* hook
         LobbyController queries is untouched. Collapses back to the
         single-column flow under 1080px (axiom S5). -->
    <aside class="lobby-panel lobby-panel--hidden shell-room" data-lobby-panel data-shell-room aria-label="Private room">
      <div class="shell-frame shell-frame--room">
        <header class="room-head">
          <div>
            <p class="shell-kicker">PRIVATE CHANNEL</p>
            <h2>Private Room</h2>
          </div>
          <p class="status-line" data-status>Booting channel...</p>
        </header>

        <div class="room-col room-col--identity">
        <h3 class="shell-section-title">Identity</h3>
        <form class="player-form" data-player-form>
          <label>
            Callsign
            <input data-player-name maxlength="24" autocomplete="nickname" />
          </label>
          <label>
            Accent
            <input data-player-color type="color" value="#50e3c2" />
          </label>
          <!-- Doors 1.8 — ONE class presentation, on the main path. This
               was a bare <select> over the same four archetypes the venue
               loadout station rendered as rich tiles (sigil + locked
               persona name + true-today kit line): same choice, two visual
               languages, and the good one reachable only by walking to a
               totem most players never found. Since Doors 1.1 made the
               venue the default landing and 1.6 can queue you on arrival, a
               player can reach a fight without passing the station at all.
               LobbyController mounts the shared picker
               (game/ui/classPicker.ts) into this node. Still two views of
               ONE selection (localStorage jakesjam.playerCharacter), kept
               in step by the jakesjam:class-change event. (No backticks in
               here — this markup lives inside a template literal.) -->
          <div data-player-character-picker></div>
        </form>
        <!-- hidden practice hook for legacy LobbyController (practice is on HOME) -->
        <button data-practice type="button" hidden>Practice</button>
        </div>

        <div class="room-col room-col--session">
        <div class="room-actions" data-room-actions>
          <button data-create-room type="button" class="primary shell-cta-primary">Host private room</button>
          <button data-back-to-splash type="button" class="shell-btn-secondary">← Home</button>
        </div>

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
          <p class="shell-hint">Walk into the READY totem to ready up, LAUNCH to start — no buttons, just walk in.</p>
          <div class="shell-pause-actions">
            <button data-leave-room type="button" class="btn-danger">Leave</button>
          </div>
        </section>

        <section class="players-box" aria-label="Players in room">
          <h3 class="shell-section-title">Squad</h3>
          <ul data-player-list></ul>
        </section>
        </div>

        <div class="room-col room-col--arena">
        <section class="map-picker-box" data-map-picker aria-label="Map selection"></section>

        <section class="custom-map-box" aria-label="Custom map from Arena Forge">
          <label class="shell-hint" for="custom-map-code">Load custom map by code (from Arena Forge)</label>
          <div class="custom-map-row">
            <input
              id="custom-map-code"
              data-custom-map-code
              type="text"
              maxlength="6"
              placeholder="ABC123"
              autocomplete="off"
              spellcheck="false"
            />
            <button data-custom-map-load type="button" class="shell-btn-secondary">Load</button>
          </div>
        </section>

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
        </div>
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

// Installed before Phaser exists at all — see rendererRecovery.ts's own
// docblock. Must be listening before Phaser's first draw call, which can
// happen synchronously-adjacent to construction below.
installRendererRecovery();

const game = new Phaser.Game(buildGameConfig());
// Scale.NONE does no automatic window tracking — this owns it (backing
// store = CSS × renderScale; see game/render/renderResolution.ts).
installRenderResolution(game);
// Frame-time governor, game-wide — AFTER installRenderResolution so its
// ceiling reads the resolved boot scale. Covers every scene (lobby, menus,
// tutorial, replay), not just matches — see renderGovernor.ts.
attachGlobalRenderGovernor(game);

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
  // Track P1 — the funnel's origin. Everything downstream is measured as
  // elapsed ms from HERE, because every north-star gate is a "how long
  // until" question.
  initFunnel();
  funnel("page_load");
  game.events.once(Phaser.Core.Events.READY, () => {
    if (game.canvas) watchContextLoss(game.canvas);
    crumb("boot", `phaser ready rs=${getRenderScale()}`);
    // "playable" = Phaser is up and a canvas exists to receive input. Not
    // "assets finished" (they stream) and not "in a match" (that is the next
    // milestone) — this is the conversion-to-play denominator.
    funnel("playable");
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

// Right-click is the PRIMARY combat action (the dash-bash power-slide), so the
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

// Chosen callsign — persisted, sanitized, rides the world join. Character
// filtering happens live (every keystroke); the full sanitizePlayerName
// pass (length/reserved-word rejection) only runs at commit time — see
// net/playerName.ts for why those are split. The SERVER re-applies
// sanitizePlayerName independently and is the only authoritative pass;
// this is UX only.
const playerNameInput = app.querySelector<HTMLInputElement>("[data-player-name]");
if (playerNameInput) {
  playerNameInput.value = localStorage.getItem("jakesjam.playerName") ?? "";
  playerNameInput.addEventListener("input", () => {
    const filtered = stripDisallowedChars(playerNameInput.value);
    if (filtered !== playerNameInput.value) playerNameInput.value = filtered;
    localStorage.setItem("jakesjam.playerName", sanitizePlayerName(filtered) ?? "");
  });
}

const lobbyController = new LobbyController(app);
const splash = queryRequired<HTMLElement>("[data-splash]");
const lobbyPanel = queryRequired<HTMLElement>("[data-lobby-panel]");
const optionsPanel = queryRequired<HTMLElement>("[data-options]");
const clipsPanel = queryRequired<HTMLElement>("[data-shell-clips]");
const pausePanel = queryRequired<HTMLElement>("[data-shell-pause]");
const creditsPanel = queryRequired<HTMLElement>("[data-shell-credits]");
const clipsListEl = queryRequired<HTMLElement>("[data-clips-list]");
const musicVolumeInput = queryRequired<HTMLInputElement>("[data-music-volume]");
const musicMutedInput = queryRequired<HTMLInputElement>("[data-music-muted]");
const sfxVolumeInput = queryRequired<HTMLInputElement>("[data-sfx-volume]");
const sfxMutedInput = queryRequired<HTMLInputElement>("[data-sfx-muted]");

// Doors 1.8 — the same class picker the venue loadout station renders,
// mounted in Settings so the choice is reachable from anywhere instead of
// only by walking to a totem. Two views, ONE persisted value: each one
// announces its writes with `jakesjam:class-change` and repaints on the
// other's, so neither goes stale inside a session.
{
  const mount = queryRequired<HTMLElement>("[data-settings-character-picker]");
  const picker = buildClassPicker({
    title: "CHOOSE YOUR CLASS",
    options: characters.map((c) => ({
      id: c.id as string,
      name: c.name,
      classId: c.classId,
      summary: c.kitSummary,
      kitComing: c.kitComing,
    })),
    selectedId: sanitizeCharacterId(localStorage.getItem("jakesjam.playerCharacter")),
    onSelect: (id) => {
      const characterId = sanitizeCharacterId(id);
      localStorage.setItem("jakesjam.playerCharacter", characterId);
      window.dispatchEvent(
        new CustomEvent("jakesjam:class-change", { detail: { characterId } }),
      );
    },
  });
  mount.appendChild(picker.el);
  window.addEventListener("jakesjam:class-change", (event) => {
    const characterId = (event as CustomEvent<{ characterId?: string }>).detail
      ?.characterId;
    if (characterId) picker.setSelected(sanitizeCharacterId(characterId));
  });
}

const shell = new ShellController({
  dom: {
    home: splash,
    room: lobbyPanel,
    settings: optionsPanel,
    clips: clipsPanel,
    pause: pausePanel,
    credits: creditsPanel,
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

// Devlog funnel: email gate above the splash on first visit. Skips itself
// for kiosk/world links and returning signups (see shell/emailGate.ts).
installEmailGate();
// Live DOM check (not a cached flag) — every gesture listener that could
// start audio (boot-ident anthem, lore-intro voice, first-gesture menu
// music) checks this at event time. The email gate auto-focuses its
// input, so without this guard typing an email or hitting Enter to
// submit bubbles a keydown/pointerdown to `window` and silently arms
// audio while the form is still up. No music plays until the email step
// is actually dismissed (submit or skip) and the splash screen is reached.
function isEmailGateOpen(): boolean {
  return document.querySelector(".email-gate") !== null;
}

// ── Boot ident: EA/THQ-style studio sting. The pre-boot gate captures
// the user gesture browsers require for audio, then the ident runs WITH
// sound, the splash theme takes over, and startMenuMusic() fades it out —
// one music authority at a time (fixes the two-songs overlap).
let fadeSplashTheme: () => void = () => {};
let resumeSplashTheme: () => void = () => {};

// ── MUSIC SINGLETON ENFORCER ──────────────────────────────────────────
// Exactly ONE music track may be audible, ever. Every music element
// registers here; a watchdog force-fades anything audible that isn't the
// current owner. Voice/SFX (announcer, procedural audio) are exempt.
const musicRegistry = new Set<HTMLAudioElement>();
let musicOwner: HTMLAudioElement | null = null;
window.setInterval(() => {
  for (const el of musicRegistry) {
    if (el !== musicOwner && !el.paused) {
      el.volume = Math.max(0, el.volume - 0.15);
      if (el.volume <= 0.02) el.pause();
    }
  }
}, 250);

// ── BOOT PLAN (Doors 1.1 — lobby-first landing) ───────────────────────
//
// The front door used to be: click-to-initiate → 27.9 s ident → splash →
// callsign → walk → bell. Five gates and 5+ clicks before a stranger saw
// a fight, against a north star of "in a live fight in under 15 seconds".
// The venue is now the DEFAULT landing; the splash becomes a surface you
// go BACK to (pause menu → Back to splash), not one you must get past.
//
// Decided once, here, because two very separate blocks need the answer:
// the ident ceremony below (which must not run on the critical path) and
// the routing block at the bottom of this file.
//
// The ident is not deleted — it is promoted to something you ASK for
// (Credits row → "Intro", which lands as `?intro=1`). `?splash=1` is the
// escape hatch back to the old landing for a marketing capture or a
// bisect, and it is also what the pause menu's Back-to-splash uses.
type BootPlan = "replay" | "room" | "venue" | "splash";
const bootParams = new URLSearchParams(window.location.search);
const bootPlan: BootPlan = ((): BootPlan => {
  if (bootParams.get("replay")) return "replay";
  if (bootParams.get("room") || bootParams.get("code")) return "room";
  // Explicit requests for the old front door win over lobby-first.
  if (bootParams.get("intro") === "1") return "splash";
  if (bootParams.get("splash") === "1") return "splash";
  // The stream kiosk exists to show the ceremony — it is the one context
  // where the ident IS the content, not a toll (stream-kit/).
  if (bootParams.get("kiosk") === "1") return "splash";
  try {
    if (localStorage.getItem("jakesjam.lobbyFirst") === "off") return "splash";
  } catch {
    /* storage unavailable — lobby-first is still the right default */
  }
  return "venue";
})();
/** True when boot should get out of the way: no ceremony, no gate. */
const bootSkipsCeremony = bootPlan !== "splash";

{
  const gate = app.querySelector<HTMLElement>("[data-boot-gate]");
  const ident = app.querySelector<HTMLElement>("[data-boot-ident]");
  const muted = localStorage.getItem("jakesjam.musicMuted") === "true";
  const vol = Number(localStorage.getItem("jakesjam.musicVolume") ?? "65") / 100;
  const instant = document.documentElement.classList.contains("ui-instant");
  // "Intro" menu button lands here with ?intro=1 — a click already IS the
  // gesture browsers require for audio, so this bypasses the click-to-
  // initiate gate and always plays the full ceremony (ignores identSeen).
  const forceIntro = new URLSearchParams(window.location.search).get("intro") === "1";
  if (forceIntro) {
    const url = new URL(window.location.href);
    url.searchParams.delete("intro");
    window.history.replaceState({}, "", url.toString()); // don't replay on refresh
  }
  const splashTheme = new Audio(getAudioUrl("splash-theme.m4a"));
  musicRegistry.add(splashTheme);
  splashTheme.loop = false; // the anthem plays ONCE — it IS the ident
  const menuLight = new Audio(getAudioUrl("menu-light.m4a"));
  menuLight.loop = true;
  musicRegistry.add(menuLight);
  const themeVol = Math.min(1, vol * 0.9);
  let handed = false;
  const menuVol = Math.min(1, vol * 0.55); // deliberately light vs the anthem
  resumeSplashTheme = () => {
    if (muted || menuVol <= 0) return;
    handed = false;
    musicOwner = menuLight;
    void menuLight.play().catch(() => { /* gated */ });
    const iv = window.setInterval(() => {
      if (handed) return window.clearInterval(iv);
      menuLight.volume = Math.min(menuVol, menuLight.volume + 0.04);
      if (menuLight.volume >= menuVol) window.clearInterval(iv);
    }, 80);
  };
  // zombie-tab silencer: hidden tabs must not keep looping the theme
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      splashTheme.pause();
      menuLight.pause();
    } else if (!handed && document.documentElement.classList.contains("ident-done")) {
      void menuLight.play().catch(() => { /* gated */ });
    }
  });
  fadeSplashTheme = () => {
    if (handed) return;
    handed = true;
    const iv = window.setInterval(() => {
      let alive = false;
      for (const el of [splashTheme, menuLight]) {
        if (!el.paused) {
          el.volume = Math.max(0, el.volume - 0.08);
          if (el.volume <= 0.01) el.pause();
          else alive = true;
        }
      }
      if (!alive) window.clearInterval(iv);
    }, 60);
  };
  const finishBoot = () => {
    // Clean cut: instant black (the "cut"), a brief held beat, then a
    // fast fade reveals the already-settled title underneath — not an
    // abrupt pop, not a slow mushy cross-dissolve. Decoupled from the
    // 27.93s master timeline entirely so the timing is exact regardless
    // of where in that animation finishBoot() actually fires (full rite
    // vs the short repeat-boot cut vs a manual skip).
    const bridge = ident?.querySelector<HTMLElement>("[data-ident-bridge]");
    if (bridge) {
      bridge.style.transition = "none";
      bridge.style.opacity = "1";
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          bridge.style.transition = "opacity 240ms cubic-bezier(0.4, 0, 0.2, 1)";
          bridge.style.opacity = "0";
        }, 140); // brief true-black hold — the "beat" that makes it read as a cut, not a glitch
      });
    }
    document.documentElement.classList.add("ident-done");
    window.setTimeout(() => {
      gate?.remove();
      ident?.remove();
    }, 850);
    // Juxtaposition: the anthem spends its energy exactly once, then the
    // menu breathes with the LIGHT instrumental (Console Rainlight).
    if (!splashTheme.paused) {
      const iv = window.setInterval(() => {
        splashTheme.volume = Math.max(0, splashTheme.volume - 0.1);
        if (splashTheme.volume <= 0.01) { splashTheme.pause(); window.clearInterval(iv); }
      }, 50);
    }
    if (!handed) resumeSplashTheme();
  };
  const IDENT_MS = 27_930; // the full anthem — the track IS the ident audio
  const IDENT_SHORT_MS = 6_600; // repeat boots: voice → drop → strike → title
  // forceIntro (the Credits-row "Intro" button) always gets the full rite.
  const identSeen = !forceIntro && localStorage.getItem("jakesjam.identSeen") === "1";
  const runIdent = () => {
    if (!ident) return finishBoot();
    gate?.remove();
    ident.hidden = false;
    // The fixed-star band: 48 ticks (Ptolemy's constellations), 12 majors
    // on downbeats (Duodecad x Tetrad), minors in beat-runs between (9.5-14s).
    const ticks = ident.querySelector("[data-ident-ticks]");
    if (ticks) {
      const BEAT = 0.41806; // 143.55 bpm
      let markup = "";
      for (let i = 0; i < 48; i++) {
        const a = (i * Math.PI * 2) / 48 - Math.PI / 2;
        const major = i % 4 === 0;
        const r0 = major ? 432 : 452;
        const x0 = 500 + r0 * Math.cos(a), y0 = 500 + r0 * Math.sin(a);
        const x1 = 500 + 478 * Math.cos(a), y1 = 500 + 478 * Math.sin(a);
        // majors stamp ON downbeats from 9.62s; minors run in the gaps
        const at = major ? 9.62 + (i / 4) * BEAT : 9.72 + Math.floor(i / 4) * BEAT + (i % 4) * (BEAT / 4);
        markup += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" style="animation-delay:${at.toFixed(3)}s" stroke-width="${major ? 5 : 2}"/>`;
      }
      ticks.innerHTML = markup;
    }
    // Letters LAST (every historical seal): seven vowels = seven spheres,
    // fading in at 24-25s on alternating major ticks.
    const vowels = ident.querySelector("[data-ident-vowels]");
    if (vowels) {
      const GLYPHS = ["\u0391", "\u0395", "\u0397", "\u0399", "\u039F", "\u03A5", "\u03A9"];
      let markup = "";
      GLYPHS.forEach((g, i) => {
        const a = ((i * 8 + 2) * Math.PI * 2) / 48 - Math.PI / 2;
        const x = 500 + 405 * Math.cos(a), y = 500 + 405 * Math.sin(a);
        markup += `<text x="${x.toFixed(1)}" y="${(y + 9).toFixed(1)}" text-anchor="middle" style="animation-delay:${(24 + i * 0.14).toFixed(2)}s">${g}</text>`;
      });
      vowels.innerHTML = markup;
    }
    // The ray crown at peak: seven short dim-gold rays (the Hebdomad) and
    // ONE long teal ray escaping through the ouroboros seam (the way out).
    const rays = ident.querySelector("[data-ident-rays]");
    if (rays) {
      let markup = "";
      for (let i = 0; i < 7; i++) {
        const a = ((i - 3) * 0.42) + Math.PI / 2; // fanned downward
        const x0 = 500 + 500 * Math.cos(a), y0 = 500 + 500 * Math.sin(a);
        const x1 = 500 + 620 * Math.cos(a), y1 = 500 + 620 * Math.sin(a);
        markup += `<line class="ray-gold" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" style="animation-delay:${(19.4 + i * 0.09).toFixed(2)}s"/>`;
      }
      // the seam is at top (boundary gap) — the teal ray runs THROUGH it
      markup += `<line class="ray-teal" x1="500" y1="490" x2="500" y2="-400" style="animation-delay:19.9s"/>`;
      rays.innerHTML = markup;
    }
    requestAnimationFrame(() => ident.classList.add("run"));
    // The anthem IS the ident audio. Play once; the ident visuals slave
    // to the AUDIO clock (WAAPI resync — CSS and audio clocks start
    // ±200ms apart and drift; see docs/research/IDENT-ENGINEERING.md).
    const syncTracks = (force: boolean) => {
      const tMs = splashTheme.currentTime * 1000;
      for (const a of ident.getAnimations({ subtree: true })) {
        try {
          if (force || Math.abs(Number(a.currentTime ?? 0) - tMs) > 45) a.currentTime = tMs;
        } catch { /* non-finite animation */ }
      }
    };
    if (!muted && themeVol > 0) {
      musicOwner = splashTheme;
      splashTheme.volume = themeVol;
      void splashTheme.play().catch(() => { /* kiosk: silent ident */ });
      splashTheme.addEventListener("playing", () => syncTracks(true), { once: true });
      splashTheme.addEventListener("timeupdate", () => {
        if (!document.documentElement.classList.contains("ident-done")) syncTracks(false);
      });
      // music reactivity: bass envelope → glow layer (transform/opacity only)
      try {
        const identCtx = new AudioContext();
        const src = identCtx.createMediaElementSource(splashTheme);
        src.connect(identCtx.destination);
        const an = identCtx.createAnalyser();
        // 1024 gives ~47Hz/bin @48kHz — fine enough to isolate the synth
        // lead ("croon") from generic mid/air, which 256 (187Hz/bin) blurs.
        an.fftSize = 1024;
        src.connect(an);
        const bins = new Uint8Array(an.frequencyBinCount);
        const glow = ident.querySelector<HTMLElement>("[data-ident-glow]");
        const quake = ident.querySelector<HTMLElement>("[data-ident-quake]");
        const seal = ident.querySelector<SVGElement>(".ident-seal");
        const pulseEl = ident.querySelector<HTMLElement>("[data-ident-pulse]");
        const shaderCanvas = ident.querySelector<HTMLCanvasElement>("[data-ident-shader]");
        const shader = shaderCanvas ? installIdentShader(shaderCanvas) : null;
        // ── per-stem envelope control (audio/splash-theme-stems.json):
        // 60Hz envelopes + onset frames from a 6-stem separation of the
        // anthem. Fetched non-blocking; until it arrives — or forever, if
        // it 404s — the live-FFT path below keeps driving everything
        // exactly as before. Both paths feed the SAME band values into the
        // SAME uniforms; the stems just replace the FFT's guessing with
        // per-instrument truth. Channel map (docs/IDENT-GRAMMAR.md §Stem
        // channels): drums→rings/kick-spring, bass→wisp bed ("cracked up
        // mega"), guitar+piano→lead/crystal, vocals→rays, other→chroma.
        // window.__identStems tells the smoke probe which path is live.
        const stemDbg = window as unknown as { __identStems?: "live" | "fallback" };
        stemDbg.__identStems = "fallback";
        let stems: IdentStems | null = null;
        // onset cursors = index of the NEXT unfired onset per stem. They're
        // fast-forwarded past the audio clock when the JSON lands mid-run,
        // so a late fetch can't machine-gun every already-missed onset.
        let drumOnsetCur = 0;
        let stabOnsetCur = 0;
        let stemArmed = false;
        void loadIdentStems(getAudioUrl("splash-theme-stems.json")).then((s) => {
          if (!s || document.documentElement.classList.contains("ident-done")) return;
          stems = s;
          stemDbg.__identStems = "live";
        });
        let raf = 0;
        let t0 = 0;
        let pulseEnv = 0; // sidechain-style envelope: snap up, decay out
        let pulseGrowth = 0; // ratchets up across repeated stabs, then settles
        const pump = (now: number) => {
          if (document.documentElement.classList.contains("ident-done")) {
            cancelAnimationFrame(raf);
            void identCtx.close().catch(() => {});
            shader?.dispose();
            return;
          }
          if (!t0) t0 = now;
          const tSec = (now - t0) / 1000;
          an.getByteFrequencyData(bins);
          // bands (48kHz/1024 → 46.9Hz/bin): sub/kick, synth-lead "croon"
          // presence, and cymbal/noise air — four DIFFERENT elements react
          // to four different things, not one number driving everything.
          let bass = 0, lead = 0, air = 0, scream = 0;
          for (let i = 1; i < 7; i++) bass += bins[i]!;          // ~47-330Hz
          for (let i = 26; i < 86; i++) lead += bins[i]!;        // ~1.2-4kHz
          for (let i = 160; i < 320; i++) air += bins[i]!;       // ~7.5-15kHz
          for (let i = 86; i < 200; i++) scream += bins[i]!;     // ~4-9.4kHz — the searing/riff register
          let pb = Math.min(1, bass / (6 * 255));
          let pl = Math.min(1, lead / (60 * 175));
          const pt = Math.min(1, air / (160 * 110));
          // aggressive curve (squared): a screaming track should read as
          // MOSTLY quiet with real spikes, not a constant hot floor.
          const psRaw = Math.min(1, scream / (114 * 130));
          const ps = psRaw * psRaw;
          // ── stem override: when the per-stem JSON is live it replaces
          // the FFT guesses for the channels it owns. air (pt) and scream
          // (ps) stay FFT-derived in BOTH modes — they're timbral registers
          // of the whole mix, not separable instruments, and the whiteout/
          // shimmer they drive should keep tracking the mix. Frame index
          // comes off splashTheme.currentTime — the ONE clock everything
          // in this ident (WAAPI resync, shader progress) already slaves
          // to; no second clock is introduced here.
          let wisp = 0; // bass stem env → the melting-light bed
          let chroma = 0; // other stem env → chroma width swell
          let raysLevel = pl; // vocals stem env in stem mode; lead in fallback
          let kickOnset = 0; // drums onset strength this frame
          let stabOnset = 0; // guitar onset strength this frame
          if (stems) {
            const s = stems;
            const frame = Math.max(0, Math.min(s.frameCount - 1, Math.floor(splashTheme.currentTime * s.fps)));
            const env = (n: IdentStemName) => (s.stems[n][frame] ?? 0) / 255;
            if (!stemArmed) {
              stemArmed = true;
              while (drumOnsetCur < s.onsets.drums.length && (s.onsets.drums[drumOnsetCur] ?? 0) <= frame) drumOnsetCur++;
              while (stabOnsetCur < s.onsets.guitar.length && (s.onsets.guitar[stabOnsetCur] ?? 0) <= frame) stabOnsetCur++;
            }
            pb = env("drums"); // rings/quake/glow punch with the DRUM stem
            // lead = guitar with the near-silent piano folded in (sum,
            // clamped) — crystal glint + ring highlights + seal saturation
            pl = Math.min(1, env("guitar") + env("piano"));
            wisp = env("bass"); // the headline channel — the envelope IS the light
            chroma = env("other");
            raysLevel = env("vocals"); // the ray crown sings with the voice
            // sample-accurate onsets: fire every onset frame the audio
            // clock crossed since last rAF. Strength = that stem's envelope
            // AT the onset frame, floored at 0.4 so an attack transient
            // caught mid-rise still lands a real kick.
            while (drumOnsetCur < s.onsets.drums.length && (s.onsets.drums[drumOnsetCur] ?? Infinity) <= frame) {
              const f = s.onsets.drums[drumOnsetCur]!;
              kickOnset = Math.max(kickOnset, Math.max(0.4, (s.stems.drums[f] ?? 0) / 255));
              drumOnsetCur++;
            }
            while (stabOnsetCur < s.onsets.guitar.length && (s.onsets.guitar[stabOnsetCur] ?? Infinity) <= frame) {
              const f = s.onsets.guitar[stabOnsetCur]!;
              stabOnset = Math.max(stabOnset, Math.max(0.4, (s.stems.guitar[f] ?? 0) / 255));
              stabOnsetCur++;
            }
          }
          if (glow) {
            glow.style.opacity = String(0.1 + pb * 0.6);
            glow.style.transform = `translate(-50%, -50%) scale(${0.9 + pb * 0.28})`;
          }
          // bass → continuous quake, organic (two mistuned sines beat
          // against each other) so it reads as tremor, not a metronome —
          // lives on its own wrapper so it never fights the seal's own
          // scripted rotate/scale keyframe (different element, no conflict).
          // Cubed + tiny ceiling: only real punch registers, the sustained
          // bassline underneath does not — a whisper of tremor, not a shake.
          if (quake) {
            const amp = pb * pb * pb * 1.3;
            const dx = amp * Math.sin(tSec * 31) + amp * 0.4 * Math.sin(tSec * 47.3);
            const dy = amp * 0.7 * Math.cos(tSec * 29) + amp * 0.3 * Math.cos(tSec * 53.1);
            quake.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
          }
          // ~9.3-14s: the staccato sidechained synth stab — a dedicated
          // pulse reads the SAME lead band but through a gated envelope
          // follower (fast attack on note-on, exponential decay = the
          // classic sidechain "duck") instead of tracking the raw level,
          // so it visibly PUMPS in time with the stab pattern rather than
          // just glowing brighter. Size ratchets up across repeated hits
          // inside the window, then settles once the section ends.
          {
            const gate = pl > 0.4 ? 1 : 0;
            pulseEnv = gate ? Math.min(1, pulseEnv + 0.4) : pulseEnv * 0.82;
            const inStabWindow = tSec > 9.3 && tSec < 14.2;
            if (inStabWindow && gate && pulseEnv > 0.85) {
              pulseGrowth = Math.min(1, pulseGrowth + 0.06);
            } else if (!inStabWindow) {
              pulseGrowth *= 0.97;
            }
            if (pulseEl) {
              const baseScale = 0.55 + pulseGrowth * 0.6;
              const scale = baseScale * (1 + pulseEnv * 0.4);
              pulseEl.style.opacity = String(0.12 + pulseEnv * 0.5);
              pulseEl.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            }
          }
          // mid-band ray wash: filter, NOT opacity — the scripted
          // rays-anthem keyframe already owns this element's opacity/rotate,
          // and CSS animations always win a same-property fight against
          // inline JS styles, so the old opacity-based pulse was inert.
          // stem mode: the VOCALS stem owns the rays group intensity (the
          // crown sings with the voice); fallback keeps the lead band.
          const raysEl = ident.querySelector<HTMLElement>("[data-ident-rays-glow]");
          if (raysEl) raysEl.style.filter = `brightness(${(0.75 + raysLevel * 1.15).toFixed(2)})`;
          // the "aggro croon": the synth lead line pulses SATURATION on the
          // liquid-gold/teal strokes themselves — the geometry visibly
          // sings along with the lead, not just a generic glow reacting.
          if (seal) {
            seal.style.filter =
              `saturate(${(1 + pl * 1.4).toFixed(2)}) brightness(${(1 + pl * 0.35).toFixed(2)})`;
          }
          const shim = ident.querySelector<HTMLElement>("[data-ident-shimmer]");
          if (shim) {
            shim.style.opacity = String(pt * 0.6);
            shim.style.transform = `translate(-50%, -50%) scale(${1 + pt * 0.02}) rotate(${pt * 1.1}deg)`;
          }
          // melting liquid-light wings, true per-pixel chromatic aberration —
          // fed the SAME live bands as everything else above. progress is
          // locked to the AUDIO clock (not tSec, which is rAF-relative from
          // first paint) so the shader's ring-by-ring ignition stays exactly
          // in sync with the CSS stroke-dashoffset draw-in even if a frame
          // hitches — same source syncTracks() uses to resync the keyframes.
          const progress = Math.min(1, splashTheme.currentTime / (IDENT_MS / 1000));
          shader?.update({
            bass: pb, lead: pl, air: pt, scream: ps, pulse: pulseEnv,
            growth: pulseGrowth, progress,
            // stem-only channels — inert (0/false) on the FFT fallback
            stemLive: stems !== null, wisp, chroma, kickOnset, stabOnset,
          });
          raf = requestAnimationFrame(pump);
        };
        raf = requestAnimationFrame(pump);
      } catch { /* reactivity is garnish — never block the boot */ }
    }
    const t = window.setTimeout(finishBoot, identSeen ? IDENT_SHORT_MS : IDENT_MS);
    try { localStorage.setItem("jakesjam.identSeen", "1"); } catch { /* fine */ }
    const skip = () => {
      window.clearTimeout(t);
      finishBoot();
    };
    window.setTimeout(() => {
      ident.addEventListener("pointerdown", skip, { once: true });
      window.addEventListener("keydown", skip, { once: true });
    }, identSeen ? 250 : 1500);
  };
  // Pairs with the template's no-autoplay video (open-doors 0.4): the
  // poster holds the frame until the gate gesture; muted play() is never
  // gesture-gated, so the catch is just belt-and-braces.
  const startSplashVideo = () => {
    const v = app.querySelector<HTMLVideoElement>(".splash-bg-video");
    if (v && v.paused) void v.play().catch(() => undefined);
  };
  if (instant || bootSkipsCeremony) {
    // Doors 1.1: lobby-first (or a replay/room deep link) means the
    // ceremony is not on the critical path at all — no click-to-initiate,
    // no 27.9 s anthem, no splash to dismiss. The ident still exists and
    // still plays in full when asked for (Credits → Intro → ?intro=1),
    // which is the point: a rite you choose, not a toll you pay.
    gate?.remove();
    ident?.remove();
    document.documentElement.classList.add("ident-done");
    if (!bootSkipsCeremony) startSplashVideo();
  } else if (forceIntro || isKioskMode) {
    // forceIntro: the Intro-button click was already the required user
    // gesture — skip the click-to-initiate gate and run straight in.
    gate?.remove();
    startSplashVideo();
    runIdent();
  } else {
    const arm = () => {
      startSplashVideo();
      // The email-capture overlay sits ABOVE this gate (z-index 60 vs 50),
      // so a real pointerdown on `gate` is already physically blocked
      // while it's open. keydown is NOT blocked by z-index — it bubbles
      // from wherever focus is, and the email input auto-focuses on
      // open — so typing an email or hitting Enter to submit would
      // otherwise arm the anthem while the form is still up. No music
      // until the email step is actually done: ignore and DON'T consume
      // this listener (isEmailGateOpen() re-checked live, not once) so
      // the real gesture — a keypress on the revealed splash — still
      // arms it correctly afterward.
      if (isEmailGateOpen()) return;
      window.removeEventListener("keydown", arm);
      runIdent();
    };
    gate?.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm);
  }
}

// Title-screen CTA (the blinking "press start" line) = Hot Lobby.
app.querySelector<HTMLButtonElement>("[data-splash-cta]")?.addEventListener(
  "click",
  () => app.querySelector<HTMLButtonElement>("[data-menu-world]")?.click(),
);
// ── Soundtrack state ─────────────────────────────────────────────────────
// Two tracks that CROSSFADE rather than hard-cut: the "Jakes Jam" theme
// underscores menu/lobby; the "bassradian" loops drive world/match. A context
// flag decides which is live; a per-element RAF fade smooths every transition
// (menu↔world and loop→loop) so nothing clicks or drops out — the main
// game-feel win over the initial hard-switch.
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
// preload="none" (open-doors 0.4): the three context tracks are ~9.3 MB
// combined and were all fetched eagerly at boot, ahead of gameplay.
// play() fetches on demand and the crossfade masks the start latency.
const menuMusic = new Audio(getAudioUrl("jakes-jam-theme.mp3"));
menuMusic.loop = true;
menuMusic.preload = "none";

// In-world / match soundtrack — cycled for variety (advance on `ended`, wrap
// around) so a long session doesn't hear the same 2 minutes on repeat.
// epic-loop-3 retired 2026-07-20; all three "Juh-Roh" (Suno, bassradian)
// takes follow it, in download order, with the "jazzy" take last.
const WORLD_MUSIC_TRACKS = [
  "epic-loop-1.mp3",
  "epic-loop-2.mp3",
  "juh-roh-1.mp3",
  "juh-roh-2.mp3",
  "juh-roh-jazzy.mp3",
] as const;
let worldTrackIdx = 0;
const worldMusic = new Audio(getAudioUrl(WORLD_MUSIC_TRACKS[0]));
// Venue lobby music — "A Table Set" (Jake, 2026-07-16; venue-sprint2-goal
// S2.C.2). Its own context in the same crossfade system: lobby↔arena
// transitions fade through the one machinery, no new audio category.
const venueMusic = new Audio(getAudioUrl("venue-lobby.mp3"));
venueMusic.loop = true;
venueMusic.preload = "none"; // see menuMusic's preload note
musicRegistry.add(menuMusic);
musicRegistry.add(worldMusic);
musicRegistry.add(venueMusic);
// One track per context — the shared law lives in shell/musicMute.ts, and
// this Record is compile-time exhaustive over MusicContext.
const contextTracks: Record<MusicContext, HTMLAudioElement> = {
  menu: menuMusic,
  world: worldMusic,
  venue: venueMusic,
};
worldMusic.preload = "none"; // see menuMusic's preload note
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
globalWithGame.__jakesjam_music__ = [menuMusic, worldMusic, venueMusic];
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

// Player record on the splash — replaced the polling world-status badge
// (Jake, 2026-07-16: "remove this add player stats"). Pure local render,
// no network; refreshed on every return home so a finished match's
// kills/wins show the moment the splash is back.
const playerStatsMount = queryRequired<HTMLElement>("[data-player-stats]");
// Live presence in the same row (Jake, 2026-07-17: "put current players
// and current players in a match in the stats"): ONLINE = lobby + arena
// humans, IN MATCH = arena humans, from /venue/summary. Polled only while
// the splash is actually on screen, at the old status-badge cadence.
let venuePresence: { online: number; inMatch: number } | null = null;
function renderPlayerStats(): void {
  const lines = statLines(loadPlayerStats());
  if (venuePresence !== null) {
    lines.push(
      { label: "ONLINE", value: String(venuePresence.online) },
      { label: "IN MATCH", value: String(venuePresence.inMatch) },
    );
  }
  playerStatsMount.replaceChildren(
    ...lines.map(({ label, value }) => {
      const item = document.createElement("span");
      item.className = "splash-stat";
      const v = document.createElement("b");
      v.textContent = value;
      const l = document.createElement("small");
      l.textContent = label;
      item.append(v, l);
      return item;
    }),
  );
}
renderPlayerStats();
window.addEventListener(ShellEvents.MATCH_ENDED, () => renderPlayerStats());
// Track P1 — the last two funnel milestones.
//
// round_end_seen: the cycle-completed beat (the same one Doors 1.2 aims the
// email ask at), i.e. the player saw a cycle finish rather than quitting
// mid-fight.
window.addEventListener(ShellEvents.CYCLE_COMPLETED, () => {
  funnel("round_end_seen");
  // The opening-window tally closes long before this; flush it here because
  // a player who reached a cycle end is a session worth reporting.
  flushWrongInputs();
});
// played_again: a SECOND arena entry in one session — the cheapest honest
// retention proxy until Pillar 5's ceremony can ask properly. Counting
// ENTRIES rather than listening for a "replay" click means the Back-to-Lobby
// round trip and the bell both count, which is what "chose again" means.
let arenaEntries = 0;
window.addEventListener(ShellEvents.MATCH_STARTED, (event) => {
  const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
  if (mode !== "world") return;
  arenaEntries += 1;
  if (arenaEntries >= 2) funnel("played_again");
});
window.addEventListener(ShellEvents.GOTO, () => renderPlayerStats());

async function pollVenuePresence(): Promise<void> {
  // Skip entirely while the splash is hidden (in a match / another shell
  // page) or the tab is backgrounded — presence is a splash read.
  if (document.visibilityState !== "visible" || playerStatsMount.offsetParent === null) return;
  const venue = await fetchVenueSummary();
  if (venue === null) return; // unreachable/not live — keep the last read
  venuePresence = {
    online: (venue.lobby?.present ?? 0) + (venue.arena?.humans ?? 0),
    inMatch: venue.arena?.humans ?? 0,
  };
  renderPlayerStats();
}
void pollVenuePresence();
setInterval(() => void pollVenuePresence(), 5_000);
window.addEventListener(ShellEvents.GOTO, () => void pollVenuePresence());

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

queryRequired<HTMLButtonElement>("[data-menu-credits]").addEventListener("click", () => {
  startMenuMusic();
  shell.goto("credits");
});

// Intro replays the boot ident from scratch — simplest reliable way is a
// full reload with a flag the boot controller checks (the ident graph is
// constructed once at module load; re-triggering in place would mean
// carrying a reset() API through 30+ animation tracks for one menu button).
queryRequired<HTMLButtonElement>("[data-menu-intro]").addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("intro", "1");
  window.location.assign(url.toString());
});

// The Pretennoia showcase — deliberately bypasses the jakesjam:start-match
// CustomEvent path (forces startWorldMusic(), sets a real MatchMode, turns
// on pause-menu/clip-recording chrome — none of which apply to a scripted
// solo cinematic). Silences whatever's currently playing since the scene
// owns its own dedicated <audio> from here on (see TutorialScene.ts).
queryRequired<HTMLButtonElement>("[data-menu-tutorial]").addEventListener("click", () => {
  // splashTheme/menuLight are block-scoped inside the boot-ident IIFE
  // (main.ts's `{ const splashTheme = ...; ... }` block) — not reachable by
  // name here. musicRegistry (the singleton enforcer's own tracking set)
  // holds every music element the app ever creates, so fading everything in
  // it is both reachable AND more complete than naming tracks individually.
  for (const el of musicRegistry) fadeMusic(el, 0, 400);
  // The raw fade above silences the AUDIO but doesn't set the ident IIFE's
  // internal `handed` guard — only fadeSplashTheme() does that. Without it,
  // the document-level visibilitychange listener still sees `handed ===
  // false` and calls menuLight.play() again on the next tab-focus event
  // (alt-tabbing to check a reference video mid-showcase was ALL it took) —
  // the menu theme creeping back in under the showcase's own track, two
  // songs at once. fadeSplashTheme() is idempotent (its own `if (handed)
  // return` guard) so calling it here is always safe.
  fadeSplashTheme();
  musicStartedForContext = null;
  if (game.scene.isActive(SceneKeys.MainMenu)) game.scene.stop(SceneKeys.MainMenu);
  game.scene.start(SceneKeys.Tutorial);
  // ShellController never learns about this scene (deliberately — see the
  // comment above), so its own splash.hidden bookkeeping stays "home" the
  // whole time. Without this, the splash overlay (with all its buttons)
  // stays visible and clickable ON TOP of the running Tutorial canvas —
  // the scene's audio/visuals were genuinely live underneath, just hidden
  // behind the still-shown menu, which read as "nothing happened until I
  // click something else." Hide it directly, bypassing ShellController the
  // same way the rest of this entry already bypasses it.
  splash.hidden = true;
});

window.addEventListener("jakesjam:tutorial-exit", () => {
  if (game.scene.isActive(SceneKeys.Tutorial)) game.scene.stop(SceneKeys.Tutorial);
  if (!game.scene.isActive(SceneKeys.MainMenu)) game.scene.start(SceneKeys.MainMenu);
  document.title = "JAKESJAM";
  splash.hidden = false;
  startMenuMusic();
});

// Arena Forge — in-game map editor. Mirrors the Tutorial/Showcase entry
// above (bypass ShellController's own splash bookkeeping, hide it directly)
// but skips the music-fade choreography since the Forge doesn't own audio.
queryRequired<HTMLButtonElement>("[data-menu-forge]").addEventListener("click", () => {
  if (game.scene.isActive(SceneKeys.MainMenu)) game.scene.stop(SceneKeys.MainMenu);
  game.scene.start(SceneKeys.ArenaForge);
  splash.hidden = true;
});

window.addEventListener("jakesjam:forge-exit", () => {
  if (game.scene.isActive(SceneKeys.ArenaForge)) game.scene.stop(SceneKeys.ArenaForge);
  if (!game.scene.isActive(SceneKeys.MainMenu)) game.scene.start(SceneKeys.MainMenu);
  document.title = "JAKESJAM";
  splash.hidden = false;
});

queryRequired<HTMLButtonElement>("[data-options-back]").addEventListener("click", () => {
  shell.closeLayer();
});

queryRequired<HTMLButtonElement>("[data-clips-back]").addEventListener("click", () => {
  shell.closeLayer();
});

queryRequired<HTMLButtonElement>("[data-credits-back]").addEventListener("click", () => {
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

// Two-step in-shell leave confirm (venue-goal Pillar 0.7) — the native
// browser confirm() was the only OS-chrome dialog in the whole product.
// Leave reveals the confirm row; Stay (or reopening the panel) hides it.
const pauseLeaveConfirm = queryRequired<HTMLElement>("[data-pause-leave-confirm]");
const pauseLeaveBtn = queryRequired<HTMLButtonElement>("[data-pause-leave]");
pauseLeaveBtn.addEventListener("click", () => {
  pauseLeaveConfirm.hidden = false;
  pauseLeaveBtn.disabled = true;
});
queryRequired<HTMLButtonElement>("[data-pause-leave-confirm-no]").addEventListener("click", () => {
  pauseLeaveConfirm.hidden = true;
  pauseLeaveBtn.disabled = false;
});
queryRequired<HTMLButtonElement>("[data-pause-leave-confirm-yes]").addEventListener("click", () => {
  pauseLeaveConfirm.hidden = true;
  pauseLeaveBtn.disabled = false;
  // Arena exits return to the VENUE lobby, not the splash (S2.F) — the
  // same branch the REQUEST_LEAVE_MATCH / return-to-lobby listeners take.
  if (currentMatchMode === "world") joinWorld();
  else leaveMatchToHome();
});

// Clip toast when match emits jakesjam:clip-uploaded (session list is
// ShellController). One upload per trigger now — no vertical crop to pair
// with (2026-07-15: dropped the 9:16 transcode), so toast immediately
// instead of waiting on a 5s pairing timeout that would never resolve early.
window.addEventListener(ShellEvents.CLIP_UPLOADED, ((e: CustomEvent) => {
  const d = e.detail as { url?: string };
  if (!d?.url) return;
  showClipShareToast(d.url);
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

sfxVolumeInput.addEventListener("input", () => {
  localStorage.setItem("jakesjam.sfxVolume", sfxVolumeInput.value);
  applySfxOptions();
});

sfxMutedInput.addEventListener("change", () => {
  localStorage.setItem("jakesjam.sfxMuted", JSON.stringify(sfxMutedInput.checked));
  applySfxOptions();
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
    "Capturing… toast + library entry in ~3–12s (stay in the match, tab focused).";
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
      "Auto: multi-kill / parry / chain · or Save clip now in the Arena.";
  } else {
    clipsSaveStatus.textContent =
      "Clips off. Save clip now turns them on and captures the current moment.";
  }
}

function showMatchChrome(show: boolean): void {
  matchChrome.hidden = !show;
  if (show) syncClipsChrome();
}

function openMatchMenu(): void {
  // Hangout (private-room pre-stage): Menu/Esc toggles the PRIVATE ROOM
  // panel as an overlay — join no longer leaves it stuck open
  // (Jake 2026-07-17). Real fights still open the pause menu.
  //
  // matchMode !== "lobby" (2026-07-20 fix): this used to catch ANY active
  // Hangout scene, including the public venue lobby (mode: "venue" /
  // matchMode "lobby", joinWorld()) — silently routing Menu/Esc to the
  // PRIVATE room panel there too, which has no room code / nothing to show.
  // Venue visitors could never reach the real pause menu, so Settings and
  // Leave were both unreachable from the lobby (reported bug). "lobby" is
  // exclusively the public venue (private hangouts always use "private" —
  // see emitMatchStarted("private") below and at room-joined), so this
  // condition now only fires for the actual private-room pre-stage case.
  if (game.scene.isActive(SceneKeys.Hangout) && shell.getState().matchMode !== "lobby") {
    const st = shell.getState();
    // Stuck open: exclusive room still up, matchMode never flipped (or
    // race). Enter private match-mode → exclusive chrome hides. One
    // press closes; next press toggles the room layer open again.
    if (st.matchMode === "none") {
      emitMatchStarted("private");
      return;
    }
    shell.goto("room");
    return;
  }
  // Pre-join private room screen (no hangout yet): Esc/Menu → home.
  if (shell.getState().exclusive === "room" && shell.getState().matchMode === "none") {
    shell.goto("home");
    return;
  }
  shell.goto("pause");
  syncClipsChrome();
  // Fresh open = fresh confirm state — a half-finished leave confirm from
  // a previous open must not greet the player.
  pauseLeaveConfirm.hidden = true;
  pauseLeaveBtn.disabled = false;
}

queryRequired<HTMLButtonElement>("[data-match-menu]").addEventListener("click", () => {
  openMatchMenu();
});

window.addEventListener(ShellEvents.MATCH_MENU, () => {
  openMatchMenu();
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
let currentMatchMode: import("./shell/types.js").MatchMode = "none";
window.addEventListener(ShellEvents.MATCH_STARTED, (event) => {
  currentMatchMode = (event as CustomEvent<{ mode: import("./shell/types.js").MatchMode }>)
    .detail.mode;
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

// (splash-phase music is owned by the boot ident controller now — the
// old first-gesture menu-music autostart here caused stacked tracks.)

// Soundtrack autoplay is blocked until a user gesture. The splash handler
// above covers the menu path, but the primary entry is now the `?world=1`
// share link, which hides the splash immediately and never fires it. So
// arm a GLOBAL one-time gesture starter: the player's first click or key
// anywhere (including their first move/shoot in-world) starts the song.
// No-op if already playing or muted.
function armSoundtrackOnFirstGesture(): void {
  const start = () => {
    // ?world=1 no longer skips the email gate (2026-07-20, emailGate.ts
    // shouldSkip) — this live re-check now correctly holds back the
    // soundtrack for a ?world=1 visitor too, same as the primary menu
    // path: clicking/typing in the email form must not start the song.
    if (isEmailGateOpen()) return;
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
  // A real match starting must always win over a still-running Showcase —
  // Phaser doesn't auto-stop unrelated active scenes (only the target scene
  // gets shut down by game.scene.start), so without this a stray
  // Practice/Hot-Lobby click while the Tutorial cinematic is still playing
  // leaves BOTH scenes rendering into the same canvas simultaneously
  // (whichever is later in the scene list keeps painting over the other —
  // this was the "practice changes to the showcase" bug). emitMatchStarted
  // above already drives ShellController.setMatchMode → splash.hidden=true
  // for the normal case; stopping Tutorial here is the actual missing fix.
  if (game.scene.isActive(SceneKeys.Tutorial)) game.scene.stop(SceneKeys.Tutorial);
  // The hangout pre-stage world (totem walked into → real match handed
  // off) must not keep running alongside the real match — two active
  // scenes would mean two live WS connections to the same room.
  if (game.scene.isActive(SceneKeys.Hangout)) game.scene.stop(SceneKeys.Hangout);
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
  const armLore = () => {
    // Clicking the email gate's own "Play now"/"maybe later" buttons IS
    // a pointerdown on `window` — ignore it (and don't consume this
    // listener) so the lore line waits for the real first click on the
    // revealed splash instead of firing under the email form.
    if (isEmailGateOpen()) return;
    const splashVisible = !document.querySelector("[data-splash]")?.closest("[hidden]");
    if (!loreStarted && splashVisible && !new URLSearchParams(location.search).has("world")) {
      loreStarted = true;
      announce("lore-intro");
    }
    window.removeEventListener("pointerdown", armLore);
  };
  window.addEventListener("pointerdown", armLore);
}

/**
 * The venue lobby is the world's front room (venue-sprint2-goal S2.F):
 * every "play online" path lands HERE — the walkable antechamber with the
 * bell totem — and the ARENA is entered only through admission
 * (enterArenaFromVenue). joinWorld keeps its name so every caller
 * (Hot Lobby button, ?world=1) inherits the flip.
 */
/**
 * @param fastQueue Doors 1.6 — queue for the next bell on arrival instead
 * of requiring a walk to the bell totem. Only the `?fight` / `?world=1`
 * deep links pass it; every in-app path (Lobby button, Back to Lobby, the
 * post-match round trip) deliberately does not, because a player already
 * inside the venue is choosing when to commit.
 */
function joinWorld(fastQueue = false): void {
  startVenueMusic();
  silenceAnnouncer(); // cut the diatribe if it's mid-flight
  requestGameFullscreen();
  armMatchResume("venue");
  // Bare `?world=1` auto-joins with no gesture (fullscreen rejects) — the
  // first in-match touch retries once.
  window.addEventListener("pointerdown", () => requestGameFullscreen(), {
    once: true,
    capture: true,
  });
  emitMatchStarted("lobby");
  game.scene.stop(SceneKeys.MainMenu); // see start-match handler note
  if (game.scene.isActive(SceneKeys.OnlineMatch)) {
    // Returning from the arena (Menu→Leave / Back to Lobby) — the round
    // trip's second half. Stopping the scene closes the arena socket.
    game.scene.stop(SceneKeys.OnlineMatch);
  }
  document.title = VENUE_TITLE;
  game.scene.start(SceneKeys.Hangout, {
    mode: "venue",
    localPlayerId: localPlayerId(),
    fastQueue,
  });
}

/**
 * The bell rang and this player was admitted (venue-admitted frame) —
 * hand the lobby off to the arena. Stopping Hangout tears down the lobby
 * socket (loop.disconnect in its teardown); OnlineMatchScene opens its own
 * /ws/world connection, which the arena inserts during the countdown with
 * the banked starter pick (VenueHost.admittedCards, 30s TTL — safe in
 * either close/attach order).
 */
function enterArenaFromVenue(): void {
  startWorldMusic();
  announce("welcome");
  emitMatchStarted("world");
  armMatchResume("arena");
  game.scene.stop(SceneKeys.Hangout);
  document.title = ARENA_TITLE;
  game.scene.start(SceneKeys.OnlineMatch, {
    mode: "world",
    localPlayerId: localPlayerId(),
  });
}
window.addEventListener("jakesjam:venue-admitted", () => enterArenaFromVenue());

function leaveMatchToHome(): void {
  if (game.scene.isActive(SceneKeys.Match)) {
    game.scene.stop(SceneKeys.Match);
  }
  if (game.scene.isActive(SceneKeys.OnlineMatch)) {
    game.scene.stop(SceneKeys.OnlineMatch);
  }
  // 2026-07-20 fix: this never checked for Hangout, so "Leave" from the
  // pause menu while in the venue lobby (now reachable — see
  // openMatchMenu's matchMode !== "lobby" fix) would start MainMenu ON TOP
  // of a still-running HangoutScene instead of stopping it — same "two
  // live WS connections" hazard the room-joined/match-started handlers
  // already guard against elsewhere in this file.
  if (game.scene.isActive(SceneKeys.Hangout)) {
    game.scene.stop(SceneKeys.Hangout);
  }
  if (!game.scene.isActive(SceneKeys.MainMenu)) {
    game.scene.start(SceneKeys.MainMenu);
  }
  document.title = "JAKESJAM";
  shell.setMatchMode("none");
  shell.goto("home");
  showMatchChrome(false);
  startMenuMusic();
  // Doors 1.7 — leaving is a DECISION. Never resume someone back into a
  // fight they chose to walk out of.
  disarmMatchResume();
}

/**
 * Doors 1.7 — keep the resume marker fresh for as long as this surface is
 * live, and drop the previous surface's heartbeat. One at a time: entering
 * the arena from the venue replaces "venue" with "arena".
 */
let stopMatchResumeHeartbeat: (() => void) | null = null;
function armMatchResume(place: MatchPlace): void {
  stopMatchResumeHeartbeat?.();
  stopMatchResumeHeartbeat = startResumeHeartbeat(place);
}
function disarmMatchResume(): void {
  stopMatchResumeHeartbeat?.();
  stopMatchResumeHeartbeat = null;
  clearInMatch();
}

// Auto-join Hot Lobby when the URL says so (`?world=1` / `/world`).
const urlParams = new URLSearchParams(window.location.search);
// Doors 1.7 — a reload mid-match used to land on the splash and forfeit
// the run: the server's 10 s reconnect grace was real but unreachable,
// because nothing on the boot path ever tried to use it. The player id
// already survives a reload (localStorage base + sessionStorage suffix),
// so all that was missing was intent. Checked BEFORE the URL branches: a
// live match outranks whatever deep link the address bar still holds,
// and `?replay` is the one exception (an explicit render request).
const resumePlace = urlParams.get("replay") ? null : resumableMatch();
if (resumePlace) {
  setTimeout(() => {
    if (resumePlace === "arena") {
      // Straight back into the fight. If the grace HAS expired the server
      // admits them as a pending entrant and Doors 1.4 shows "YOU'RE IN /
      // NEXT BELL" — never a false ELIMINATED — so a late resume degrades
      // honestly instead of lying about a run that ended.
      enterArenaFromVenue();
    } else {
      joinWorld();
    }
  }, 0);
} else if (urlParams.get("replay")) {
  // Replay playback / offline render (ReplayScene) — no netcode, no lobby.
  //
  // `shell.goto("home")` used to run here (since ReplayScene shipped in
  // 82b13c7) and it SHOWS the splash — so watch mode drew the whole menu
  // on top of the replay you came to watch. Measured 2026-08-09:
  // `[data-splash]` hidden=false, visible=true, twelve seconds in. The
  // headless clip pipeline never noticed because it captures the CANVAS,
  // not the page; a human opening `?replay=<file>` sees the wordmark,
  // the callsign field and the Lobby button over the footage.
  //
  // A replay surface is a match surface as far as chrome is concerned:
  // splash away, match chrome on. Practice is the honest mode here —
  // there is no netcode and no roster, exactly like the practice range.
  shell.setMatchMode("practice");
  document.title = "JAKESJAM — Replay";
  setTimeout(() => {
    game.scene.stop(SceneKeys.MainMenu);
    game.scene.start(SceneKeys.Replay);
  }, 0);
} else if (
  urlParams.has("fight") ||
  urlParams.get("world") === "1" ||
  window.location.pathname === "/world" ||
  // Venue lobby deep link — same landing since the S2.F flow flip
  // (joinWorld IS the venue now); kept as a stable alias.
  urlParams.get("venue") === "1" ||
  // Doors 1.1 — THE DEFAULT. A bare URL lands in the venue, where there
  // are bots fighting and dummies to hit, instead of on a splash the
  // visitor has to get past. `?splash=1` (and the pause menu's
  // Back-to-splash) still reaches the old front door.
  bootPlan === "venue"
) {
  // Doors 1.6 — the `?fight` fast lane: queued for the next bell on
  // arrival, so the walk to the bell totem stops being part of the
  // URL→first-shot budget. `?world=1` / `/world` alias to it per
  // venue-goal P6.3 — that param IS the public share link, and its whole
  // promise is "join the fight".
  //
  // Deliberately NOT the fast lane: `?venue=1` (it asked for the venue,
  // not a fight) and the bare default landing (Doors 1.1). Auto-queueing
  // every default visitor would commit a first-timer to a bout before
  // anything has taught them the bell — a bigger call than this item, and
  // one that belongs with the Phase 3 onboarding work.
  const wantsFastQueue =
    urlParams.has("fight") ||
    urlParams.get("world") === "1" ||
    window.location.pathname === "/world";
  // Defer one tick so Phaser has a chance to register the scene.
  setTimeout(() => joinWorld(wantsFastQueue), 0);
} else if (urlParams.get("room") || urlParams.get("code")) {
  // Shared room link → open lobby and auto-join the room (idempotent on server).
  shell.goto("room");
  setTimeout(() => lobbyController.autoJoinFromUrl(), 0);
}

// Back-to-splash button in the lobby panel → shell home.
window.addEventListener("jakesjam:back-to-splash", () => {
  shell.goto("home");
  startMenuMusic();
  disarmMatchResume(); // Doors 1.7 — deliberate exit, see returnToMenu
});

// Tab title reflects which room the player is in (item 9).
window.addEventListener("jakesjam:room-joined", (event) => {
  const detail = (event as CustomEvent<{ code: string; playerId: string }>).detail;
  document.title = `JAKESJAM — Lobby ${detail.code}`;
  // Enter "private" match mode so the exclusive PRIVATE ROOM chrome
  // hides and match chrome (Menu) shows. Room UI reopens via Menu/Esc
  // as a layer overlay — not stuck open over hangout.
  emitMatchStarted("private");
  // Belt-and-suspenders: force-hide even if a race re-applied exclusive room.
  shell.closeLayer();
  // Party Hangout: the walkable pre-match world replaces the old DOM
  // Ready/Start buttons (totems drive both, server-side). The lobby DOM
  // panel is a Menu-toggled overlay (same data-* hooks).
  // Uses LobbyController's own playerId (carried on the event) —
  // NOT this file's localPlayerId() helper, which is a different id scheme
  // and isn't the id the server actually knows as a member of this room.
  game.scene.stop(SceneKeys.MainMenu);
  game.scene.start(SceneKeys.Hangout, {
    roomCode: detail.code,
    localPlayerId: detail.playerId,
  });
});

window.addEventListener("jakesjam:room-left", () => {
  document.title = "JAKESJAM";
  if (game.scene.isActive(SceneKeys.Hangout)) {
    game.scene.stop(SceneKeys.Hangout);
  }
  // Leave private hangout → clear match mode so splash/chrome reset.
  window.dispatchEvent(new CustomEvent(ShellEvents.MATCH_ENDED));
  shell.goto("home");
  if (!game.scene.isActive(SceneKeys.MainMenu)) {
    game.scene.start(SceneKeys.MainMenu);
  }
});

window.addEventListener("jakesjam:chaos-change", (event) => {
  const matchEvent = event as CustomEvent;
  game.scene.start(SceneKeys.MainMenu, matchEvent.detail);
});

// Fired by MatchScene's results overlay when the player picks "Back to
// Lobby" after a match. Arena (world-mode) exits return to the VENUE, not
// the splash (venue-sprint2-goal S2.F — the lobby is the world's home);
// every other match type keeps the original home flow.
window.addEventListener("jakesjam:return-to-lobby", () => {
  if (currentMatchMode === "world") joinWorld();
  else leaveMatchToHome();
});

window.addEventListener(ShellEvents.REQUEST_LEAVE_MATCH, () => {
  if (currentMatchMode === "world") joinWorld();
  else leaveMatchToHome();
});

window.addEventListener("beforeunload", () => {
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
  sfxVolumeInput.value = localStorage.getItem("jakesjam.sfxVolume") ?? "65";
  sfxMutedInput.checked = localStorage.getItem("jakesjam.sfxMuted") === "true";
  applySfxOptions();
}

function musicVol(): number {
  return Number(musicVolumeInput.value) / 100;
}

/** Mirrors applyAudioOptions' shape but for SFX — no fade/crossfade
 *  complexity to manage (gameplay one-shots, not looping music tracks),
 *  just broadcasts the effective 0..1 level to whichever ProceduralAudio/
 *  GameAudioSystem instance(s) currently exist via the shared setter. */
function applySfxOptions(): void {
  const muted = sfxMutedInput.checked;
  setSfxVolume01(muted ? 0 : Number(sfxVolumeInput.value) / 100);
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
  applyMusicMute(contextTracks, musicMutedInput.checked);
  // Live slider: jump the ACTIVE track to the new level (unless it's mid-fade,
  // where the fade already targets the current level).
  const active = activeTrack(contextTracks, musicContext);
  if (!musicFades.has(active)) active.volume = musicVol();
}

function playCurrentMusic() {
  // Every music start traces back to a user gesture (splash click, menu
  // button, etc.) — this is the one choke point they all go through, so
  // it's the safe place to resume the AudioContext the bass filter lives
  // in (browsers create it suspended until a gesture happens). Resuming an
  // already-running context is a harmless no-op.
  // Some browsers CLOSE (not just suspend) a long-idle AudioContext, so
  // resume() can reject outright — catch it or it's an unhandled
  // rejection in telemetry every time (signature 1kfou88).
  void audioCtx.resume().catch(() => {});
  // Arm mic for gnostic geometry (same gesture). Failures are silent.
  if (isVoiceWanted()) {
    void startVoiceReactive(audioCtx);
  }
  const requestedContext = musicContext;
  const active = activeTrack(contextTracks, requestedContext);
  const others = inactiveTracks(contextTracks, requestedContext);
  // Already settled on this exact context — see musicStartedForContext's
  // doc comment. Only skip once the track is actually audibly running
  // (not just non-paused): if an earlier attempt is still stuck mid-way
  // (autoplay block, slow promise), let this call retry for real rather
  // than silently no-op forever.
  if (musicStartedForContext === requestedContext && !active.paused) {
    return;
  }
  musicStartedForContext = requestedContext;
  applyMusicMute(contextTracks, musicMutedInput.checked);
  // Crossfade: bring the active track up from wherever it is, fade every
  // other context's track out (and pause it at the end).
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
  for (const other of others) {
    if (!other.paused) fadeMusic(other, 0, CROSSFADE_MS);
  }
}

function startMenuMusic() {
  // Menu music deleted (Jake, 2026-07-11): the splash theme IS the menu
  // music. Fade any match music out and bring the theme back.
  musicContext = "menu";
  musicStartedForContext = null;
  fadeMusic(worldMusic, 0, CROSSFADE_MS);
  fadeMusic(menuMusic, 0, CROSSFADE_MS);
  fadeMusic(venueMusic, 0, CROSSFADE_MS);
  resumeSplashTheme();
}

function startWorldMusic() {
  fadeSplashTheme();
  musicOwner = worldMusic;
  musicContext = "world";
  playCurrentMusic();
}

/** Venue lobby music (S2.C.2) — "A Table Set", crossfaded through the same
 *  machinery as menu/world so lobby↔arena transitions never hard-cut. */
function startVenueMusic() {
  fadeSplashTheme();
  musicOwner = venueMusic;
  musicContext = "venue";
  playCurrentMusic();
}

