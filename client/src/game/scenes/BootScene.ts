import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create() {
    // Boot complete, move to asset preloading
    this.scene.start(SceneKeys.Preload);
  }
}
