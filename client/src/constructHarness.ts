// Live-Phaser construct harness — boots the ACTUAL construct code in a real
// Phaser engine (not the offline canvas mock), so the presentation harness loop
// can read the real render + MOTION without wiring into the live match scene
// (uncommitted/dirty under a parallel pass). Collision-free: a standalone entry
// (client/harness.html) served by JAKESJAM's own vite dev server (:5174).
//
// Two demos, switched by command:
//  - "entangle" (default): drives the REAL ConstructVfxController with a
//    synthetic WorldState — state -> planEntanglement -> controller -> off-pool
//    tether + pooled bursts/motes; mark/unmark fire bind/snap via real state.
//  - "kindred": the paladin divine ward — a persistent faceted dome drawn into a
//    dedicated off-pool layer (never the shared pool), plus raise/absorb/drop
//    one-shots and the Kindled Edge weapon.
//
// A page-error surfaces to the screenshot script — the port + integration
// validation the offline preview cannot do.

import Phaser from "phaser";
import { ParticlePool } from "./game/systems/ParticlePool";
import { transientVfx } from "./game/render/TransientVfx";
import { ConstructVfxController } from "./game/systems/ConstructVfxController";
import {
  spawnCrystalShards,
  drawWardSlab,
  spawnWardRaise,
  spawnWardAbsorb,
  spawnWardDrop,
  GEOMETRICIAN_TINT,
  KINDRED_TINT,
} from "./game/render/LightConstruct";
import type { CharacterArchetype, PlayerId, Vec2, WorldState } from "./sim";

type HarnessWindow = Window & {
  __harnessReady?: boolean;
  __cmd?: string | null;
  harnessFire?: (name: string) => void;
};

const resolveClassId = (cid: CharacterArchetype): string => (cid === "shielded" ? "priest" : "wizard");

const KINDRED_POS: Vec2 = { x: 340, y: 200 }; // paladin body
const KINDRED_SLAB: Vec2 = { x: 402, y: 208 }; // the shield HELD to the front

class HarnessScene extends Phaser.Scene {
  private pool!: ParticlePool;
  private controller!: ConstructVfxController;
  private wardLayer!: Phaser.GameObjects.Graphics;
  private priest!: Phaser.GameObjects.Arc;
  private priestHalo!: Phaser.GameObjects.Arc;
  private victim!: Phaser.GameObjects.Arc;
  private victimHalo!: Phaser.GameObjects.Arc;
  private kindred!: Phaser.GameObjects.Arc;
  private kindredHalo!: Phaser.GameObjects.Arc;
  private t = 0;
  private wardPhase = 0;
  private markActive = true;
  private mode: "entangle" | "kindred" = "entangle";
  private wardActive = false;
  private wardIntensity = 0; // eases toward wardActive so raise/drop ramp smoothly
  private victimPos: Vec2 = { x: 520, y: 170 };

  constructor() {
    super("harness");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#12151c");
    this.pool = new ParticlePool(this);
    transientVfx.attach(this);
    this.controller = new ConstructVfxController(this, this.pool);

    // Off-pool ward layer (mirrors the controller's off-pool tether layer).
    this.wardLayer = this.add.graphics();
    this.wardLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.wardLayer.setDepth(6);

    this.priestHalo = this.add
      .circle(200, 220, 30, 0xffcc88, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(20);
    this.priest = this.add.circle(200, 220, 13, 0x8fd0ff, 1).setDepth(20);
    this.victimHalo = this.add.circle(520, 170, 30, 0xffcc88, 0.28).setBlendMode(Phaser.BlendModes.ADD).setDepth(20);
    this.victim = this.add.circle(520, 170, 13, 0xf0c48a, 1).setDepth(20);

    // Kindred paladin — hidden until switched to.
    this.kindredHalo = this.add
      .circle(KINDRED_POS.x, KINDRED_POS.y, 26, 0xffd9a0, 0.22)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(20)
      .setVisible(false);
    this.kindred = this.add.circle(KINDRED_POS.x, KINDRED_POS.y, 13, 0xffe6b0, 1).setDepth(20).setVisible(false);

    const w = window as HarnessWindow;
    w.__cmd = null;
    w.harnessFire = (name: string) => {
      w.__cmd = name;
    };
    w.__harnessReady = true;
  }

  private hitOnSlab(): Vec2 {
    // A hit landing on the shield's outward (left) face.
    return { x: KINDRED_SLAB.x - 30, y: KINDRED_SLAB.y - 8 };
  }

  update(_time: number, delta: number): void {
    this.t += delta;
    this.wardPhase += delta / 1000;

    // Victim orbits (the tether must track it).
    this.victimPos = { x: 500 + Math.cos(this.t * 0.0016) * 70, y: 180 + Math.sin(this.t * 0.0016) * 45 };
    this.victim.setPosition(this.victimPos.x, this.victimPos.y);
    this.victimHalo.setPosition(this.victimPos.x, this.victimPos.y);

    const w = window as HarnessWindow;
    const cmd = w.__cmd;
    if (cmd) {
      w.__cmd = null;
      switch (cmd) {
        case "kindred":
          this.mode = "kindred";
          this.markActive = false;
          this.wardActive = false;
          this.priest.setVisible(false);
          this.priestHalo.setVisible(false);
          this.victim.setVisible(false);
          this.victimHalo.setVisible(false);
          this.kindred.setVisible(true);
          this.kindredHalo.setVisible(true);
          break;
        case "mark":
          this.markActive = true;
          break;
        case "unmark":
          this.markActive = false;
          break;
        case "blade":
          // Interstice twin-dagger slash — driven through the controller's
          // persistent swing layer (advanced each frame in controller.update).
          this.controller.triggerSwing("ninja", { x: 360, y: 330 }, -0.35);
          break;
        case "shards":
          // Geometrician conjures a volley of cyan crystal shards from the palm.
          spawnCrystalShards(this.pool, { x: 250, y: 320 }, -0.15, GEOMETRICIAN_TINT);
          break;
        case "raise":
          this.wardActive = true;
          spawnWardRaise(this.pool, KINDRED_SLAB, KINDRED_TINT);
          break;
        case "absorb":
          spawnWardAbsorb(this.pool, KINDRED_POS, this.hitOnSlab(), KINDRED_TINT);
          break;
        case "drop":
          this.wardActive = false;
          spawnWardDrop(this.pool, KINDRED_SLAB, KINDRED_TINT);
          break;
        case "edge":
          // Kindred crystal-edge swing to the LEFT, clear of the shield held on
          // the right — driven through the controller's persistent swing layer.
          this.controller.triggerSwing("paladin", KINDRED_POS, 2.3);
          break;
      }
    }

    // hold — the paladin's held slab shield, drawn every frame into the off-pool
    // layer (rune-screen alive via wardPhase). Its intensity eases toward the
    // ward state, so raise fades it IN and drop fades it OUT (no instant pop).
    const wardTarget = this.mode === "kindred" && this.wardActive ? 1 : 0;
    this.wardIntensity += (wardTarget - this.wardIntensity) * Math.min(1, delta / 160);
    this.wardLayer.clear();
    if (this.wardIntensity > 0.02) {
      drawWardSlab(this.wardLayer, KINDRED_SLAB, KINDRED_TINT, this.wardPhase, this.wardIntensity);
    }

    // The REAL entanglement pipeline (does nothing in kindred mode: markActive off).
    const tick = Math.floor(this.t / 16);
    const state = {
      tick,
      players: {
        priest: { alive: true, characterId: "shielded" as CharacterArchetype },
        victim: {
          alive: true,
          characterId: "balanced" as CharacterArchetype,
          focusHexMarkUntilTick: this.markActive ? tick + 50 : 0,
        },
      },
    } as unknown as WorldState;
    const getPos = (id: PlayerId): Vec2 | undefined =>
      id === ("priest" as PlayerId)
        ? { x: this.priest.x, y: this.priest.y }
        : id === ("victim" as PlayerId)
          ? this.victimPos
          : undefined;
    this.controller.update(state, [], delta, getPos, resolveClassId);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "harness-root",
  width: 720,
  height: 405,
  backgroundColor: "#12151c",
  scene: HarnessScene,
  fps: { target: 60 },
});
