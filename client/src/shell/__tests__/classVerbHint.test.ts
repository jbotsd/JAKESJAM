// Doors 3.3 — class verbs are taught once PER CLASS, not once ever.
//
// The distinction is the whole row: picking Kindled teaches you nothing
// about Syzygist, so a single "seen the hint" flag would silently mean
// three of the four chassis never explain themselves.

import { describe, expect, test, beforeEach, afterAll } from "bun:test";

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

const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

const { isFirstPick, noteClassPicked } = await import("../classVerbHint.ts");

// noteClassPicked touches the DOM; the tests here only care about the
// remembering, so give it the smallest surface that will not throw.
//
// RESTORED IN afterAll — `bun test` runs every file in ONE process, so a
// global installed here leaks into every other suite. Doing it without
// the restore turned a green run into 39 failures across unrelated
// files: the exact singleton-leak shape fixed in serverWasmHost.test.ts
// earlier the same day, re-committed by hand a few hours later.
const priorDocument = (globalThis as { document?: unknown }).document;
const priorWindow = (globalThis as { window?: unknown }).window;
afterAll(() => {
  (globalThis as { document?: unknown }).document = priorDocument;
  (globalThis as { window?: unknown }).window = priorWindow;
});

const created: Array<{ className: string }> = [];
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => {
    const el = {
      className: "",
      textContent: "",
      setAttribute() {},
      append() {},
      appendChild() {},
      classList: { add() {} },
      remove() {},
    };
    created.push(el as unknown as { className: string });
    return el;
  },
  body: { appendChild() {} },
};
(globalThis as unknown as { window: unknown }).window = { setTimeout: () => 0 };

beforeEach(() => {
  store.clear();
  created.length = 0;
});

describe("Doors 3.3 — class verbs on first pick", () => {
  test("a chassis is first-pick until it is picked", () => {
    expect(isFirstPick("balanced")).toBe(true);
    noteClassPicked("balanced", "Geometrician", "100hp · the full crystal arsenal");
    expect(isFirstPick("balanced")).toBe(false);
  });

  test("EACH chassis gets its own first time", () => {
    noteClassPicked("balanced", "Geometrician", "a");
    // The bug a single flag would cause: three classes never explained.
    expect(isFirstPick("heavy")).toBe(true);
    expect(isFirstPick("sprinter")).toBe(true);
    expect(isFirstPick("shielded")).toBe(true);
  });

  test("picking the same chassis again teaches nothing", () => {
    noteClassPicked("heavy", "Kindled", "b");
    const after = created.length;
    noteClassPicked("heavy", "Kindled", "b");
    expect(created.length).toBe(after); // no second strip built
  });

  test("a corrupt seen-list is treated as nothing taught, not as everything", () => {
    store.setItem("jakesjam.classVerbsSeen", "{not json");
    // Teaching twice is a far cheaper failure than never teaching.
    expect(isFirstPick("balanced")).toBe(true);
  });
});
