// QualityProfile — the single source of truth for fidelity decisions
// (docs/RENDER_OVERHAUL_PLAN.md, "one QualityProfile object; no scattered
// per-device if-statements"). Resolved ONCE at boot, before the Phaser game
// is constructed; every visual system reads the same frozen object.
//
// Tier ladder (from the Pi→phone→4070 research):
//   potato   — VideoCore / software GL / very weak: 0.75× render scale,
//              30fps cap, minimal particles, no glow layers.
//   phone    — touch mobile: DPR-capped scale ×0.8, 60fps cap (thermals),
//              reduced particles, halo-sprite glow only.
//   standard — default desktop/laptop: full effects at DPR-native scale.
//   ultra    — discrete-GPU desktops: supersampling headroom + uncapped fps
//              (rAF follows the display, sim stays fixed-tick).
//
// Precedence: URL ?quality= (persists) > stored user choice > auto-detect.
// The user's choice ALWAYS wins over detection (Krunker rule). ?rs= remains
// a raw renderScale override on top of whatever tier resolves.

export type QualityTier = "potato" | "phone" | "standard" | "ultra";

export type QualityProfile = {
  tier: QualityTier;
  /** How the tier was picked — shown in settings ("Auto (phone)" vs "Phone"). */
  source: "auto" | "user";
  /** Tier's render scale before the ?rs= raw override (renderResolution.ts
   *  resolves the final value; this is the tier's contribution). */
  renderScale: number;
  /** 0 = uncapped (Phaser follows the display's rAF rate). */
  fpsLimit: number;
  /** Multiplier on particle pool budgets / spawn counts (0..1]. */
  particleScale: number;
  /** 0 = no glow/lighting layers, 1 = selective, 2 = full stack. */
  fxLevel: 0 | 1 | 2;
  /** Rig painter: live vector (the game's identity) or the baked twin
   *  (same pose solve, textured-quad painters — see BakedPlayerRig). */
  rigStyle: "live" | "baked";
};

const TIER_KEY = "jj_quality_tier";

const TIERS: Record<QualityTier, Omit<QualityProfile, "tier" | "source">> = {
  potato: { renderScale: 0.75, fpsLimit: 30, particleScale: 0.25, fxLevel: 0, rigStyle: "baked" },
  phone: { renderScale: 1, fpsLimit: 60, particleScale: 0.6, fxLevel: 1, rigStyle: "live" },
  standard: { renderScale: 1, fpsLimit: 0, particleScale: 1, fxLevel: 2, rigStyle: "live" },
  ultra: { renderScale: 1.5, fpsLimit: 0, particleScale: 1, fxLevel: 2, rigStyle: "live" },
};

function isTier(v: string | null): v is QualityTier {
  return v === "potato" || v === "phone" || v === "standard" || v === "ultra";
}

/** Renderer string from a throwaway WebGL context (cheap, cached by the
 *  browser). Empty string when unavailable — detection falls through. */
export function probeRendererString(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ?? (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return renderer;
  } catch {
    return "";
  }
}

export function isTouchMobile(): boolean {
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  return coarse && (mobileUa || navigator.maxTouchPoints > 1);
}

function detectTier(): QualityTier {
  const renderer = probeRendererString().toLowerCase();
  // Software rasterizers and the Pi's VideoCore: the fill-rate wall.
  if (/videocore|v3d|swiftshader|llvmpipe|softpipe|software rasterizer/.test(renderer)) {
    return "potato";
  }
  if (isTouchMobile()) return "phone";
  // Discrete desktop GPUs earn supersampling. Conservative match — an
  // unknown renderer string stays "standard" and the user can opt up.
  if (/(rtx|gtx|geforce|radeon rx|radeon pro|arc a|arc b)/.test(renderer)) {
    return "ultra";
  }
  return "standard";
}

let cached: QualityProfile | null = null;

/** The active profile. First call resolves and freezes it (boot-time). */
export function getQualityProfile(): QualityProfile {
  if (cached) return cached;
  let tier: QualityTier;
  let source: "auto" | "user" = "auto";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("quality");
    if (isTier(fromUrl)) {
      tier = fromUrl;
      source = "user";
      localStorage.setItem(TIER_KEY, fromUrl);
    } else {
      const stored = localStorage.getItem(TIER_KEY);
      if (isTier(stored)) {
        tier = stored;
        source = "user";
      } else {
        tier = detectTier();
      }
    }
  } catch {
    tier = "standard";
  }
  cached = Object.freeze({ tier, source, ...TIERS[tier] });
  return cached;
}

/** Persist a user tier choice. Takes effect on reload (context flags and
 *  boot-sized systems depend on it; the settings UI says so). */
export function setQualityTier(tier: QualityTier | null): void {
  try {
    if (tier === null) localStorage.removeItem(TIER_KEY);
    else localStorage.setItem(TIER_KEY, tier);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}

/** What auto-detection would pick right now (settings UI shows "Auto (X)"). */
export function detectedTier(): QualityTier {
  return detectTier();
}
