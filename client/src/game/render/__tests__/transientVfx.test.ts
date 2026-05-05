// Phase C3 — contract tests for the TransientVfx coordinator.
//
// Locks in the public surface introduced in C1a/C1b:
//
//   - attach(scene) binds + drains on shutdown
//   - spawn(opts) registers a transient with curve-based fade
//   - drainAll() sweeps everything (round-end gate)
//   - Graphics geometry is scrubbed via .clear() on cleanup
//   - pool-managed objects route release() correctly
//
// Phaser is real-DOM-heavy; we use a lightweight stub that
// satisfies just the surface TransientVfx touches:
//   - scene.tweens.add(...) returns a tween-like with kill()
//   - scene.tweens.killTweensOf(target)
//   - scene.events.once(SHUTDOWN/DESTROY, cb)
//
// This is enough to unit-test the coordinator without a full
// Phaser game instance.

import { describe, expect, test, beforeEach } from "bun:test";
import { TransientVfx } from "../TransientVfx";

type FakeTween = {
  killCalled: boolean;
  onComplete: () => void;
  onUpdate?: (t: { progress: number }) => void;
};

type FakeGameObject = {
  destroyed: boolean;
  cleared: number;
  alpha: number;
  destroy: () => void;
  clear?: () => void;
  setAlpha: (a: number) => FakeGameObject;
};

function fakeObject(opts: { withClear?: boolean } = {}): FakeGameObject {
  const obj: FakeGameObject = {
    destroyed: false,
    cleared: 0,
    alpha: 1,
    destroy() {
      obj.destroyed = true;
    },
    setAlpha(a: number) {
      obj.alpha = a;
      return obj;
    },
  };
  if (opts.withClear) {
    obj.clear = () => {
      obj.cleared += 1;
    };
  }
  return obj;
}

type FakeScene = {
  events: {
    once: (event: string, cb: () => void) => void;
    fireShutdown: () => void;
  };
  tweens: {
    activeTweens: FakeTween[];
    add: (cfg: {
      targets: unknown;
      onComplete: () => void;
      onUpdate?: (t: { progress: number }) => void;
    }) => FakeTween;
    killTweensOf: (target: unknown) => void;
    completeAll: () => void;
  };
};

function fakeScene(): FakeScene {
  const shutdownCallbacks: Array<() => void> = [];
  const tweens: FakeTween[] = [];
  return {
    events: {
      once(event: string, cb: () => void): void {
        if (event === "shutdown") shutdownCallbacks.push(cb);
      },
      fireShutdown(): void {
        for (const cb of shutdownCallbacks) cb();
      },
    },
    tweens: {
      activeTweens: tweens,
      add(cfg) {
        const t: FakeTween = {
          killCalled: false,
          onComplete: cfg.onComplete,
          onUpdate: cfg.onUpdate,
        };
        tweens.push(t);
        return t;
      },
      killTweensOf(_target) {
        for (const t of tweens) {
          if (!t.killCalled) t.killCalled = true;
        }
      },
      completeAll(): void {
        for (const t of [...tweens]) {
          if (!t.killCalled) t.onComplete();
        }
      },
    },
  };
}

describe("TransientVfx — C3 contract", () => {
  let vfx: TransientVfx;
  let scene: FakeScene;

  beforeEach(() => {
    vfx = new TransientVfx();
    scene = fakeScene();
    // Phaser typing isn't available in a unit-test env; cast through.
    vfx.attach(scene as unknown as Phaser.Scene);
  });

  test("spawn registers an active transient", () => {
    vfx.spawn({ factory: () => fakeObject() as unknown as Phaser.GameObjects.GameObject, lifetimeMs: 100 });
    expect(vfx.__activeCountForTests()).toBe(1);
  });

  test("tween onComplete releases the entry (active count drops)", () => {
    const obj = fakeObject();
    vfx.spawn({ factory: () => obj as unknown as Phaser.GameObjects.GameObject, lifetimeMs: 100 });
    expect(vfx.__activeCountForTests()).toBe(1);
    scene.tweens.completeAll();
    expect(vfx.__activeCountForTests()).toBe(0);
  });

  test("default cleanup is destroy()", () => {
    const obj = fakeObject();
    vfx.spawn({ factory: () => obj as unknown as Phaser.GameObjects.GameObject, lifetimeMs: 100 });
    scene.tweens.completeAll();
    expect(obj.destroyed).toBe(true);
  });

  test("custom release() runs instead of destroy when provided", () => {
    const obj = fakeObject();
    let releaseCalled = false;
    vfx.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 100,
      release: () => {
        releaseCalled = true;
      },
    });
    scene.tweens.completeAll();
    expect(releaseCalled).toBe(true);
    expect(obj.destroyed).toBe(false);
  });

  test("startAlpha applies before tween starts", () => {
    const obj = fakeObject();
    vfx.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 100,
      startAlpha: 0.42,
    });
    expect(obj.alpha).toBe(0.42);
  });

  test("drainAll kills tweens AND releases all entries", () => {
    const o1 = fakeObject();
    const o2 = fakeObject();
    let r1 = false;
    let r2 = false;
    vfx.spawn({
      factory: () => o1 as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 1000,
      release: () => {
        r1 = true;
      },
    });
    vfx.spawn({
      factory: () => o2 as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 1000,
      release: () => {
        r2 = true;
      },
    });
    expect(vfx.__activeCountForTests()).toBe(2);
    vfx.drainAll();
    expect(vfx.__activeCountForTests()).toBe(0);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  test("drainAll scrubs Graphics geometry via .clear() before release", () => {
    const obj = fakeObject({ withClear: true });
    vfx.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 1000,
    });
    expect(obj.cleared).toBe(0);
    vfx.drainAll();
    // .clear() called once before destroy/release.
    expect(obj.cleared).toBe(1);
  });

  test("drainAll on objects WITHOUT clear() (Arc, Rectangle) doesn't throw", () => {
    const obj = fakeObject(); // no clear method
    vfx.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 1000,
    });
    expect(() => vfx.drainAll()).not.toThrow();
    expect(obj.destroyed).toBe(true);
  });

  test("scene shutdown event auto-drains", () => {
    let r = false;
    vfx.spawn({
      factory: () => fakeObject() as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 10_000,
      release: () => {
        r = true;
      },
    });
    expect(vfx.__activeCountForTests()).toBe(1);
    scene.events.fireShutdown();
    expect(vfx.__activeCountForTests()).toBe(0);
    expect(r).toBe(true);
  });

  test("attaching a NEW scene drains the prior scene's transients", () => {
    let r = false;
    vfx.spawn({
      factory: () => fakeObject() as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 10_000,
      release: () => {
        r = true;
      },
    });
    expect(vfx.__activeCountForTests()).toBe(1);
    const scene2 = fakeScene();
    vfx.attach(scene2 as unknown as Phaser.Scene);
    expect(vfx.__activeCountForTests()).toBe(0);
    expect(r).toBe(true);
  });

  test("spawn before attach immediately destroys (defensive — caller misorder)", () => {
    const standalone = new TransientVfx();
    const obj = fakeObject();
    standalone.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 100,
    });
    expect(standalone.__activeCountForTests()).toBe(0);
    expect(obj.destroyed).toBe(true);
  });

  test("100 simultaneous spawns can drain in one drainAll without errors", () => {
    for (let i = 0; i < 100; i++) {
      vfx.spawn({
        factory: () => fakeObject() as unknown as Phaser.GameObjects.GameObject,
        lifetimeMs: 100,
      });
    }
    expect(vfx.__activeCountForTests()).toBe(100);
    expect(() => vfx.drainAll()).not.toThrow();
    expect(vfx.__activeCountForTests()).toBe(0);
  });

  test("drainAll mid-tween doesn't double-release if onComplete also fires later", () => {
    const obj = fakeObject();
    let releaseCount = 0;
    vfx.spawn({
      factory: () => obj as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 1000,
      release: () => {
        releaseCount += 1;
      },
    });
    vfx.drainAll();
    expect(releaseCount).toBe(1);
    // The tween's onComplete was set to delete-then-release; if the
    // tween fires again post-drain, releaseEntry no-ops because the
    // entry is no longer in the active set.
    scene.tweens.completeAll();
    expect(releaseCount).toBe(1);
  });

  test("onTick fires with progress 0..1 on tween updates", () => {
    let lastT = -1;
    vfx.spawn({
      factory: () => fakeObject() as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 100,
      onTick: (_, t) => {
        lastT = t;
      },
    });
    const tween = scene.tweens.activeTweens[0]!;
    tween.onUpdate?.({ progress: 0.42 });
    expect(lastT).toBe(0.42);
  });
});
