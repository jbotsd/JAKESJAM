import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { MatchScene } from "./scenes/MatchScene";
import { OnlineMatchScene } from "./scenes/OnlineMatchScene";
import { DraftScene } from "./scenes/DraftScene";
import { isClipsEnabled } from "./highlights/clipConsent.js";

// Highlight-clip capture draws a cropped copy of the game canvas onto a
// separate destination canvas via drawImage() (see ClipRecorder). Without
// preserveDrawingBuffer, WebGL may clear the drawing buffer right after
// composite → solid BLACK frames.
//
// Cost: a small per-frame GPU→retain path. Only pay it when clips are ON
// at boot (product default ON). WebGL context attrs can't flip mid-session;
// toggling clips off/on after load needs a reload to change this bit
// (OnlineMatchScene still gates recorder start/stop by consent).

export function buildGameConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: "game-root",
    // Right-click is the aegis power-slide — the browser context menu must NEVER
    // appear. This is Phaser's own canvas-level suppressor (Mouse + Touch
    // managers), one of several independent layers (see index.html head script
    // and main.ts) so no single point of failure lets the menu through.
    disableContextMenu: true,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#05080f",
    scene: [BootScene, PreloadScene, MainMenuScene, MatchScene, OnlineMatchScene, DraftScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: "100%",
      height: "100%",
    },
    render: {
      roundPixels: true,
      antialias: false,
      pixelArt: true,
      preserveDrawingBuffer: isClipsEnabled(),
      powerPreference: "high-performance",
    },
  };
}

/** @deprecated Prefer buildGameConfig() — frozen snapshot for rare static imports. */
export const gameConfig: Phaser.Types.Core.GameConfig = buildGameConfig();
