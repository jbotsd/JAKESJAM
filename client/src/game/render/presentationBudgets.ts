import type {
  PresentationIntensityTier,
} from "./eventPresentationRegistry.js";
import type { QualityTier } from "./qualityProfile.js";

export type PresentationBudget = {
  /** Higher-priority requests may replace lower-priority camera/audio work. */
  priority: number;
  shakeDurationMs: number;
  shakeIntensity: number;
  /** Maximum render-only freeze for this tier. Zero means none. */
  hitStopMs: number;
  /** Relative transient richness; never controls the core gameplay tell. */
  transientScale: number;
};

/** One numerical vocabulary for all packages. Values are ceilings: an event
 * may request less, but must move up a tier to request more. */
export const PRESENTATION_BUDGETS = {
  micro:  { priority: 0, shakeDurationMs: 0,   shakeIntensity: 0,     hitStopMs: 0,  transientScale: 0.35 },
  action: { priority: 1, shakeDurationMs: 60,  shakeIntensity: 0.004, hitStopMs: 0,  transientScale: 0.6 },
  hit:    { priority: 2, shakeDurationMs: 80,  shakeIntensity: 0.008, hitStopMs: 35, transientScale: 0.8 },
  heavy:  { priority: 3, shakeDurationMs: 120, shakeIntensity: 0.01,  hitStopMs: 50, transientScale: 1 },
  cast:   { priority: 4, shakeDurationMs: 120, shakeIntensity: 0.01,  hitStopMs: 50, transientScale: 1 },
  kill:   { priority: 5, shakeDurationMs: 180, shakeIntensity: 0.012, hitStopMs: 80, transientScale: 1.2 },
  round:  { priority: 6, shakeDurationMs: 180, shakeIntensity: 0.012, hitStopMs: 80, transientScale: 1.2 },
} as const satisfies Record<PresentationIntensityTier, PresentationBudget>;

export const QUALITY_PRESENTATION_SCALE = {
  potato: 0.25,
  phone: 0.6,
  standard: 1,
  ultra: 1,
} as const satisfies Record<QualityTier, number>;

export function presentationBudget(tier: PresentationIntensityTier): PresentationBudget {
  return PRESENTATION_BUDGETS[tier];
}

/** Cosmetic transient allowance only. Core pose, silhouette, state chip, and
 * effect-site tell are explicitly outside this multiplier. */
export function transientAllowance(
  tier: PresentationIntensityTier,
  quality: QualityTier,
): number {
  return PRESENTATION_BUDGETS[tier].transientScale * QUALITY_PRESENTATION_SCALE[quality];
}
