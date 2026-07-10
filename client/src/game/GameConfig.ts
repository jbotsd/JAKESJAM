import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { MatchScene } from "./scenes/MatchScene";
import { OnlineMatchScene } from "./scenes/OnlineMatchScene";
import { DraftScene } from "./scenes/DraftScene";
import { ReplayScene } from "./scenes/ReplayScene";
import { backingSize, getRenderScale } from "./render/renderResolution.js";
import { getQualityProfile } from "./render/qualityProfile.js";

// Render config is tuned for VECTOR art, not pixel art: the whole game is
// tessellated Graphics geometry, so context MSAA (antialias:true) is the only
// edge AA it ever gets, and roundPixels would quantize slow camera pans to
// whole-pixel steps (and forces a separate shader → batch breaks).
//
// preserveDrawingBuffer stays FALSE even with clips on: ClipRecorder is
// driven from Phaser's POST_RENDER hook, in the same task as the WebGL draw,
// so the drawing buffer is guaranteed intact when drawImage reads it.

export function buildGameConfig(): Phaser.Types.Core.GameConfig {
  const { width, height } = backingSize();
  const profile = getQualityProfile();
  return {
    // Tiered fps cap: potato 30 (honest budget), phone 60 (thermals),
    // desktop uncapped (rAF follows the display — 120-240Hz just works;
    // the sim stays fixed-tick and render interpolates).
    fps: profile.fpsLimit > 0 ? { limit: profile.fpsLimit } : undefined,
    type: Phaser.AUTO,
    parent: "game-root",
    // Right-click is the aegis power-slide — the browser context menu must NEVER
    // appear. This is Phaser's own canvas-level suppressor (Mouse + Touch
    // managers), one of several independent layers (see index.html head script
    // and main.ts) so no single point of failure lets the menu through.
    disableContextMenu: true,
    // Backing store = window CSS px × renderScale; the ScaleManager zoom
    // pins the canvas CSS size back to the window. Scale.NONE because RESIZE
    // would force game size = parent CSS size (killing the scale factor) —
    // renderResolution.ts owns window-resize tracking instead.
    width,
    height,
    backgroundColor: "#05080f",
    scene: [BootScene, PreloadScene, MainMenuScene, MatchScene, OnlineMatchScene, DraftScene, ReplayScene],
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
      zoom: 1 / getRenderScale(),
    },
    render: {
      roundPixels: false,
      antialias: true,
      pixelArt: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    },
  };
}

/** @deprecated Prefer buildGameConfig() — frozen snapshot for rare static imports. */
export const gameConfig: Phaser.Types.Core.GameConfig = buildGameConfig();
