import { describe, expect, test } from "bun:test";
import {
  createShellState,
  shellCloseLayer,
  shellGoto,
  shellSetMatchMode,
  shellTogglePause,
  shellVisibility,
} from "../placeMachine.js";

describe("shell placeMachine", () => {
  test("starts at home with no layer", () => {
    const s = createShellState();
    expect(s.exclusive).toBe("home");
    expect(s.layer).toBeNull();
    expect(s.matchMode).toBe("none");
    const v = shellVisibility(s);
    expect(v.home).toBe(true);
    expect(v.room).toBe(false);
    expect(v.settings).toBe(false);
    expect(v.matchActive).toBe(false);
  });

  test("home → settings → home (close layer)", () => {
    let s = createShellState();
    s = shellGoto(s, "settings");
    expect(s.layer).toBe("settings");
    expect(shellVisibility(s).settings).toBe(true);
    expect(shellVisibility(s).home).toBe(true); // exclusive home still
    s = shellCloseLayer(s);
    expect(s.layer).toBeNull();
    expect(shellVisibility(s).settings).toBe(false);
  });

  test("home → room exclusive", () => {
    let s = createShellState();
    s = shellGoto(s, "room");
    expect(s.exclusive).toBe("room");
    const v = shellVisibility(s);
    expect(v.room).toBe(true);
    expect(v.home).toBe(false);
  });

  test("match-active → pause → resume", () => {
    let s = createShellState();
    s = shellSetMatchMode(s, "world");
    expect(shellVisibility(s).matchActive).toBe(true);
    expect(shellVisibility(s).home).toBe(false);
    s = shellTogglePause(s);
    expect(s.layer).toBe("pause");
    expect(shellVisibility(s).pause).toBe(true);
    s = shellTogglePause(s);
    expect(s.layer).toBeNull();
    expect(shellVisibility(s).pause).toBe(false);
  });

  test("pause ignored when no match", () => {
    let s = createShellState();
    s = shellGoto(s, "pause");
    expect(s.layer).toBeNull();
    s = shellTogglePause(s);
    expect(s.layer).toBeNull();
  });

  test("room toggles as layer while match active (hangout menu)", () => {
    let s = shellSetMatchMode(createShellState(), "private");
    s = shellGoto(s, "room");
    expect(s.layer).toBe("room");
    expect(shellVisibility(s).room).toBe(true);
    expect(shellVisibility(s).matchActive).toBe(true);
    s = shellGoto(s, "room");
    expect(s.layer).toBeNull();
    expect(shellVisibility(s).room).toBe(false);
  });

  test("clips layer over home", () => {
    let s = shellGoto(createShellState(), "clips");
    expect(s.layer).toBe("clips");
    expect(shellVisibility(s).clips).toBe(true);
  });

  test("leaving match returns home exclusive", () => {
    let s = shellSetMatchMode(createShellState(), "world");
    s = shellSetMatchMode(s, "none");
    expect(s.matchMode).toBe("none");
    expect(shellVisibility(s).home).toBe(true);
  });

  // Regression (Jake/Grok, 2026-07-18): hangout can start with the shell
  // still parked at exclusive:"room"/matchMode:"none" from the pre-join
  // screen (a race, or a join path that skips shellSetMatchMode). In that
  // stuck state, goto("room") takes the pre-join branch and rewrites the
  // SAME state back onto itself — Menu/Esc looked like it did nothing.
  test("stuck open (exclusive room, no match mode): goto('room') is a no-op", () => {
    const stuck = { exclusive: "room" as const, layer: null, matchMode: "none" as const };
    const s = shellGoto(stuck, "room");
    expect(s).toEqual(stuck); // proves the bug shape, not the fix
  });

  test("stuck open: the real recovery is shellSetMatchMode, not goto", () => {
    const stuck = { exclusive: "room" as const, layer: null, matchMode: "none" as const };
    const s = shellSetMatchMode(stuck, "private");
    // Entering match mode always clears exclusive chrome regardless of
    // what it was stuck on — the panel closes on the FIRST press.
    expect(shellVisibility(s).room).toBe(false);
    expect(shellVisibility(s).matchActive).toBe(true);
    // Second press (now correctly in match mode) toggles the room layer
    // open as an overlay — the normal hangout-menu behavior.
    const reopened = shellGoto(s, "room");
    expect(reopened.layer).toBe("room");
    expect(shellVisibility(reopened).room).toBe(true);
  });
});
