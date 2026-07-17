import { describe, expect, test } from "bun:test";
import { SecondOrderDynamics1D, SecondOrderDynamics2D } from "../secondOrderDynamics.js";

describe("SecondOrderDynamics1D", () => {
  test("converges to a step target", () => {
    const d = new SecondOrderDynamics1D(4, 1, 0, 0);
    let y = 0;
    for (let i = 0; i < 600; i++) y = d.update(1 / 60, 100);
    expect(y).toBeCloseTo(100, 0);
  });

  test("critically damped (z=1, r=0) never overshoots a step target", () => {
    const d = new SecondOrderDynamics1D(3, 1, 0, 0);
    let maxY = 0;
    for (let i = 0; i < 300; i++) {
      const y = d.update(1 / 60, 100);
      maxY = Math.max(maxY, y);
    }
    expect(maxY).toBeLessThanOrEqual(100.001);
  });

  test("r>0 produces real overshoot past the target (the punch character)", () => {
    const d = new SecondOrderDynamics1D(4, 0.6, 2, 0);
    let maxY = 0;
    for (let i = 0; i < 300; i++) {
      const y = d.update(1 / 60, 100);
      maxY = Math.max(maxY, y);
    }
    expect(maxY).toBeGreaterThan(100);
  });

  test("frame-rate independent: same elapsed time converges to ~same value at 30Hz vs 240Hz", () => {
    const elapsedS = 0.5;
    const a = new SecondOrderDynamics1D(4, 1, 0, 0);
    const b = new SecondOrderDynamics1D(4, 1, 0, 0);
    const stepsA = Math.round(elapsedS * 30);
    const stepsB = Math.round(elapsedS * 240);
    let ya = 0;
    let yb = 0;
    for (let i = 0; i < stepsA; i++) ya = a.update(1 / 30, 100);
    for (let i = 0; i < stepsB; i++) yb = b.update(1 / 240, 100);
    expect(Math.abs(ya - yb)).toBeLessThan(1.5);
  });

  test("stays finite under a large dt spike (stability clamp)", () => {
    const d = new SecondOrderDynamics1D(6, 0.5, 1.5, 0);
    const y = d.update(0.5, 1000); // one big frame-time spike
    expect(Number.isFinite(y)).toBe(true);
    expect(Number.isFinite(d.velocity)).toBe(true);
    // keep stepping normally afterward — must recover, not stay corrupted
    let last = y;
    for (let i = 0; i < 120; i++) last = d.update(1 / 60, 1000);
    expect(last).toBeCloseTo(1000, -1);
  });

  test("setParams retunes constants without a position/velocity discontinuity", () => {
    const d = new SecondOrderDynamics1D(1, 1, 0, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60, 100);
    const yBefore = d.value;
    const vBefore = d.velocity;
    d.setParams(8, 1, 0); // much snappier — should not jump position/velocity itself
    expect(d.value).toBe(yBefore);
    expect(d.velocity).toBe(vBefore);
    // but subsequent updates should now converge much faster than the old f=1 pace would have
    let y = d.value;
    for (let i = 0; i < 10; i++) y = d.update(1 / 60, 100);
    expect(y).toBeCloseTo(100, 0);
  });

  test("reset snaps position and zeroes velocity", () => {
    const d = new SecondOrderDynamics1D(4, 1, 0, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60, 100);
    expect(d.velocity).not.toBe(0);
    d.reset(50);
    expect(d.value).toBe(50);
    expect(d.velocity).toBe(0);
  });

  test("correctValue moves the displayed value but preserves velocity (unlike reset)", () => {
    const d = new SecondOrderDynamics1D(4, 1, 0, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60, 100);
    const vBefore = d.velocity;
    expect(vBefore).not.toBe(0);
    d.correctValue(42);
    expect(d.value).toBe(42);
    expect(d.velocity).toBe(vBefore);
  });

  test("explicit target velocity (xd) leads a constantly-moving target better than estimation", () => {
    // A target moving at constant 200 units/sec. With xd supplied exactly,
    // tracking error should be smaller than relying on backward-difference
    // estimation from a cold start.
    const withXd = new SecondOrderDynamics1D(5, 0.9, 0, 0);
    const withoutXd = new SecondOrderDynamics1D(5, 0.9, 0, 0);
    let x = 0;
    const dt = 1 / 60;
    const speed = 200;
    let errWith = 0;
    let errWithout = 0;
    for (let i = 0; i < 120; i++) {
      x += speed * dt;
      const yWith = withXd.update(dt, x, speed);
      const yWithout = withoutXd.update(dt, x);
      errWith = Math.abs(x - yWith);
      errWithout = Math.abs(x - yWithout);
    }
    expect(errWith).toBeLessThanOrEqual(errWithout + 0.01);
  });
});

describe("SecondOrderDynamics2D", () => {
  test("tracks both axes independently to a 2D target", () => {
    const d = new SecondOrderDynamics2D(4, 1, 0, 0, 0);
    let last = { x: 0, y: 0 };
    for (let i = 0; i < 300; i++) last = d.update(1 / 60, 300, -150);
    expect(last.x).toBeCloseTo(300, 0);
    expect(last.y).toBeCloseTo(-150, 0);
    expect(d.x).toBeCloseTo(300, 0);
    expect(d.y).toBeCloseTo(-150, 0);
  });

  test("reset moves both axes with zero velocity", () => {
    const d = new SecondOrderDynamics2D(4, 1, 0, 0, 0);
    for (let i = 0; i < 30; i++) d.update(1 / 60, 300, -150);
    d.reset(10, 20);
    expect(d.x).toBe(10);
    expect(d.y).toBe(20);
  });
});
