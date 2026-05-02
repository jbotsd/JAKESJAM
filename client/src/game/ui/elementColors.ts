// Shared element-to-hex-color map. Imported by DraftScene and cardIcons.
// Kept as a const satisfies so callers get literal-typed keys (no string widening).

import type { ElementType } from "../../sim/types";

export const ELEMENT_COLORS = {
  crystal: 0x50e3c2,
  neutral: 0xf7fbff,
  fire: 0xff7a18,
  ice: 0x93c5fd,
  lightning: 0xfef08a,
  void: 0xa78bfa,
  radiant: 0xfff7d6,
  electric: 0xfef08a,
  toxic: 0x86efac,
  sticky: 0xf97316,
  explosive: 0xfb7185,
} as const satisfies Record<ElementType, number>;

export const NEUTRAL_ELEMENTS = new Set<ElementType>(["crystal", "neutral"]);
