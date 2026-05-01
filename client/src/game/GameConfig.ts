import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { MatchScene } from "./scenes/MatchScene";
import { OnlineMatchScene } from "./scenes/OnlineMatchScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: "game-root",
  width: 960,
  height: 540,
  backgroundColor: "#0b0e14",
  scene: [BootScene, MainMenuScene, MatchScene, OnlineMatchScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
