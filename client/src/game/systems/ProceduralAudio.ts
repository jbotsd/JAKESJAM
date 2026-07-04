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

export class ProceduralAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private reverbSend?: GainNode;
  private noiseBuf?: AudioBuffer;
  /** Active shield drone voice (started on shield-up, stopped on shield down). */
  private shieldDrone: { stop: (t: number) => void } | null = null;

  // Anti-fatigue weapon variation: round-robin index + last-shot time. Every
  // shot advances the round-robin (guaranteed non-repeat) and the inter-shot
  // interval drives rate-adaptive dynamics (rapid fire ducks + shortens).
  private rrIdx = 0;
  private lastShotAt = 0;

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
    const t = ctx.currentTime;
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
    const tailMul = lerp(1.0, 0.42, rapid);
    const level = lerp(1.0, 0.68, rapid); // duck sustained fire
    const pan = ((rr & 1) === 0 ? 1 : -1) * lerp(0.1, 0.34, rapid);

    // Shape → timbre. Waveform + brightness shift so a shape card is audible.
    const shapeWave: OscillatorType | null =
      shape === "square" ? "square" : shape === "bar" ? "sawtooth" : shape === "triangle" || shape === "orb" ? "triangle" : null;
    const wave = shapeWave ?? v.wave;
    const bright = shape === "x" || shape === "hexagon" ? 1.35 : shape === "triangle" || shape === "orb" ? 0.82 : 1;

    // Bus: level → stereo pan → tone lowpass → master (+ reverb send).
    const bus = ctx.createGain();
    bus.gain.value = level;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = v.tone * bright * rand(0.9, 1.12);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      bus.connect(panner).connect(tone).connect(master);
    } else {
      bus.connect(tone).connect(master);
    }
    this.sendReverb(tone, 0.05 + inten * 0.05);

    const bodyFreq = v.body * (1 - charge * 0.35 - (heavy ? 0.15 : 0)) * pitchMul;
    const dur = (0.1 + charge * 0.09 + (heavy ? 0.05 : 0)) * tailMul;

    // 1) Transient — varied per shot (brightness + level jitter).
    const tb = rand(0.8, 1.3) * bright;
    this.noiseInto(bus, t, 0.005, (0.45 + inten * 0.3) * rand(0.85, 1.15), v.air * 2 * tb, 0.9, "highpass");

    // 2) Body — FM carrier with fast downward pitch sweep.
    const carrier = ctx.createOscillator();
    carrier.type = wave;
    carrier.frequency.setValueAtTime(bodyFreq * 1.6, t);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(40, bodyFreq - v.sweep), t + dur);
    const bodyGain = this.env(t, 0.001, dur, 0.32 + inten * 0.22);
    if (v.fmRatio > 0) {
      const mod = ctx.createOscillator();
      mod.type = "sine";
      // Small per-shot FM-ratio wobble → spectral variation (anti-fatigue).
      mod.frequency.setValueAtTime(bodyFreq * v.fmRatio * rand(0.98, 1.02), t);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(v.fmIndex * (1 + charge * 0.6) * rand(0.85, 1.15), t);
      modGain.gain.exponentialRampToValueAtTime(1, t + dur);
      mod.connect(modGain).connect(carrier.frequency);
      mod.start(t);
      mod.stop(t + dur + 0.02);
    }
    carrier.connect(bodyGain).connect(bus);
    carrier.start(t);
    carrier.stop(t + dur + 0.02);

    // 3) Sub thump — weight (thinned on rapid fire to avoid low-end buildup).
    const sub = ctx.createOscillator();
    sub.type = "sine";
    const subF = (heavy ? 70 : 95) * (1 - charge * 0.3);
    sub.frequency.setValueAtTime(subF * 2, t);
    sub.frequency.exponentialRampToValueAtTime(subF, t + 0.08);
    sub.connect(this.env(t, 0.001, (0.1 + charge * 0.06) * tailMul, (0.26 + charge * 0.25) * lerp(1, 0.6, rapid))).connect(bus);
    sub.start(t);
    sub.stop(t + 0.18);

    // 4) Air burst — bandpassed noise sizzle, varied.
    this.noiseInto(bus, t, (0.05 + inten * 0.05) * tailMul, 0.16 + inten * 0.14, v.air * bright * rand(0.9, 1.12), 1.4, "bandpass");

    // 5) Crystalline shimmer — the signature "laser crystal" arpeggio for the
    //    default weapon (crystal). Partials rotate per shot → magical, never
    //    identical.
    if ((p.element ?? "crystal") === "crystal" || p.element === "ice" || p.element === "radiant") {
      this.crystalShimmer(bus, t, bodyFreq, rr, rapid, tailMul);
    }

    // 6) Element flavour (fire/lightning/void/toxic/…).
    this.weaponFlavour(bus, t, p.element, charge);

    // 7) Impact-card flavour — an explosive/sticky/pierce card is audible.
    this.impactFlavour(bus, t, p.impact, p.pathing, bodyFreq, tailMul);
  }

  /** Rotating inharmonic crystal partials — the shimmer that makes rapid
   *  crystal fire read as an evolving arpeggio instead of a repeated click. */
  private crystalShimmer(bus: AudioNode, t: number, bodyFreq: number, rr: number, rapid: number, tailMul: number): void {
    const count = rapid > 0.6 ? 2 : 3; // thin the shimmer on rapid fire
    const dur = lerp(0.2, 0.07, rapid) * tailMul;
    for (let i = 0; i < count; i += 1) {
      const semi = SHIMMER_STEPS[(rr + i * 3) % SHIMMER_STEPS.length]!;
      const f = bodyFreq * SEMI(semi) * rand(0.995, 1.005);
      // Inharmonic ratio (2.76) → glassy bell; high-Q bandpass = ringing.
      this.fmPing(bus, t + i * 0.004, f, 2.76, 260, (0.16 - i * 0.03) * lerp(1, 0.7, rapid), dur, true);
    }
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

// Bright crystalline partials (semitones above the body) for the shimmer tail
// — consonant intervals (octaves, fifths, thirds, tenths) so rapid crystal
// fire reads as a magical arpeggio rather than noise.
const SHIMMER_STEPS = [12, 19, 24, 7, 16, 28, 31, 15];
