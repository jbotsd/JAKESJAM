// Render-resolution dial — the master fidelity knob of the quality ladder
// (docs/RENDER_OVERHAUL_PLAN.md). Phaser 4 has no resolution/DPR knob: the
// canvas backing store always equals the game size. So the dial works by
// sizing the game at (window CSS px × renderScale) while the ScaleManager's
// zoom (1/renderScale) pins the canvas CSS size to the window — the browser
// up/downscales the backing store to fit. Pointer input flows through the
// same zoom transform, so hit coordinates stay correct at any scale.
//
// renderScale < 1  → weak GPUs render fewer pixels (Pi / phone tiers).
// renderScale = devicePixelRatio → native-crisp on HiDPI displays.
// renderScale > DPR → supersampling for strong GPUs (with MSAA on top).
//
// DEFAULT IS 1.0 — bit-identical to the pre-dial behavior — because HUD
// layout still uses fixed px fonts/offsets that shrink at rs≠1; the UI
// uiScale sweep (QualityProfile phase) has to land before DPR-crisp can be
// the default. Until then the dial is an opt-in: `?rs=1.5` or
// localStorage jj_render_scale.

import Phaser from "phaser";

const STORAGE_KEY = "jj_render_scale";
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

let cachedScale: number | null = null;

function clamp(v: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
}

/** The active render scale. URL `?rs=` wins (and persists), else stored
 *  value, else 1.0. Read once — a change requires reload (the WebGL
 *  context itself survives resize, but every scene's layout assumes a
 *  boot-constant scale until the QualityProfile governor lands). */
export function getRenderScale(): number {
  if (cachedScale !== null) return cachedScale;
  let scale = 1;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("rs");
    if (fromUrl !== null && Number.isFinite(Number(fromUrl))) {
      scale = clamp(Number(fromUrl));
      localStorage.setItem(STORAGE_KEY, String(scale));
    } else {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) scale = clamp(stored);
    }
  } catch {
    // Storage unavailable (private mode) — run at 1.
  }
  cachedScale = scale;
  return scale;
}

/** Backing-store size for the current window at the active scale. */
export function backingSize(): { width: number; height: number } {
  const rs = getRenderScale();
  return {
    width: Math.max(2, Math.round(window.innerWidth * rs)),
    height: Math.max(2, Math.round(window.innerHeight * rs)),
  };
}

/** HUD-space (CSS px) width for a scene. HUD objects are laid out in CSS
 *  pixels and the HUD camera zooms by renderScale, so HUD physical size is
 *  independent of the backing resolution (screen = cssX × rs exactly,
 *  because backing = css × rs and zoom pivots at the viewport centre). */
export function uiWidth(scene: Phaser.Scene): number {
  return scene.scale.width / getRenderScale();
}

/** HUD-space (CSS px) height — see uiWidth. */
export function uiHeight(scene: Phaser.Scene): number {
  return scene.scale.height / getRenderScale();
}

/** Keep the backing store tracking the window. Scale.NONE mode does no
 *  automatic resizing, so this owns what Scale.RESIZE used to do — every
 *  resize re-derives game size from CSS×rs and the ScaleManager re-applies
 *  its zoom to hold the canvas CSS size at the window size. Emits the same
 *  Phaser.Scale.Events.RESIZE all existing HUD/camera listeners rely on. */
export function installRenderResolution(game: Phaser.Game): void {
  const apply = (): void => {
    const { width, height } = backingSize();
    if (game.scale.width !== width || game.scale.height !== height) {
      game.scale.resize(width, height);
    }
  };
  window.addEventListener("resize", apply);
  // Some mobile browsers settle innerWidth/innerHeight a tick after load
  // (URL bar collapse) — one deferred pass catches that.
  setTimeout(apply, 0);
}
