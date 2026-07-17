// Procedural combat audio — a small modular synth in Web Audio.
//
// Every weapon shot and shield event is SYNTHESIZED live from game state
// (element, charge, intensity) with per-trigger micro-variation, so nothing
// is a frozen sample: each shot/deflect is subtly different and reacts to
// what's happening. Techniques are the Serum vocabulary done algorithmically
// — layered detuned oscillators, FM pairs for metallic/zap timbres, filtered
// noise, pitch/amp envelopes, and slow LFO modulation for shield drones.
//
// Signal path:  voices → master gain → soft limiter → destination
//               (+ a light generated-impulse reverb SEND for space on
//                shields/impacts)
//
// The engine is silent until the AudioContext is unlocked by a user gesture
// (the scene wires unlock on first pointer/key).

import { sampleEngine } from "../audio/SampleEngine.js";
import { getSfxVolume01, onSfxVolumeChange } from "../audio/sfxVolume.js";

export type AudioCue =
  | "shoot"
  | "hit"
  | "jump"
  | "land"
  | "explosion"
  | "fire"
  | "card"
  | "pickup"
  | "shield-up"
  | "shield-hit"
  | "shield-break"
  | "parry"
  | "dash";

export type AudioParams = {
  /** Element of the shot/effect (fire/ice/lightning/void/…) → timbre. */
  element?: string;
  /** 0..1 weapon charge / overcharge — bigger = deeper, longer, heavier. */
  charge?: number;
  /** 0..1 intensity (damage / velocity) — scales body + air. */
  intensity?: number;
  /** Heavy weapon class → more low-end thump. */
  heavy?: boolean;
  /** Projectile shape (circle/triangle/square/hexagon/orb/x/bar) → waveform +
   *  brightness, so a shape-changing card is audible. */
  shape?: string;
  /** Impact behaviour (explosive/sticky/pierce-chain/slow-field) → extra
   *  tail layer, so an impact card is audible. */
  impact?: string;
  /** Pathing (homing/bounce/…) → subtle motion in the tail. */
  pathing?: string;
};

const MASTER = 0.22;

type ElementVoice = {
  /** Base body waveform. */
  wave: OscillatorType;
  /** FM modulator : carrier frequency ratio (0 = no FM). */
  fmRatio: number;
  /** FM index (timbral brightness / metallicness). */
  fmIndex: number;
  /** Body base pitch in Hz (before charge scaling). */
  body: number;
  /** How far the body pitch sweeps DOWN over its decay (Hz). */
  sweep: number;
  /** Air/noise band centre (Hz) + how bright the sizzle is. */
  air: number;
  /** Warmth: lowpass on the whole voice (Hz; high = bright). */
  tone: number;
};

// Per-element synth character. Total over the element set; unknown → neutral.
const ELEMENTS: Record<string, ElementVoice> = {
  neutral: { wave: "square", fmRatio: 0, fmIndex: 0, body: 520, sweep: 340, air: 1700, tone: 6000 },
  crystal: { wave: "triangle", fmRatio: 3.5, fmIndex: 180, body: 620, sweep: 300, air: 3200, tone: 9000 },
  fire: { wave: "sawtooth", fmRatio: 0, fmIndex: 0, body: 300, sweep: 180, air: 900, tone: 3200 },
  ice: { wave: "triangle", fmRatio: 5, fmIndex: 260, body: 720, sweep: 220, air: 4200, tone: 11000 },
  lightning: { wave: "sawtooth", fmRatio: 7.1, fmIndex: 420, body: 480, sweep: 260, air: 3600, tone: 9000 },
  electric: { wave: "sawtooth", fmRatio: 7.1, fmIndex: 420, body: 480, sweep: 260, air: 3600, tone: 9000 },
  void: { wave: "sine", fmRatio: 1.5, fmIndex: 90, body: 190, sweep: 90, air: 500, tone: 2200 },
  radiant: { wave: "triangle", fmRatio: 2, fmIndex: 120, body: 560, sweep: 200, air: 3000, tone: 12000 },
  toxic: { wave: "square", fmRatio: 1.01, fmIndex: 60, body: 340, sweep: 140, air: 1200, tone: 3400 },
  sticky: { wave: "triangle", fmRatio: 0, fmIndex: 0, body: 260, sweep: 120, air: 700, tone: 2600 },
  explosive: { wave: "sawtooth", fmRatio: 0, fmIndex: 0, body: 150, sweep: 90, air: 600, tone: 2600 },
};

const NEUTRAL_VOICE: ElementVoice = ELEMENTS.neutral!;
function elementVoice(el?: string): ElementVoice {
  return ELEMENTS[el ?? "neutral"] ?? NEUTRAL_VOICE;
}

/**
 * Dubstep-style weapon patch: a diverse, MODULATED voice per element. Two
 * detuned oscillators → waveshaper distortion → an LFO-wobbled (or
 * envelope-swept) lowpass → optional formant growl. This is the "array of
 * sounds" — each element is a distinct aggressive character, and cards modify
 * it (charge → more distortion + deeper wobble, shape → waveform/formant).
 * Tunable in one table.
 */
type WeaponPatch = {
  osc: OscillatorType;
  detune: number; // cents between the two oscillators (thickness)
  pitch: number; // Hz base
  sweep: number; // downward pitch sweep over decay (Hz)
  dist: number; // 0..1 waveshaper drive
  filterBase: number; // wobble lowpass base cutoff (Hz)
  wobbleRate: number; // LFO Hz on cutoff (0 = a single filter-envelope "wub")
  wobbleDepth: number; // cutoff modulation depth (Hz)
  formant: number; // vocal growl bandpass centre (0 = none)
  sub: number; // sub-osc level 0..1
  decay: number; // body decay (s)
};

const WEAPON_PATCHES: Record<string, WeaponPatch> = {
  // Default crystal — a bright, aggressive laser-growl (filter-env wub).
  crystal: { osc: "sawtooth", detune: 16, pitch: 540, sweep: 280, dist: 0.42, filterBase: 2600, wobbleRate: 0, wobbleDepth: 1700, formant: 0, sub: 0.22, decay: 0.15 },
  neutral: { osc: "sawtooth", detune: 14, pitch: 520, sweep: 300, dist: 0.4, filterBase: 2400, wobbleRate: 0, wobbleDepth: 1600, formant: 0, sub: 0.24, decay: 0.15 },
  // Fire — a formant growl.
  fire: { osc: "sawtooth", detune: 24, pitch: 300, sweep: 150, dist: 0.64, filterBase: 1500, wobbleRate: 32, wobbleDepth: 1300, formant: 850, sub: 0.32, decay: 0.2 },
  // Ice — bright crystalline zap.
  ice: { osc: "sawtooth", detune: 10, pitch: 720, sweep: 220, dist: 0.32, filterBase: 4200, wobbleRate: 0, wobbleDepth: 2100, formant: 0, sub: 0.12, decay: 0.13 },
  // Lightning — fast neuro wobble.
  lightning: { osc: "sawtooth", detune: 30, pitch: 480, sweep: 240, dist: 0.74, filterBase: 3200, wobbleRate: 72, wobbleDepth: 2800, formant: 0, sub: 0.16, decay: 0.13 },
  electric: { osc: "sawtooth", detune: 30, pitch: 480, sweep: 240, dist: 0.74, filterBase: 3200, wobbleRate: 72, wobbleDepth: 2800, formant: 0, sub: 0.16, decay: 0.13 },
  // Void — deep slow sub wobble.
  void: { osc: "square", detune: 8, pitch: 150, sweep: 70, dist: 0.55, filterBase: 700, wobbleRate: 18, wobbleDepth: 600, formant: 0, sub: 0.55, decay: 0.24 },
  // Radiant — bright screech (high formant).
  radiant: { osc: "sawtooth", detune: 18, pitch: 600, sweep: 220, dist: 0.46, filterBase: 5000, wobbleRate: 0, wobbleDepth: 2300, formant: 1400, sub: 0.14, decay: 0.14 },
  // Toxic — gurgle wobble.
  toxic: { osc: "square", detune: 20, pitch: 340, sweep: 120, dist: 0.5, filterBase: 1200, wobbleRate: 26, wobbleDepth: 1000, formant: 700, sub: 0.26, decay: 0.18 },
  // Sticky — damped low wobble.
  sticky: { osc: "triangle", detune: 12, pitch: 260, sweep: 110, dist: 0.4, filterBase: 900, wobbleRate: 16, wobbleDepth: 500, formant: 0, sub: 0.3, decay: 0.16 },
  // Explosive — sub-drop growl.
  explosive: { osc: "sawtooth", detune: 14, pitch: 160, sweep: 90, dist: 0.72, filterBase: 900, wobbleRate: 14, wobbleDepth: 700, formant: 0, sub: 0.6, decay: 0.24 },
};

const CRYSTAL_PATCH: WeaponPatch = WEAPON_PATCHES.crystal!;
function weaponPatch(el?: string): WeaponPatch {
  return WEAPON_PATCHES[el ?? "crystal"] ?? CRYSTAL_PATCH;
}

export class ProceduralAudio {
  private ctx?: AudioContext | OfflineAudioContext;
  private master?: GainNode;
  /** OFFLINE RENDER MODE (clip-goal CL.B): constructed with an
   *  OfflineAudioContext, every cue schedules at `offlineAt` (set per sim
   *  tick by the replay renderer) instead of ctx.currentTime, realtime
   *  gates (context state, voice caps, setTimeout layers) are bypassed,
   *  and the SFX volume is a fixed broadcast level — the clip must not
   *  inherit whatever slider position this box happens to have. */
  private readonly offlineCtx?: OfflineAudioContext;
  private offlineAt = 0;

  constructor(offlineCtx?: OfflineAudioContext) {
    this.offlineCtx = offlineCtx;
  }

  private get offline(): boolean {
    return this.offlineCtx !== undefined;
  }

  /** Replay renderer sets the current cue time (seconds from clip start). */
  setOfflineTime(seconds: number): void {
    this.offlineAt = seconds;
  }

  /** Cue-schedule time: explicit offline clock, else the live context's. */
  private cueNow(ctx: BaseAudioContext): number {
    return this.offline ? this.offlineAt : ctx.currentTime;
  }

  /** Offline setup: build the graph on the offline context and wait for
   *  the sample pack so sample-first cues don't race the load. */
  async prepareOffline(): Promise<void> {
    this.ensureContext();
    await sampleEngine.whenReady();
  }
  /** Concurrent weapon voices — a hard cap prevents audio-thread overload
   *  (crackle/"lag distortion") when fire rate + player count spikes. */
  private activeShots = 0;
  /** Cached distortion curves (avoid a per-shot Float32Array allocation). */
  private readonly distCurveCache = new Map<number, Float32Array>();
  private reverbSend?: GainNode;
  private noiseBuf?: AudioBuffer;
  /** Active shield drone voice (started on shield-up, stopped on shield down). */
  private shieldDrone: { stop: (t: number) => void } | null = null;
  /** Unsubscribes this instance from the shared SFX-volume broadcaster;
   *  set once the audio context (and therefore `master`) exists. */
  private unsubscribeSfxVolume?: () => void;

  // Anti-fatigue weapon variation: round-robin index + last-shot time. Every
  // shot advances the round-robin (guaranteed non-repeat) and the inter-shot
  // interval drives rate-adaptive dynamics (rapid fire ducks + shortens).
  private rrIdx = 0;
  private lastShotAt = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Call from a user-gesture handler to create/resume the context. */
  unlock(): void {
    if (this.offline) return; // offline contexts render, they don't resume
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  destroy(): void {
    try {
      this.shieldDrone?.stop(this.now());
    } catch {
      /* context may be gone */
    }
    this.unsubscribeSfxVolume?.();
    this.unsubscribeSfxVolume = undefined;
    // Offline contexts are owned by the replay renderer (it still needs
    // startRendering after we're done) — only close a realtime context.
    if (this.ctx && !this.offline) void (this.ctx as AudioContext).close();
    this.ctx = undefined;
  }

  private ensureContext(): AudioContext | OfflineAudioContext | undefined {
    if (this.ctx) return this.ctx;
    let ctx: AudioContext | OfflineAudioContext;
    if (this.offlineCtx) {
      ctx = this.offlineCtx;
    } else {
      const Ctor =
        (window as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      ctx = new Ctor();
    }
    this.ctx = ctx;

    // Master → soft limiter → out. Scaled by the shared SFX-volume setting
    // (settings panel, main.ts) on top of the fixed MASTER mix level —
    // live-updates via onSfxVolumeChange so dragging the slider mid-match
    // takes effect immediately, not just on the next scene/context.
    // Offline renders pin a fixed broadcast level instead (the clip's mix
    // must not depend on this box's slider).
    const master = ctx.createGain();
    if (this.offline) {
      master.gain.value = MASTER * 0.8;
    } else {
      master.gain.value = MASTER * getSfxVolume01();
      this.unsubscribeSfxVolume = onSfxVolumeChange((v01) => {
        master.gain.value = MASTER * v01;
      });
    }
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;

    // Light reverb send (generated impulse) for "space" on shields/impacts.
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 0.5, 2.2);
    const send = ctx.createGain();
    send.gain.value = 0;
    send.connect(reverb).connect(limiter);
    this.reverbSend = send;

    this.noiseBuf = this.makeNoise(ctx, 1.0);
    // Bitwig-designed sample pack rides the same context + master bus;
    // cues with samples take over, the synth keeps the rest.
    if (this.master) sampleEngine.init(ctx, this.master);
    return ctx;
  }

  private now(): number {
    if (this.offline) return this.offlineAt;
    return this.ctx?.currentTime ?? 0;
  }

  /** Realtime-ready gate: a live context must be running (user-gesture
   *  unlocked); an offline context is always schedulable. */
  private ready(): boolean {
    if (!this.ensureContext()) return false;
    return this.offline || (this.ctx as AudioContext).state === "running";
  }

  // ── Public cue API (router-compatible) ──────────────────────────────

  play(cue: AudioCue, params: AudioParams = {}): void {
    if (!this.ready()) return;
    // SAMPLE-FIRST (SampleEngine): if the Bitwig pack ships this cue, the
    // studio version wins; intensity maps to gain. Synth = fallback.
    if (
      sampleEngine.play(cue, {
        gain: 0.5 + clamp01(params.intensity ?? 0.5) * 0.5,
        pitch: 1 - clamp01(params.charge ?? 0) * 0.15,
        // Offline renders schedule at the replay clock, not "now".
        at: this.offline ? this.offlineAt : undefined,
      })
    ) {
      return;
    }
    switch (cue) {
      case "shoot":
        this.weaponFire(params);
        break;
      case "hit":
        this.impact(params);
        break;
      case "explosion":
        this.explosion(params);
        break;
      case "shield-up":
        this.shieldUp(params);
        break;
      case "shield-hit":
        this.shieldDeflect(params);
        break;
      case "shield-break":
        this.shieldBreak(params);
        break;
      case "parry":
        this.parry(params);
        break;
      case "dash":
        this.dashWhoosh(params);
        break;
      case "jump":
        this.blip(330, "sine", 0.12, 0.12, 260);
        break;
      case "land":
        this.noise(0.09, 0.14, 420, 0.7);
        break;
      case "pickup":
        this.blip(740, "sine", 0.09, 0.05, 260);
        // Second layer: wall-clock delay live; replay-clock offset offline
        // (setTimeout never fires inside the offline stepping loop).
        if (this.offline) this.blip(980, "triangle", 0.08, 0.07, 180, 0.042);
        else window.setTimeout(() => this.blip(980, "triangle", 0.08, 0.07, 180), 42);
        break;
      case "card":
        this.blip(430, "sine", 0.1, 0.07, 420);
        if (this.offline) this.blip(650, "sine", 0.09, 0.09, 240, 0.055);
        else window.setTimeout(() => this.blip(650, "sine", 0.09, 0.09, 240), 55);
        break;
      case "fire":
        this.noise(0.12, 0.1, 980, 1.2);
        break;
    }
  }

  /** Start/stop the continuous shield energy hum (call on shield up/down). */
  setShieldHum(on: boolean): void {
    if (!this.ready()) return;
    if (on && !this.shieldDrone) this.startShieldHum();
    else if (!on && this.shieldDrone) {
      this.shieldDrone.stop(this.now());
      this.shieldDrone = null;
    }
  }

  // ── Weapons ─────────────────────────────────────────────────────────

  /**
   * AAA anti-fatigue weapon shot. Layered synthesis (varied transient + FM
   * body + sub + air + element/shape/impact flavour), but critically built to
   * survive HUNDREDS of repeats without wearing on the ear:
   *
   *  - Round-robin musical pitch (BODY_STEPS): consecutive shots are
   *    guaranteed to differ, over consonant intervals so rapid fire reads as
   *    a shimmering arpeggio, not a machine gun.
   *  - Rate-adaptive dynamics: rapid fire DUCKS level + SHORTENS tails so a
   *    burst thins out instead of building into mush.
   *  - Stereo spread: alternating pan widens the field (mono repeats fatigue
   *    fastest).
   *  - Per-shot transient variation: the ear locks onto the attack, so its
   *    brightness/pitch jitters every shot.
   *
   * Every draft card is audible: element → timbre, shape → waveform/bright,
   * impact → tail layer, pathing → subtle motion, charge/intensity → weight.
   */
  private weaponFire(p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    // Voice cap — skip the synth if too many shots are already ringing out.
    // Overlapping heavy (distorted) voices are what crackle the audio thread.
    // REALTIME protection only: offline rendering isn't on the audio thread
    // and its setTimeout bookkeeping never fires inside the stepping loop.
    if (!this.offline) {
      if (this.activeShots > 12) return;
      this.activeShots += 1;
      window.setTimeout(() => {
        this.activeShots = Math.max(0, this.activeShots - 1);
      }, 260);
    }
    const t = this.cueNow(ctx);
    const v = elementVoice(p.element);
    const charge = clamp01(p.charge ?? 0);
    const inten = clamp01(p.intensity ?? 0.5);
    const heavy = p.heavy ?? false;
    const shape = p.shape ?? "circle";

    // Rate tracking → rapid factor (1 = machine-gun, 0 = spaced single shots).
    const interval = this.lastShotAt ? t - this.lastShotAt : 1;
    this.lastShotAt = t;
    const rapid = clamp01((0.32 - interval) / 0.28);

    // Round-robin variation — guaranteed non-repeat.
    const step = BODY_STEPS[this.rrIdx % BODY_STEPS.length]!;
    const rr = this.rrIdx;
    this.rrIdx += 1;
    const pitchMul = SEMI(step) * rand(0.994, 1.006);
    const level = lerp(1.0, 0.68, rapid); // duck sustained fire
    const pan = ((rr & 1) === 0 ? 1 : -1) * lerp(0.1, 0.34, rapid);

    // Dubstep patch for this element — a distinct aggressive character.
    const patch = weaponPatch(p.element);
    const dist = clamp01(patch.dist + charge * 0.3);
    const wobbleDepth = patch.wobbleDepth * (1 + charge * 0.5) * rand(0.85, 1.15);
    const wobbleRate = patch.wobbleRate > 0 ? patch.wobbleRate * rand(0.85, 1.2) : 0;
    const bodyFreq = patch.pitch * (1 - charge * 0.3 - (heavy ? 0.12 : 0)) * pitchMul;
    const dur = patch.decay * lerp(1, 0.55, rapid);
    const osc: OscillatorType =
      shape === "square" ? "square" : shape === "triangle" || shape === "orb" ? "triangle" : patch.osc;
    const formantHz = patch.formant * (shape === "x" || shape === "hexagon" ? 1.4 : 1);

    // Output bus: level -> stereo pan -> tone lowpass -> master (+ reverb).
    const bus = ctx.createGain();
    bus.gain.value = level;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = v.tone * rand(0.9, 1.12);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      bus.connect(panner).connect(tone).connect(master);
    } else {
      bus.connect(tone).connect(master);
    }

    // MECHANISM layer (Jake: "more tactile, more AK-47 — hooky lock
    // machine"): a hard supersonic CRACK (8ms of highpassed noise) + the
    // bolt clack. Constant across the round-robin — the crack varies with
    // the body, the clack is the invariant hook your hands lock onto.
    {
      const crack = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.22 * level, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      crack.connect(hp).connect(cg).connect(bus);
      crack.start(t);
      crack.stop(t + 0.02);
      this.boltClack(t + 0.004, 0.10 * level);
    }

    // Body chain: detuned oscillators -> waveshaper distortion -> wobble
    // (LFO/env) lowpass -> body envelope -> bus. This is the dubstep growl.
    const shaper = ctx.createWaveShaper();
    // Loose-typed curve setter — the makeDistCurve buffer is a fresh
    // Float32Array; the DOM lib's tighter ArrayBuffer generic isn't worth the
    // ceremony here.
    (shaper as unknown as { curve: Float32Array | null }).curve = this.makeDistCurve(dist);
    const wob = this.wobbleFilter(t, dur, patch.filterBase * rand(0.9, 1.12), wobbleDepth, wobbleRate);
    const bodyEnv = this.env(t, 0.002, dur, 0.34 + inten * 0.16);
    shaper.connect(wob).connect(bodyEnv).connect(bus);
    // Parallel formant growl on the wobbled signal (vocal character).
    if (formantHz > 0) {
      for (const [ff, g] of [[formantHz, 0.55] as const]) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = ff;
        bp.Q.value = 6;
        const fg = ctx.createGain();
        fg.gain.value = g;
        wob.connect(bp).connect(fg).connect(bodyEnv);
      }
    }
    for (const det of [-patch.detune, patch.detune]) {
      const o = ctx.createOscillator();
      o.type = osc;
      o.detune.value = det;
      o.frequency.setValueAtTime(bodyFreq * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(45, bodyFreq - patch.sweep), t + dur);
      o.connect(shaper);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    // Transient — varied attack (the ear tracks it, so never identical).
    this.noiseInto(bus, t, 0.005, (0.4 + inten * 0.3) * rand(0.85, 1.15), v.air * 2 * rand(0.8, 1.3), 0.9, "highpass");

    // Sub thump — thinned on rapid fire to avoid low-end buildup.
    if (patch.sub > 0) {
      const sub = ctx.createOscillator();
      sub.type = "sine";
      const sf = (heavy ? 60 : 88) * (1 - charge * 0.25);
      sub.frequency.setValueAtTime(sf * 2, t);
      sub.frequency.exponentialRampToValueAtTime(sf, t + 0.07);
      sub
        .connect(this.env(t, 0.001, 0.1 * lerp(1, 0.6, rapid), patch.sub * (0.6 + charge * 0.4) * lerp(1, 0.7, rapid)))
        .connect(bus);
      sub.start(t);
      sub.stop(t + 0.18);
    }

    // Card layers: element extras (crackle/zap) + impact/pathing.
    this.weaponFlavour(bus, t, p.element, charge);
    this.impactFlavour(bus, t, p.impact, p.pathing, bodyFreq, lerp(1, 0.55, rapid));
  }

  /** Waveshaper distortion curve (tanh soft-clip). amount 0..1 → gritty. */
  private makeDistCurve(amount: number): Float32Array {
    const key = Math.round(amount * 8); // bucket → at most ~9 cached curves
    const hit = this.distCurveCache.get(key);
    if (hit) return hit;
    const n = 512;
    const c = new Float32Array(n);
    const k = 1 + amount * amount * 50;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    this.distCurveCache.set(key, c);
    return c;
  }

  /** Wobble lowpass: cutoff either LFO-modulated (rateHz>0, the dubstep wub)
   *  or a single filter-envelope sweep (rateHz=0). Returns the filter node. */
  private wobbleFilter(t: number, dur: number, base: number, depth: number, rateHz: number): BiquadFilterNode {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = base;
    lp.Q.value = 7;
    if (rateHz > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(rateHz, t);
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(lp.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    } else {
      lp.frequency.setValueAtTime(base * 2.4, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, base * 0.45), t + dur * 0.55);
      lp.frequency.exponentialRampToValueAtTime(base * 1.5, t + dur);
    }
    return lp;
  }

  /** Impact/pathing card flavour layered onto the shot. */
  private impactFlavour(bus: AudioNode, t: number, impact: string | undefined, pathing: string | undefined, bodyFreq: number, tailMul: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (impact === "explosive") {
      // A low boom hint so an explosive-round card lands heavier.
      const s = ctx.createOscillator();
      s.type = "sine";
      s.frequency.setValueAtTime(140, t);
      s.frequency.exponentialRampToValueAtTime(70, t + 0.14);
      s.connect(this.env(t, 0.002, 0.16 * tailMul, 0.22)).connect(bus);
      s.start(t); s.stop(t + 0.2);
    } else if (impact === "pierce-chain") {
      // Bright zing → "it'll chain".
      this.fmPing(bus, t, bodyFreq * 4 * rand(0.98, 1.02), 3.2, 200, 0.14, 0.1, true);
    } else if (impact === "sticky") {
      // Damped thud.
      this.noiseInto(bus, t, 0.04, 0.14, 700, 1, "lowpass");
    }
    if (pathing === "homing") {
      // A subtle rising tail = "it's seeking".
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(bodyFreq * 0.9, t);
      o.frequency.exponentialRampToValueAtTime(bodyFreq * 1.6, t + 0.12);
      o.connect(this.env(t, 0.02, 0.14, 0.1)).connect(bus);
      o.start(t); o.stop(t + 0.16);
    }
  }

  private weaponFlavour(bus: AudioNode, t: number, el: string | undefined, charge: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    switch (el) {
      case "fire": {
        // Crackle: 3-5 short noise grains scattered over ~120ms.
        const n = 3 + Math.floor(rand(0, 3));
        for (let i = 0; i < n; i += 1) {
          this.noiseInto(bus, t + rand(0.01, 0.13), 0.012, 0.12, rand(1200, 3000), 3, "bandpass");
        }
        break;
      }
      case "ice": {
        // Crystalline high bell shimmer.
        this.fmPing(bus, t, rand(2400, 3200), 6.5, 300, 0.22, 0.12);
        break;
      }
      case "lightning":
      case "electric": {
        // Fast electric zap — rapidly modulated buzz.
        const z = ctx.createOscillator();
        z.type = "sawtooth";
        z.frequency.setValueAtTime(rand(1400, 2200), t);
        z.frequency.exponentialRampToValueAtTime(rand(400, 700), t + 0.08);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rand(60, 110);
        const lfoG = ctx.createGain();
        lfoG.gain.value = 400;
        lfo.connect(lfoG).connect(z.frequency);
        z.connect(this.env(t, 0.001, 0.09, 0.14)).connect(bus);
        lfo.start(t); z.start(t); lfo.stop(t + 0.1); z.stop(t + 0.1);
        break;
      }
      case "void": {
        // Deep dark sub swell (adds ominous weight + longer tail).
        const s = ctx.createOscillator();
        s.type = "sine";
        s.frequency.setValueAtTime(70, t);
        s.frequency.exponentialRampToValueAtTime(44, t + 0.35);
        s.connect(this.env(t, 0.01, 0.4, 0.3)).connect(bus);
        s.start(t); s.stop(t + 0.42);
        break;
      }
      case "radiant":
        this.fmPing(bus, t, rand(1600, 2000), 2, 160, 0.3, 0.1);
        break;
      case "toxic": {
        // Wobble — LFO'd detune gurgle.
        const w = ctx.createOscillator();
        w.type = "square";
        w.frequency.value = rand(240, 320);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 14;
        const lg = ctx.createGain();
        lg.gain.value = 40;
        lfo.connect(lg).connect(w.frequency);
        w.connect(this.env(t, 0.005, 0.16, 0.12)).connect(bus);
        lfo.start(t); w.start(t); lfo.stop(t + 0.18); w.stop(t + 0.18);
        break;
      }
      default:
        void charge;
        break;
    }
  }

  // ── Impacts ─────────────────────────────────────────────────────────

  private impact(p: AudioParams): void {
    const inten = clamp01(p.intensity ?? 0.5);
    // Tonal thud + short bright noise, pitched by intensity — plus an
    // anvil TINK so hits land on heaven-metal, not on cloth.
    this.blip(220 + inten * 120, "triangle", 0.14 + inten * 0.1, 0.09, 200);
    this.noise(0.05, 0.12 + inten * 0.1, 1400 + inten * 1400, 2);
    this.metalPing(680 * rand(0.94, 1.08), 0.13 + inten * 0.06, 0.12 + inten * 0.08, { reverb: 0.12 });
  }

  private explosion(p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const inten = clamp01(p.intensity ?? 0.6);
    // Big filtered noise body + downward sawtooth boom + sub.
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.18);
    this.noiseInto(bus, t, 0.28 + inten * 0.15, 0.34, 300, 0.8, "lowpass");
    const boom = ctx.createOscillator();
    boom.type = "sawtooth";
    boom.frequency.setValueAtTime(120, t);
    boom.frequency.exponentialRampToValueAtTime(40, t + 0.22);
    boom.connect(this.env(t, 0.002, 0.24, 0.3)).connect(bus);
    boom.start(t); boom.stop(t + 0.3);
  }

  // ── Shields ─────────────────────────────────────────────────────────

  private shieldUp(_p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.14);
    // Rising "bwoom": FM tone gliding up + noise swell opening a lowpass.
    const c = ctx.createOscillator();
    c.type = "sine";
    c.frequency.setValueAtTime(120, t);
    c.frequency.exponentialRampToValueAtTime(360, t + 0.22);
    const m = ctx.createOscillator();
    m.type = "sine";
    m.frequency.setValueAtTime(240, t);
    const mg = ctx.createGain();
    mg.gain.value = 120;
    m.connect(mg).connect(c.frequency);
    c.connect(this.env(t, 0.02, 0.3, 0.26)).connect(bus);
    m.start(t); c.start(t); m.stop(t + 0.34); c.stop(t + 0.34);
    // Noise swell.
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.28);
    src.connect(f).connect(this.env(t, 0.05, 0.3, 0.12)).connect(bus);
    src.start(t); src.stop(t + 0.34);
    // Begin the sustained hum.
    this.setShieldHum(true);
  }

  private startShieldHum(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.05, t + 0.25); // low, sits under gameplay
    out.connect(master);
    this.sendReverb(out, 0.1);
    // Two detuned oscillators → bandpass with a slow shimmer LFO.
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = "sawtooth"; b.type = "sawtooth";
    a.frequency.value = 174; b.frequency.value = 174 * 1.01;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = ctx.createGain();
    lg.gain.value = 350;
    lfo.connect(lg).connect(bp.frequency);
    a.connect(bp); b.connect(bp);
    bp.connect(out);
    a.start(t); b.start(t); lfo.start(t);
    this.shieldDrone = {
      stop: (stopAt) => {
        try {
          out.gain.cancelScheduledValues(stopAt);
          out.gain.setValueAtTime(out.gain.value, stopAt);
          out.gain.exponentialRampToValueAtTime(0.0001, stopAt + 0.12);
          a.stop(stopAt + 0.16); b.stop(stopAt + 0.16); lfo.stop(stopAt + 0.16);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  private shieldDeflect(p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.16);
    // Resonant metallic ping (inharmonic FM through high-Q bandpass) +
    // bright shimmer + a touch of noise, pitch-varied per hit.
    const base = rand(620, 820) * (1 + clamp01(p.intensity ?? 0.5) * 0.2);
    this.fmPing(bus, t, base, 2.76, 500, 0.28, 0.16, true);
    this.noiseInto(bus, t, 0.03, 0.14, base * 2, 4, "bandpass");
  }

  private shieldBreak(_p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.2);
    // Downward FM sweep (energy collapse) + noise burst + shatter shards.
    const c = ctx.createOscillator();
    c.type = "sawtooth";
    c.frequency.setValueAtTime(520, t);
    c.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const m = ctx.createOscillator();
    m.type = "sine";
    m.frequency.setValueAtTime(700, t);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(600, t);
    mg.gain.exponentialRampToValueAtTime(20, t + 0.25);
    m.connect(mg).connect(c.frequency);
    c.connect(this.env(t, 0.002, 0.26, 0.26)).connect(bus);
    m.start(t); c.start(t); m.stop(t + 0.3); c.stop(t + 0.3);
    this.noiseInto(bus, t, 0.12, 0.2, 1400, 1, "bandpass");
    // Shatter shards — a few high pings.
    const shards = 3 + Math.floor(rand(0, 3));
    for (let i = 0; i < shards; i += 1) {
      this.fmPing(bus, t + rand(0.02, 0.16), rand(1600, 3200), 3.4, 240, 0.12, 0.08, true);
    }
    // A broken shield is no longer humming.
    this.setShieldHum(false);
  }

  private parry(_p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.2);
    // ICONIC REFLECT TELL (Overwatch philosophy — one listen = "reflected!").
    // 1) A reverse pre-swell = the "catch".
    const swell = this.noiseSource();
    const sf = ctx.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.value = 3200;
    sf.Q.value = 2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.16, t + 0.045); // reverse swell up to the clang
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
    swell.connect(sf).connect(sg).connect(bus);
    swell.start(t);
    swell.stop(t + 0.08);
    // 2) A hard metallic CLANG — two detuned resonant FM pings for a bright,
    //    heavy hit (Halo weight). Right on the swell peak.
    const clangT = t + 0.045;
    this.fmPing(bus, clangT, rand(2000, 2300), 4.1, 700, 0.34, 0.14, true);
    this.fmPing(bus, clangT + 0.004, rand(1400, 1600), 2.76, 520, 0.24, 0.16, true);
    // 3) The ENERGY RETURN — a rising whoosh (the shot flying back). This is
    //    the readable "sent it back" gesture.
    const ret = ctx.createOscillator();
    ret.type = "sawtooth";
    ret.frequency.setValueAtTime(300, clangT + 0.02);
    ret.frequency.exponentialRampToValueAtTime(1400, clangT + 0.18);
    const rf = ctx.createBiquadFilter();
    rf.type = "bandpass";
    rf.frequency.setValueAtTime(600, clangT + 0.02);
    rf.frequency.exponentialRampToValueAtTime(2600, clangT + 0.18);
    rf.Q.value = 3;
    ret.connect(rf).connect(this.env(clangT + 0.02, 0.02, 0.18, 0.14)).connect(bus);
    ret.start(clangT + 0.02);
    ret.stop(clangT + 0.24);
  }

  /** The dash-bash power-slide launch: a short air-cut whoosh. Band-passed noise
   *  whose center sweeps up fast then falls away — cloth-through-air, not an
   *  engine. Quiet by design: the slide fires often, so the cue must read
   *  without fatiguing (same restraint as jump/land). */
  private dashWhoosh(_p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx);
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(rand(1500, 1900), t + 0.09);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.24);
  }

  // ── Synth primitives ────────────────────────────────────────────────

  /** A quick pitched blip with exp pitch slide. `delayS` offsets the cue
   *  time — used by offline renders in place of setTimeout layers. */
  private blip(freq: number, type: OscillatorType, gain: number, dur: number, slide: number, delayS = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.cueNow(ctx) + delayS;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    o.connect(this.env(t, 0.005, dur, gain)).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Standalone filtered-noise hit into master. */
  private noise(dur: number, gain: number, lowpassHz: number, q: number): void {
    const master = this.master;
    if (!master) return;
    this.noiseInto(master, this.now(), dur, gain, lowpassHz, q, "lowpass");
  }

  /** Filtered noise burst routed into a bus. */
  private noiseInto(
    dest: AudioNode,
    t: number,
    dur: number,
    gain: number,
    freq: number,
    q: number,
    filter: BiquadFilterType,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(this.env(t, 0.001, dur, gain)).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Inharmonic FM "ping" (metallic bell) into a bus. `metallic` uses a
   *  bandpass for a ringing resonance. */
  private fmPing(
    dest: AudioNode,
    t: number,
    freq: number,
    ratio: number,
    index: number,
    gain: number,
    dur: number,
    metallic = false,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const c = ctx.createOscillator();
    c.type = "sine";
    c.frequency.value = freq;
    const m = ctx.createOscillator();
    m.type = "sine";
    m.frequency.value = freq * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(index, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    m.connect(mg).connect(c.frequency);
    let node: AudioNode = c;
    if (metallic) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = 8;
      c.connect(bp);
      node = bp;
    }
    node.connect(this.env(t, 0.001, dur, gain)).connect(dest);
    m.start(t); c.start(t);
    m.stop(t + dur + 0.02); c.stop(t + dur + 0.02);
  }

  /** AD gain envelope node (attack then exp decay to ~silence). */
  private env(t: number, attack: number, decay: number, peak: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.0005, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /**
   * METAL PING (the Binipe pass): strike transient + inharmonic partials
   * (anvil ratios 1/2.76/5.4/8.93) with per-partial decay — the physics of
   * struck metal, not a chord. Feeds the same master/reverb bus.
   */
  private metalPing(
    baseHz: number,
    dur: number,
    gain: number,
    opts: { ratios?: number[]; reverb?: number; at?: number } = {},
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = (opts.at ?? this.cueNow(ctx));
    const ratios = opts.ratios ?? [1, 2.76, 5.4, 8.93];
    const bus = ctx.createGain();
    bus.connect(master);
    if (opts.reverb) this.sendReverb(bus, opts.reverb);
    for (let i = 0; i < ratios.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseHz * ratios[i]! * rand(0.995, 1.005), t);
      const partialDur = Math.max(0.03, dur * (1 - i * 0.18));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain / (1 + i * 1.2), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + partialDur);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  /**
   * BOLT CLACK — the AK tactility: two machined-metal ticks a breath apart
   * (strike + carrier return). THE per-shot mechanical hook; rapid fire
   * reads as a cycling lock machine.
   */
  private boltClack(at: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.metalPing(3150 * rand(0.97, 1.03), 0.035, gain, { ratios: [1, 1.83], at });
    this.metalPing(2280 * rand(0.97, 1.03), 0.05, gain * 0.75, { ratios: [1, 2.1], at: at + 0.026 });
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf ?? this.makeNoise(ctx, 1);
    src.loop = true;
    return src;
  }

  private sendReverb(from: AudioNode, amount: number): void {
    if (!this.reverbSend || !this.ctx) return;
    const tap = this.ctx.createGain();
    tap.gain.value = amount;
    from.connect(tap).connect(this.reverbSend);
  }

  private makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Semitone → frequency ratio. */
function SEMI(n: number): number {
  return Math.pow(2, n / 12);
}

// Body-pitch round-robin — small musical steps keep the weapon's identity
// while guaranteeing consecutive shots differ (the core anti-fatigue trick).
// Ordered to avoid neighbouring repeats.
const BODY_STEPS = [0, 3, -2, 2, -3, 1, 4, -1];

