import { describe, expect, test } from "bun:test";
import { RenderTimeArbiter } from "../RenderTimeArbiter.js";

describe("RenderTimeArbiter", () => {
  test("strongest active source wins and expiry reveals the remaining hold", () => {
    const host = { tweens: { timeScale: 1 }, time: { now: 100 } };
    const arbiter = new RenderTimeArbiter(host);
    arbiter.hold("slow-motion", 0.35, 500);
    arbiter.hold("hit-stop", 0, 50);
    expect(host.tweens.timeScale).toBe(0);
    host.time.now = 151;
    arbiter.update();
    expect(host.tweens.timeScale).toBe(0.35);
    host.time.now = 601;
    arbiter.update();
    expect(host.tweens.timeScale).toBe(1);
  });

  test("repeated source requests extend rather than shorten a hold", () => {
    const host = { tweens: { timeScale: 1 }, time: { now: 0 } };
    const arbiter = new RenderTimeArbiter(host);
    arbiter.hold("hit-stop", 0, 80);
    host.time.now = 20;
    arbiter.hold("hit-stop", 0.5, 10);
    host.time.now = 31;
    arbiter.update();
    expect(host.tweens.timeScale).toBe(0);
    host.time.now = 81;
    arbiter.update();
    expect(host.tweens.timeScale).toBe(1);
  });

  test("explicit input release removes only its own source", () => {
    const host = { tweens: { timeScale: 1 }, time: { now: 0 } };
    const arbiter = new RenderTimeArbiter(host);
    arbiter.hold("slow-motion", 0.35, 500);
    arbiter.hold("hit-stop", 0, 50);
    arbiter.release("slow-motion");
    expect(host.tweens.timeScale).toBe(0);
  });
});
