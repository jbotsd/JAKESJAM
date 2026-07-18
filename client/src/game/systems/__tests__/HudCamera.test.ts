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
  const hudCamera = { setName: () => undefined, setSize: () => undefined, ignore: () => undefined };
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
