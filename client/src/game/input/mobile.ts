// Mobile / touch detection — single source of truth for "should we show
// touch controls and the mobile UI".
//
// Heuristic (well-tested across the platform-fighter genre): a device is
// "touch-primary" when it exposes touch points AND its primary pointer is
// coarse (finger, not mouse). This correctly includes phones/tablets and
// excludes touch-screen laptops that still have a trackpad/mouse. A URL
// override (?touch=1 / ?touch=0) forces it either way for testing on
// desktop and for the rare device the heuristic misreads.
//
// CACHED (2026-07-15, camera-skew investigation): `matchMedia("(pointer:
// coarse)")` is a LIVE query — its `.matches` value is allowed to change at
// any time the UA thinks the "primary pointer" changed, independent of any
// resize. OnlineMatchScene.applyMobileCamera() re-derives its zoom PRESET
// (desktop 1.4 / touch-landscape 1.0 / portrait 0.8 — a 40%+ jump, not a
// subtle one) from isTouchPrimary() on every Phaser "resize" event —
// including the frame-time governor's own internal renderScale resizes
// (setRenderScaleRuntime → game.scale.resize), which fire whether or not
// the device actually changed. If the coarse-pointer query is ever
// momentarily true for an unrelated reason, the NEXT governor resize
// (not a real device change) would apply a completely different camera
// preset — reading as "camera cuts to the wrong view" — and it would only
// self-correct once a LATER resize happened to re-read the query as false
// again ("fixes itself after a while"). Caching this and only refreshing it
// on genuine external resize/orientation/fullscreen signals (see
// invalidateMobileDetectionCache, called from installRenderResolution's
// real listeners — never from the governor's own resize) removes that
// window entirely while still tracking real device/orientation changes.
let cachedTouchPrimary: boolean | null = null;

/** Force a re-read of touch/pointer state on the next isTouchPrimary() call.
 *  Call ONLY from genuine external signals (window resize, orientationchange,
 *  fullscreenchange, visualViewport resize) — never from the render
 *  governor's internal resize, which isn't a real device change. */
export function invalidateMobileDetectionCache(): void {
  cachedTouchPrimary = null;
}

function readTouchPrimary(): boolean {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const forced = params.get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;

  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const hasTouch =
    (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return hasTouch && coarse;
}

export function isTouchPrimary(): boolean {
  if (cachedTouchPrimary === null) cachedTouchPrimary = readTouchPrimary();
  return cachedTouchPrimary;
}

/** True when the viewport is taller than wide. Portrait is the mobile-first
 *  orientation for JAKESJAM (game on top, controls in a bottom band). */
export function isPortrait(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerHeight >= window.innerWidth;
}

/** Touch device currently held upright — the target mobile layout. */
export function isPortraitMobile(): boolean {
  return isTouchPrimary() && isPortrait();
}

/**
 * Go fullscreen (hides the mobile browser URL bar / chrome — the "massive
 * banner") and lock to portrait when possible. Must be called from within a
 * user-gesture handler. All calls are best-effort: iOS Safari has no
 * Fullscreen API (there, "Add to Home Screen" gives a chrome-less PWA via the
 * apple-mobile-web-app meta tags), and orientation lock only works in
 * fullscreen on Android — failures are swallowed.
 */
export async function enterFullscreenPortrait(): Promise<void> {
  if (typeof document === "undefined") return;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    }
  } catch {
    /* user denied or unsupported — game still runs, just with chrome */
  }
  // NO orientation lock (removed 2026-07-11): locking at join time meant
  // rotating the phone mid-match could never swap layouts — landscape and
  // portrait are both first-class now and the layout follows the hold.
}
