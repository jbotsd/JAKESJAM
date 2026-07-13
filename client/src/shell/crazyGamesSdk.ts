// CrazyGames SDK v3 — thin, defensive portal integration wrapper.
//
// JAKESJAM ships from THREE kinds of host, and SDK.environment tells them
// apart:
//   - crazygames.com (their portal)      → environment === "crazygames"
//     (full functionality)
//   - localhost / 127.0.0.1 (dev)        → environment === "local"
//     (simulated behavior — safe to call)
//   - play.elyad.io and EVERYWHERE ELSE  → environment === "disabled"
//     (every SDK method call THROWS)
//
// play.elyad.io is JAKESJAM's own production site, not just a CrazyGames
// portal build — it must never see a CrazyGames-related crash. That is the
// single hard constraint of this module: every exported function is a safe
// no-op unless we're actually inside a live CrazyGames-aware environment,
// and every SDK call is additionally try/caught because "disabled" is a
// documented THROW, not a null-return.
//
// Call sites (main.ts, OnlineMatchScene.ts, LobbyController.ts) use these
// helpers unconditionally — they carry zero environment-awareness of their
// own.

export type CrazyGamesEnvironment = "local" | "crazygames" | "disabled" | string;

interface CrazyGamesSettingsChangeEvent {
  key: string;
  value: unknown;
}

interface CrazyGamesGameApi {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  addSettingsChangeListener(
    listener: (event: CrazyGamesSettingsChangeEvent) => void,
  ): void;
  isInstantMultiplayer?: boolean;
  inviteLink(params: { url: string }): void;
}

interface CrazyGamesSdkApi {
  environment: CrazyGamesEnvironment;
  init(): Promise<void>;
  game: CrazyGamesGameApi;
}

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: CrazyGamesSdkApi;
    };
  }
}

type MuteAudioListener = (muted: boolean) => void;

// Module state. `sdkReady` only flips true once init() has resolved inside
// a non-"disabled" environment — that's the single gate every other
// exported function checks via isLive().
let sdkReady = false;
let environment: CrazyGamesEnvironment | null = null;
let gameplayActive = false; // guards against double-start / unpaired stop
let underlyingMuteListenerRegistered = false;
const muteListeners: MuteAudioListener[] = [];

/** Defensive accessor — window.CrazyGames may not exist at all (script not
 *  loaded yet, stale cached HTML, ad-blocker, non-portal host). */
function getSdk(): CrazyGamesSdkApi | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.CrazyGames?.SDK;
  } catch {
    return undefined;
  }
}

function isLive(): boolean {
  return sdkReady && environment !== "disabled" && environment !== null;
}

/** Raw environment probe for diagnostics/telemetry. Never throws. */
export function getCrazyGamesEnvironment(): CrazyGamesEnvironment | null {
  const sdk = getSdk();
  if (!sdk) return null;
  try {
    return sdk.environment ?? null;
  } catch {
    return null;
  }
}

function ensureUnderlyingMuteListener(): void {
  if (underlyingMuteListenerRegistered) return;
  const sdk = getSdk();
  if (!sdk || !isLive()) return;
  try {
    sdk.game.addSettingsChangeListener((event) => {
      if (!event || event.key !== "muteAudio") return;
      const muted = event.value === true;
      for (const listener of muteListeners.slice()) {
        try {
          listener(muted);
        } catch {
          // one bad listener must not break the others
        }
      }
    });
    underlyingMuteListenerRegistered = true;
  } catch {
    // SDK present but registration failed — treat as unavailable.
  }
}

/**
 * Call once at boot, as early as possible (before/around Phaser.Game
 * construction). When the SDK is present and not disabled, awaits
 * SDK.init() and then fires loadingStart() immediately — CrazyGames wants
 * that call "as early as possible when the game begins loading".
 *
 * Resolves in EVERY case (SDK absent, disabled, init() throws) so callers
 * never need to wrap it in try/catch themselves.
 */
export async function installCrazyGamesSdk(): Promise<void> {
  const sdk = getSdk();
  if (!sdk) return;
  try {
    environment = sdk.environment ?? null;
    if (environment === "disabled") return; // every call would throw — stop here
    await sdk.init();
    sdkReady = true;
  } catch {
    sdkReady = false;
    return;
  }
  try {
    sdk.game.loadingStart();
  } catch {
    // a loadingStart failure must never break boot
  }
  // Register (or leave registered) the settings-change listener now that
  // the SDK is actually ready — covers listeners added before init resolved.
  ensureUnderlyingMuteListener();
}

/** Menu/first-frame interactive — pairs with the loadingStart() implicitly
 *  fired inside installCrazyGamesSdk(). */
export function notifyLoadingDone(): void {
  const sdk = getSdk();
  if (!sdk || !isLive()) return;
  try {
    sdk.game.loadingStop();
  } catch {
    // no-op
  }
}

/** Real gameplay begins (entering a live match, public or private). Guards
 *  against a double-start — no-op if a session is already open. */
export function notifyGameplayStart(): void {
  const sdk = getSdk();
  if (!sdk || !isLive()) return;
  if (gameplayActive) return;
  try {
    sdk.game.gameplayStart();
    gameplayActive = true;
  } catch {
    // no-op
  }
}

/** Gameplay session ends (match teardown / leave / disconnect-out). Guards
 *  against an unpaired stop — no-op unless a session is actually open. */
export function notifyGameplayStop(): void {
  const sdk = getSdk();
  if (!sdk || !isLive()) return;
  if (!gameplayActive) return;
  try {
    sdk.game.gameplayStop();
  } catch {
    // no-op
  } finally {
    gameplayActive = false;
  }
}

/** Register a listener for the portal's `muteAudio` setting. Fires with the
 *  current boolean whenever the player (or the portal chrome) changes it.
 *  Multiple listeners are supported; each is isolated from the others'
 *  failures. Safe to call before installCrazyGamesSdk() resolves — the
 *  listener is queued and wired up once (and if) the SDK goes live. */
export function onMuteAudioChange(listener: MuteAudioListener): void {
  muteListeners.push(listener);
  ensureUnderlyingMuteListener();
}

/** CrazyGames' own signal that this session should drop straight into
 *  instant multiplayer with no extra menu friction. False (never true)
 *  outside a live CrazyGames environment. */
export function getInstantMultiplayerFlag(): boolean {
  const sdk = getSdk();
  if (!sdk || !isLive()) return false;
  try {
    return sdk.game.isInstantMultiplayer === true;
  } catch {
    return false;
  }
}

/** Surface a room invite through the portal's own native UI (friends list,
 *  share sheet, etc.) IN ADDITION to whatever clipboard-copy the call site
 *  already does — this never replaces that fallback, only supplements it
 *  inside a live CrazyGames environment. */
export function shareInviteLink(url: string): void {
  const sdk = getSdk();
  if (!sdk || !isLive()) return;
  try {
    sdk.game.inviteLink({ url });
  } catch {
    // no-op — the clipboard-copy path already ran at the call site
  }
}

/** Test-only: resets all module state between specs. Not called from
 *  production code. */
export function __resetCrazyGamesSdkForTests(): void {
  sdkReady = false;
  environment = null;
  gameplayActive = false;
  underlyingMuteListenerRegistered = false;
  muteListeners.length = 0;
}
