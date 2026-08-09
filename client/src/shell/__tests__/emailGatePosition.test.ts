// Doors 1.2 — the email gate's position, built dark (L4).
//
// Two things must stay true at once:
//   1. while the default is "boot", behaviour is EXACTLY what shipped —
//      a dark flag that quietly changes the live funnel is worse than no
//      flag, and this is the funnel's only remaining front-door gate;
//   2. "post-fight" really is one line away, and really does behave
//      differently (ask after a cycle, remember a decline).

import { describe, expect, test, beforeEach } from "bun:test";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = local;
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = session;
// jsdom-free: the module only reads location.search.
(globalThis as unknown as { window: { location: { search: string } } }).window = {
  location: { search: "" },
};

const { gatePosition } = await import("../emailGate.ts");

beforeEach(() => {
  local.clear();
  session.clear();
  (globalThis as unknown as { window: { location: { search: string } } }).window.location.search =
    "";
});

describe("Doors 1.2 — gate position", () => {
  test("defaults to boot, so the dark flag changes nothing live", () => {
    // If this ever fails without a matching Decision-1 ratification in
    // the goal doc's Decisions ledger, the flip happened by accident.
    expect(gatePosition()).toBe("boot");
  });

  test("a URL override can demo the flip without editing source", () => {
    (
      globalThis as unknown as { window: { location: { search: string } } }
    ).window.location.search = "?gate-position=post-fight";
    expect(gatePosition()).toBe("post-fight");
  });

  test("localStorage can pin it for a whole session", () => {
    local.setItem("jakesjam.gatePosition", "post-fight");
    expect(gatePosition()).toBe("post-fight");
  });

  test("the URL wins over the stored value", () => {
    local.setItem("jakesjam.gatePosition", "post-fight");
    (
      globalThis as unknown as { window: { location: { search: string } } }
    ).window.location.search = "?gate-position=boot";
    expect(gatePosition()).toBe("boot");
  });

  test("a junk override falls back to the default rather than throwing", () => {
    (
      globalThis as unknown as { window: { location: { search: string } } }
    ).window.location.search = "?gate-position=banana";
    expect(gatePosition()).toBe("boot");
    local.setItem("jakesjam.gatePosition", "banana");
    expect(gatePosition()).toBe("boot");
  });
});
