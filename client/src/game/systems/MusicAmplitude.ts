// Live music amplitude for arena juice — a thin music-only VIEW over the
// shared SonicField (main.ts writes bands there every analyser tick).
// Pure render-layer — never touches sim.
//
// Formerly fed by a `jakesjam:music-level` CustomEvent; that allocated and
// dispatched a fresh event+detail object EVERY rAF (game-loop-perf: pure
// heap churn). SonicField is the single source of truth now; this module
// exists so env-bloom-style consumers keep a music-only type.
//
// Values are 0..1 smoothed bands. `pulse` blends bass+rms for a single
// "how hard is the track pumping" cue; `beat` is a short spike on bass hits.

import { getSonicField } from "./SonicField";

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

/** Reused every call — hot path, never clone. */
const view: MusicLevel = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  pulse: 0,
  beat: 0,
};

/** Latest smoothed bands (same object every call). Safe to call every frame. */
export function getMusicLevel(): MusicLevel {
  const f = getSonicField();
  view.bass = f.bass;
  view.mid = f.mid;
  view.high = f.high;
  view.rms = f.rms;
  view.pulse = f.pulse;
  view.beat = f.beat;
  return view;
}
