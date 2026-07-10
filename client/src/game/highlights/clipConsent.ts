// Consent switch for highlight-clip capture. ClipRecorder records the
// player's own gameplay and uploads it to the server.
//
// Product default: ON. Players can opt out via Settings / match chrome.
//
// Enabled when:
//   1. localStorage is unset or "1" (default ON), or
//   2. `?clips=1` (dev force-on, does not persist).
// Disabled when:
//   1. localStorage is "0" (explicit opt-out), or
//   2. `?clips=0` (dev force-off, does not persist).

const CLIPS_CONSENT_KEY = "jakesjam-clips-enabled";

function urlClipsOverride(): boolean | null {
  try {
    const v = new URLSearchParams(window.location.search).get("clips");
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // No window/location (tests).
  }
  return null;
}

function storedConsent(): boolean {
  try {
    const v = localStorage.getItem(CLIPS_CONSENT_KEY);
    // Explicit opt-out only. Missing key → default ON.
    if (v === "0") return false;
    return true;
  } catch {
    // Storage unavailable → default ON (same as product default).
    return true;
  }
}

export function isClipsEnabled(): boolean {
  const url = urlClipsOverride();
  if (url !== null) return url;
  return storedConsent();
}

/** The persistent toggle's own state (ignores the ?clips= URL override) —
 *  what the Options checkbox should display. Default ON when unset. */
export function isClipsConsentStored(): boolean {
  return storedConsent();
}

export function setClipsEnabled(enabled: boolean): void {
  try {
    // Always write so default-ON semantics stay stable: "0" = opt out,
    // "1" = opt in. Removing the key would flip people back to default ON.
    localStorage.setItem(CLIPS_CONSENT_KEY, enabled ? "1" : "0");
  } catch {
    // Private mode etc. — the session just won't persist the choice.
  }
}
