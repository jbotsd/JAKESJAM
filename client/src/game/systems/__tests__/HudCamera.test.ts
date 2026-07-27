// Regression test for the production crash:
//   Uncaught TypeError: Cannot read properties of undefined (reading 'sys')
//   at initialize.removeFromDisplayList -> initialize.addHandler ->
//      .exports [as Add] -> initialize.add
// (server/.telemetry/events-2026-07-1{6,7}.jsonl, 3 occurrences, ~24-33min
// into long online-match sessions, always preceded by ParticlePool
// exhaustion warnings + net reconnect attempts + a perf governor step.)
//
// Root cause: installHudCamera() defers newly-created scene objects one
// step (ADDED_TO_SCENE queues into `pending`; POST_UPDATE drains it into
// `hudRoot.add()` for scrollFactor(0) HUD objects). If an object is
// destroy()'d again inside that one-step gap — e.g. a HUD banner/text
// superseded while the client fast-forwards a backlog of buffered sim
// ticks after a stall/reconnect, which is exactly the observed breadcrumb
// shape — the stale reference is still sitting in `pending` when
// POST_UPDATE runs. Handing a destroy()'d object to Phaser's
// `Container.add()` (hudRoot is a Container) walks into
// addHandler -> gameObject.removeFromDisplayList(), which evaluates
// `this.displayList || this.scene.sys.displayList` — Phaser's own
// destroy() clears both `.displayList` and `.scene`, so this reads `.sys`
// off `undefined` and throws with the exact production message.
//
// Phaser is not spun up here (no canvas/WebGL in bun:test, matching the
// house style set by ParticlePool.test.ts's duck-typed scene stubs). The
// fake `hudRoot.add()` below reproduces the real Container/DisplayList
// contract precisely enough to fail before the fix and pass after it —
// this is a faithful mechanical repro of the crash, not just a plausibility
// check.

import { describe, expect, test } from "bun:test";
import { installHudCamera } from "../HudCamera";

type FakeGameObject = {
  scrollFactorX: number;
  scene: unknown;
  displayList: unknown;
};

function makeLiveHudObject(): FakeGameObject {
  return { scrollFactorX: 0, scene: {}, displayList: null };
}

/** Mirrors what real Phaser's GameObject#destroy() does to the two fields
 *  `removeFromDisplayList` inspects (see GameObject.js:1026 / :1057-1059
 *  in phaser@4.2.1 — `this.scene = undefined` is the last thing it sets). */
function destroyHudObject(obj: FakeGameObject): void {
  obj.displayList = null;
  obj.scene = undefined;
}

function makeContainer() {
  const children: FakeGameObject[] = [];
  const container = {
    children,
    setScale: () => container,
    sort: () => container,
    add(obj: FakeGameObject) {
      // Faithful repro of Container.addHandler -> removeFromDisplayList
      // (phaser@4.2.1 src/gameobjects/container/Container.js:431 and
      // src/gameobjects/GameObject.js:910): an exclusive container always
      // detaches the incoming object from wherever it was, and that
      // detach path falls back to `this.scene.sys.displayList` whenever
      // the object has no `.displayList` of its own.
      if (!obj.displayList && !obj.scene) {
        throw new TypeError("Cannot read properties of undefined (reading 'sys')");
      }
      children.push(obj);
    },
  };
  return container;
}

function makeFakeScene() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (event: string, fn: (...args: unknown[]) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  };
  const off = (event: string, fn: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(fn);
  };
  const once = (event: string, fn: (...args: unknown[]) => void) => {
    const wrapped = (...args: unknown[]) => {
      off(event, wrapped);
      fn(...args);
    };
    on(event, wrapped);
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
  };

  const hudContainer = makeContainer();
  const hudCamera = {
    setName: () => undefined,
    setSize: () => undefined,
    ignore: () => undefined,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    rotation: 0,
    setScroll(x: number, y: number) {
      hudCamera.scrollX = x;
      hudCamera.scrollY = y;
    },
    setZoom(z: number) {
      hudCamera.zoom = z;
    },
    setRotation(r: number) {
      hudCamera.rotation = r;
    },
  };
  const mainCamera = { ignore: () => undefined };

  const scale = { width: 800, height: 600, on: () => undefined, off: () => undefined };

  const scene = {
    cameras: { main: mainCamera, add: () => hudCamera },
    add: { container: () => hudContainer },
    children: { list: [] as unknown[] },
    scale,
    events: { on, off, once },
  };

  return {
    scene: scene as unknown as Phaser.Scene,
    hudContainer,
    hudCamera,
    sceneChildren: scene.children.list,
    fireAdded: (obj: FakeGameObject) => emit("addedtoscene", obj),
    firePostUpdate: () => emit("postupdate"),
    fireShutdown: () => emit("shutdown"),
  };
}

describe("installHudCamera POST_UPDATE partition", () => {
  test("an object destroyed between ADDED_TO_SCENE and POST_UPDATE does not crash", () => {
    const { scene, fireAdded, firePostUpdate } = makeFakeScene();
    installHudCamera(scene);

    const obj = makeLiveHudObject();
    fireAdded(obj); // queued into `pending`, same as a real Phaser create()

    // Superseded before the next POST_UPDATE — e.g. a round-banner/kill-
    // callout replaced by a later event while the client fast-forwards a
    // backlog of buffered ticks after a reconnect stall.
    destroyHudObject(obj);

    expect(() => firePostUpdate()).not.toThrow();
  });

  test("a live HUD object added the same way still gets partitioned into hudRoot", () => {
    const { scene, hudContainer, fireAdded, firePostUpdate } = makeFakeScene();
    installHudCamera(scene);

    const obj = makeLiveHudObject();
    fireAdded(obj);
    firePostUpdate();

    expect(hudContainer.children).toContain(obj);
  });

  test("shutdown detaches the listeners so a late fire is a no-op, not a crash", () => {
    const { scene, fireAdded, firePostUpdate, fireShutdown } = makeFakeScene();
    installHudCamera(scene);
    fireShutdown();

    const obj = makeLiveHudObject();
    destroyHudObject(obj);
    fireAdded(obj); // no-op: onAdded was unsubscribed by shutdown
    expect(() => firePostUpdate()).not.toThrow();
  });
});

// Footage-study D6 (docs/clip-goal.md, 2026-07-27): world geometry rendered
// over the always-on-top roster row for ~0.8s mid-clip. Both regressions
// below are one-shot-partition gaps: `partition()` only ever judges an
// object once, so anything that drifts out of its bucket AFTERWARD (or
// nudges the HUD camera's own transform) stayed broken indefinitely with no
// prior test pinning either invariant.
describe("installHudCamera D6 self-healing (world/HUD never mis-layers, regardless of drift)", () => {
  test("the HUD camera's scroll/zoom/rotation are re-pinned every POST_UPDATE", () => {
    const { scene, hudCamera, firePostUpdate } = makeFakeScene();
    installHudCamera(scene);

    // Simulate anything that ever touches camera state broadly (a
    // screen-shake helper looping every camera, a stray `.pan()`/`.zoomTo()`
    // aimed at the wrong camera variable) nudging the HUD camera off its
    // required identity transform.
    hudCamera.scrollX = 42;
    hudCamera.scrollY = -17;
    hudCamera.zoom = 1.4;
    hudCamera.rotation = 0.3;

    firePostUpdate();

    expect(hudCamera.scrollX).toBe(0);
    expect(hudCamera.scrollY).toBe(0);
    expect(hudCamera.zoom).toBe(1);
    expect(hudCamera.rotation).toBe(0);
  });

  test("a world object whose scrollFactorX drifts to 0 after classification migrates into hudRoot within the resync window", () => {
    const { scene, hudContainer, sceneChildren, firePostUpdate } = makeFakeScene();
    installHudCamera(scene);

    // Placed directly into the live scene child list — exactly where a real
    // GameObject already classified as world by a prior partition() pass
    // sits forever (world objects are never reparented, so nothing about
    // them is normally revisited again).
    const obj: FakeGameObject = { scrollFactorX: 1, scene: {}, displayList: null };
    sceneChildren.push(obj);

    firePostUpdate(); // still world — untouched
    expect(hudContainer.children).not.toContain(obj);

    // Something declares it screen-fixed sometime later (the drift D6's
    // mechanism-class is built on) without going through installHudCamera
    // at all — there is no other code path that would ever re-classify it.
    obj.scrollFactorX = 0;

    // Drive POST_UPDATE through the full resync window — the safety net is
    // throttled, not immediate, but it must fire within its documented
    // bound rather than never.
    for (let i = 0; i < 30; i += 1) firePostUpdate();

    expect(hudContainer.children).toContain(obj);
  });

  test("a world object that never drifts is left alone across many resync windows (no spurious migration)", () => {
    const { scene, hudContainer, sceneChildren, firePostUpdate } = makeFakeScene();
    installHudCamera(scene);

    const obj: FakeGameObject = { scrollFactorX: 1, scene: {}, displayList: null };
    sceneChildren.push(obj);

    for (let i = 0; i < 90; i += 1) firePostUpdate();

    expect(hudContainer.children).not.toContain(obj);
  });
});
