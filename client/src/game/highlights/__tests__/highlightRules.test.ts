import { describe, expect, test } from "bun:test";
import { HighlightTracker } from "../highlightRules.js";
import { EntityId, PlayerId, type SimEvent } from "../../../sim/types.js";

const A = PlayerId("a");
const B = PlayerId("b");

type KillCause = "projectile" | "void" | "burn" | "fire" | "explosion" | "chain-lightning";

function killedBy(killerId: PlayerId, cause: KillCause = "projectile"): SimEvent {
  return { t: "player-killed", victimId: B, killerId, cause };
}

describe("HighlightTracker", () => {
  test("no events -> no highlights", () => {
    const t = new HighlightTracker();
    expect(t.ingest([], 0)).toEqual([]);
  });

  test("environmental kill (killerId null) never triggers anything", () => {
    const t = new HighlightTracker();
    const events: SimEvent[] = [{ t: "player-killed", victimId: B, killerId: null, cause: "void" }];
    expect(t.ingest(events, 1000)).toEqual([]);
  });

  test("chain-lightning kill fires chain-kill", () => {
    const t = new HighlightTracker();
    const hl = t.ingest([killedBy(A, "chain-lightning")], 1000);
    expect(hl).toHaveLength(1);
    expect(hl[0]!.kind).toBe("chain-kill");
    expect(hl[0]!.playerId).toBe(A);
  });

  test("ordinary projectile kill does not fire chain-kill", () => {
    const t = new HighlightTracker();
    const hl = t.ingest([killedBy(A, "projectile")], 1000);
    expect(hl.find((h) => h.kind === "chain-kill")).toBeUndefined();
  });

  test("a single kill does not fire multi-kill", () => {
    const t = new HighlightTracker();
    const hl = t.ingest([killedBy(A)], 1000);
    expect(hl.find((h) => h.kind === "multi-kill")).toBeUndefined();
  });

  test("two kills within the window fire exactly one multi-kill, on the 2nd", () => {
    const t = new HighlightTracker();
    const hl1 = t.ingest([killedBy(A)], 1000);
    expect(hl1.find((h) => h.kind === "multi-kill")).toBeUndefined();
    const hl2 = t.ingest([killedBy(A)], 3000);
    const mk = hl2.find((h) => h.kind === "multi-kill");
    expect(mk).toBeDefined();
    expect(mk!.playerId).toBe(A);
  });

  test("a 3rd kill in the SAME window does not re-fire multi-kill", () => {
    const t = new HighlightTracker();
    t.ingest([killedBy(A)], 1000);
    t.ingest([killedBy(A)], 3000); // fires here
    const hl3 = t.ingest([killedBy(A)], 4000);
    expect(hl3.find((h) => h.kind === "multi-kill")).toBeUndefined();
  });

  test("two kills OUTSIDE the 6s window do not fire multi-kill", () => {
    const t = new HighlightTracker();
    t.ingest([killedBy(A)], 0);
    const hl = t.ingest([killedBy(A)], 10_000);
    expect(hl.find((h) => h.kind === "multi-kill")).toBeUndefined();
  });

  test("a fresh multi-kill window CAN re-fire later for the same player", () => {
    const t = new HighlightTracker();
    t.ingest([killedBy(A)], 0);
    t.ingest([killedBy(A)], 2000); // fires window #1
    t.ingest([killedBy(A)], 20_000); // window #1 has expired
    const hl = t.ingest([killedBy(A)], 22_000);
    expect(hl.find((h) => h.kind === "multi-kill")).toBeDefined();
  });

  test("kills by different players don't combine into a multi-kill", () => {
    const t = new HighlightTracker();
    t.ingest([killedBy(A)], 1000);
    const hl = t.ingest([killedBy(B)], 2000);
    expect(hl.find((h) => h.kind === "multi-kill")).toBeUndefined();
  });

  test("a kill within 2s of that killer's parry fires parry-kill", () => {
    const t = new HighlightTracker();
    t.ingest([{ t: "parry-deflected", playerId: A, projectileId: EntityId(1) }], 1000);
    const hl = t.ingest([killedBy(A)], 2500);
    const pk = hl.find((h) => h.kind === "parry-kill");
    expect(pk).toBeDefined();
    expect(pk!.playerId).toBe(A);
  });

  test("a kill more than 2s after that killer's parry does NOT fire parry-kill", () => {
    const t = new HighlightTracker();
    t.ingest([{ t: "parry-deflected", playerId: A, projectileId: EntityId(1) }], 1000);
    const hl = t.ingest([killedBy(A)], 4000);
    expect(hl.find((h) => h.kind === "parry-kill")).toBeUndefined();
  });

  test("a player's parry does not grant a parry-kill credit to someone else's kill", () => {
    const t = new HighlightTracker();
    t.ingest([{ t: "parry-deflected", playerId: A, projectileId: EntityId(1) }], 1000);
    const hl = t.ingest([killedBy(B)], 1500);
    expect(hl.find((h) => h.kind === "parry-kill")).toBeUndefined();
  });

  test("a single kill can fire BOTH chain-kill and parry-kill simultaneously", () => {
    const t = new HighlightTracker();
    t.ingest([{ t: "parry-deflected", playerId: A, projectileId: EntityId(1) }], 1000);
    const hl = t.ingest([killedBy(A, "chain-lightning")], 1200);
    expect(hl.some((h) => h.kind === "chain-kill")).toBe(true);
    expect(hl.some((h) => h.kind === "parry-kill")).toBe(true);
  });
});
