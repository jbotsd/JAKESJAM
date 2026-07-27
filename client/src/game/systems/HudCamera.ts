// `import type` keeps the Phaser bundle out of Node-side test runs that
// don't have a `window` (Bun's default test env) — same rationale as
// RenderLayer.ts's BLEND_MODE_ADD inline. The four Scene/Scale event-name
// strings below are frozen Phaser API constants (unchanged across 3.x →
// 4.x), so inlining them costs nothing at runtime.
import type Phaser from "phaser";
import { getRenderScale } from "../render/renderResolution.js";

const EVT_ADDED_TO_SCENE = "addedtoscene"; // Phaser.Scenes.Events.ADDED_TO_SCENE
const EVT_POST_UPDATE = "postupdate"; // Phaser.Scenes.Events.POST_UPDATE
const EVT_SHUTDOWN = "shutdown"; // Phaser.Scenes.Events.SHUTDOWN
const EVT_RESIZE = "resize"; // Phaser.Scale.Events.RESIZE

// Footage-study D6 (docs/clip-goal.md, 2026-07-27): a scrolling world platform
// rendered directly over the always-on-top roster row for ~0.8s mid-clip.
// The one-shot partition below (classify once, at ADDED_TO_SCENE time, never
// again) has no way to correct a GameObject that drifts out of its bucket
// AFTER that one classification — e.g. a stray `.setScrollFactor()` call
// somewhere down the line, or the HUD camera's own scroll/zoom/rotation
// getting nudged by anything that ever touches camera state broadly (the
// exact class of bug OnlineMatchScene's/renderResolution's "camera-skew
// investigation" [diag:camera]/[diag:governor] comments already flag as
// live and unresolved). Either failure silently exposes world geometry
// wherever the HUD used to (or should) paint, for as long as it takes for
// something else to re-trigger a partition pass — which could be the rest
// of the match. RESYNC_EVERY_N_FRAMES bounds that exposure window instead
// of leaving it open-ended.
const RESYNC_EVERY_N_FRAMES = 30; // ~0.5s at 60Hz — cheap safety net, not a hot path.

/**
 * installHudCamera — split rendering between a zoomed WORLD camera
 * (cameras.main) and a fixed HUD camera, so the world can crop in
 * (main.setZoom > 1, making the player the main event) WITHOUT dragging the
 * edge-anchored, scroll-fixed HUD off-screen.
 *
 * Partition rule: any object with scrollFactorX === 0 is HUD — rendered only
 * by the HUD camera (immune to the world zoom); everything else is world —
 * rendered only by the zoomed main camera. This works because the HUD is
 * ALREADY built entirely from setScrollFactor(0) objects (health/timer/chips,
 * overlays, banners), so no per-object tagging is needed.
 *
 * RENDER-SCALE MAPPING: HUD objects are laid out in CSS px (uiWidth/
 * uiHeight) while the backing store is CSS × renderScale. Every HUD object
 * is reparented into one root container scaled by renderScale — scaling
 * pivots at the container origin (0,0 = top-left), so a HUD object at CSS
 * (x, y) lands exactly at backing (x·rs, y·rs) with its physical size
 * independent of render resolution. (A HUD-camera zoom can NOT do this:
 * zoom pivots at the viewport centre and scrollFactor-0 objects ignore
 * camera scroll, so the mapping can't be re-anchored to the corner.)
 * Container children render in list order, not scene depth — the container
 * re-sorts by `depth` whenever new HUD objects arrive, preserving the
 * scene's depth semantics.
 *
 * New objects created during play (projectiles, particles, damage numbers,
 * late-joining player rigs, death/round overlays) are partitioned in
 * POST_UPDATE — deferred one step past ADDED_TO_SCENE so any chained
 * `.setScrollFactor(0)` has run before we read it. Draining in POST_UPDATE
 * (not the next frame) means they're assigned before that frame renders, so
 * there's no double-render flicker.
 *
 * Returns the HUD camera (rarely needed by callers).
 */
export function installHudCamera(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
  const main = scene.cameras.main;
  const hud = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
  hud.setName("hud");

  // Root for every HUD object — the CSS-px → backing-px mapping (see above).
  const hudRoot = scene.add.container(0, 0);
  hudRoot.setScale(getRenderScale());
  main.ignore(hudRoot);

  const partition = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj === (hudRoot as unknown as Phaser.GameObjects.GameObject)) return;
    const sf = (obj as unknown as { scrollFactorX?: number }).scrollFactorX;
    // scrollFactorX is undefined on objects without a Transform component —
    // treat those as world (they can't be HUD).
    if (sf === 0) {
      main.ignore(obj);
      hudRoot.add(obj as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform);
      // HUD text lives in CSS px inside an rs-scaled container: without a
      // matching glyph resolution the texture upscales and blurs — the
      // exact "UI looks low-res" report. Applies to Text-likes only.
      const rs = getRenderScale();
      if (rs > 1) {
        (obj as { setResolution?: (r: number) => void }).setResolution?.(rs);
      }
    } else {
      hud.ignore(obj);
    }
  };

  // Partition everything already in the scene at install time (call this at
  // the END of create(), after the HUD + initial world are built).
  // Snapshot first — reparenting into hudRoot mutates children.list.
  for (const obj of [...scene.children.list]) partition(obj);
  hudRoot.sort("depth");

  // Re-pin the HUD camera's own transform every frame. It must NEVER
  // scroll/zoom/rotate — anything that ever does (a future screen-shake
  // helper looping every camera, a stray `.pan()`/`.zoomTo()` aimed at the
  // wrong `cam` variable) would otherwise leave the HUD's viewport drifted
  // away from (0,0)/zoom 1 for however long that effect runs, exposing
  // whatever the world camera already painted underneath wherever the HUD
  // used to land. Guarded compares so the common (no-drift) case is just a
  // few property reads, not a matrix recompute every frame.
  const pinHudCamera = (): void => {
    if (hud.scrollX !== 0 || hud.scrollY !== 0) hud.setScroll(0, 0);
    if (hud.zoom !== 1) hud.setZoom(1);
    // No guarded read here: Phaser 4.2.1's own .d.ts doesn't expose a
    // `rotation` getter on Camera (the runtime accessor exists — the JS
    // source defines one — the types just don't declare it), so there's
    // nothing typed to compare against. Calling setRotation(0)
    // unconditionally is still cheap — one assignment, no matrix rebuild
    // beyond what setScroll/setZoom already trigger when they fire.
    hud.setRotation(0);
  };

  // Safety-net re-scan: catch any top-level scene object whose
  // scrollFactorX has drifted to 0 (declaring itself screen-fixed) SINCE it
  // was last classified as world by `partition()` above. `partition()` only
  // ever runs once per object (initial scan, or the ADDED_TO_SCENE/
  // POST_UPDATE pair below) — it has no ongoing opinion, so a later
  // `.setScrollFactor(0)` on an already-classified-world object would
  // otherwise stick as world (rendered by `main`, ignored by `hud`) forever,
  // which is the opposite failure (HUD content silently going invisible)
  // but the same root cause as D6. Iterated backwards because `partition()`
  // reparents matches into `hudRoot`, splicing them out of
  // `scene.children.list` — forward iteration with in-place removal skips
  // the element that shifts into the just-removed slot.
  const resyncDriftedWorldObjects = (): boolean => {
    const list = scene.children.list;
    let migratedAny = false;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const obj = list[i] as unknown as Phaser.GameObjects.GameObject;
      if (obj === (hudRoot as unknown as Phaser.GameObjects.GameObject)) continue;
      const sf = (obj as unknown as { scrollFactorX?: number }).scrollFactorX;
      if (sf === 0) {
        partition(obj);
        migratedAny = true;
      }
    }
    return migratedAny;
  };

  const pending: Phaser.GameObjects.GameObject[] = [];
  const onAdded = (obj: Phaser.GameObjects.GameObject): void => {
    pending.push(obj);
  };
  let framesSinceResync = 0;
  const onPostUpdate = (): void => {
    // Cheap, unconditional — must run every frame regardless of whether
    // anything else changed this tick (see pinHudCamera's rationale above).
    pinHudCamera();

    let addedHud = false;
    if (pending.length > 0) {
      for (const obj of pending) {
        // ADDED_TO_SCENE queues here; POST_UPDATE (this callback) drains it a
        // step later. An object created and destroy()'d again inside that
        // same gap (e.g. a HUD banner/text superseded while the client
        // fast-forwards a backlog of buffered ticks after a stall/reconnect)
        // is still in `pending` but is no longer live — Phaser's own
        // destroy() clears `.scene` to undefined. Passing that stale
        // reference into `hudRoot.add()` walks into Phaser's DisplayList
        // internals (Container.addHandler -> removeFromDisplayList) and
        // throws reading `.sys` off the undefined scene. Same defensive
        // shape as the statusText/combatFx null-before-use guards in
        // OnlineMatchScene.teardown() — check liveness before touching it.
        if (!(obj as unknown as { scene?: Phaser.Scene }).scene) continue;
        const wasHud = (obj as unknown as { scrollFactorX?: number }).scrollFactorX === 0;
        partition(obj);
        addedHud ||= wasHud;
      }
      pending.length = 0;
    }

    framesSinceResync += 1;
    if (framesSinceResync >= RESYNC_EVERY_N_FRAMES) {
      framesSinceResync = 0;
      if (resyncDriftedWorldObjects()) addedHud = true;
    }

    // Children render in list order — keep scene depth semantics.
    if (addedHud) hudRoot.sort("depth");
  };
  const onResize = (): void => {
    hud.setSize(scene.scale.width, scene.scale.height);
    hudRoot.setScale(getRenderScale());
  };

  scene.events.on(EVT_ADDED_TO_SCENE, onAdded);
  scene.events.on(EVT_POST_UPDATE, onPostUpdate);
  scene.scale.on(EVT_RESIZE, onResize);
  scene.events.once(EVT_SHUTDOWN, () => {
    scene.events.off(EVT_ADDED_TO_SCENE, onAdded);
    scene.events.off(EVT_POST_UPDATE, onPostUpdate);
    scene.scale.off(EVT_RESIZE, onResize);
  });

  return hud;
}
