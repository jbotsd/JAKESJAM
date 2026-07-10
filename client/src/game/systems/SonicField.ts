// SonicField — unified music + voice energy for gnostic arena geometry.
//
// Hot-path rules (game-loop-perf):
//  - One mutable REST object, never reallocated
//  - Analyser buffers preallocated
//  - No CustomEvent spam from this module (main may still publish music-level)
//  - getSonicField() returns the same object every frame
//
// Voice is opt-out (`?voice=off`) and only starts after a user gesture
// (share the unlock path that resumes AudioContext). Denied mic = silent voice bands.

export type SonicField = {
  /** Music ~20–200 Hz */
  bass: number;
  /** Music ~200–2k */
  mid: number;
  /** Music ~2k–12k */
  high: number;
  /** Music overall */
  rms: number;
  /** Bass-weighted music pump */
  pulse: number;
  /** Music bass transient */
  beat: number;
  /** Mic overall loudness 0..1 */
  voice: number;
  /** Mic mid formant / "chant" presence */
  chant: number;
  /** Mic onset spike 0..1 */
  voiceOnset: number;
  /**
   * Combined 0..1 energy for sacred geometry.
   * max(music.pulse, voice*1.15) with soft blend — voice can dominate when speaking.
   */
  gnostic: number;
  /** 1 if mic stream is live and analysing */
  voiceLive: number;
};

const field: SonicField = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  pulse: 0,
  beat: 0,
  voice: 0,
  chant: 0,
  voiceOnset: 0,
  gnostic: 0,
  voiceLive: 0,
};

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Mutate music bands (called from main.ts analyser tick). */
export function writeMusicBands(partial: {
  bass: number;
  mid: number;
  high: number;
  rms: number;
  pulse: number;
  beat: number;
}): void {
  field.bass = clamp01(partial.bass);
  field.mid = clamp01(partial.mid);
  field.high = clamp01(partial.high);
  field.rms = clamp01(partial.rms);
  field.pulse = clamp01(partial.pulse);
  field.beat = clamp01(partial.beat);
  recomputeGnostic();
}

function recomputeGnostic(): void {
  // Voice dominates when speaking; music always underpins.
  const v = field.voice * 1.35 + field.chant * 0.7 + field.voiceOnset * 1.15;
  const m = field.pulse * 0.95 + field.beat * 0.7 + field.bass * 0.35 + field.mid * 0.2;
  field.gnostic = clamp01(Math.max(m, v) * 0.88 + Math.min(m, v) * 0.45);
}

// ── Voice analyser (lazy) ───────────────────────────────────────────────

let voiceCtx: AudioContext | null = null;
let voiceAnalyser: AnalyserNode | null = null;
let voiceStream: MediaStream | null = null;
let voiceFreq: Uint8Array | null = null;
let voiceTime: Uint8Array | null = null;
let smVoice = 0;
let smChant = 0;
let prevVoice = 0;
let voiceOnsetEnv = 0;
let voiceStartAttempted = false;
let voiceWanted = false;

function voiceDisabledByQuery(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("voice") === "off";
  } catch {
    return false;
  }
}

/** Explicit opt-in for in-game mic (OBS voice is separate). */
function voiceEnabledByQuery(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("voice") === "1";
  } catch {
    return false;
  }
}

/**
 * Optional in-game mic — only when `?voice=1`.
 * Stream/OBS voice reactivity lives in stream-kit (not here).
 */
export async function startVoiceReactive(sharedCtx?: AudioContext): Promise<boolean> {
  if (!voiceEnabledByQuery() || voiceDisabledByQuery()) {
    voiceWanted = false;
    return false;
  }
  if (voiceAnalyser) return true;
  if (voiceStartAttempted) return voiceAnalyser !== null;
  voiceStartAttempted = true;
  voiceWanted = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    voiceStream = stream;
    const ctx = sharedCtx ?? new AudioContext();
    voiceCtx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    // Minimal analyser lag — speech must hit geometry next frame.
    analyser.smoothingTimeConstant = 0.18;
    // Don't connect mic to destination — analysis only.
    src.connect(analyser);
    voiceAnalyser = analyser;
    voiceFreq = new Uint8Array(analyser.frequencyBinCount);
    voiceTime = new Uint8Array(analyser.fftSize);
    field.voiceLive = 1;
    return true;
  } catch {
    field.voiceLive = 0;
    return false;
  }
}

/** Stop mic (scene teardown / privacy). Safe to call multiple times. */
export function stopVoiceReactive(): void {
  if (voiceStream) {
    for (const t of voiceStream.getTracks()) t.stop();
    voiceStream = null;
  }
  voiceAnalyser = null;
  voiceFreq = null;
  voiceTime = null;
  field.voiceLive = 0;
  field.voice = 0;
  field.chant = 0;
  field.voiceOnset = 0;
  recomputeGnostic();
  // Don't close shared music AudioContext.
  if (voiceCtx && voiceCtx !== (null as unknown as AudioContext)) {
    // only close if we created a private one — caller shares music ctx usually
  }
}

function bandMean(data: Uint8Array, i0: number, i1: number): number {
  let s = 0;
  const a = Math.max(0, i0 | 0);
  const b = Math.min(data.length, i1 | 0);
  if (b <= a) return 0;
  for (let i = a; i < b; i++) s += data[i]!;
  return s / (b - a) / 255;
}

/**
 * Sample mic into field. Call once per music tick (same rAF as music).
 * Zero-alloc after start. No-op if mic not live.
 */
export function tickVoiceReactive(): void {
  if (!voiceAnalyser || !voiceFreq || !voiceTime) return;
  if (voiceCtx && voiceCtx.state !== "running") return;

  // Buffers are fixed at start; cast keeps TS happy across lib.dom variants.
  voiceAnalyser.getByteFrequencyData(voiceFreq as unknown as Uint8Array<ArrayBuffer>);
  voiceAnalyser.getByteTimeDomainData(voiceTime as unknown as Uint8Array<ArrayBuffer>);
  const n = voiceFreq.length;
  // Speech energy: mid-band formants + overall peak
  const low = bandMean(voiceFreq, 1, Math.max(2, (n * 0.1) | 0));
  const chant = bandMean(voiceFreq, (n * 0.08) | 0, (n * 0.45) | 0);
  const air = bandMean(voiceFreq, (n * 0.45) | 0, (n * 0.85) | 0);
  let peak = 0;
  for (let i = 0; i < voiceTime.length; i++) {
    const v = Math.abs((voiceTime[i]! - 128) / 128);
    if (v > peak) peak = v;
  }
  // Sensitive mic: low gate, strong gain, snappy attack.
  const raw = Math.max(peak * 1.85, low * 0.75 + chant * 1.15 + air * 0.45);
  const gated = raw < 0.018 ? 0 : Math.min(1, Math.pow((raw - 0.015) * 2.1, 0.55));
  const chantL = Math.min(1, Math.pow(Math.max(0, chant - 0.015) * 2.0, 0.58));

  // Attack ~1 frame, release still audible but quick.
  smVoice += (gated - smVoice) * (gated > smVoice ? 0.95 : 0.28);
  smChant += (chantL - smChant) * (chantL > smChant ? 0.92 : 0.24);
  // Onset from raw peak jump (not only smoothed) for max responsiveness.
  const dSm = Math.max(0, smVoice - prevVoice);
  const dRaw = Math.max(0, gated - prevVoice);
  prevVoice = smVoice;
  voiceOnsetEnv = Math.max(
    voiceOnsetEnv * 0.68,
    Math.min(1, dSm * 22 + dRaw * 12 + (gated > 0.45 ? gated * 0.4 : 0)),
  );

  field.voice = smVoice;
  field.chant = smChant;
  field.voiceOnset = voiceOnsetEnv;
  recomputeGnostic();
}

/** Same object every call — never clone in hot path. */
export function getSonicField(): SonicField {
  return field;
}

/** Whether we should try to start in-game mic (?voice=1 only). */
export function isVoiceWanted(): boolean {
  return voiceWanted && voiceEnabledByQuery() && !voiceDisabledByQuery();
}
