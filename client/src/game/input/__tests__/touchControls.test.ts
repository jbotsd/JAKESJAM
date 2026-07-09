// TouchControls input-mapping contract + mobile detection.
//
// The DOM is stubbed just enough to construct the overlay and drive
// synthetic pointer events, then we assert the resulting InputBit bitfield.
// This locks the twin-stick semantics: left stick = move/jump/crouch, right
// stick = aim + auto-fire, shield/dash buttons.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { InputBit } from "../../../net/protocol";

// ── Minimal DOM shim (bun:test has no DOM) ───────────────────────────────
type Listener = (e: unknown) => void;
class FakeEl {
  className = "";
  textContent = "";
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners = new Map<string, Listener[]>();
  classList = {
    _s: new Set<string>(),
    add: (c: string) => this.classList._s.add(c),
    remove: (c: string) => this.classList._s.delete(c),
    toggle: (c: string, v?: boolean) => (v ? this.classList._s.add(c) : this.classList._s.delete(c)),
    contains: (c: string) => this.classList._s.has(c),
  };
  append(...els: FakeEl[]): void {
    this.children.push(...els);
  }
  appendChild(e: FakeEl): FakeEl {
    this.children.push(e);
    return e;
  }
  remove(): void {}
  addEventListener(t: string, l: Listener): void {
    const arr = this.listeners.get(t) ?? [];
    arr.push(l);
    this.listeners.set(t, arr);
  }
  removeEventListener(): void {}
  fire(t: string, e: unknown): void {
    for (const l of this.listeners.get(t) ?? []) l(e);
  }
}

let created: FakeEl[] = [];
let winListeners: Map<string, Listener[]>;

beforeEach(() => {
  created = [];
  winListeners = new Map();
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const e = new FakeEl();
      created.push(e);
      return e;
    },
    body: new FakeEl(),
  };
  (globalThis as { window?: unknown }).window = {
    addEventListener: (t: string, l: Listener) => {
      const arr = winListeners.get(t) ?? [];
      arr.push(l);
      winListeners.set(t, arr);
    },
    removeEventListener: () => {},
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
});

function fireWindow(t: string, e: unknown): void {
  for (const l of winListeners.get(t) ?? []) l(e);
}

async function makeControls() {
  const { TouchControls } = await import("../TouchControls");
  const tc = new TouchControls(new FakeEl() as unknown as HTMLElement);
  tc.attach();
  // Zones are the first two children of root (left, right); shield, dash next.
  const root = created[0]!;
  const kids = root.children as FakeEl[];
  return { tc, leftZone: kids[0]!, rightZone: kids[1]!, shieldBtn: kids[2]!, dashBtn: kids[3]! };
}

describe("TouchControls mapping", () => {
  test("left stick: right-tilt → Right; up-tilt → Jump", async () => {
    const { tc, leftZone } = await makeControls();
    leftZone.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 300, preventDefault() {} });
    // Drag right + up past the deadzones.
    fireWindow("pointermove", { pointerId: 1, clientX: 100 + 60, clientY: 300 - 60, preventDefault() {} });
    const s = tc.getState();
    expect(s.keys & InputBit.Right).toBeTruthy();
    expect(s.keys & InputBit.Jump).toBeTruthy();
    expect(s.keys & InputBit.Left).toBeFalsy();
  });

  test("right stick: drag → aim direction + auto-fire", async () => {
    const { tc, rightZone } = await makeControls();
    rightZone.fire("pointerdown", { pointerId: 2, clientX: 700, clientY: 300, preventDefault() {} });
    fireWindow("pointermove", { pointerId: 2, clientX: 700 + 50, clientY: 300, preventDefault() {} });
    const s = tc.getState();
    expect(s.keys & InputBit.Fire).toBeTruthy();
    expect(s.aimDir).not.toBeNull();
    expect(s.aimDir!.x).toBeGreaterThan(0.9); // pointing right
    expect(Math.abs(s.aimDir!.y)).toBeLessThan(0.2);
  });

  test("shield + dash buttons set their bits while held", async () => {
    const { tc, shieldBtn, dashBtn } = await makeControls();
    shieldBtn.fire("pointerdown", { pointerId: 3, preventDefault() {} });
    dashBtn.fire("pointerdown", { pointerId: 4, preventDefault() {} });
    let s = tc.getState();
    expect(s.keys & InputBit.Shield).toBeTruthy();
    expect(s.keys & InputBit.Dash).toBeTruthy();
    // Release shield.
    fireWindow("pointerup", { pointerId: 3, preventDefault() {} });
    s = tc.getState();
    expect(s.keys & InputBit.Shield).toBeFalsy();
    expect(s.keys & InputBit.Dash).toBeTruthy(); // dash still held
  });

  test("deadzone: tiny move-stick nudge produces no movement", async () => {
    const { tc, leftZone } = await makeControls();
    leftZone.fire("pointerdown", { pointerId: 5, clientX: 100, clientY: 300, preventDefault() {} });
    fireWindow("pointermove", { pointerId: 5, clientX: 105, clientY: 300, preventDefault() {} }); // 5px
    const s = tc.getState();
    expect(s.keys & InputBit.Left).toBeFalsy();
    expect(s.keys & InputBit.Right).toBeFalsy();
  });

  test("releasing the aim stick stops fire and clears aimDir", async () => {
    const { tc, rightZone } = await makeControls();
    rightZone.fire("pointerdown", { pointerId: 6, clientX: 700, clientY: 300, preventDefault() {} });
    fireWindow("pointermove", { pointerId: 6, clientX: 760, clientY: 300, preventDefault() {} });
    expect(tc.getState().keys & InputBit.Fire).toBeTruthy();
    fireWindow("pointerup", { pointerId: 6, preventDefault() {} });
    const s = tc.getState();
    expect(s.keys & InputBit.Fire).toBeFalsy();
    expect(s.aimDir).toBeNull();
  });
});
