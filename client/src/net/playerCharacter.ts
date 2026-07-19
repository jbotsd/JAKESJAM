// Chassis (character archetype) sanitizer — ONE function, imported by both
// the client (loadout-station class picker, world-join URL builder) and the
// server (ws upgrade — the authoritative pass; the client copy is UX-only
// and must never be trusted). Mirrors playerName.ts's split exactly.
//
// The wire/sim ids stay the ORIGINAL archetype ids ("balanced" etc.) even
// though the player-facing layer now speaks the LOCKED persona names
// (Geometrician/Interstice/Kindled/Syzygist — docs/classes-goal.md §
// Naming, 2026-07-17): characterId is sim-visible (PlayerEntity/
// PlayerSpawnInfo, replays serialize it), so renaming ids would break wire
// compat and recorded replays for a purely cosmetic win. Display names
// live in client/src/game/data/characters.ts.

import type { CharacterArchetype } from "../sim/types.js";

export const CHARACTER_ARCHETYPE_IDS: readonly CharacterArchetype[] = [
  "balanced",
  "heavy",
  "sprinter",
  "shielded",
];

const VALID = new Set<string>(CHARACTER_ARCHETYPE_IDS);

export const DEFAULT_CHARACTER_ID: CharacterArchetype = "balanced";

/**
 * Whitelist pass: anything that isn't exactly one of the four archetype ids
 * (a request can hit /ws/world directly, bypassing the browser UI) falls
 * back to the default chassis rather than erroring — a bad class pick must
 * never block entry to the arena.
 */
export function sanitizeCharacterId(raw: string | null | undefined): CharacterArchetype {
  return raw && VALID.has(raw) ? (raw as CharacterArchetype) : DEFAULT_CHARACTER_ID;
}
