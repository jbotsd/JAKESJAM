// Bot identity helpers — server bots carry the "bot_" id prefix; every
// player-facing surface (rig color, nameplate, scoreboard, banners) uses
// these so bots are UNMISTAKABLY bots.
export const BOT_ID_PREFIX = "bot_";

export function isBotId(playerId: string): boolean {
  return playerId.startsWith(BOT_ID_PREFIX);
}

/** "bot_spark" -> "BOT · SPARK" */
export function botLabel(playerId: string): string {
  return `BOT · ${playerId.slice(BOT_ID_PREFIX.length).toUpperCase()}`;
}

/** Short scoreboard/banner tag for any player id. */
export function playerTag(playerId: string): string {
  return isBotId(playerId)
    ? botLabel(playerId)
    : playerId.slice(-4).toUpperCase();
}

/** Amber — visually distinct from the teal local + crimson remote rigs. */
export const BOT_RIG_COLOR = 0xffb454;
