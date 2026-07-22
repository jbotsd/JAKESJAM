// Class-correct default accent (glow) colors — docs/chassis-design-axioms.md
// CA2: "color is earned, not assigned. Cyan is conjured, gold is grown,
// white is measured." Three distinct light-quality registers, not a
// palette of four arbitrary hues:
//
//   - Crystal cyan (conjured/expended): Geometrician's summoned shards AND
//     Interstice's held blades. Both SHARE this exact value on purpose —
//     CA2/CA3 are explicit that these two classes are differentiated by
//     SILHOUETTE, not color; they intentionally read the same combat-cyan
//     register.
//   - Autogenes gold (grown/carried): Kindled's always-on vein-circuitry.
//     Same hex OnlineMatchScene.spawnWardAbsorbFlash already uses for
//     Kindled's Ward-absorb flash — one gold, not two.
//   - Measured white (observed/instrument): Syzygist's tick-marked ring +
//     spine-conduit. This settles the previously-open "cool-white vs.
//     reserved violet" question from earlier this session — white is the
//     locked answer, not a placeholder.
//
// ARENA-ONLY for this pass (OnlineMatchScene.makePlayerRig is the sole
// consumer) — these are DEFAULTS: a player's own Vessel Creator cosmetic
// pick (accentColor/visorColor/palmColor/jointColor/auraColor) still wins
// over this table when set. See makePlayerRig's color-priority comment for
// the full decision (cosmetic > class default > the old hardcoded
// local-gold/remote-cyan convention, which this table replaces).

import type { ClassId } from "../../sim/data/cardTypes.js";

export type ClassAccentPalette = {
  accentColor: number;
  visorColor: number;
  palmColor: number;
  jointColor: number;
  auraColor: number;
};

/** Combat/live-fire register (visual-language-gnostic-vessel.md's
 *  play-readability cyan, `#8ff8ff`). */
const COMBAT_CYAN = 0x8ff8ff;
/** House/self-generated register (Autogenes gold, `#c9a84c` — the same hex
 *  used across this codebase's render layer for Kindled/house VFX). */
const HOUSE_GOLD = 0xc9a84c;
/** Measured/instrument register — cool white with a faint blue cast, NOT a
 *  dimmed cyan and NOT violet. Syzygist's own register, doing a job
 *  neither gold nor cyan can (legible read-outs, not combat or house glow). */
const MEASURED_WHITE = 0xdff2ff;

const CLASS_ACCENT_PALETTES: Record<ClassId, ClassAccentPalette> = {
  wizard: {
    accentColor: COMBAT_CYAN,
    visorColor: COMBAT_CYAN,
    palmColor: COMBAT_CYAN,
    jointColor: COMBAT_CYAN,
    auraColor: COMBAT_CYAN,
  },
  ninja: {
    accentColor: COMBAT_CYAN,
    visorColor: COMBAT_CYAN,
    palmColor: COMBAT_CYAN,
    jointColor: COMBAT_CYAN,
    auraColor: COMBAT_CYAN,
  },
  paladin: {
    accentColor: HOUSE_GOLD,
    visorColor: HOUSE_GOLD,
    palmColor: HOUSE_GOLD,
    jointColor: HOUSE_GOLD,
    auraColor: HOUSE_GOLD,
  },
  priest: {
    accentColor: MEASURED_WHITE,
    visorColor: MEASURED_WHITE,
    palmColor: MEASURED_WHITE,
    jointColor: MEASURED_WHITE,
    auraColor: MEASURED_WHITE,
  },
};

/** Total, pure lookup — the class union is closed so every ClassId has an
 *  entry; nothing to fall back on. */
export function classAccentPalette(classId: ClassId): ClassAccentPalette {
  return CLASS_ACCENT_PALETTES[classId];
}

// Compact class tag for nameplate rows (2026-07-20, "put what class
// everyone is... including self" — the roster column's every-player
// nameplate, HudSystem.updateScoreRows, had no class signal at all; the
// accent colors above can't carry it alone since wizard/ninja intentionally
// SHARE combat-cyan — classes-goal.md's naming doc bans the dev-id words
// (wizard/ninja/paladin/priest) from any player-facing surface, so these
// are drawn from the persona names (characters.ts), not the dev ids.
const CLASS_SHORT_LABEL: Record<ClassId, string> = {
  wizard: "GEO", // Geometrician
  ninja: "INT", // Interstice
  paladin: "KIN", // Kindled
  priest: "SYZ", // Syzygist
};

export function classShortLabel(classId: ClassId): string {
  return CLASS_SHORT_LABEL[classId];
}
