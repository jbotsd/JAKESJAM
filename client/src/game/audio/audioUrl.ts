// Resolves a filename in client/public/audio/ to a loadable URL. Extracted
// from main.ts (which still re-exports the call sites unchanged) so scenes
// outside main.ts's module scope — e.g. TutorialScene.ts — can load audio
// the same way splashTheme/menuMusic/worldMusic already do.
export function getAudioUrl(file: string): string {
  const assetBase = window.__JAKESJAM_ASSET_BASE__;
  if (assetBase) {
    return new URL(`audio/${file}`, assetBase).toString();
  }
  if (window.location.protocol === "file:") {
    return new URL(`./audio/${file}`, window.location.href).toString();
  }
  return `${window.location.origin}/audio/${file}`;
}
