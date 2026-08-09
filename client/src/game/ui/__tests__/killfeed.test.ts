// gospel 4.6 — the killfeed's decisions, which are the whole feature.
// Rendering is the scene's problem; what a line SAYS and how long it lives
// is this file's.

import { describe, expect, test } from "bun:test";
import {
  Killfeed,
  killfeedLineText,
  KILLFEED_MAX_LINES,
  KILLFEED_TTL_MS,
} from "../killfeed.ts";

const NAMES: Record<string, string> = {
  me: "You",
  a: "Alder",
  b: "Bram",
  c: "Cinder",
  d: "Dross",
  e: "Ember",
};
const nameOf = (id: string): string => NAMES[id] ?? id;
const feed = (localId: string | null = "me"): Killfeed => new Killfeed(nameOf, localId);

describe("attribution", () => {
  test("an ordinary kill names both sides", () => {
    const f = feed();
    f.push({ victimId: "b", killerId: "a" }, 0);
    expect(killfeedLineText(f.visible(0)[0]!)).toBe("Alder eliminated Bram");
  });

  test("an unattributed death (void plane, storm) has no killer half", () => {
    const f = feed();
    f.push({ victimId: "b", killerId: null }, 0);
    expect(killfeedLineText(f.visible(0)[0]!)).toBe("Bram was eliminated");
  });

  test("a suicide reads as unattributed, NOT 'Bram eliminated Bram'", () => {
    // killerId === victimId is a real event shape; rendering it literally
    // reads as a bug to a player.
    const f = feed();
    f.push({ victimId: "b", killerId: "b" }, 0);
    expect(killfeedLineText(f.visible(0)[0]!)).toBe("Bram was eliminated");
    expect(f.visible(0)[0]!.byLocal).toBe(false);
  });

  test("an execute is worded differently", () => {
    const f = feed();
    f.push({ victimId: "b", killerId: "a", execute: true }, 0);
    expect(killfeedLineText(f.visible(0)[0]!)).toBe("Alder executed Bram");
  });
});

describe("local emphasis", () => {
  test("flags the local player's own kill and own death separately", () => {
    const f = feed("me");
    f.push({ victimId: "a", killerId: "me" }, 0);
    f.push({ victimId: "me", killerId: "a" }, 0);
    const [mine, theirs] = f.visible(0);
    expect(mine!.byLocal).toBe(true);
    expect(mine!.ofLocal).toBe(false);
    expect(theirs!.byLocal).toBe(false);
    expect(theirs!.ofLocal).toBe(true);
  });

  test("a spectator (no local id) emphasises nothing", () => {
    const f = feed(null);
    f.push({ victimId: "a", killerId: "b" }, 0);
    const [only] = f.visible(0);
    expect(only!.byLocal).toBe(false);
    expect(only!.ofLocal).toBe(false);
  });
});

describe("lifetime and volume", () => {
  test("a line ages out at the TTL", () => {
    const f = feed();
    f.push({ victimId: "b", killerId: "a" }, 1_000);
    expect(f.visible(1_000 + KILLFEED_TTL_MS - 1)).toHaveLength(1);
    expect(f.visible(1_000 + KILLFEED_TTL_MS)).toHaveLength(0);
  });

  test("a burst is capped, keeping the NEWEST lines", () => {
    const f = feed();
    for (const v of ["a", "b", "c", "d", "e"]) f.push({ victimId: v, killerId: "me" }, 0);
    const shown = f.visible(0);
    expect(shown).toHaveLength(KILLFEED_MAX_LINES);
    // Oldest ("Alder") pushed off; newest ("Ember") retained and last.
    expect(shown.map((s) => s.victim)).not.toContain("Alder");
    expect(shown[shown.length - 1]!.victim).toBe("Ember");
  });

  test("entries do not accumulate without bound when nothing renders", () => {
    // The idle-tab case: push() is driven by events, visible() by frames.
    const f = feed();
    for (let i = 0; i < 500; i += 1) f.push({ victimId: "b", killerId: "a" }, i);
    // Everything is aged out by now; the sweep must actually free them.
    expect(f.visible(1_000_000)).toHaveLength(0);
  });

  test("clear() empties the feed at a round boundary", () => {
    const f = feed();
    f.push({ victimId: "b", killerId: "a" }, 0);
    f.clear();
    expect(f.visible(0)).toHaveLength(0);
  });
});
