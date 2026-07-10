// Instrument seals for draft cards — sci-fi gnostic chrome, not liturgy.
//
// Doctrine (docs/visual-language-gnostic-vessel.md):
//   • At most ONE seal line per card — never Coptic wallpaper
//   • Where Coptic appears, always pair with Latin translit + English gloss
//   • Reads as unparsed instrument charge / seal, not a sermon
//
// Mapping is structural (rarity + primary bucket/category), not per-id spam,
// so new cards inherit a seal without hand-authoring 61 phrases.

import type { CardDefinition, WeaponBucket } from "../../sim/data/cardTypes.js";

/** One instrument seal — Coptic glyph-row + how to say it + what it means. */
export type CardSeal = {
  /** Coptic script (Unicode). Primary visual charge. */
  coptic: string;
  /** Latin transliteration for players who cannot read Coptic. */
  latin: string;
  /** Short English gloss — always shown under the seal. */
  english: string;
  /** Why this seal (for docs/debug; not shown in UI). */
  motif: string;
};

/**
 * Seals are gnostic *structure* dressed as hull instrument marks:
 * light / vessel / path / multitude / strike / element / implement / withdraw.
 * Legendary uses Autogenes (self-begotten) — the house gold register.
 */
const SEALS = {
  /** Common spark — light as scarce inner charge. */
  light: {
    coptic: "ⲪⲰⲤ",
    latin: "phōs",
    english: "light",
    motif: "inner spark / combat cyan register",
  },
  /** Seal / mark — common instrument tick. */
  seal: {
    coptic: "ⲤⲪⲢⲀⲄⲒⲤ",
    latin: "sphragis",
    english: "seal",
    motif: "closed circuit; common rarity tick",
  },
  /** Form / shape bucket. */
  form: {
    coptic: "ⲘⲞⲢⲪⲎ",
    latin: "morphē",
    english: "form",
    motif: "projectile silhouette identity",
  },
  /** Path / trajectory. */
  path: {
    coptic: "ϩⲒⲎ",
    latin: "hie",
    english: "path",
    motif: "arc / homing / bounce grammar",
  },
  /** Multitude / quantity. */
  multitude: {
    coptic: "ⲘⲎϢ",
    latin: "mēš",
    english: "multitude",
    motif: "pellet count / spray",
  },
  /** Strike / impact. */
  strike: {
    coptic: "ⲠⲖⲎⲄⲎ",
    latin: "plēgē",
    english: "strike",
    motif: "impact behavior / detonation",
  },
  /** Element / stoicheion. */
  element: {
    coptic: "ⲤⲦⲞⲒⲬⲈⲒⲞⲚ",
    latin: "stoicheion",
    english: "element",
    motif: "fire ice void radiant grammar",
  },
  /** Projection / delivery (emission from the vessel). */
  projection: {
    coptic: "ⲠⲢⲞⲂⲞⲖⲎ",
    latin: "probolē",
    english: "projection",
    motif: "delivery: raycast / beam / pulse",
  },
  /** Implement / vessel utility. */
  vessel: {
    coptic: "ⲤⲔⲈⲨⲎ",
    latin: "skeuē",
    english: "vessel",
    motif: "utility hull systems",
  },
  /** Motion. */
  motion: {
    coptic: "ⲔⲒⲘ",
    latin: "kim",
    english: "motion",
    motif: "movement augments",
  },
  /** Cover / defense. */
  cover: {
    coptic: "ⲤⲔⲈⲠⲎ",
    latin: "skepē",
    english: "cover",
    motif: "shield / parry systems",
  },
  /** Knowledge — rare uncommon wisdom mark. */
  knowledge: {
    coptic: "ⲤⲞⲞⲨⲚ",
    latin: "sooun",
    english: "knowledge",
    motif: "uncommon revelation tier",
  },
  /** Self-begotten — legendary / Autogenes house gold. */
  autogenes: {
    coptic: "ⲀⲨⲦⲞⲄⲈⲚⲎⲤ",
    latin: "autogenēs",
    english: "self-begotten",
    motif: "legendary house register — Autogenes gold",
  },
  /** Darkness / void — cursed or void-leaning. */
  darkness: {
    coptic: "ⲔⲀⲔⲈ",
    latin: "kake",
    english: "darkness",
    motif: "cursed / void charge",
  },
  /** Withdraw — Allogenes motion (settle, don't ascend). */
  withdraw: {
    coptic: "ⲀⲚⲀⲬⲰⲢⲈⲒ",
    latin: "anachōrei",
    english: "withdraw",
    motif: "settle / dock; anti level-up energy",
  },
} as const satisfies Record<string, CardSeal>;

type SealKey = keyof typeof SEALS;

function primaryBucket(card: CardDefinition): WeaponBucket | undefined {
  return card.buckets?.[0];
}

/**
 * Signature legendaries get their own seal (still Autogenes-adjacent gold).
 * Everything else resolves from bucket / category — one seal per plate.
 */
const CARD_SEAL_OVERRIDES: Partial<Record<string, SealKey>> = {
  "cataclysmic-prism": "strike", // pure white flash / plēgē
  "homing-cluster": "path", // seeks the path
  "sticky-ray": "projection", // emission that clings
  "riot-mirror": "cover", // returns the blow
  "stolen-fangs": "darkness", // borrowed bite from the dark
  "void-fracture": "darkness",
  "radiant-overload": "light",
  "frost-prism": "element",
  "molten-core": "element",
  "blink-dash": "withdraw", // be elsewhere — anachōrei
  "double-jump": "motion",
  "aim-barrier": "cover",
  "raycast-prism": "projection",
  "continuous-refractor": "projection",
};

/**
 * Resolve the single instrument seal for a card plate.
 * Priority: id override → cursed → legendary Autogenes → bucket → category.
 */
export function sealForCard(card: CardDefinition): CardSeal {
  const override = CARD_SEAL_OVERRIDES[card.id];
  if (override) return SEALS[override];

  if (card.rarity === "cursed") return SEALS.darkness;
  if (card.rarity === "legendary") return SEALS.autogenes;

  const bucket = primaryBucket(card);
  if (bucket === "delivery") return SEALS.projection;
  if (bucket === "shape") return SEALS.form;
  if (bucket === "trajectory") return SEALS.path;
  if (bucket === "quantity") return SEALS.multitude;
  if (bucket === "impact") return SEALS.strike;
  if (bucket === "element") return SEALS.element;
  if (bucket === "utility") {
    if (card.category === "movement") return SEALS.motion;
    if (card.category === "defense") return SEALS.cover;
    return SEALS.vessel;
  }

  if (card.category === "movement") return SEALS.motion;
  if (card.category === "defense") return SEALS.cover;
  if (card.category === "weapon") return SEALS.projection;
  if (card.category === "projectile") return SEALS.form;
  if (card.category === "tradeoff") return SEALS.withdraw;

  if (card.rarity === "rare") return SEALS.light;
  if (card.rarity === "uncommon") return SEALS.knowledge;
  return SEALS.seal;
}

/**
 * Compact chip label for results/HUD: "ⲪⲰⲤ  light" — never bare Coptic.
 */
export function formatSealChip(card: CardDefinition): string {
  const s = sealForCard(card);
  return `${s.coptic}  ${s.english}`;
}

/** One-line UI string: Coptic · latin — english */
export function formatSealLine(seal: CardSeal): string {
  return `${seal.coptic}  ·  ${seal.latin}`;
}

export function formatSealGloss(seal: CardSeal): string {
  return seal.english;
}

/** Gold register for legendary / Autogenes seals; cyan for combat seals. */
export function sealAccent(card: CardDefinition): "gold" | "cyan" | "violet" {
  if (card.rarity === "legendary") return "gold";
  if (card.rarity === "cursed") return "violet";
  if (primaryBucket(card) === "element" || card.category === "defense") return "violet";
  return "cyan";
}

export const SEAL_ACCENT_HEX = {
  gold: "#c9a84c",
  cyan: "#8ff8ff",
  violet: "#a78bfa",
} as const;

/** Test/export surface for seal dictionary completeness. */
export function allSeals(): readonly CardSeal[] {
  return Object.values(SEALS);
}

export type { SealKey };
