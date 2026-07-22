// Nameplate + action-bar buff/debuff chip derivation — one shared
// descriptor table so a window-buff field on PlayerEntity only has to be
// named ONCE to reach both screen surfaces. Pulled out of OnlineMatchScene
// (class-overhaul-workboard.md chunk 4.2, "Nameplate status legibility":
// "spectator-visible tells for the new window-bearing buffs... action-bar
// cooldowns are covered, nameplate chips aren't") so the derivation is
// unit-testable without a Phaser scene — same "sim state in, display model
// out, no Phaser" pattern as activeSlots.ts / acquiredAbilities.ts.
//
// Two consumers read this table today:
//   - deriveHudChips: the local player's text chip strip (HudSystem's
//     drawChips) AND the bottom action bar's buff/debuff tick row
//     (ActionBarSystem's shown/drawBuffTick) — both local-only, detailed.
//   - deriveNameplateTicks: EVERY roster player's compact per-row status
//     marks on the fused nameplate column (HudSystem's updateScoreRows) —
//     the one spectator/opponent-visible surface. This is the "nameplate
//     chip" the workboard chunk names: it's the only place a player with an
//     active Sunlance/Overclock/Resonance window (or any other *UntilTick
//     buff below) is legible to anyone OTHER than themselves.
//
// Adding a new timed window-buff field to PlayerEntity: add one row below
// (buff or debuff table, whichever reads true) and both surfaces pick it up
// automatically. Do NOT add slotNCooldownUntilTick rows here — cooldowns are
// the action bar's job (ActionBarSystem's diamond sweep); this table is for
// WINDOW-BUFF state only, the thing that has no other spectator-visible
// tell today.

import { STEP_MS } from "../../sim/constants.js";
import { PALETTE } from "./palette.js";
import type { PlayerEntity } from "../../sim/types.js";
import type { HudChip, NameplateStatusTick } from "./HudSystem.js";

export type BuffDescriptor = {
  key: string;
  field: keyof PlayerEntity;
  label: string;
  color: number;
  /** Standard application duration — the nameplate decay arc's full scale
   *  (a READ of roughly-how-long-left, not a stopwatch). */
  nominalMs: number;
};

export const BUFF_DESCRIPTORS: BuffDescriptor[] = [
  { key: "overcharge", field: "overchargeUntilTick", label: "OC", color: 0xffd166, nominalMs: 8000 },
  { key: "damage-amp", field: "damageAmpUntilTick", label: "DMG", color: 0xfb7185, nominalMs: 8000 },
  { key: "speed", field: "speedBoostUntilTick", label: "SPD", color: 0x67e8f9, nominalMs: 8000 },
  { key: "melee", field: "meleeModeUntilTick", label: "MEL", color: 0xf97316, nominalMs: 9000 },
  { key: "boss", field: "bossModeUntilTick", label: "BOSS", color: 0xfff7d6, nominalMs: 16000 },
  // Ward shell (six-axes Layer 1): the post-cast damage gate a Ward hand
  // earns. Sapphire — the shield/EMIT resource family, not an element.
  { key: "ward", field: "wardShellUntilTick", label: "WARD", color: 0x38bdf8, nominalMs: 700 },
  // Crimson Tithe window (six-axes Layer 2): shots leech while live.
  // Crimson — the Drain register, deliberately not an element color.
  { key: "tithe", field: "titheUntilTick", label: "TITHE", color: 0xdc2626, nominalMs: 3000 },
  // Veil of Nought: unmade — homing/satellites blind. Violet Mystery register.
  { key: "veil", field: "veilUntilTick", label: "VEIL", color: 0x8b5cf6, nominalMs: 1500 },
  // Severing Answer stance: next hit negated + returned. Amber Technique register.
  { key: "answer", field: "counterUntilTick", label: "CNTR", color: 0xf59e0b, nominalMs: 500 },
  // Geometrician catalog v1 (docs/class-ability-catalogs-v1.md, wizard-only)
  // — added 2026-07-18, closing the gap the catalog chunk flagged: these
  // three windows only had an action-bar (self-view) tell before this
  // (activeSlots.ts's windowFrac crimson pulse); nothing told a spectator
  // or opponent. Crystal-cyan family (visual-language-gnostic-vessel.md
  // "combat = cyan, never gold") — distinct from the six-axes registers
  // above since these aren't Emission-axis effects.
  // Sunlance: shots deal GEO_SUNLANCE_DAMAGE_MULTIPLIER while live
  // (durationMs 700 today, data/cards.ts "sunlance").
  { key: "sunlance", field: "sunlanceUntilTick", label: "SUN", color: 0x22d3ee, nominalMs: 700 },
  // Facet Break's mark lives on the CASTER (facetTargetId/facetMarkUntilTick,
  // not the victim — see the field's types.ts comment): "I have a target
  // marked and my next hits on them are amplified" is a caster-side tell,
  // hence a buff row, not a debuff. durationMs 4000 (data/cards.ts).
  { key: "facet-mark", field: "facetMarkUntilTick", label: "MARK", color: 0x2dd4bf, nominalMs: 4000 },
  // Overclock: fire rate up, spread tighter while live. durationMs 3000
  // (data/cards.ts). Distinct label from the pickup "OC" (overcharge) above
  // — same-ish concept, different systems, must not read as one buff.
  { key: "overclock", field: "overclockUntilTick", label: "OVCK", color: 0x5ac8fa, nominalMs: 3000 },
  // Resonance (classes-goal.md "Rotation system", class-overhaul-
  // workboard.md chunk 0.1): the ~2s window opened by ANY drafted-active
  // cast (six-axes Layer 2 kinds and the Geometrician catalog v1 alike —
  // class-agnostic) that a DIFFERENT-kind cast consumes for a cooldown
  // refund. Landed 2026-07-18, no nameplate tell before this row. Reuses
  // PALETTE.sapphirePulse — the same accent ActionBarSystem's own
  // ready-ping already uses for "an ability just came back" — instead of
  // inventing a new hue for a class-agnostic mechanic.
  { key: "resonance", field: "resonanceUntilTick", label: "RES", color: PALETTE.sapphirePulse, nominalMs: 2000 },
  // Kindled catalog v1 (docs/class-ability-catalogs-v1.md, paladin-only) —
  // added 2026-07-18, closing the SAME nameplate-legibility gap the
  // Geometrician catalog rows above already close for Wizard. Gold-forward
  // family (classes-goal.md: "Gold-forward combat kit unlocked" — the one
  // chassis where gold reads as combat, not house/cosmetic tier) —
  // deliberately distinct from the Geometrician rows' crystal-cyan family
  // and from the six-axes registers' element colors.
  // Judgment Line's mark lives on the CASTER (judgmentMarkUntilTick, not
  // the victim — same reasoning as facet-mark above): "I have a target
  // marked and my Kindled Edge hits on them are amplified."
  { key: "judgment-mark", field: "judgmentMarkUntilTick", label: "MARK", color: 0xfcd34d, nominalMs: 3000 },
  // Unbroken Seal: the next landed Kindled Edge hit is amplified + staggers.
  { key: "seal", field: "sealUntilTick", label: "SEAL", color: 0xeab308, nominalMs: 5000 },
  // Aegis Share: this player's team-peel radius is widened for allies.
  { key: "aegis-share", field: "aegisShareUntilTick", label: "AEGIS", color: 0xd97706, nominalMs: 3000 },
  // Syzygist status substrate extension (class-overhaul-workboard.md chunk
  // 3.1) — added 2026-07-18. The first BUFF rows that can appear on a
  // player who never cast anything themselves (another player's Priest
  // cast wrote these fields onto THEM — see World.ts's applyRegenToAlly/
  // applyHasteToAlly) — exactly the "spectator-visible tell" gap this
  // table exists to close, now doubly true since the AFFECTED player also
  // needs their own tell that someone else buffed them. Cool-white family
  // (docs/character-sheets-v1.md: Syzygist visual LOCKED "cool-white...
  // not violet, not Kindled gold") — distinct from every other family on
  // this table (crystal-cyan Geometrician, gold Kindled, element colors).
  // No real Priest ability wires these yet (chunk 3.4); the rows exist so
  // the nameplate/action-bar surfaces are ready the moment one does.
  { key: "regen", field: "regenUntilTick", label: "REGEN", color: 0xdff7ff, nominalMs: 4000 },
  { key: "haste", field: "hasteUntilTick", label: "HASTE", color: 0xb9ecff, nominalMs: 5000 },
  // Syzygist catalog v1 (class-overhaul-workboard.md chunk 3.4) — added
  // 2026-07-18, same cool-white family as regen/haste above (this is the
  // FIRST class where a buff visibly appearing on an ally who never cast
  // it is the norm, not the exception — Ward/Focus Hex both close the same
  // "an ally needs to see a buff originating from another player's cast"
  // gap regen/haste's own row closes).
  // Syzygist Ward: absorb pool live (wardAbsorbUntilTick — NOT
  // wardAbsorbRemaining, which isn't a tick field; the nominal duration
  // matches SYZ_WARD_DURATION_TICKS_DEFAULT's ~6s).
  { key: "syz-ward", field: "wardAbsorbUntilTick", label: "WARD", color: 0xe0f2fe, nominalMs: 6000 },
  // Focus Hex mark lives on the CASTER (focusHexMarkUntilTick, not the
  // victim — same reasoning as facet-mark/judgment-mark above): "I have a
  // target marked and my hits on them are amplified."
  { key: "focus-hex", field: "focusHexMarkUntilTick", label: "MARK", color: 0xa5f3fc, nominalMs: 4000 },
  // Interstice catalog v1 (docs/class-ability-catalogs-v1.md, ninja-only) —
  // added 2026-07-18, closing the SAME nameplate-legibility gap the
  // Geometrician/Kindled/Syzygist rows above already close for their own
  // chassis. Sharper/higher-frequency crystal-cyan family
  // (character-sheets-v1.md: "energy-resource glow — sharper, higher-
  // frequency pulse than wizard cyan") — distinct hex values from the
  // Geometrician block's own crystal-cyan family so the two chassis never
  // read as the same buff at a glance.
  // Read Mark's mark lives on the CASTER (readMarkUntilTick, not the
  // victim — same reasoning as facet-mark/judgment-mark/focus-hex above);
  // Razor Route's own "marks Read on cross" byproduct rides this SAME row
  // (they share one field pair by design — see World.ts's razor-route case).
  { key: "read-mark", field: "readMarkUntilTick", label: "MARK", color: 0x67e8f9, nominalMs: 5000 },
  // Undercut: while live, a landed arc hit on anyone below 15% health is a
  // guaranteed kill.
  { key: "undercut", field: "undercutUntilTick", label: "UNDER", color: 0xfb7185, nominalMs: 4000 },
  // Edge Storm: while live (and charges remain), wave-off-swings hit hard.
  { key: "edge-storm", field: "edgeStormUntilTick", label: "STORM", color: 0x22d3ee, nominalMs: 6000 },
  // Wall Bloom: the next wall-kick blooms a shard burst.
  { key: "wall-bloom", field: "wallBloomUntilTick", label: "BLOOM", color: 0x5ac8fa, nominalMs: 9000 },
  // Ghost Guard: a banked near-miss charge — the next hit while moving
  // simply doesn't land.
  { key: "ghost-guard", field: "ghostGuardChargeUntilTick", label: "GHOST", color: 0x38bdf8, nominalMs: 6000 },
  // Second Wind: land a hit inside the window for a health + energy kick.
  { key: "second-wind", field: "secondWindUntilTick", label: "WIND", color: 0x67e8f9, nominalMs: 1500 },
  // Razor Route: the next dash carries further and marks its first cross.
  { key: "razor-route", field: "razorRouteUntilTick", label: "ROUTE", color: 0x22d3ee, nominalMs: 3000 },
];

// Element statuses (burn/freeze/slow-field) included since 2026-07-16 —
// they were the ONLY combat statuses with no nameplate read (ambient
// particles via StatusVfxController only), and they're exactly the marks
// the Emission applies at scale (emission-engine-goal P2 victim-side
// legibility). Colors match elementColors.ts. nominalMs = the status's
// standard application duration (burn 3s, freeze up to the 2s emission
// cap, slow-field 1.5s base ×2 emission scale) — the decay arc is a read,
// not a stopwatch; a refreshed status simply snaps the arc full again.
export const DEBUFF_DESCRIPTORS: BuffDescriptor[] = [
  { key: "burn", field: "burnUntilTick", label: "BURN", color: 0xff7a18, nominalMs: 3000 },
  { key: "freeze", field: "freezeUntilTick", label: "FRZ", color: 0x93c5fd, nominalMs: 2000 },
  { key: "slowed", field: "slowedUntilTick", label: "SLOW", color: 0x7dd3fc, nominalMs: 3000 },
  { key: "slow", field: "slowDebuffUntilTick", label: "SLOW", color: 0xbfdbfe, nominalMs: 5500 },
  { key: "vuln", field: "vulnerabilityUntilTick", label: "VULN", color: 0xfca5a5, nominalMs: 5500 },
  { key: "no-block", field: "blockJammerUntilTick", label: "JAM", color: 0xc084fc, nominalMs: 6500 },
  // Paper Double's Fooled debuff (2026-07-19 mechanic, 2026-07-20 nameplate
  // fast-follow — class-overhaul-workboard.md chunk 4.2's "nameplate status
  // legibility" gap named this pattern generically; Fooled was a real,
  // shipped-since-yesterday example of it with zero tell). +25% damage
  // taken while live (World.ts's fooledDamageMultiplier) — a hot magenta
  // distinct from every other row here (closest neighbor "vuln" is a
  // different mechanic entirely; sharing its color would misread as the
  // same status). nominalMs matches NINJA_FOOLED_DURATION_MS (2000).
  { key: "fooled", field: "fooledUntilTick", label: "FOOL", color: 0xff6ec7, nominalMs: 2000 },
  // Borrowed Time's debt (2026-07-20 fast-follow): the flat, delayed drain
  // every Borrowed Time cast banks (SYZ_BORROWED_TIME_DEBT_DELAY_TICKS
  // later, World.ts's debt-resolution block) had ZERO tell before this —
  // the drained player (caster on self-cast, or the healed ally on the
  // ally branch) had no idea it was coming until their health silently
  // dropped. nominalMs matches the delay (6000ms, constants.ts). Dusky
  // maroon — same Drain-register family "tithe" above claims, but a
  // visibly distinct shade (this is a delayed bill, not an active leech),
  // so the two never read as the same status.
  { key: "debt", field: "debtUntilTick", label: "DEBT", color: 0x991b1b, nominalMs: 6000 },
];

/** Local-only detailed chip strip (HudSystem's text chips + ActionBarSystem's
 *  buff/debuff tick row) — text label + countdown seconds. */
export function deriveHudChips(player: PlayerEntity | undefined, tick: number): HudChip[] {
  const chips: HudChip[] = [];
  if (!player) return chips;
  for (const buff of BUFF_DESCRIPTORS) {
    const tickValue = player[buff.field] as number | undefined;
    if (typeof tickValue === "number" && tickValue > tick) {
      const remainingMs = Math.max(0, (tickValue - tick) * STEP_MS);
      chips.push({ label: buff.label, color: buff.color, remainingSec: remainingMs / 1000, isDebuff: false });
    }
  }
  for (const debuff of DEBUFF_DESCRIPTORS) {
    const tickValue = player[debuff.field] as number | undefined;
    if (typeof tickValue === "number" && tickValue > tick) {
      const remainingMs = Math.max(0, (tickValue - tick) * STEP_MS);
      chips.push({ label: debuff.label, color: debuff.color, remainingSec: remainingMs / 1000, isDebuff: true });
    }
  }
  return chips;
}

/** Every-roster-player compact status marks for the fused nameplate column
 *  (HudSystem's updateScoreRows) — color + shape only (no text room on a
 *  badge-height row), the one surface visible to spectators/opponents. */
export function deriveNameplateTicks(
  player: PlayerEntity | undefined,
  tick: number,
): NameplateStatusTick[] {
  const ticks: NameplateStatusTick[] = [];
  if (!player) return ticks;
  for (const buff of BUFF_DESCRIPTORS) {
    const tickValue = player[buff.field] as number | undefined;
    if (typeof tickValue === "number" && tickValue > tick) {
      const remainingMs = (tickValue - tick) * STEP_MS;
      ticks.push({
        color: buff.color,
        isDebuff: false,
        remainingFrac: Math.min(1, remainingMs / buff.nominalMs),
      });
    }
  }
  for (const debuff of DEBUFF_DESCRIPTORS) {
    const tickValue = player[debuff.field] as number | undefined;
    if (typeof tickValue === "number" && tickValue > tick) {
      const remainingMs = (tickValue - tick) * STEP_MS;
      ticks.push({
        color: debuff.color,
        isDebuff: true,
        remainingFrac: Math.min(1, remainingMs / debuff.nominalMs),
      });
    }
  }
  return ticks;
}
