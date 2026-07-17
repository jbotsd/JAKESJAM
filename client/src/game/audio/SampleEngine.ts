// SampleEngine — Bitwig-designed one-shots replace WebAudio synth spaghetti.
//
// Sound design happens in a REAL studio (Bitwig/Serum); the game just
// plays the exports. Files: /audio/sfx/<cue>-01.m4a, <cue>-02.m4a, ...
// (scripts/process-sfx.ts builds them + the manifest). Round-robin across
// variants + ±6% pitch jitter = organic repeats, Nijman rule #16 for free.
//
// GRACEFUL: cues with no samples report canPlay=false and the caller
// falls back to the procedural synth — the game never goes silent while
// the sample pack is half-finished.

type CueName = string;

const PITCH_JITTER = 0.06;
const MAX_VOICES = 24;

export class SampleEngine {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<CueName, AudioBuffer[]>();
  private rr = new Map<CueName, number>();
  private loading = false;
  private manifest: Record<CueName, number> | null = null;
  private activeVoices = 0;
  /** Resolves when the pack finished loading (or was found absent) —
   *  offline renders (clip-goal CL.B) must await this before stepping so
   *  sample-first cues don't silently fall back to synth mid-load. */
  private loadedPromise: Promise<void> | null = null;

  /** Attach to the game's AudioContext (share ProceduralAudio's).
   *  Re-init with a different context is allowed (offline clip render) —
   *  decoded AudioBuffers are context-independent PCM. */
  init(ctx: BaseAudioContext, master: GainNode): void {
    this.ctx = ctx;
    this.master = master;
    if (!this.loading) {
      this.loading = true;
      this.loadedPromise = this.loadAll();
    }
  }

  /** Await pack readiness (no-op resolve when init never ran). */
  whenReady(): Promise<void> {
    return this.loadedPromise ?? Promise.resolve();
  }

  private async loadAll(): Promise<void> {
    try {
      const res = await fetch("/audio/sfx/manifest.json");
      if (!res.ok) return; // no pack yet — synth fallback everywhere
      this.manifest = (await res.json()) as Record<string, number>;
    } catch {
      return;
    }
    const ctx = this.ctx;
    if (!ctx || !this.manifest) return;
    await Promise.all(
      Object.entries(this.manifest).map(async ([cue, count]) => {
        const list: AudioBuffer[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const r = await fetch(`/audio/sfx/${cue}-${String(i).padStart(2, "0")}.m4a`);
            if (!r.ok) continue;
            list.push(await ctx.decodeAudioData(await r.arrayBuffer()));
          } catch {
            // skip broken variant
          }
        }
        if (list.length > 0) this.buffers.set(cue, list);
      }),
    );
    console.log(`[sfx] sample pack loaded: ${this.buffers.size} cues`);
  }

  canPlay(cue: CueName): boolean {
    return (this.buffers.get(cue)?.length ?? 0) > 0;
  }

  /**
   * Fire a one-shot. `gain` 0..1, `pitch` multiplies on top of the jitter,
   * `pan` -1..1. Returns false when the cue has no samples (caller synths).
   */
  play(
    cue: CueName,
    opts: { gain?: number; pitch?: number; pan?: number; at?: number } = {},
  ): boolean {
    const ctx = this.ctx;
    const master = this.master;
    const list = this.buffers.get(cue);
    if (!ctx || !master || !list || list.length === 0) return false;
    // Voice cap is a REALTIME audio-thread protection; offline renders
    // (explicit `at` scheduling, clip-goal CL.B) build the whole graph up
    // front and the cap's onended bookkeeping never fires between cues.
    if (opts.at === undefined && this.activeVoices >= MAX_VOICES) return true; // swallowed, not synth-doubled
    const idx = (this.rr.get(cue) ?? 0) % list.length;
    this.rr.set(cue, idx + 1);
    const src = ctx.createBufferSource();
    src.buffer = list[idx]!;
    src.playbackRate.value =
      (opts.pitch ?? 1) * (1 - PITCH_JITTER + Math.random() * PITCH_JITTER * 2);
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    let head: AudioNode = g;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      head = p;
    }
    src.connect(g);
    head.connect(master);
    if (opts.at === undefined) {
      this.activeVoices += 1;
      src.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      };
    }
    src.start(opts.at);
    return true;
  }
}

export const sampleEngine = new SampleEngine();
