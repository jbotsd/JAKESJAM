// CowRecord — copy-on-write semantics + zero-allocation guarantee.

import { describe, expect, test } from "bun:test";
import { CowRecord } from "../cowRecord.js";

describe("CowRecord", () => {
  test("read without write returns source by reference", () => {
    const source = { a: 1, b: 2 };
    const cow = new CowRecord<string, number>(source);
    expect(cow.get("a")).toBe(1);
    expect(cow.has("b")).toBe(true);
    expect(cow.isMutated()).toBe(false);
    // The whole point: view() === source when untouched.
    expect(cow.view()).toBe(source);
  });

  test("first set triggers a clone; further sets reuse it", () => {
    const source = { a: 1, b: 2 };
    const cow = new CowRecord<string, number>(source);
    cow.set("c", 3);
    expect(cow.isMutated()).toBe(true);
    expect(cow.view()).not.toBe(source);
    // Source untouched.
    expect(source).toEqual({ a: 1, b: 2 });
    // Mutation visible through view().
    expect(cow.view()).toEqual({ a: 1, b: 2, c: 3 });
    cow.set("d", 4);
    expect(cow.view()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  test("delete triggers clone too", () => {
    const source = { a: 1, b: 2 };
    const cow = new CowRecord<string, number>(source);
    cow.delete("a");
    expect(source.a).toBe(1); // source untouched
    expect(cow.view()).toEqual({ b: 2 });
    expect(cow.isMutated()).toBe(true);
  });

  test("get reflects mutations after first set", () => {
    const source = { a: 1 };
    const cow = new CowRecord<string, number>(source);
    cow.set("a", 99);
    expect(cow.get("a")).toBe(99);
    // Source still original.
    expect(source.a).toBe(1);
  });
});
