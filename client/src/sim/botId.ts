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

// Venue lobby tableau (docs/venue-lobby-tableau-goal.md, 2026-07-18): the
// stationary "good" (ally) practice figure standing at the loadout table.
// `bot_`-prefixed so every existing "is this a real human" check (arena
// headcounts, admission, roster displays) already excludes it for free —
// it never has a real websocket, never receives input, and is the one
// entity in the lobby carrying LOBBY_PRACTICE_TEAM_ID so ally-targeted
// abilities (Aegis Share, Rally Light, Borrowed Time, Glass Ward, Haste
// Gift) see a real `isAlly()` target instead of only their solo-fallback.
const LOBBY_ALLY_NPC_ID_PREFIX = `${BOT_ID_PREFIX}practice_ally_`;

/** Two ally NPCs flank the loadout table (inner-left/inner-right — the
 *  compositional symmetry docs/venue-lobby-tableau-goal.md Part 3 calls
 *  for), so this is an id-builder, not one fixed id. */
export function lobbyAllyNpcId(index: 1 | 2): string {
  return `${LOBBY_ALLY_NPC_ID_PREFIX}${index}`;
}

export function isLobbyAllyNpcId(playerId: string): boolean {
  return playerId.startsWith(LOBBY_ALLY_NPC_ID_PREFIX);
}

/** Shared teamId every venue-lobby visitor AND the practice ally NPCs carry
 *  — safe because the lobby has no PvP/scoring at all (hangoutMode zeroes
 *  every player-vs-player damage site), so "everyone's on one team" here
 *  has no gameplay meaning beyond making `isAlly()` true for ability tests. */
export const LOBBY_PRACTICE_TEAM_ID = "lobby-practice";
