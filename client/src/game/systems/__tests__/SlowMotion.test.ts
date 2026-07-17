import { describe, expect, test } from "bun:test";
import { SlowMotion } from "../SlowMotion.js";

function fakeScene(startMs = 0) {
  return {
    time: { now: startMs },
    tweens: { timeScale: 1 },
  } as unknown as Phaser.Scene;
}

describe("SlowMotion", () => {
  test("trigger dips render timeScale immediately", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 500);
    expect(scene.tweens.timeScale).toBe(0.35);
    expect(sm.isActive()).toBe(true);
  });

  test("stays dipped while no input and before the deadline", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 500);
    scene.time.now += 100;
    sm.update(0);
    expect(scene.tweens.timeScale).toBe(0.35);
    expect(sm.isActive()).toBe(true);
  });

  test("any meaningful key press snaps back to full speed INSTANTLY, not eased", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 500);
    scene.time.now += 50; // well before the timeout
    sm.update(1 << 0); // some key bit set — a real input arrived
    expect(scene.tweens.timeScale).toBe(1);
    expect(sm.isActive()).toBe(false);
  });

  test("times out to full speed if nothing cancels it first", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 500);
    scene.time.now += 500;
    sm.update(0);
    expect(scene.tweens.timeScale).toBe(1);
    expect(sm.isActive()).toBe(false);
  });

  test("update() is a no-op when never triggered", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.update(1 << 3);
    expect(scene.tweens.timeScale).toBe(1);
    expect(sm.isActive()).toBe(false);
  });

  test("update() after it already ended doesn't re-touch timeScale", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 500);
    sm.update(1 << 0); // ends it
    scene.tweens.timeScale = 2; // something else (e.g. hit-stop) owns it now
    sm.update(1 << 0);
    expect(scene.tweens.timeScale).toBe(2); // SlowMotion must not stomp it
  });

  test("cancel() forces an immediate end without waiting for input or timeout", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 5000);
    sm.cancel();
    expect(scene.tweens.timeScale).toBe(1);
    expect(sm.isActive()).toBe(false);
  });

  test("a new trigger while already active restarts the dip and deadline", () => {
    const scene = fakeScene();
    const sm = new SlowMotion(scene);
    sm.trigger(0.35, 200);
    scene.time.now += 150;
    sm.trigger(0.2, 200); // re-triggered near the old deadline
    scene.time.now += 150; // would have timed out under the OLD deadline
    sm.update(0);
    expect(sm.isActive()).toBe(true);
    expect(scene.tweens.timeScale).toBe(0.2);
  });
});
