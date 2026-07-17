// Shared hex-string → Phaser numeric color conversion. Was duplicated
// privately in MatchScene.ts; OnlineMatchScene.ts needs the same conversion
// for Vessel Creator cosmetics (docs/vessel-creator-design.md), so it's
// pulled out once rather than re-copied a third time.

/** Falls back to crystal teal (matches the rig's own default accent
 *  family) on anything unparseable, rather than black — a malformed
 *  cosmetic string should never silently render invisible. */
export function colorToNumber(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x50e3c2;
}
