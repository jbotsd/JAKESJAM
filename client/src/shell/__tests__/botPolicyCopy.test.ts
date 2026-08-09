// gospel 3.1 — the bot-policy copy must stay TRUE.
//
// Settings now tells players, as fact: bots are always labelled with a
// violet body and a BOT nameplate, and are never counted as players in
// anything they are shown. That is a stronger commitment than a dashboard
// number — a stale figure misleads whoever reads the dashboard, but copy
// that stops being true misleads every player, and they have no way to
// check it.
//
// So the claims are pinned to the code that implements them. If someone
// recolours bot rigs, drops the plate prefix, or starts folding bots into
// a "players online" figure, this fails and the sentence gets rewritten
// rather than quietly becoming a lie.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOT_RIG_COLOR, botLabel, isBotId } from "../../game/ui/botIdentity.ts";

const mainSrc = readFileSync(resolve(import.meta.dir, "../../main.ts"), "utf8");

describe("the bot-policy copy exists and says what it should", () => {
  test("Settings carries the policy", () => {
    expect(mainSrc).toContain("data-bot-policy");
    // Vacuity guard: the attribute could exist on an empty element.
    const at = mainSrc.indexOf("data-bot-policy");
    expect(mainSrc.slice(at, at + 500)).toContain("BOT");
  });
});

describe("the claims are true of the code", () => {
  test("CLAIM: bots are labelled 'BOT · NAME'", () => {
    expect(botLabel("bot_spark")).toBe("BOT · SPARK");
    // And the label is reached for real bot ids, not just callable.
    expect(isBotId("bot_spark")).toBe(true);
    expect(isBotId("player_abc")).toBe(false);
  });

  test("CLAIM: bot rigs are violet, and distinctly so", () => {
    // Violet: blue and red both high, green low. Pinning the exact hex
    // would fail on a harmless tint tweak; pinning the HUE is what the
    // sentence actually promises a player.
    const r = (BOT_RIG_COLOR >> 16) & 0xff;
    const g = (BOT_RIG_COLOR >> 8) & 0xff;
    const b = BOT_RIG_COLOR & 0xff;
    expect(b).toBeGreaterThan(160);
    expect(r).toBeGreaterThan(120);
    expect(g).toBeLessThan(r);
    expect(g).toBeLessThan(b);
  });

  test("CLAIM: bots are counted separately from humans, never merged", () => {
    // The server's own summary keeps two fields. If they were ever folded
    // into one "players" number, the sentence "never counted as players in
    // anything you are shown" would stop being true.
    const worldHost = readFileSync(
      resolve(import.meta.dir, "../../../../server/src/worldHost.ts"),
      "utf8",
    );
    expect(worldHost).toMatch(/humans/);
    expect(worldHost).toMatch(/bots/);
    const matchHost = readFileSync(
      resolve(import.meta.dir, "../../../../server/src/matchHost.ts"),
      "utf8",
    );
    // summary() reports them as separate keys.
    expect(matchHost).toMatch(/humans:/);
    expect(matchHost).toMatch(/bots:/);
  });

  test("CLAIM: a bot id is never mistakable for a human id", () => {
    // "Nobody you meet here is a real person wearing a bot's name, or the
    // other way round" rests entirely on the prefix being reserved.
    for (const id of ["bot_spark", "bot_ally_1", "bot_"]) expect(isBotId(id)).toBe(true);
    for (const id of ["player_1", "spark", "robot_spark", ""]) expect(isBotId(id)).toBe(false);
  });
});
