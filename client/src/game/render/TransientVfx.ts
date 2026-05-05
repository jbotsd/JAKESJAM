// Phase C1 of the architecture deepening plan
// (/home/jimothy/.claude/plans/enchanted-juggling-cocke.md).
//
// `TransientVfx` is the single owner of every short-lived visual
// effect's lifetime. Replaces the 11+ ad-hoc patterns scattered
// across ProjectileSystem, StatusVfxController, OnlineMatchScene,
// MatchScene where each call site:
//
//   1. Calls `scene.add.<gameobject>(...)` (or `pool.acquireX()`).
//   2. Calls `scene.tweens.add({ targets, alpha: 0, duration,
//      onComplete: <destroy or release> })`.
//   3. Hopes `drainActive` finds them on round-end.
//
// Bug class this fixes: when a tween is killed externally (e.g.
// drainActive's killTweensOf, or scene shutdown), `onComplete`
// never fires, so the cleanup never runs. The visual object lives
// on. Cumulative geometry leaks (the cyan-line accumulation bug,
// commit dcde5ad) and pool exhaustion (bolt geometry retention,
// commit 86d205d) both trace back to this.
//
// Inspired by Unreal's Niagara Ribbon / NetworkTickSmoother
// pattern: visual lifetime is owned by the visual system, not the
// gameplay system, and the termination condition is a curve, not
// a boolean.
//
// Public surface:
//
//   transientVfx.spawn(opts) — register a transient. Module owns
//   the tween, the cleanup, the round-end drain.
//
//   transientVfx.drainAll() — sweep ALL in-flight transients.
//   Call from `case "round-end":` in the SimEvent handler.
//
//   transientVfx.attach(scene) — bind to a scene's lifecycle so
//   the in-flight set drains automatically on shutdown.
//
// Phase C1a — this file: module skeleton + spawn API +
//   drainAll. ProjectileSystem migrates in this same cut.
// Phase C1b — StatusVfxController + OnlineMatchScene blast-tint.

// Avoid `import Phaser from "phaser"` here so unit tests under
// bun:test can load this module without instantiating the full
// Phaser engine. We reference `Phaser.GameObjects.GameObject` and
// `Phaser.Tweens.Tween` only as type-only references via global
// triple-slash typing (Phaser is in scope at runtime in real game
// code; in tests we cast through `unknown`).
//
// The two scene-event names we register for ("shutdown" + "destroy")
// are the literal string keys Phaser's SceneEvents enum resolves
// to; using the strings directly keeps this module Phaser-free at
// import time.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Phaser {
    namespace GameObjects {
      interface GameObject {
        destroy(): void;
      }
    }
    namespace Tweens {
      interface Tween {
        progress: number;
      }
    }
  }
}

/**
 * What the caller hands `TransientVfx.spawn`. The factory
 * creates the visual; the module owns its lifetime.
 */
export type SpawnOpts = {
  /**
   * Construct the visual. Called synchronously inside `spawn`.
   * Return value is the GameObject that will be tweened to alpha
   * 0 then destroyed (or released back to the pool, if `release`
   * is set).
   */
  factory: () => Phaser.GameObjects.GameObject;

  /**
   * Total visual lifetime in milliseconds. Alpha tweens from
   * `startAlpha` (default 1) to 0 over this duration, easing per
   * `ease` (default Sine.easeIn).
   */
  lifetimeMs: number;

  /**
   * Initial alpha value. Defaults to 1. Useful for very-subtle
   * background effects that start dim.
   */
  startAlpha?: number;

  /**
   * Tween easing. Phaser-format string. Defaults to "Sine.easeIn".
   */
  ease?: string;

  /**
   * If set, called instead of `obj.destroy()` when the visual's
   * lifetime ends or `drainAll` sweeps it. Use this for
   * pool-managed objects:
   *
   *   release: () => particlePool.release(obj),
   */
  release?: () => void;

  /**
   * Optional per-frame hook. Receives the GameObject and the
   * current `t` (0..1, where 0 is just spawned, 1 is just
   * released). Use for moving the visual along an arc, scaling,
   * etc.
   */
  onTick?: (obj: Phaser.GameObjects.GameObject, t01: number) => void;
};

type Entry = {
  obj: Phaser.GameObjects.GameObject;
  tween: Phaser.Tweens.Tween;
  release?: () => void;
};

/**
 * The transient-VFX coordinator. One singleton per scene (see the
 * `attach` lifecycle below). The exported `transientVfx` is
 * scene-agnostic — it routes `spawn` to whichever scene last
 * `attach`'d. A scene can replace another at any time; previous
 * scenes' transients are drained at the prior scene's
 * SHUTDOWN/DESTROY event.
 */
export class TransientVfx {
  private active = new Set<Entry>();
  private scene: Phaser.Scene | null = null;

  /**
   * Bind to a scene. Sets the active scene for future `spawn`
   * calls + registers shutdown/destroy hooks so any in-flight
   * transients sweep automatically.
   */
  attach(scene: Phaser.Scene): void {
    if (this.scene === scene) return;
    if (this.scene) {
      // Drain prior-scene transients before re-binding.
      this.drainAll();
    }
    this.scene = scene;
    // Use the literal event-name strings Phaser's SceneEvents enum
    // resolves to. Avoids importing Phaser at module load (so the
    // unit tests can run without a real Phaser instance).
    scene.events.once("shutdown", () => {
      if (this.scene === scene) {
        this.drainAll();
        this.scene = null;
      }
    });
    scene.events.once("destroy", () => {
      if (this.scene === scene) {
        this.drainAll();
        this.scene = null;
      }
    });
  }

  /**
   * Spawn a transient. Returns void — the caller does not own the
   * object's lifetime. Use `obj` only inside `factory` /
   * `onTick` / `release`.
   */
  spawn(opts: SpawnOpts): void {
    const scene = this.scene;
    if (!scene) {
      // No scene attached — caller is misordering. Construct +
      // immediately destroy the object so we don't leak.
      const obj = opts.factory();
      if (opts.release) opts.release();
      else obj.destroy();
      return;
    }
    const obj = opts.factory();
    const startAlpha = opts.startAlpha ?? 1;
    if ("setAlpha" in obj && typeof (obj as { setAlpha?: unknown }).setAlpha === "function") {
      (obj as { setAlpha: (a: number) => unknown }).setAlpha(startAlpha);
    }
    const tween = scene.tweens.add({
      targets: obj,
      alpha: 0,
      duration: Math.max(1, opts.lifetimeMs),
      ease: opts.ease ?? "Sine.easeIn",
      onUpdate: opts.onTick
        ? (t: Phaser.Tweens.Tween) => {
            opts.onTick!(obj, t.progress);
          }
        : undefined,
      onComplete: () => {
        this.releaseEntry(entry);
      },
    });
    const entry: Entry = { obj, tween, release: opts.release };
    this.active.add(entry);
  }

  /**
   * Sweep every in-flight transient. Kills tweens, scrubs Graphics
   * geometry where applicable, releases back to pool or destroys.
   * Call from round-end SimEvent handlers.
   */
  drainAll(): void {
    const scene = this.scene;
    for (const entry of this.active) {
      if (scene) scene.tweens.killTweensOf(entry.obj);
      // Scrub Graphics geometry — Phaser Graphics is cumulative
      // (commit 86d205d). If the next consumer re-uses this object
      // (pool path) the leftover strokes/fills bleed through.
      if (
        "clear" in entry.obj &&
        typeof (entry.obj as { clear?: unknown }).clear === "function"
      ) {
        (entry.obj as { clear: () => void }).clear();
      }
      this.releaseEntry(entry);
    }
    this.active.clear();
  }

  /**
   * Test-only: snapshot the active transient count.
   */
  __activeCountForTests(): number {
    return this.active.size;
  }

  private releaseEntry(entry: Entry): void {
    if (!this.active.has(entry)) return;
    this.active.delete(entry);
    try {
      if (entry.release) {
        entry.release();
      } else {
        entry.obj.destroy();
      }
    } catch {
      // Defensive — release errors mustn't propagate into the
      // tween onComplete callback. Already-destroyed objects throw
      // sometimes; swallow.
    }
  }
}

/**
 * Page-singleton. Each scene calls `transientVfx.attach(this)` in
 * its `create()`.
 */
export const transientVfx = new TransientVfx();
