// Consent switch for highlight-clip capture. ClipRecorder records the
// player's own gameplay and uploads it to the server, so it must never
// activate silently — this module is the single source of truth for
// whether the player has opted in.
//
// Two ways to be enabled:
//   1. The persistent Options toggle (localStorage) — the real product path.
//   2. `?clips=1` — the original developer/tester override, kept for e2e
//      tests and debugging. It does NOT persist.

const CLIPS_CONSENT_KEY = "jakesjam-clips-enabled";

export function isClipsEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("clips") === "1") return true;
  } catch {
    // No window/location (tests) — fall through to storage.
  }
  try {
    return localStorage.getItem(CLIPS_CONSENT_KEY) === "1";
  } catch {
    return false; // storage unavailable → default OFF (consent can't persist)
  }
}

/** The persistent toggle's own state (ignores the ?clips=1 dev override) —
 *  what the Options checkbox should display. */
export function isClipsConsentStored(): boolean {
  try {
    return localStorage.getItem(CLIPS_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setClipsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(CLIPS_CONSENT_KEY, "1");
    else localStorage.removeItem(CLIPS_CONSENT_KEY);
  } catch {
    // Private mode etc. — the session just won't persist the choice.
  }
}
