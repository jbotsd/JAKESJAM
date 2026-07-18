// Sim-authoritative construct VFX driver — the Syzygist entanglement read.
// Thin painter: each frame it asks the pure planner (render/entanglementPlan)
// WHAT to draw from the snapshot state, then paints it via LightConstruct. No
// decision logic and no sim-logic import live here — the render layer only reads
// state + is handed a class resolver (north-star §5). Sibling of
// StatusVfxController.
//
// The continuous tether is drawn into ONE dedicated off-pool Graphics this
// controller owns and redraws every frame — NOT re-emitted as pooled transients.
// The live-Phaser harness proved the churn model exhausted the shared 4-bolt
// pool every frame and starved every other effect. Bursts + feed motes stay
// pooled transients (they are occasional, which is what the pool is for).
//
// Wiring (deferred — OnlineMatchScene.ts is uncommitted/dirty under a parallel
// pass; editing another session's open file is unsafe). When it settles, mirror
// the StatusVfxController hookup in OnlineMatchScene:
//     this.constructVfx = new ConstructVfxController(this, this.particlePool);
//     ...each frame:
//     this.constructVfx.update(state, deltaMs, (id) => this.worldPosOf(id),
//                              (cid) => this.getCharacter(cid).classId);

import Phaser from "phaser";
import { ParticlePool } from "./ParticlePool";
import {
  drawTether,
  spawnTetherMote,
  spawnBindBurst,
  SYZYGIST_TINT,
  ENTANGLE_SHAPE,
} from "../render/LightConstruct";
import {
  makeEntanglementMemo,
  planEntanglement,
  type EntanglementMemo,
} from "../render/entanglementPlan";
import type { CharacterArchetype, PlayerId, Vec2, WorldState } from "../../sim";

// Under the fighters so they stay the loudest read (A18). Provisional — tune to
// the live scene's depth scheme when wired.
const TETHER_DEPTH = 6;

export class ConstructVfxController {
  private readonly pool: ParticlePool;
  private readonly memo: EntanglementMemo = makeEntanglementMemo();
  // One dedicated off-pool Graphics for ALL live tethers, redrawn each frame.
  private readonly tetherLayer: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, pool: ParticlePool) {
    this.pool = pool;
    this.tetherLayer = scene.add.graphics();
    this.tetherLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.tetherLayer.setDepth(TETHER_DEPTH);
  }

  update(
    state: WorldState,
    deltaMs: number,
    getPosition: (id: PlayerId) => Vec2 | undefined,
    resolveClassId: (characterId: CharacterArchetype) => string,
  ): void {
    const plan = planEntanglement(state, deltaMs, getPosition, resolveClassId, this.memo);

    // hold — redraw every live tether into the one dedicated layer.
    this.tetherLayer.clear();
    for (const t of plan.tethers) {
      drawTether(this.tetherLayer, t.from, t.to, SYZYGIST_TINT, ENTANGLE_SHAPE, t.phaseSec);
    }

    // bind / snap / feed — occasional, pooled transients.
    for (const s of plan.snaps) spawnBindBurst(this.pool, s, SYZYGIST_TINT, true);
    for (const b of plan.binds) spawnBindBurst(this.pool, b, SYZYGIST_TINT, false);
    for (const m of plan.motes) spawnTetherMote(this.pool, m.from, m.to, SYZYGIST_TINT, ENTANGLE_SHAPE);
  }

  destroy(): void {
    this.tetherLayer.destroy();
    this.memo.moteCadence.clear();
    this.memo.lastVictimPos.clear();
    this.memo.active.clear();
  }
}
