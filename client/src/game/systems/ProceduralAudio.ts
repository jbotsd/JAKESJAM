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
  | "parry";

export type AudioParams = {
  /** Element of the shot/effect (fire/ice/lightning/void/…) → timbre. */
  element?: string;
  /** 0..1 weapon charge / overcharge — bigger = deeper, longer, heavier. */
  charge?: number;
  /** 0..1 intensity (damage / velocity) — scales body + air. */
  intensity?: number;
  /** Heavy weapon class → more low-end thump. */
  heavy?: boolean;
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

export class ProceduralAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private reverbSend?: GainNode;
  private noiseBuf?: AudioBuffer;
  /** Active shield drone voice (started on shield-up, stopped on shield down). */
  private shieldDrone: { stop: (t: number) => void } | null = null;

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Call from a user-gesture handler to create/resume the context. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  destroy(): void {
    try {
      this.shieldDrone?.stop(this.now());
    } catch {
      /* context may be gone */
    }
    void this.ctx?.close();
    this.ctx = undefined;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const Ctor =
      (window as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    const ctx = new Ctor();
    this.ctx = ctx;

    // Master → soft limiter → out.
    const master = ctx.createGain();
    master.gain.value = MASTER;
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
    return ctx;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  // ── Public cue API (router-compatible) ──────────────────────────────

  play(cue: AudioCue, params: AudioParams = {}): void {
    if (!this.ensureContext() || this.ctx?.state !== "running") return;
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
      case "jump":
        this.blip(330, "sine", 0.12, 0.12, 260);
        break;
      case "land":
        this.noise(0.09, 0.14, 420, 0.7);
        break;
      case "pickup":
        this.blip(740, "sine", 0.09, 0.05, 260);
        window.setTimeout(() => this.blip(980, "triangle", 0.08, 0.07, 180), 42);
        break;
      case "card":
        this.blip(430, "sine", 0.1, 0.07, 420);
        window.setTimeout(() => this.blip(650, "sine", 0.09, 0.09, 240), 55);
        break;
      case "fire":
        this.noise(0.12, 0.1, 980, 1.2);
        break;
    }
  }

  /** Start/stop the continuous shield energy hum (call on shield up/down). */
  setShieldHum(on: boolean): void {
    if (!this.ensureContext() || this.ctx?.state !== "running") return;
    if (on && !this.shieldDrone) this.startShieldHum();
    else if (!on && this.shieldDrone) {
      this.shieldDrone.stop(this.now());
      this.shieldDrone = null;
    }
  }

  // ── Weapons ─────────────────────────────────────────────────────────

  /**
   * Layered gunshot: transient click + FM/osc body with a fast downward
   * pitch sweep + sub thump + filtered air burst + per-element flavour, all
   * jittered per shot.
   */
  private weaponFire(p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const v = elementVoice(p.element);
    const charge = clamp01(p.charge ?? 0);
    const inten = clamp01(p.intensity ?? 0.5);
    const heavy = p.heavy ?? false;

    // Charge/weight → lower + longer. Micro pitch jitter per shot.
    const pitchJit = rand(0.94, 1.06);
    const chargeMul = 1 - charge * 0.35 - (heavy ? 0.15 : 0);
    const bodyFreq = v.body * chargeMul * pitchJit;
    const dur = 0.11 + charge * 0.09 + (heavy ? 0.05 : 0);

    // Whole-voice tone shaping (element warmth) + reverb space.
    const bus = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = v.tone * rand(0.9, 1.1);
    bus.connect(tone).connect(master);
    this.sendReverb(tone, 0.06 + inten * 0.05);

    // 1) Transient click — 4ms highpassed noise spike.
    this.noiseInto(bus, t, 0.006, 0.5 + inten * 0.3, v.air * 2, 0.9, "highpass");

    // 2) Body — osc (+ optional FM) with fast exp pitch drop.
    const carrier = ctx.createOscillator();
    carrier.type = v.wave;
    carrier.frequency.setValueAtTime(bodyFreq * 1.6, t);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(40, bodyFreq - v.sweep), t + dur);
    const bodyGain = this.env(t, 0.001, dur, 0.34 + inten * 0.22);
    if (v.fmRatio > 0) {
      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(bodyFreq * v.fmRatio, t);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(v.fmIndex * (1 + charge * 0.6), t);
      modGain.gain.exponentialRampToValueAtTime(1, t + dur);
      mod.connect(modGain).connect(carrier.frequency);
      mod.start(t);
      mod.stop(t + dur + 0.02);
    }
    carrier.connect(bodyGain).connect(bus);
    carrier.start(t);
    carrier.stop(t + dur + 0.02);

    // 3) Sub thump — weight, scales with charge/heavy.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    const subF = (heavy ? 70 : 95) * (1 - charge * 0.3);
    sub.frequency.setValueAtTime(subF * 2, t);
    sub.frequency.exponentialRampToValueAtTime(subF, t + 0.08);
    sub.connect(this.env(t, 0.001, 0.1 + charge * 0.06, 0.28 + charge * 0.25)).connect(bus);
    sub.start(t);
    sub.stop(t + 0.18);

    // 4) Air burst — bandpassed noise sizzle.
    this.noiseInto(bus, t, 0.05 + inten * 0.05, 0.18 + inten * 0.14, v.air * rand(0.9, 1.1), 1.4, "bandpass");

    // 5) Element flavour.
    this.weaponFlavour(bus, t, p.element, charge);
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
    // Tonal thud + short bright noise, pitched by intensity.
    this.blip(220 + inten * 120, "triangle", 0.14 + inten * 0.1, 0.09, 200);
    this.noise(0.05, 0.12 + inten * 0.1, 1400 + inten * 1400, 2);
  }

  private explosion(p: AudioParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
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
    const t = ctx.currentTime;
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
    const t = ctx.currentTime;
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
    const t = ctx.currentTime;
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
    const t = ctx.currentTime;
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
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.connect(master);
    this.sendReverb(bus, 0.18);
    // A tiny reverse pre-swell (the "catch") then a sharp bright metallic ting.
    const swell = this.noiseSource();
    const sf = ctx.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.value = 3000;
    sf.Q.value = 2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.14, t + 0.05); // reverse swell up
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    swell.connect(sf).connect(sg).connect(bus);
    swell.start(t); swell.stop(t + 0.09);
    // The ting — very high resonant FM ping right after the swell peak.
    this.fmPing(bus, t + 0.05, rand(1900, 2400), 4.1, 620, 0.32, 0.13, true);
  }

  // ── Synth primitives ────────────────────────────────────────────────

  /** A quick pitched blip with exp pitch slide. */
  private blip(freq: number, type: OscillatorType, gain: number, dur: number, slide: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
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
