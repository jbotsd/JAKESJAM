// Mobile / touch detection — single source of truth for "should we show
// touch controls and the mobile UI".
//
// Heuristic (well-tested across the platform-fighter genre): a device is
// "touch-primary" when it exposes touch points AND its primary pointer is
// coarse (finger, not mouse). This correctly includes phones/tablets and
// excludes touch-screen laptops that still have a trackpad/mouse. A URL
// override (?touch=1 / ?touch=0) forces it either way for testing on
// desktop and for the rare device the heuristic misreads.

export function isTouchPrimary(): boolean {
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
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    // Respect the player's current hold: locking hard to portrait while the
    // phone is held sideways would yank the screen out from under someone
    // who just dismissed the rotate hint ("play sideways anyway").
    await orientation.lock?.(isPortrait() ? "portrait" : "landscape");
  } catch {
    /* orientation lock unsupported / not allowed */
  }
}
