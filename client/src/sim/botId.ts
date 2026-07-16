// Bot identity — the single source of truth for the "bot_" id prefix.
//
// Before this module existed the prefix was hand-copied in FOUR places
// (round.ts, worldBots.ts, botIdentity.ts, and inline startsWith calls) —
// exactly the duplicated-magic-constant pattern that bit the dash-cooldown
// tests. Lives in @sim because both sides need it: the server (worldBots,
// matchHost.summary's honest human/bot split) and the client (HUD bot
// plates, round.ts's bot-shootout guard).

export const BOT_ID_PREFIX = "bot_";

export function isBotId(playerId: string): boolean {
  return playerId.startsWith(BOT_ID_PREFIX);
}
