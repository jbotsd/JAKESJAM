import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { MatchScene } from "./scenes/MatchScene";
import { OnlineMatchScene } from "./scenes/OnlineMatchScene";
import { DraftScene } from "./scenes/DraftScene";

// Highlight-clip capture (?clips=1, see client/src/game/highlights/) draws a
// cropped copy of the game canvas onto a SEPARATE destination canvas via
// drawImage(), in its own requestAnimationFrame — not inside Phaser's own
// render pass. Without preserveDrawingBuffer, a WebGL canvas's drawing buffer
// is allowed to be cleared by the browser immediately after each frame is
// composited (an optimization to avoid a copy), so that drawImage read can
// land on an already-cleared buffer — produces solid BLACK captured frames
// (confirmed: ffprobe showed valid, corruption-free video that was 100%
// black). captureStream() sidesteps this internally via the compositor;
// manual drawImage reads do not. preserveDrawingBuffer:true keeps the last
// rendered frame available for reads at any time, at a real but small copy
// cost — only paid when a tester/dev explicitly opts into capture.
const clipsRequested =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("clips") === "1";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
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
    preserveDrawingBuffer: clipsRequested,
  },
};
