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

/** True when the viewport is taller than wide — a brawler wants landscape. */
export function isPortrait(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerHeight > window.innerWidth;
}
