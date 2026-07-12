/**
 * Scene keys for type-safe scene management.
 * Use these constants instead of magic strings.
 */
export const SceneKeys = {
  Boot: "BootScene",
  Preload: "PreloadScene",
  MainMenu: "MainMenuScene",
  Match: "MatchScene",
  OnlineMatch: "OnlineMatchScene",
  Draft: "DraftScene",
  Replay: "ReplayScene",
  HUD: "HUDScene",
  Tutorial: "TutorialScene",
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];
