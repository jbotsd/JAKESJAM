// Construct-layer glow gate — thin, quality-tiered wrapper around Phaser
// 4.2.1's real GameObject Filters API. `enableFilters()` + `.filters.internal.
// addGlow(...)` — NOT `preFX.addGlow()` (that's Phaser-3-era naming; confirmed
// against the installed 4.2.1 package, node_modules/phaser/src/gameobjects/
// components/Filters.js + FilterList.js). Applied ONCE to a PERSISTENT,
// SINGLE-TINT construct layer (a layer that only ever holds one class's
// geometry) as a progressive enhancement over the hand-stacked-stroke bloom
// those layers already draw — the vector-only look remains the fallback below
// fxLevel 2 for free, no separate low-tier code path to author.
//
// Gated on fxLevel === 2 (docs/RENDER_OVERHAUL_PLAN.md's tier ladder: potato
// "no filters", phone "halo sprites, no filters", laptop+ "1-2 filters") AND a
// real WebGL renderer (mirrors OnlineMatchScene.ts's own `combatCinematics`
// guard: `rendererType === Phaser.WEBGL`) — `enableFilters()` itself already
// no-ops without `scene.renderer.gl`, but checking explicitly here keeps this
// file's intent visible rather than relying on an internal engine fallback.
//
// Cost note straight from Phaser's own doc comment on Filters: "each object
// with filters enabled... makes a new draw call, plus one or more per active
// filter... use sparingly" — why this is applied to the FEW persistent layers
// (paid once per layer per frame), never per-transient-particle.

import Phaser from "phaser";
import { getQualityProfile } from "./qualityProfile.js";

let webglChecked = false;
let webglOk = false;

function isWebGL(scene: Phaser.Scene): boolean {
  if (!webglChecked) {
    webglChecked = true;
    const rendererType = (scene.game as { renderer?: { type?: number } } | undefined)?.renderer
      ?.type;
    webglOk = rendererType === Phaser.WEBGL;
  }
  return webglOk;
}

/** Enable a soft additive glow on a persistent, single-tint construct layer.
 *  No-ops below fxLevel 2 or on a non-WebGL renderer — safe to call
 *  unconditionally right after creating the layer. `glowColor` should be the
 *  layer's own ConstructTint.glow — a layer holding two classes' tints can't
 *  use a single filter color correctly; split it into per-class layers first
 *  (ConstructVfxController's swingLayerNinja/swingLayerPaladin pattern). */
export function applyConstructGlow(
  gameObject: Phaser.GameObjects.Graphics,
  glowColor: number,
  // Bold on purpose — these constructs are the flagship read of the whole
  // presentation-overhaul pass (Jake, 2026-07-19: "juice this... up to
  // epic"). A timid glow reads as a rendering artifact; this should read as
  // the construct genuinely radiating.
  outerStrength = 2.0,
  distance = 18,
): void {
  if (getQualityProfile().fxLevel < 2) return;
  if (!isWebGL(gameObject.scene)) return;
  gameObject.enableFilters();
  // `.filters` is still nullable in the type (the mixin returns null when the
  // renderer has no WebGL context) even after the isWebGL() guard above —
  // belt-and-suspenders in case a scene's renderer object lies about its type.
  if (!gameObject.filters) return;
  gameObject.filters.internal.addGlow(glowColor, outerStrength, 0, 1, false, 10, distance);
}

/** Test-only: reset the cached WebGL probe (module-level cache would otherwise
 *  leak between unrelated test scenes). */
export function __resetConstructFiltersCacheForTests(): void {
  webglChecked = false;
  webglOk = false;
}
