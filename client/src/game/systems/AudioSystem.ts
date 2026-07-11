import Phaser from "phaser";

export type GameSound =
  | "shoot"
  | "hit"
  | "jump"
  | "land"
  | "explosion"
  | "fire"
  | "card"
  | "pickup"
  | "dash";

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const MASTER_GAIN = 0.16;

export class GameAudioSystem {
  private readonly scene: Phaser.Scene;
  private context?: AudioContext;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.scene.input.once("pointerdown", this.unlock);
    this.scene.input.keyboard?.once("keydown", this.unlock);
  }

  destroy() {
    this.scene.input.off("pointerdown", this.unlock);
    this.scene.input.keyboard?.off("keydown", this.unlock);
    void this.context?.close();
    this.context = undefined;
  }

  play(sound: GameSound) {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    // Per game-feel-juice/SKILL.md Nijman rule #16: random pitch on every SFX.
    // ±8% jitter (0.92–1.08). Opt-out only for tonal UI cues (card/pickup)
    // which have intentional pitch relationships between their two tones.
    const pitch = (): number => 0.92 + Math.random() * 0.16;

    if (sound === "shoot") {
      // Heaven-iron bolt: hammer-tap ring over the old body — the launch
      // CLINKS like metal leaving metal.
      const p = pitch();
      this.playMetal(1180 * p, 90, 0.14, { strike: 0.9 });
      this.playTone(520 * p, 110, "square", 0.12, -340);
    } else if (sound === "hit") {
      // Anvil tink — the strike landing on a vessel of heaven-metal.
      const p = pitch();
      this.playMetal(720 * p, 150, 0.2, { strike: 0.7 });
    } else if (sound === "jump") {
      const p = pitch();
      this.playTone(330 * p, 120, "sine", 0.12, 260);
    } else if (sound === "land") {
      const p = pitch();
      this.playNoise(70, 0.14, 420 * p);
    } else if (sound === "explosion") {
      // Kill/shatter: the old boom + a deep GONG so the death rings.
      const p = pitch();
      this.playNoise(180, 0.32, 240 * p);
      this.playTone(86 * p, 180, "sawtooth", 0.18, -28);
      this.playMetal(196 * p, 650, 0.16, { ratios: [1, 2.4, 4.1, 6.9], strike: 0.2 });
    } else if (sound === "fire") {
      const p = pitch();
      this.playNoise(140, 0.11, 980 * p);
    } else if (sound === "dash") {
      // Aegis slide: blade-draw SCHWING — noise sweep + a whisper of ring.
      const p = pitch();
      this.playNoise(190, 0.1, 1500 * p);
      this.playMetal(2350 * p, 120, 0.05, { ratios: [1, 1.5], strike: 0.15 });
    } else if (sound === "card") {
      // UI tones: use gentle jitter (±4%) so the two-note phrase stays musical.
      const p = 0.96 + Math.random() * 0.08;
      this.playTone(430 * p, 70, "sine", 0.1, 420);
      window.setTimeout(() => this.playTone(650 * p, 90, "sine", 0.09, 240), 55);
    } else if (sound === "pickup") {
      const p = 0.96 + Math.random() * 0.08;
      this.playTone(740 * p, 55, "sine", 0.08, 260);
      window.setTimeout(() => this.playTone(980 * p, 75, "triangle", 0.07, 180), 42);
    }
  }

  private readonly unlock = () => {
    const context = this.ensureContext();
    if (context?.state === "suspended") {
      void context.resume();
    }
  };

  private ensureContext(): AudioContext | undefined {
    if (this.context) {
      return this.context;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) {
      return undefined;
    }

    this.context = new AudioContextConstructor();
    return this.context;
  }

  /**
   * METAL (the Binipe pass): real metallic timbre = a strike transient +
   * INHARMONIC partials ringing out at different rates — that's the
   * physics of a bell/anvil, not a chord. Ratios from classic anvil
   * analysis (1, 2.76, 5.40, 8.93); jitter keeps repeats organic.
   */
  private playMetal(
    baseHz: number,
    durationMs: number,
    gainValue: number,
    opts: { ratios?: number[]; strike?: number; body?: OscillatorType } = {},
  ) {
    const context = this.context;
    if (!context) return;
    const ratios = opts.ratios ?? [1, 2.76, 5.4, 8.93];
    const now = context.currentTime;
    const durS = durationMs / 1000;
    // Strike transient: a few ms of bright filtered noise — the hammer.
    this.playNoise(Math.min(30, durationMs * 0.2), (opts.strike ?? 0.5) * gainValue, 6500);
    for (let i = 0; i < ratios.length; i++) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = opts.body ?? "sine";
      const f = baseHz * ratios[i]! * (0.995 + Math.random() * 0.01);
      osc.frequency.setValueAtTime(f, now);
      // Higher partials die faster — the ring "cools" like real metal.
      const partialDur = durS * (1 - i * 0.18);
      const g = (gainValue * MASTER_GAIN) / (1 + i * 1.2);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(g, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, partialDur));
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(now);
      osc.stop(now + durS + 0.05);
    }
  }

  private playTone(
    frequency: number,
    durationMs: number,
    type: OscillatorType,
    gainValue: number,
    frequencySlide = 0,
  ) {
    const context = this.context;
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const durationSeconds = durationMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency + frequencySlide),
      now + durationSeconds,
    );

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue * MASTER_GAIN, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.02);
  }

  private playNoise(durationMs: number, gainValue: number, lowpassHz: number) {
    const context = this.context;
    if (!context) {
      return;
    }

    const sampleRate = context.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * (durationMs / 1000)));
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
    }

    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(lowpassHz, now);
    gain.gain.setValueAtTime(gainValue * MASTER_GAIN, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
  }
}
