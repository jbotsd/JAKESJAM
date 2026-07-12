// Pure correctness tests for SongDirector — no DOM, no audio, no Phaser.

import { describe, expect, test } from "bun:test";
import { SongDirector, type SongCue } from "../SongDirector.js";

const cues: SongCue[] = [
  { id: "a", atSec: 1, kind: "test" },
  { id: "b", atSec: 2, kind: "test" },
  { id: "c", atSec: 3, kind: "test" },
  { id: "d", atSec: 5, kind: "test" },
];

describe("SongDirector", () => {
  test("fires no cues before their time", () => {
    const d = new SongDirector(cues);
    expect(d.update(0.5)).toEqual([]);
  });

  test("fires cues in ascending order as time crosses their threshold", () => {
    const d = new SongDirector(cues);
    expect(d.update(1.5).map((c) => c.id)).toEqual(["a"]);
    expect(d.update(2.5).map((c) => c.id)).toEqual(["b"]);
  });

  test("each cue fires exactly once, never again on a later call", () => {
    const d = new SongDirector(cues);
    d.update(1.5);
    expect(d.update(1.9).map((c) => c.id)).toEqual([]);
    expect(d.update(10).map((c) => c.id)).toEqual(["b", "c", "d"]);
    expect(d.update(20).map((c) => c.id)).toEqual([]);
  });

  test("a single large jump (simulating a dropped/late frame) returns ALL skipped cues in one batch, not silently dropped", () => {
    const d = new SongDirector(cues);
    const fired = d.update(4.0);
    expect(fired.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  test("cues are sorted by atSec regardless of authoring order", () => {
    const shuffled: SongCue[] = [
      { id: "late", atSec: 10, kind: "x" },
      { id: "early", atSec: 1, kind: "x" },
      { id: "mid", atSec: 5, kind: "x" },
    ];
    const d = new SongDirector(shuffled);
    expect(d.update(100).map((c) => c.id)).toEqual(["early", "mid", "late"]);
  });

  test("seek() does NOT replay already-passed cues", () => {
    const d = new SongDirector(cues);
    d.seek(4.0); // jump straight past a/b/c
    expect(d.update(10).map((c) => c.id)).toEqual(["d"]); // only d, not a/b/c replayed
  });

  test("seek() backward re-arms cues after that point (for scrubbing back)", () => {
    const d = new SongDirector(cues);
    d.update(10); // fire everything
    d.seek(1.5); // scrub back to just after "a"
    expect(d.update(10).map((c) => c.id)).toEqual(["b", "c", "d"]);
  });

  test("done is true only once every cue has fired", () => {
    const d = new SongDirector(cues);
    expect(d.done).toBe(false);
    d.update(4);
    expect(d.done).toBe(false);
    d.update(10);
    expect(d.done).toBe(true);
  });
});
