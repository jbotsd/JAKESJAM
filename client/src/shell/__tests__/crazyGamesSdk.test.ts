// CrazyGames SDK v3 wrapper — environment-gating + lifecycle-pairing
// contract. bun:test has no DOM, so `window` is stubbed per-test (see
// touchControls.test.ts for the established pattern) rather than imported
// from a real browser.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetCrazyGamesSdkForTests,
  getCrazyGamesEnvironment,
  getInstantMultiplayerFlag,
  installCrazyGamesSdk,
  notifyGameplayStart,
  notifyGameplayStop,
  notifyLoadingDone,
  onMuteAudioChange,
  shareInviteLink,
} from "../crazyGamesSdk.js";

type ChangeEvent = { key: string; value: unknown };
type ChangeListener = (event: ChangeEvent) => void;

interface MockGame {
  loadingStart: () => void;
  loadingStop: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  addSettingsChangeListener: (listener: ChangeListener) => void;
  isInstantMultiplayer?: boolean;
  inviteLink: (params: { url: string }) => void;
}

interface MockSdk {
  environment: string;
  init: () => Promise<void>;
  game: MockGame;
}

/** A "live" mock SDK (environment "local" or "crazygames") that records
 *  every call it receives so tests can assert exact call counts/pairing. */
function makeLiveSdk(
  environment: "local" | "crazygames",
  opts?: { isInstantMultiplayer?: boolean; failInit?: boolean },
): { sdk: MockSdk; calls: string[]; fireSettingsChange: (e: ChangeEvent) => void } {
  const calls: string[] = [];
  let changeListener: ChangeListener | null = null;
  const sdk: MockSdk = {
    environment,
    init: async () => {
      if (opts?.failInit) throw new Error("init failed");
      calls.push("init");
    },
    game: {
      loadingStart: () => calls.push("loadingStart"),
      loadingStop: () => calls.push("loadingStop"),
      gameplayStart: () => calls.push("gameplayStart"),
      gameplayStop: () => calls.push("gameplayStop"),
      addSettingsChangeListener: (listener) => {
        changeListener = listener;
        calls.push("addSettingsChangeListener");
      },
      isInstantMultiplayer: opts?.isInstantMultiplayer ?? false,
      inviteLink: (params) => calls.push(`inviteLink:${params.url}`),
    },
  };
  return {
    sdk,
    calls,
    fireSettingsChange: (e) => changeListener?.(e),
  };
}

/** A "disabled" mock SDK — every method THROWS, matching CrazyGames' real
 *  documented behavior on any non-portal, non-localhost host (this is
 *  exactly the play.elyad.io production-site scenario). */
function makeDisabledSdk(): MockSdk {
  const boom = (): never => {
    throw new Error("disabled SDK call — must never happen");
  };
  return {
    environment: "disabled",
    init: async () => boom(),
    game: {
      loadingStart: boom,
      loadingStop: boom,
      gameplayStart: boom,
      gameplayStop: boom,
      addSettingsChangeListener: boom,
      isInstantMultiplayer: undefined,
      inviteLink: boom,
    },
  };
}

function setWindowCrazyGames(sdk: MockSdk | undefined): void {
  (globalThis as { window?: { CrazyGames?: { SDK?: MockSdk } } }).window = sdk
    ? { CrazyGames: { SDK: sdk } }
    : {};
}

beforeEach(() => {
  __resetCrazyGamesSdkForTests();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  __resetCrazyGamesSdkForTests();
});

describe("crazyGamesSdk — no window.CrazyGames at all", () => {
  test("every export is a silent no-op, nothing throws", async () => {
    setWindowCrazyGames(undefined);
    await expect(installCrazyGamesSdk()).resolves.toBeUndefined();
    expect(() => notifyLoadingDone()).not.toThrow();
    expect(() => notifyGameplayStart()).not.toThrow();
    expect(() => notifyGameplayStop()).not.toThrow();
    expect(() => shareInviteLink("https://example.com")).not.toThrow();
    expect(() => onMuteAudioChange(() => {})).not.toThrow();
    expect(getInstantMultiplayerFlag()).toBe(false);
    expect(getCrazyGamesEnvironment()).toBeNull();
  });

  test("window entirely undefined (module accessed before script tag exists)", async () => {
    delete (globalThis as { window?: unknown }).window;
    await expect(installCrazyGamesSdk()).resolves.toBeUndefined();
    expect(() => notifyGameplayStart()).not.toThrow();
    expect(getInstantMultiplayerFlag()).toBe(false);
  });
});

describe("crazyGamesSdk — environment: disabled (e.g. play.elyad.io production)", () => {
  test("init() is never called; no game.* method is ever invoked", async () => {
    const disabled = makeDisabledSdk();
    setWindowCrazyGames(disabled);
    await expect(installCrazyGamesSdk()).resolves.toBeUndefined();
    // Every one of these would throw immediately if the wrapper ever
    // reached the real SDK method — none of them should.
    expect(() => notifyLoadingDone()).not.toThrow();
    expect(() => notifyGameplayStart()).not.toThrow();
    expect(() => notifyGameplayStop()).not.toThrow();
    expect(() => shareInviteLink("https://example.com")).not.toThrow();
    expect(() => onMuteAudioChange(() => {})).not.toThrow();
    expect(getInstantMultiplayerFlag()).toBe(false);
    expect(getCrazyGamesEnvironment()).toBe("disabled");
  });
});

describe("crazyGamesSdk — live environment (local / crazygames)", () => {
  test("installCrazyGamesSdk awaits init() then fires loadingStart exactly once", async () => {
    const { sdk, calls } = makeLiveSdk("local");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();
    expect(calls).toEqual(["init", "loadingStart", "addSettingsChangeListener"]);
  });

  test("notifyLoadingDone maps to loadingStop", async () => {
    const { sdk, calls } = makeLiveSdk("crazygames");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();
    notifyLoadingDone();
    expect(calls).toContain("loadingStop");
  });

  test("gameplayStart/Stop pairing: no double-start, no unpaired stop", async () => {
    const { sdk, calls } = makeLiveSdk("crazygames");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();

    notifyGameplayStart();
    notifyGameplayStart(); // double-start attempt — must be swallowed
    expect(calls.filter((c) => c === "gameplayStart")).toHaveLength(1);

    notifyGameplayStop();
    notifyGameplayStop(); // unpaired second stop — must be swallowed
    expect(calls.filter((c) => c === "gameplayStop")).toHaveLength(1);

    // A fresh start after a real stop must fire again (not stuck latched).
    notifyGameplayStart();
    expect(calls.filter((c) => c === "gameplayStart")).toHaveLength(2);
  });

  test("getInstantMultiplayerFlag reflects the SDK's flag only when live", async () => {
    const { sdk } = makeLiveSdk("crazygames", { isInstantMultiplayer: true });
    setWindowCrazyGames(sdk);
    expect(getInstantMultiplayerFlag()).toBe(false); // not installed yet
    await installCrazyGamesSdk();
    expect(getInstantMultiplayerFlag()).toBe(true);
  });

  test("shareInviteLink forwards the url to SDK.game.inviteLink", async () => {
    const { sdk, calls } = makeLiveSdk("local");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();
    shareInviteLink("https://play.elyad.io/?room=ABC123");
    expect(calls).toContain("inviteLink:https://play.elyad.io/?room=ABC123");
  });

  test("onMuteAudioChange listener fires with the muteAudio boolean, ignores other keys", async () => {
    const { sdk, fireSettingsChange } = makeLiveSdk("crazygames");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();

    const seen: boolean[] = [];
    onMuteAudioChange((muted) => seen.push(muted));

    fireSettingsChange({ key: "someOtherSetting", value: true });
    expect(seen).toEqual([]);

    fireSettingsChange({ key: "muteAudio", value: true });
    expect(seen).toEqual([true]);

    fireSettingsChange({ key: "muteAudio", value: false });
    expect(seen).toEqual([true, false]);
  });

  test("onMuteAudioChange registered BEFORE install still receives events after install resolves", async () => {
    const { sdk, fireSettingsChange } = makeLiveSdk("local");
    setWindowCrazyGames(sdk);

    const seen: boolean[] = [];
    onMuteAudioChange((muted) => seen.push(muted));
    // Not installed yet — nothing to fire against, but must not throw.
    expect(seen).toEqual([]);

    await installCrazyGamesSdk();
    fireSettingsChange({ key: "muteAudio", value: true });
    expect(seen).toEqual([true]);
  });

  test("a listener that throws does not break other listeners", async () => {
    const { sdk, fireSettingsChange } = makeLiveSdk("crazygames");
    setWindowCrazyGames(sdk);
    await installCrazyGamesSdk();

    const seen: boolean[] = [];
    onMuteAudioChange(() => {
      throw new Error("boom");
    });
    onMuteAudioChange((muted) => seen.push(muted));

    expect(() => fireSettingsChange({ key: "muteAudio", value: true })).not.toThrow();
    expect(seen).toEqual([true]);
  });

  test("init() rejecting leaves the SDK non-live — everything stays a no-op", async () => {
    const { sdk, calls } = makeLiveSdk("local", { failInit: true });
    setWindowCrazyGames(sdk);
    await expect(installCrazyGamesSdk()).resolves.toBeUndefined();
    expect(calls).toEqual([]); // init failed before recording, loadingStart never reached
    expect(() => notifyGameplayStart()).not.toThrow();
    expect(getInstantMultiplayerFlag()).toBe(false);
  });
});
