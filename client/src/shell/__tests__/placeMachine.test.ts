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

  test("room blocked while match active", () => {
    let s = shellSetMatchMode(createShellState(), "practice");
    s = shellGoto(s, "room");
    expect(s.exclusive).toBe("home");
    expect(s.matchMode).toBe("practice");
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
});
