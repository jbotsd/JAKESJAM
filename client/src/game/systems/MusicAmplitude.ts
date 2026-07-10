// Live music amplitude for arena juice. Fed by main.ts AnalyserNode via
// `jakesjam:music-level` CustomEvent. Pure render-layer — never touches sim.
//
// Values are 0..1 smoothed bands. `pulse` blends bass+rms for a single
// "how hard is the track pumping" cue; `beat` is a short spike on bass hits.
//
// Prefer `getSonicField()` (music + voice) for CosmicArenaLayer; this module
// remains for env bloom / legacy consumers that only need music bands.

export type MusicLevel = {
  /** ~20–200 Hz energy */
  bass: number;
  /** ~200–2k Hz */
  mid: number;
  /** ~2k–12k Hz */
  high: number;
  /** Overall loudness */
  rms: number;
  /** Combined 0..1 pump (bass-weighted) */
  pulse: number;
  /** 0..1 transient hit detector */
  beat: number;
};

const EVENT = "jakesjam:music-level";

const REST: MusicLevel = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  pulse: 0,
  beat: 0,
};

let current: MusicLevel = { ...REST };
let listening = false;

function onLevel(ev: Event): void {
  const d = (ev as CustomEvent<Partial<MusicLevel>>).detail;
  if (!d) return;
  current = {
    bass: clamp01(d.bass ?? 0),
    mid: clamp01(d.mid ?? 0),
    high: clamp01(d.high ?? 0),
    rms: clamp01(d.rms ?? 0),
    pulse: clamp01(d.pulse ?? 0),
    beat: clamp01(d.beat ?? 0),
  };
}

function ensureListen(): void {
  if (listening) return;
  listening = true;
  // globalThis works in browser (window) and bun tests
  globalThis.addEventListener?.(EVENT, onLevel as EventListener);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Latest smoothed bands. Safe to call every frame. */
export function getMusicLevel(): MusicLevel {
  ensureListen();
  return current;
}

/** Event name main.ts dispatches (for tests / tooling). */
export const MUSIC_LEVEL_EVENT = EVENT;
