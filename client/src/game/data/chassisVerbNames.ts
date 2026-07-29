// Chassis-verb ability display names — the single source of truth for the
// Dash/Shield names shown on BOTH touch-device ability surfaces:
// ActionBarSystem.ts (canvas HUD, bottom-center) and TouchControls.ts (DOM
// touch buttons, same bottom-center region). Prior to 2026-07-29 wave 2 QA
// these were two independently-hardcoded label sets (clusterA-03, filed
// 2026-07-28): ActionBarSystem carried the real per-class names below,
// TouchControls' physical buttons just said generic "SHIELD"/"DASH" no
// matter the class — so a touch player read one name off the HUD and
// pressed a button labeled something else entirely for the same ability.
// Hoisting the maps here and having both surfaces import this module is the
// structural fix: there is only one copy to drift out of sync.
//
// Naming history (2026-07-18 legibility pass, Jake: "we still have shift
// shield and mouse right click in the game what do we do about those those
// should be abilities") — Shield (held Shift) and Dash (right-click/C, the
// "dash-bash shield power-slide") are already class-specific mechanics
// under the hood (combat.ts's Kindled Ward branch, World.ts's ninja
// dash-through/evasion, weapon.ts's Priest innate directionalShield) but
// were rendering as an unlabeled resource orb and a bare key hint. This is
// a NAMING/LABELING layer only — no mechanic, number, or gating changes.
//
// "Kindled Ward" (paladin) is the session's own established name
// (combat.ts's WARD_* doc comments, class-overhaul-workboard.md chunks
// 2.2/2.3). "Slipstream" (ninja Dash) is pulled verbatim from
// docs/character-sheets-v1.md ("Slipstream / Read: Dash through them...").
// The remaining six (wizard's two, ninja's Shield, priest's two, paladin's
// Dash) have no established name in classes-goal.md /
// character-sheets-v1.md / class-ability-catalogs-v1.md, so they were
// freshly authored to each class's C4 tone register (classes-goal.md:
// wizard technical-awesome, ninja insidious-precise, paladin
// epic-settled/self-lit-not-liturgical, priest unsettling-benevolent) and
// checked against that class's own catalog vocabulary for collisions.
//
// Ninja's Shield is a real "no mitigation, ever" override (combat.ts's
// tryDeflectDamage "ninja" branch, docs/character-sheets-v1.md's
// DI-Tempest/WoW-Rogue table: "Dash i-frames only — never block") — per
// docs/design-axioms.md A2 ("ship the missing feature, never the broken
// one"), ActionBarSystem hides the shield orb AND its name label entirely
// for ninja rather than name a fake ability (see that file's
// `shieldDisplayMax` gate). SHIELD_NAME_BY_CLASS keeps a ninja entry anyway
// as a defense-in-depth fallback string, and TouchControls DOES surface it
// on its still-physically-present Shield button (that button isn't hidden
// the way ActionBarSystem's orb is — see TouchControls.ts's own comment) —
// "Nothing to Guard" is written to read as an honest absence, not an
// ability, in Interstice's insidious-precise voice, so a touch player who
// presses it learns the truth instead of being told a lie in a shorter
// word.
//
// "Nothing to Guard" is also the longest string in either map (16 chars,
// 3 words) — the deliberate worst-case fit target measured against
// TouchControls' 76-84px circular buttons (2026-07-29 wave 2 QA,
// scripts/touchAbilityLabelShots.ts, real 393x852 portrait-touch
// screenshots) before this naming was applied to that surface.
import type { ClassId } from "../types/game.js";

export const DASH_NAME_BY_CLASS: Record<ClassId, string> = {
  paladin: "Kindled Charge",
  wizard: "Vector Charge",
  ninja: "Slipstream",
  priest: "Tethered Charge",
};

export const SHIELD_NAME_BY_CLASS: Record<ClassId, string> = {
  paladin: "Kindled Ward",
  wizard: "Prism Wall",
  ninja: "Nothing to Guard",
  priest: "Open Hand",
};
