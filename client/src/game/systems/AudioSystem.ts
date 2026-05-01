import Phaser from "phaser";

export type GameSound =
  | "shoot"
  | "hit"
  | "jump"
  | "land"
  | "explosion"
  | "fire"
  | "card"
  | "pickup";

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

    if (sound === "shoot") {
      this.playTone(520, 130, "square", 0.2, -340);
      this.playNoise(38, 0.18, 1700);
    } else if (sound === "hit") {
      this.playTone(260, 95, "triangle", 0.15, 220);
    } else if (sound === "jump") {
      this.playTone(330, 120, "sine", 0.12, 260);
    } else if (sound === "land") {
      this.playNoise(70, 0.14, 420);
    } else if (sound === "explosion") {
      this.playNoise(180, 0.32, 240);
      this.playTone(86, 180, "sawtooth", 0.18, -28);
    } else if (sound === "fire") {
      this.playNoise(140, 0.11, 980);
    } else if (sound === "card") {
      this.playTone(430, 70, "sine", 0.1, 420);
      window.setTimeout(() => this.playTone(650, 90, "sine", 0.09, 240), 55);
    } else if (sound === "pickup") {
      this.playTone(740, 55, "sine", 0.08, 260);
      window.setTimeout(() => this.playTone(980, 75, "triangle", 0.07, 180), 42);
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
