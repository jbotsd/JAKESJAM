// Shared SFX volume/mute state — the settings panel (main.ts) lives outside
// any scene, but the actual audio graphs (ProceduralAudio, the legacy
// GameAudioSystem) are scene-owned instances created/destroyed per match.
// A module-level broadcaster lets main.ts set the volume once and have
// whichever instance(s) currently exist pick it up live, the same shape
// AnnouncerSystem.ts already uses for music-derived announcer volume —
// except SFX needs to drive a live Web Audio GainNode, not just an
// <audio> element's .volume, so instances SUBSCRIBE instead of re-reading
// a plain variable each play() call.

let currentVolume01 = 1;

const listeners = new Set<(volume01: number) => void>();

/** Current effective 0..1 SFX volume (0 if muted, already includes mute). */
export function getSfxVolume01(): number {
  return currentVolume01;
}

/** Called by the settings panel whenever the slider/checkbox changes, and
 *  once at boot to apply the restored value. */
export function setSfxVolume01(volume01: number): void {
  currentVolume01 = Math.max(0, Math.min(1, volume01));
  for (const fn of listeners) fn(currentVolume01);
}

/** Called by each ProceduralAudio/GameAudioSystem instance when its audio
 *  graph is created — returns an unsubscribe function to call on destroy(). */
export function onSfxVolumeChange(fn: (volume01: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
