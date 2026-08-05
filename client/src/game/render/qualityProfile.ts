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

// DPR-aware scales: renderScale = devicePixelRatio is what "native crisp"
// means on HiDPI (see renderResolution.ts). Phones ship DPR 2-3 — the old
// flat 1.0 rendered a THIRD of native and the browser upscaled it (the
// "everything looks low-res on mobile" report, 2026-07-11). Start crisp,
// capped for thermals; the frame-time governor walks it down if the
// silicon can't hold it (ceiling = this starting scale).
const DPR = Math.max(
  1,
  Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 3),
);

const TIERS: Record<QualityTier, Omit<QualityProfile, "tier" | "source">> = {
  potato: { renderScale: 0.75, fpsLimit: 30, particleScale: 0.25, fxLevel: 0, rigStyle: "baked" },
  // min(DPR,2) was a 4× fill jump over the old flat 1.0 — real-phone
  // report 2026-07-11: "major perf hit". 1.5 is still 2.25× sharper than
  // before and mid-range GPUs hold 60 there; the governor covers the rest.
  phone: { renderScale: Math.min(DPR, 1.5), fpsLimit: 60, particleScale: 0.6, fxLevel: 1, rigStyle: "live" },
  standard: { renderScale: Math.min(DPR, 2), fpsLimit: 0, particleScale: 1, fxLevel: 2, rigStyle: "live" },
  ultra: { renderScale: Math.max(1.5, Math.min(DPR * 1.25, 3)), fpsLimit: 0, particleScale: 1, fxLevel: 2, rigStyle: "live" },
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
  // Aged integrated laptop GPUs (2026-07-31, "old laptop lags in the lobby"
  // report): pre-Iris Intel iGPUs and GMA-era parts hit the same fill wall
  // as the Pi on this vector-fill-heavy game, but read as "standard" here
  // and got DPR-native scale + uncapped fps + live rigs. Matches both Mesa
  // strings ("Mesa Intel(R) HD Graphics 4000 (IVB GT2)") and Windows ANGLE
  // ("ANGLE (Intel, Intel(R) HD Graphics 4600 Direct3D11 ...)"). Kept
  // deliberately narrow — Iris/Xe/Arc and UHD 6xx stay "standard" and the
  // (now game-wide) governor covers the middle ground.
  if (
    /\bgma\b|intel\(r\) hd graphics(?! [6-9]\d\d)|hd graphics (2000|2500|3000|4000|4200|4400|4600|5000|5300|5500|515|520|530)\b|\b(ivb|snb|hsw|byt|bsw|bdw) gt/.test(
      renderer,
    )
  ) {
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

// Runtime rig downgrade — separate from the frozen boot-time profile above
// ON PURPOSE (see this file's own "Resolved ONCE at boot" comment: every
// system depends on that object never changing shape mid-session). Added
// 2026-07-13: telemetry's own "resolution-insensitive frame time"
// (governor-futile) signal — RenderGovernor's own admission that dropping
// render SCALE didn't recover frame time, which only happens when the
// bottleneck is CPU work, not GPU fill — fired on real "standard"/"ultra"
// tier sessions (rigStyle "live" by default at those tiers; only "potato"
// ever auto-selects the cheap baked rig). ProceduralPlayerRig fully
// redraws ~150 vector paths per player per frame with no tier gate above
// potato — exactly the kind of CPU cost the governor's own diagnosis
// describes but had no lever to actually fix. This is that lever: a
// SESSION-scoped (not persisted — a temporary slowdown from unrelated load
// shouldn't permanently downgrade a device that's normally fine) override
// RenderGovernor calls when it detects futility, so the game can actually
// respond to its own diagnosis instead of just freezing and living with it.
let runtimeRigDowngrade = false;

/** Call when the frame-time governor concludes resolution scaling can't
 *  help (CPU-bound, not fill-bound) — see renderGovernor.ts. */
export function forceRigDowngrade(): void {
  runtimeRigDowngrade = true;
}

export function isRigDowngraded(): boolean {
  return runtimeRigDowngrade;
}

/** What rig style should actually be used right now — the frozen tier
 *  profile's choice, UNLESS a runtime downgrade has fired since boot. */
export function getEffectiveRigStyle(): "live" | "baked" {
  return runtimeRigDowngrade ? "baked" : getQualityProfile().rigStyle;
}
