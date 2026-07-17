// Acquired-ability derivation for the action bar (Jake, 2026-07-16: "add
// the abilities to the ability bar on the bottom as we acquire them
// throughout the match").
//
// Pure presentation-side derivation over the RESOLVED build — the same
// composition doctrine as everything else (docs/emission-engine-goal.md):
// no ability registry, no unlock flags, no second source of truth. A card
// that grants a capability IS the acquisition; the bar just reads the
// build. Iteration follows `build.cards` (application order), so slots
// appear in the order the hand earned them and never reshuffle mid-match.
//
// Deliberately EXCLUDED v1:
//  - dash charges (the M2 slot already owns dash identity — extra charges
//    read there, not as a duplicate diamond)
//  - character innates (Shielded's directional shield) — this surface is
//    about what you acquired THIS match; innates are loadout, not loot.
//  - drafted ACTIVES (six-axes-goal.md Layer 2) — those are pressable
//    slots keyed 1-4, derived by activeSlots.ts from build.actives; this
//    file owns only the passive capability glyphs that follow them on the
//    bar. One derivation each, two rows, no overlap.

import type { ResolvedWeaponBuild } from "../../sim/data/cardTypes.js";

export type AcquiredAbilityKind =
  | "satellites"
  | "stolen-fangs"
  | "mirror-shield"
  | "aim-shield"
  | "air-jumps";

export type AcquiredAbility = {
  kind: AcquiredAbilityKind;
  /** Resolved (post-clamp) count where the capability stacks — satellites
   *  orbiting, air jumps available. Undefined for booleans. */
  count?: number;
};

/** Cached per resolved-build identity (weapon.ts's resolvePlayerBuild
 *  already caches builds on the cards-array reference, so this inherits
 *  the same invalidation: a draft pick → new array → new build → fresh
 *  derivation). Called every frame by the HUD — game-loop-perf. */
const cache = new WeakMap<ResolvedWeaponBuild, AcquiredAbility[]>();

export function acquiredAbilities(build: ResolvedWeaponBuild): AcquiredAbility[] {
  const cached = cache.get(build);
  if (cached) return cached;
  const out: AcquiredAbility[] = [];
  const seen = new Set<AcquiredAbilityKind>();
  const add = (kind: AcquiredAbilityKind, count?: number): void => {
    if (seen.has(kind)) {
      // A later stack of the same capability updates the count in place —
      // the slot keeps its original acquisition position.
      if (count !== undefined) {
        const existing = out.find((a) => a.kind === kind);
        if (existing) existing.count = count;
      }
      return;
    }
    seen.add(kind);
    out.push(count !== undefined ? { kind, count } : { kind });
  };

  for (const card of build.cards) {
    const m = card.modifier;
    if (!m) continue;
    if (m.orbitingSatellites) add("satellites", build.orbitingSatellites);
    if (m.stolenFangs) add("stolen-fangs");
    if (m.mirrorShield) add("mirror-shield");
    if (m.directionalShield) add("aim-shield");
    if (m.airJumpsAdd) add("air-jumps", build.airJumps);
  }
  cache.set(build, out);
  return out;
}
