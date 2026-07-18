// Card glyphs: what the effect LOOKS LIKE, or a clear symbol of that behavior.
// Stroke-first ink marks — no neon blobs. Identity tint is quiet; silhouette is the read.

import type { CardDefinition } from "../../sim/data/cardTypes.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** Quiet identity tint — never white-hot. */
function ink(hex: string): string {
  return esc(hex);
}

/**
 * Frame: no drop-shadow flood. Subtle edge lift only.
 * Filled shapes use a flat tint, not a radial "glow ball".
 */
function svg(inner: string, _tint: string, view = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="68" height="68" aria-hidden="true" style="display:block">${inner}</svg>`;
}

const ST = (c: string, w = 2) => `fill="none" stroke="${ink(c)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const FL = (c: string, o = 0.28) => `fill="${ink(c)}" fill-opacity="${o}"`;

/** Build a glyph true to combat identity. */
export function cardGlyphHtml(card: CardDefinition): string {
  const c = card.visual?.glowColor ?? "#8ff8ff";
  const shape = card.visual?.iconShape ?? "circle";
  const id = card.id;
  const m = card.modifier;

  switch (id) {
    // ── Delivery ────────────────────────────────────────────────────
    case "raycast-prism":
      // Instant hitscan line + prism tip (no travel time)
      return svg(
        `<line x1="8" y1="32" x2="50" y2="32" ${ST(c, 2.5)}/>
         <line x1="8" y1="32" x2="50" y2="32" stroke="#fff" stroke-width="0.8" opacity="0.35"/>
         <polygon points="50,26 60,32 50,38" ${FL(c, 0.45)} stroke="${ink(c)}" stroke-width="1.2"/>
         <circle cx="10" cy="32" r="2.5" fill="${ink(c)}" opacity="0.7"/>`,
        c,
      );

    case "continuous-refractor":
      // Hold-beam: thick continuous bar with pour marks
      return svg(
        `<rect x="10" y="26" width="44" height="12" rx="2" ${FL(c, 0.2)} stroke="${ink(c)}" stroke-width="1.8"/>
         <line x1="14" y1="32" x2="50" y2="32" stroke="#fff" stroke-width="1.2" opacity="0.25"/>
         <path d="M52 22 L58 32 L52 42" ${ST(c, 1.6)}/>`,
        c,
      );

    case "sticky-ray":
      // Hitscan + sticky blob at end
      return svg(
        `<line x1="8" y1="32" x2="42" y2="32" ${ST(c, 2.2)}/>
         <circle cx="48" cy="32" r="9" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.6"/>
         <circle cx="48" cy="32" r="3.5" fill="${ink(c)}" opacity="0.55"/>
         <path d="M44 40 Q48 46 52 40" ${ST(c, 1.4)}/>`,
        c,
      );

    case "crystal-volley":
      // Single honest shard
      return svg(
        `<path d="M32 10 L42 36 L32 52 L22 36 Z" ${FL(c, 0.32)} stroke="${ink(c)}" stroke-width="1.8"/>
         <line x1="32" y1="16" x2="32" y2="46" stroke="#fff" stroke-width="1" opacity="0.25"/>`,
        c,
      );

    // ── Shape (projectile silhouette = what you see flying) ─────────
    case "circle-rounds":
      return svg(
        `<circle cx="32" cy="32" r="16" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="2"/>
         <circle cx="32" cy="32" r="6" ${ST(c, 1.4)}/>`,
        c,
      );

    case "triangle-rounds":
      return svg(
        `<polygon points="32,10 52,50 12,50" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="2"/>
         <line x1="32" y1="22" x2="32" y2="42" stroke="#fff" stroke-width="1" opacity="0.25"/>`,
        c,
      );

    case "square-rounds":
      // Mass + knock: square with impact arrow
      return svg(
        `<rect x="14" y="14" width="36" height="36" rx="2" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="2"/>
         <path d="M32 22 V42 M26 36 L32 44 L38 36" ${ST("#c8d0d8", 1.8)}/>`,
        c,
      );

    case "x-rounds":
      return svg(
        `<line x1="16" y1="16" x2="48" y2="48" ${ST(c, 5)}/>
         <line x1="48" y1="16" x2="16" y2="48" ${ST(c, 5)}/>
         <line x1="20" y1="20" x2="44" y2="44" stroke="#fff" stroke-width="1.2" opacity="0.3"/>
         <line x1="44" y1="20" x2="20" y2="44" stroke="#fff" stroke-width="1.2" opacity="0.3"/>`,
        c,
      );

    case "i-rounds":
      return svg(
        `<rect x="26" y="10" width="12" height="44" rx="2" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.8"/>
         <line x1="32" y1="14" x2="32" y2="50" stroke="#fff" stroke-width="1" opacity="0.2"/>`,
        c,
      );

    case "orby-blap-blap":
      // Two fat orbs side by side (double blap)
      return svg(
        `<circle cx="22" cy="32" r="13" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.8"/>
         <circle cx="44" cy="32" r="13" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.8"/>
         <text x="22" y="36" text-anchor="middle" font-size="10" fill="#fff" opacity="0.35" font-family="monospace">•</text>`,
        c,
      );

    case "crystal-plating":
      // Hex armor plating + HP bar inside
      return svg(
        `<path d="M32 8 L50 18 L50 40 L32 54 L14 40 L14 18 Z" ${FL(c, 0.22)} stroke="${ink(c)}" stroke-width="2"/>
         <line x1="22" y1="30" x2="42" y2="30" ${ST("#fff", 2.2)} opacity="0.55"/>
         <line x1="22" y1="36" x2="36" y2="36" ${ST("#fff", 2)} opacity="0.35"/>`,
        c,
      );

    // ── Trajectory ──────────────────────────────────────────────────
    case "bouncy-prism":
      // Multi-bounce path off floor
      return svg(
        `<path d="M8 48 L20 20 L34 44 L46 16 L56 36" ${ST(c, 2.2)}/>
         <circle cx="20" cy="20" r="3.5" fill="${ink(c)}" opacity="0.55"/>
         <circle cx="46" cy="16" r="3.5" fill="${ink(c)}" opacity="0.55"/>
         <line x1="6" y1="52" x2="58" y2="52" stroke="#6a7a88" stroke-width="1.5" opacity="0.5"/>`,
        c,
      );

    case "extra-bounce":
      // +1 bounce badge on a single arc
      return svg(
        `<path d="M10 46 Q32 10 54 46" ${ST(c, 2.2)}/>
         <circle cx="54" cy="46" r="4" fill="${ink(c)}" opacity="0.6"/>
         <text x="32" y="40" text-anchor="middle" font-size="11" font-weight="700" fill="${ink(c)}" font-family="monospace">+1</text>`,
        c,
      );

    case "boomerang-return":
      // Out then curl home
      return svg(
        `<path d="M14 40 C14 14 50 14 50 32 C50 48 22 50 18 36" ${ST(c, 2.4)}/>
         <polygon points="16,32 10,38 20,40" fill="${ink(c)}" opacity="0.7"/>
         <circle cx="48" cy="30" r="3" fill="${ink(c)}" opacity="0.45"/>`,
        c,
      );

    case "seeker-facets":
      // One arrow curving into a target ring
      return svg(
        `<circle cx="44" cy="22" r="9" ${ST(c, 1.5)} stroke-dasharray="2.5 2"/>
         <path d="M12 48 C20 40 28 34 38 26" ${ST(c, 2.2)}/>
         <polygon points="36,22 46,24 38,32" fill="${ink(c)}" opacity="0.65"/>
         <circle cx="44" cy="22" r="2.5" fill="${ink(c)}" opacity="0.8"/>`,
        c,
      );

    case "micro-seekers":
      // Small extra homers peeling off
      return svg(
        `<path d="M10 40 L28 28" ${ST(c, 2)}/>
         <path d="M14 48 L30 42" ${ST(c, 1.5)} opacity="0.7"/>
         <path d="M12 32 L26 22" ${ST(c, 1.5)} opacity="0.7"/>
         <circle cx="42" cy="20" r="5" ${ST(c, 1.3)} stroke-dasharray="2 1.5"/>
         <circle cx="48" cy="36" r="4" ${ST(c, 1.2)} stroke-dasharray="2 1.5"/>
         <circle cx="40" cy="48" r="3.5" ${ST(c, 1.1)} stroke-dasharray="2 1.5"/>`,
        c,
      );

    // magnet-spray glyph case removed — card cut 2026-07-18 split-cluster
    // audit (design-axioms.md A7). Unknown ids fall back to the generic
    // bucket-glyph default below (same path ~36 other cards already use).

    case "homing-cluster":
      // Triple fan that all curve to one mark
      return svg(
        `<circle cx="50" cy="28" r="8" ${ST(c, 1.4)} stroke-dasharray="2.5 2"/>
         <path d="M10 20 Q28 18 44 26" ${ST(c, 1.8)}/>
         <path d="M10 32 Q30 30 44 28" ${ST(c, 1.8)}/>
         <path d="M10 44 Q28 40 44 32" ${ST(c, 1.8)}/>
         <circle cx="50" cy="28" r="2.5" fill="${ink(c)}" opacity="0.75"/>`,
        c,
      );

    case "arc-shards":
      // Lob over a wall/platform
      return svg(
        `<path d="M8 48 Q32 6 56 48" ${ST(c, 2.2)}/>
         <rect x="28" y="36" width="8" height="16" rx="1" fill="#4a5560" opacity="0.7"/>
         <polygon points="52,44 58,50 48,52" fill="${ink(c)}" opacity="0.6"/>`,
        c,
      );

    case "zero-g-floaters":
      // Slow floaters hanging in air (no gravity arrow)
      return svg(
        `<circle cx="22" cy="28" r="8" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.5"/>
         <circle cx="42" cy="36" r="10" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.5"/>
         <circle cx="32" cy="18" r="6" ${FL(c, 0.22)} stroke="${ink(c)}" stroke-width="1.3"/>
         <path d="M18 48 H46" stroke="#6a7a88" stroke-width="1" opacity="0.35" stroke-dasharray="3 2"/>
         <path d="M32 52 L32 46" ${ST("#8ab", 1.2)} opacity="0.4"/>`,
        c,
      );

    case "x-velocity":
      // Fast thin projectile + speed chevrons
      return svg(
        `<line x1="8" y1="32" x2="48" y2="32" ${ST(c, 2)}/>
         <polygon points="48,26 58,32 48,38" fill="${ink(c)}" opacity="0.7"/>
         <path d="M14 24 L22 32 L14 40" ${ST(c, 1.5)} opacity="0.45"/>
         <path d="M22 24 L30 32 L22 40" ${ST(c, 1.5)} opacity="0.65"/>`,
        c,
      );

    // ── Quantity / pattern ──────────────────────────────────────────
    // dual-splitter glyph case removed — card cut 2026-07-18 split-cluster
    // audit (design-axioms.md A7). Falls back to the generic bucket-glyph.

    case "triple-fan":
      return svg(
        `<line x1="12" y1="32" x2="52" y2="12" ${ST(c, 1.8)}/>
         <line x1="12" y1="32" x2="54" y2="32" ${ST(c, 1.8)}/>
         <line x1="12" y1="32" x2="52" y2="52" ${ST(c, 1.8)}/>
         <circle cx="12" cy="32" r="3.5" fill="${ink(c)}" opacity="0.65"/>`,
        c,
      );

    case "five-shard-spray":
      return svg(
        `${[12, 22, 32, 42, 52]
          .map((y) => `<line x1="10" y1="32" x2="54" y2="${y}" ${ST(c, 1.4)}/>`)
          .join("")}
         <circle cx="10" cy="32" r="3" fill="${ink(c)}" opacity="0.6"/>`,
        c,
      );

    case "wide-barrage":
      // Side-to-side horizontal flood
      return svg(
        `<line x1="8" y1="18" x2="56" y2="18" ${ST(c, 1.8)}/>
         <line x1="8" y1="32" x2="56" y2="32" ${ST(c, 1.8)}/>
         <line x1="8" y1="46" x2="56" y2="46" ${ST(c, 1.8)}/>
         <path d="M50 12 L58 18 L50 24" ${ST(c, 1.4)}/>
         <path d="M50 40 L58 46 L50 52" ${ST(c, 1.4)}/>`,
        c,
      );

    case "one-more-shard":
      return svg(
        `<circle cx="24" cy="32" r="11" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.8"/>
         <circle cx="44" cy="32" r="11" ${ST(c, 1.8)} stroke-dasharray="3 2"/>
         <text x="44" y="36" text-anchor="middle" font-size="12" font-weight="700" fill="${ink(c)}" font-family="monospace">+</text>`,
        c,
      );

    // needle-hose glyph case removed — card cut 2026-07-18 split-cluster
    // audit (design-axioms.md A7). Falls back to the generic bucket-glyph.

    case "shard-bloom":
      // Close-range burst from center
      return svg(
        `<circle cx="32" cy="32" r="6" ${FL(c, 0.4)} stroke="${ink(c)}" stroke-width="1.5"/>
         ${[0, 45, 90, 135, 180, 225, 270, 315]
           .map((deg) => {
             const a = (deg * Math.PI) / 180;
             const x1 = 32 + Math.cos(a) * 10;
             const y1 = 32 + Math.sin(a) * 10;
             const x2 = 32 + Math.cos(a) * 26;
             const y2 = 32 + Math.sin(a) * 26;
             return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${ST(c, 1.8)}/>`;
           })
           .join("")}`,
        c,
      );

    case "orbiting-satellites":
      return svg(
        `<circle cx="32" cy="32" r="7" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.5"/>
         <circle cx="32" cy="32" r="20" ${ST(c, 1.2)} stroke-dasharray="3.5 2.5" opacity="0.65"/>
         <circle cx="52" cy="32" r="4.5" ${FL(c, 0.4)} stroke="${ink(c)}" stroke-width="1.2"/>
         <circle cx="12" cy="32" r="4.5" ${FL(c, 0.4)} stroke="${ink(c)}" stroke-width="1.2"/>`,
        c,
      );

    // ── Impact ──────────────────────────────────────────────────────
    case "cluster-bomb":
      // Parent hit → 6 child shards
      return svg(
        `<circle cx="32" cy="32" r="8" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.6"/>
         ${[0, 60, 120, 180, 240, 300]
           .map((deg) => {
             const a = (deg * Math.PI) / 180;
             const x = 32 + Math.cos(a) * 20;
             const y = 32 + Math.sin(a) * 20;
             return `<circle cx="${x}" cy="${y}" r="4" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1"/>
                     <line x1="${32 + Math.cos(a) * 9}" y1="${32 + Math.sin(a) * 9}" x2="${x - Math.cos(a) * 4}" y2="${y - Math.sin(a) * 4}" ${ST(c, 1)} opacity="0.5"/>`;
           })
           .join("")}`,
        c,
      );

    case "explosive-facet":
      // Impact burst rings (splash radius)
      return svg(
        `<circle cx="32" cy="32" r="7" ${FL(c, 0.4)} stroke="${ink(c)}" stroke-width="1.5"/>
         <circle cx="32" cy="32" r="16" ${ST(c, 1.6)} opacity="0.7"/>
         <circle cx="32" cy="32" r="24" ${ST(c, 1.2)} opacity="0.4"/>
         <path d="M32 8 V14 M32 50 V56 M8 32 H14 M50 32 H56" ${ST(c, 1.5)}/>`,
        c,
      );

    case "cataclysmic-prism":
      // Massive nova + white core
      return svg(
        `<circle cx="32" cy="32" r="6" fill="#f0f4f8" opacity="0.85"/>
         <circle cx="32" cy="32" r="14" ${ST(c, 2)}/>
         <circle cx="32" cy="32" r="22" ${ST(c, 1.4)} opacity="0.55"/>
         <circle cx="32" cy="32" r="28" ${ST(c, 1)} opacity="0.3"/>
         ${[0, 45, 90, 135]
           .map((deg) => {
             const a = (deg * Math.PI) / 180;
             return `<line x1="${32 + Math.cos(a) * 16}" y1="${32 + Math.sin(a) * 16}" x2="${32 + Math.cos(a) * 30}" y2="${32 + Math.sin(a) * 30}" ${ST(c, 1.6)}/>`;
           })
           .join("")}`,
        c,
      );

    case "sticky-shards":
      // Shard stuck to wall, fuse drip
      return svg(
        `<rect x="44" y="10" width="8" height="44" rx="1" fill="#3a4450" stroke="#6a7888" stroke-width="1"/>
         <circle cx="30" cy="32" r="11" ${FL(c, 0.32)} stroke="${ink(c)}" stroke-width="1.8"/>
         <line x1="38" y1="32" x2="44" y2="32" ${ST(c, 2)}/>
         <path d="M26 40 Q30 48 34 40" ${ST(c, 1.4)} opacity="0.7"/>`,
        c,
      );

    case "pierce-chain":
      // Line through three targets
      return svg(
        `<line x1="6" y1="32" x2="58" y2="32" ${ST(c, 2)}/>
         <circle cx="18" cy="32" r="7" ${ST("#c8d0d8", 1.6)}/>
         <circle cx="34" cy="32" r="7" ${ST("#c8d0d8", 1.6)}/>
         <circle cx="50" cy="32" r="7" ${ST("#c8d0d8", 1.6)}/>
         <line x1="6" y1="32" x2="58" y2="32" stroke="#fff" stroke-width="0.8" opacity="0.25"/>`,
        c,
      );

    case "slow-field":
      // Ground aura under impact
      return svg(
        `<ellipse cx="32" cy="42" rx="22" ry="10" ${ST(c, 1.6)} opacity="0.7"/>
         <ellipse cx="32" cy="42" rx="14" ry="6" ${FL(c, 0.15)} stroke="${ink(c)}" stroke-width="1"/>
         <circle cx="32" cy="24" r="7" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.5"/>
         <path d="M32 31 V36" ${ST(c, 1.5)}/>`,
        c,
      );

    // ── Element ─────────────────────────────────────────────────────
    case "molten-core":
      // Fire: droplet + heat lines
      return svg(
        `<path d="M32 12 C32 12 18 30 18 40 C18 48 24 54 32 54 C40 54 46 48 46 40 C46 30 32 12 32 12 Z" ${FL(c, 0.32)} stroke="${ink(c)}" stroke-width="1.8"/>
         <path d="M26 38 Q32 44 38 38" ${ST("#fff", 1.3)} opacity="0.3"/>`,
        c,
      );

    case "frost-prism":
      // Ice crystal facet (not same as slow-field)
      return svg(
        `<path d="M32 8 L44 20 L44 40 L32 52 L20 40 L20 20 Z" ${FL(c, 0.2)} stroke="${ink(c)}" stroke-width="1.8"/>
         <line x1="32" y1="8" x2="32" y2="52" ${ST(c, 1.2)} opacity="0.6"/>
         <line x1="20" y1="28" x2="44" y2="28" ${ST(c, 1.2)} opacity="0.6"/>
         <line x1="24" y1="16" x2="40" y2="44" ${ST(c, 1)} opacity="0.4"/>
         <line x1="40" y1="16" x2="24" y2="44" ${ST(c, 1)} opacity="0.4"/>`,
        c,
      );

    case "voltaic-spark":
      // Lightning bolt + side arc jump
      return svg(
        `<polyline points="30,8 20,30 30,30 22,56 48,26 36,26 44,8" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.4"/>
         <path d="M48 36 Q56 40 50 48" ${ST(c, 1.5)} opacity="0.7"/>`,
        c,
      );

    case "void-fracture":
      // Dark hole that punches through shield
      return svg(
        `<path d="M18 20 H46 V28 L40 32 L46 36 V44 H18 V36 L24 32 L18 28 Z" ${FL("#1a1028", 0.85)} stroke="${ink(c)}" stroke-width="1.8"/>
         <circle cx="32" cy="32" r="5" fill="#050208"/>
         <line x1="8" y1="32" x2="18" y2="32" ${ST(c, 1.5)} opacity="0.5"/>
         <line x1="46" y1="32" x2="56" y2="32" ${ST(c, 1.5)} opacity="0.5"/>`,
        c,
      );

    case "radiant-overload":
      // White core + sparse rays (power, not fireworks)
      return svg(
        `<circle cx="32" cy="32" r="8" fill="#f4f7fa" opacity="0.9" stroke="${ink(c)}" stroke-width="1.5"/>
         ${[0, 60, 120, 180, 240, 300]
           .map((deg) => {
             const a = (deg * Math.PI) / 180;
             return `<line x1="${32 + Math.cos(a) * 12}" y1="${32 + Math.sin(a) * 12}" x2="${32 + Math.cos(a) * 26}" y2="${32 + Math.sin(a) * 26}" ${ST(c, 2)}/>`;
           })
           .join("")}`,
        c,
      );

    // ── Fire-rate / size ────────────────────────────────────────────
    case "rapid-refraction":
      // Fast tempo: stacked thin needles with clock marks
      return svg(
        `<line x1="8" y1="18" x2="50" y2="18" ${ST(c, 1.5)}/>
         <line x1="8" y1="32" x2="54" y2="32" ${ST(c, 1.5)}/>
         <line x1="8" y1="46" x2="50" y2="46" ${ST(c, 1.5)}/>
         <path d="M52 12 L58 18 L52 24" ${ST(c, 1.3)}/>
         <path d="M56 26 L62 32 L56 38" ${ST(c, 1.3)}/>
         <path d="M52 40 L58 46 L52 52" ${ST(c, 1.3)}/>`,
        c,
      );

    case "needle-compressor":
      // Dense small shots
      return svg(
        `${[16, 24, 32, 40, 48]
          .map((y) => `<line x1="10" y1="${y}" x2="48" y2="${y}" ${ST(c, 1.3)}/>`)
          .join("")}
         <rect x="48" y="14" width="6" height="36" rx="1" ${FL(c, 0.25)} stroke="${ink(c)}" stroke-width="1"/>`,
        c,
      );

    case "heavy-coolant":
      // Big slow shot (fat circle + snail tempo)
      return svg(
        `<circle cx="30" cy="32" r="16" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="2"/>
         <path d="M48 40 C54 40 56 28 50 24" ${ST(c, 1.6)} opacity="0.6"/>
         <circle cx="50" cy="24" r="3" fill="${ink(c)}" opacity="0.5"/>`,
        c,
      );

    case "overcharge":
      // Patient brutal: huge core + impact radius
      return svg(
        `<circle cx="32" cy="32" r="14" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="2.2"/>
         <circle cx="32" cy="32" r="22" ${ST(c, 1.3)} opacity="0.45"/>
         <circle cx="32" cy="32" r="5" fill="${ink(c)}" opacity="0.5"/>`,
        c,
      );

    case "essence-battery":
      // Mag / reload cell
      return svg(
        `<rect x="20" y="12" width="24" height="40" rx="3" ${FL(c, 0.18)} stroke="${ink(c)}" stroke-width="1.8"/>
         <rect x="24" y="30" width="16" height="16" rx="1" ${FL(c, 0.45)}/>
         <rect x="26" y="16" width="12" height="5" rx="1" fill="${ink(c)}" opacity="0.4"/>
         <line x1="28" y1="8" x2="36" y2="8" ${ST(c, 2)}/>`,
        c,
      );

    // ── Defense ─────────────────────────────────────────────────────
    case "mirror-shield":
      // Shield + bounce-back arrow
      return svg(
        `<path d="M32 8 L50 16 L50 36 C50 48 32 56 32 56 C32 56 14 48 14 36 L14 16 Z" ${FL(c, 0.2)} stroke="${ink(c)}" stroke-width="1.8"/>
         <path d="M22 28 L32 22 L42 28" ${ST("#e8eef4", 1.8)}/>
         <path d="M42 28 V42 M38 38 L42 44 L46 38" ${ST("#e8eef4", 1.8)}/>`,
        c,
      );

    case "riot-mirror":
      // Aimed frontal wall + reflect
      return svg(
        `<path d="M16 18 H48 V46 H16 Z" ${FL(c, 0.12)} stroke="${ink(c)}" stroke-width="1.8"/>
         <path d="M48 24 L56 32 L48 40" ${ST(c, 2)}/>
         <path d="M12 32 H48" ${ST(c, 1.5)} opacity="0.5"/>
         <circle cx="24" cy="32" r="3" fill="${ink(c)}" opacity="0.45"/>`,
        c,
      );

    case "wide-parry":
      // Wide dash-bash arc
      return svg(
        `<path d="M8 44 A28 28 0 0 1 56 44" ${ST(c, 3.2)}/>
         <path d="M14 44 A22 22 0 0 1 50 44" ${ST(c, 1.2)} opacity="0.4"/>
         <circle cx="32" cy="48" r="3.5" fill="${ink(c)}" opacity="0.55"/>
         <line x1="6" y1="48" x2="58" y2="48" stroke="#5a6878" stroke-width="1" opacity="0.35"/>`,
        c,
      );

    case "quick-parry":
      // Same arc + tempo tick (short cooldown)
      return svg(
        `<path d="M12 42 A24 24 0 0 1 52 42" ${ST(c, 2.6)}/>
         <circle cx="32" cy="46" r="3" fill="${ink(c)}" opacity="0.55"/>
         <path d="M48 16 A10 10 0 1 1 44 14" ${ST(c, 1.5)}/>
         <polygon points="44,10 48,16 42,16" fill="${ink(c)}" opacity="0.65"/>`,
        c,
      );

    case "aim-barrier":
      // Frontal wall only (aim direction)
      return svg(
        `<path d="M20 14 L44 14 L48 32 L44 50 L20 50" ${ST(c, 2.4)}/>
         <path d="M20 14 L44 14 L48 32 L44 50 L20 50" ${FL(c, 0.12)}/>
         <line x1="8" y1="32" x2="20" y2="32" ${ST(c, 1.5)} opacity="0.5"/>
         <polygon points="14,28 20,32 14,36" fill="${ink(c)}" opacity="0.5"/>`,
        c,
      );

    case "bulwark-core":
      // Fat shield battery
      return svg(
        `<path d="M32 10 L50 18 L50 38 C50 50 32 56 32 56 C32 56 14 50 14 38 L14 18 Z" ${FL(c, 0.25)} stroke="${ink(c)}" stroke-width="2"/>
         <path d="M32 10 L50 18 L50 38 C50 50 32 56 32 56 C32 56 14 50 14 38 L14 18 Z" transform="scale(0.62) translate(20 18)" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.2"/>`,
        c,
      );

    case "rapid-capacitor":
      // Shield recharge: shield + lightning tick
      return svg(
        `<path d="M32 12 L48 20 L48 36 C48 46 32 52 32 52 C32 52 16 46 16 36 L16 20 Z" ${FL(c, 0.18)} stroke="${ink(c)}" stroke-width="1.6"/>
         <polyline points="30,22 26,32 32,32 28,44 40,28 34,28 38,22" fill="${ink(c)}" opacity="0.55"/>`,
        c,
      );

    // ── Mobility ────────────────────────────────────────────────────
    case "sprint-coils":
      // Ground speed: chevrons along ground
      return svg(
        `<line x1="8" y1="48" x2="56" y2="48" stroke="#5a6878" stroke-width="1.5" opacity="0.45"/>
         <path d="M12 40 L22 40 L28 28 L36 40 L48 40" ${ST(c, 2)}/>
         <path d="M40 28 L48 20 L56 28" ${ST(c, 1.8)}/>`,
        c,
      );

    case "blink-dash":
      // Horizontal burst / teleport bar
      return svg(
        `<circle cx="14" cy="32" r="5" ${ST(c, 1.5)} opacity="0.45"/>
         <line x1="20" y1="32" x2="44" y2="32" ${ST(c, 2.5)} stroke-dasharray="3 2"/>
         <circle cx="50" cy="32" r="6" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.6"/>
         <path d="M44 26 L52 32 L44 38" ${ST(c, 1.5)}/>`,
        c,
      );

    case "double-jump":
      // Second jump chevron mid-air
      return svg(
        `<path d="M32 56 V34" ${ST(c, 2)}/>
         <path d="M22 42 L32 32 L42 42" ${ST(c, 2)}/>
         <path d="M24 26 L32 16 L40 26" ${ST(c, 2.2)}/>
         <circle cx="32" cy="12" r="3" fill="${ink(c)}" opacity="0.55"/>`,
        c,
      );

    case "spring-heel":
      // High single jump
      return svg(
        `<path d="M20 50 H44" stroke="#5a6878" stroke-width="1.5" opacity="0.45"/>
         <path d="M32 50 V18" ${ST(c, 2)}/>
         <path d="M22 28 L32 14 L42 28" ${ST(c, 2.2)}/>
         <path d="M26 50 Q32 42 38 50" ${ST(c, 1.5)} opacity="0.5"/>`,
        c,
      );

    case "glide-membrane":
      // Low gravity: figure + hang wings
      return svg(
        `<circle cx="32" cy="22" r="5" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.3"/>
         <line x1="32" y1="27" x2="32" y2="44" ${ST(c, 1.8)}/>
         <path d="M16 30 Q32 24 48 30" ${ST(c, 1.8)}/>
         <path d="M20 36 Q32 32 44 36" ${ST(c, 1.3)} opacity="0.5"/>
         <path d="M28 50 L32 44 L36 50" ${ST(c, 1.4)} opacity="0.4"/>`,
        c,
      );

    case "gecko-grip":
      // Body clinging to wall
      return svg(
        `<rect x="46" y="8" width="8" height="48" rx="1" fill="#3a4450" stroke="#6a7888" stroke-width="1"/>
         <circle cx="32" cy="24" r="6" ${FL(c, 0.35)} stroke="${ink(c)}" stroke-width="1.4"/>
         <line x1="32" y1="30" x2="32" y2="44" ${ST(c, 1.8)}/>
         <line x1="32" y1="24" x2="46" y2="22" ${ST(c, 1.6)}/>
         <line x1="32" y1="40" x2="46" y2="42" ${ST(c, 1.6)}/>
         <circle cx="28" cy="48" r="3" ${ST(c, 1.2)}/>`,
        c,
      );

    case "lead-boots":
      // Heavy boots + down arrow
      return svg(
        `<path d="M16 30 H48 L52 50 H12 Z" ${FL(c, 0.3)} stroke="${ink(c)}" stroke-width="1.6"/>
         <path d="M32 12 V28" ${ST(c, 2)}/>
         <path d="M24 22 L32 30 L40 22" ${ST(c, 1.8)}/>`,
        c,
      );

    case "stolen-fangs":
      // Parry bank → next shot (fangs + lock pip)
      return svg(
        `<path d="M18 14 L26 50 L32 38 L38 50 L46 14" ${ST(c, 2.2)}/>
         <circle cx="50" cy="42" r="8" ${ST(c, 1.5)}/>
         <path d="M46 42 H54 M50 38 V46" ${ST(c, 1.4)}/>`,
        c,
      );

    default:
      break;
  }

  // ── Modifier fallbacks ────────────────────────────────────────────
  if (m?.delivery === "raycast" || m?.delivery === "continuous-beam") {
    return svg(`<line x1="8" y1="32" x2="56" y2="32" ${ST(c, 2.5)}/><circle cx="10" cy="32" r="3" fill="${ink(c)}"/>`, c);
  }
  if (m?.projectile?.pathing === "homing") {
    return svg(
      `<path d="M12 48 C22 36 30 30 42 22" ${ST(c, 2)}/>
       <circle cx="48" cy="18" r="7" ${ST(c, 1.4)} stroke-dasharray="2 1.5"/>`,
      c,
    );
  }
  if (m?.projectile?.pathing === "bounce") {
    return svg(`<path d="M8 48 L22 18 L38 44 L54 16" ${ST(c, 2)}/>`, c);
  }
  if (m?.airJumpsAdd || m?.jumpMultiplier) {
    return svg(`<path d="M32 54 V22 M22 32 L32 18 L42 32" ${ST(c, 2.2)}/>`, c);
  }
  if (m?.dashChargesAdd) {
    return svg(
      `<circle cx="14" cy="32" r="4" ${ST(c, 1.4)}/><line x1="20" y1="32" x2="50" y2="32" ${ST(c, 2)} stroke-dasharray="3 2"/>`,
      c,
    );
  }
  if (m?.mirrorShield || m?.directionalShield) {
    return svg(
      `<path d="M32 10 L50 18 L50 38 C50 50 32 56 32 56 C32 56 14 50 14 38 L14 18 Z" ${FL(c, 0.2)} stroke="${ink(c)}" stroke-width="1.8"/>`,
      c,
    );
  }
  if (m?.maxHealthAdd) {
    return svg(
      `<path d="M32 10 L48 20 L48 40 L32 52 L16 40 L16 20 Z" ${FL(c, 0.22)} stroke="${ink(c)}" stroke-width="1.8"/>
       <path d="M24 32 H40 M32 24 V40" ${ST("#fff", 2)} opacity="0.5"/>`,
      c,
    );
  }
  if (m?.moveSpeedMultiplier && m.moveSpeedMultiplier > 1) {
    return svg(`<path d="M10 40 L26 40 L32 26 L40 40 L54 40" ${ST(c, 2)}/>`, c);
  }

  switch (shape) {
    case "triangle":
      return svg(`<polygon points="32,12 52,50 12,50" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.8"/>`, c);
    case "square":
      return svg(`<rect x="16" y="16" width="32" height="32" rx="2" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.8"/>`, c);
    case "bar":
      return svg(`<rect x="26" y="12" width="12" height="40" rx="2" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.8"/>`, c);
    case "hexagon":
      return svg(
        `<polygon points="32,10 50,21 50,43 32,54 14,43 14,21" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.8"/>`,
        c,
      );
    case "x":
      return svg(
        `<line x1="18" y1="18" x2="46" y2="46" ${ST(c, 5)}/><line x1="46" y1="18" x2="18" y2="46" ${ST(c, 5)}/>`,
        c,
      );
    default:
      return svg(
        `<circle cx="32" cy="32" r="14" ${FL(c, 0.28)} stroke="${ink(c)}" stroke-width="1.8"/>`,
        c,
      );
  }
}
