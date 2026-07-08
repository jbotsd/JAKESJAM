import Phaser from "phaser";

/**
 * installHudCamera — split rendering between a zoomed WORLD camera
 * (cameras.main) and a fixed 1:1 HUD camera, so the world can crop in
 * (main.setZoom > 1, making the player the main event) WITHOUT dragging the
 * edge-anchored, scroll-fixed HUD off-screen.
 *
 * Partition rule: any object with scrollFactorX === 0 is HUD — rendered only
 * by the HUD camera (immune to the world zoom); everything else is world —
 * rendered only by the zoomed main camera. This works because the HUD is
 * ALREADY built entirely from setScrollFactor(0) objects (health/timer/chips,
 * overlays, banners), so no per-object tagging is needed.
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

  const partition = (obj: Phaser.GameObjects.GameObject): void => {
    const sf = (obj as unknown as { scrollFactorX?: number }).scrollFactorX;
    // scrollFactorX is undefined on objects without a Transform component —
    // treat those as world (they can't be HUD).
    if (sf === 0) main.ignore(obj);
    else hud.ignore(obj);
  };

  // Partition everything already in the scene at install time (call this at
  // the END of create(), after the HUD + initial world are built).
  for (const obj of scene.children.list) partition(obj);

  const pending: Phaser.GameObjects.GameObject[] = [];
  const onAdded = (obj: Phaser.GameObjects.GameObject): void => {
    pending.push(obj);
  };
  const onPostUpdate = (): void => {
    if (pending.length === 0) return;
    for (const obj of pending) partition(obj);
    pending.length = 0;
  };
  const onResize = (): void => {
    hud.setSize(scene.scale.width, scene.scale.height);
  };

  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate);
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate);
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
  });

  return hud;
}
