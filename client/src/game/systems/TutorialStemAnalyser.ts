// Muted, analysis-only playback of the song's isolated stems (vocals/
// drums/bass/percussion/other) running ALONGSIDE the showcase's single
// audible master track (TutorialScene's own songAudio) — lets reactive
// visuals read the REAL per-instrument signal instead of guessing from
// frequency-band splits of the full mix (which is all readMusicBands()
// can do, since it only has the finished mixdown to work with).
//
// Never audible, structurally: each stem's MediaElementSource connects
// ONLY to its own AnalyserNode, never to ctx.destination. Silence here is
// a routing fact, not a `.muted`/`.volume` promise some other code path
// could accidentally bypass — `el.muted = true` is set too, belt-and-
// suspenders, but the real guarantee is the missing destination edge.
//
// "Synth" stem is deliberately excluded — measured at -91dB mean / -56dB
// peak (pure noise floor) for this track, i.e. this song has no separated
// synth layer; whatever would read as "synth" got folded into "Other" by
// the source separation. Re-check volumedetect if this analyser is ever
// pointed at a different song before assuming that still holds.
//
// Sync caveat: these are a separate DAW export, not derived from the same
// file tutorial-theme.mp3 was encoded from. A head cross-correlation
// found the stems' content leading the master mix by roughly 90ms — small,
// and well within tolerance for the CONTINUOUS envelope-driven effects
// these feed (glow/shimmer/pulse), which don't need tutorial-song.ts's
// cue-table precision. resync() also actively corrects any accumulated
// drift from independent per-element decode timing.
import { getAudioUrl } from "../audio/audioUrl.js";

export type StemName = "leadVocals" | "backingVocals" | "drums" | "bass" | "percussion" | "other";

const STEM_NAMES: StemName[] = ["leadVocals", "backingVocals", "drums", "bass", "percussion", "other"];

const STEM_FILES: Record<StemName, string> = {
  leadVocals: "tutorial-stems/lead-vocals.m4a",
  backingVocals: "tutorial-stems/backing-vocals.m4a",
  drums: "tutorial-stems/drums.m4a",
  bass: "tutorial-stems/bass.m4a",
  percussion: "tutorial-stems/percussion.m4a",
  other: "tutorial-stems/other.m4a",
};

export type StemEnvelopes = Record<StemName, number>;

const RESYNC_DRIFT_SEC = 0.25;

export class TutorialStemAnalyser {
  private ctx: AudioContext | null = null;
  private elements: HTMLAudioElement[] = [];
  private analysers = new Map<StemName, AnalyserNode>();
  private bins = new Map<StemName, Uint8Array<ArrayBuffer>>();

  /** Best-effort — a stem analysis failure should never block the showcase
   *  from playing; every consumer treats a missing/zeroed envelope as "no
   *  extra signal," falling back to the existing mix-band reactivity. */
  install(): void {
    try {
      this.ctx = new AudioContext();
      for (const name of STEM_NAMES) {
        const el = new Audio(getAudioUrl(STEM_FILES[name]));
        el.loop = false;
        el.muted = true;
        el.preload = "auto";
        this.elements.push(el);
        const src = this.ctx.createMediaElementSource(el);
        const an = this.ctx.createAnalyser();
        an.fftSize = 512; // envelope-only — no need for fine frequency resolution
        src.connect(an); // deliberately NOT connected to ctx.destination
        this.analysers.set(name, an);
        this.bins.set(name, new Uint8Array(an.fftSize));
      }
    } catch {
      this.dispose();
    }
  }

  /** Call once, right as the master track starts, so all stems share the
   *  same start instant. */
  play(): void {
    for (const el of this.elements) void el.play().catch(() => {});
  }

  /** Call on load and after any ?t= seek of the master track. */
  seek(sec: number): void {
    for (const el of this.elements) {
      try {
        el.currentTime = sec;
      } catch {
        // Not ready yet — resync() below will catch it up once it is.
      }
    }
  }

  /** Corrects any drift accumulated from independent per-element decode
   *  timing. Cheap early-out when everything's already close. */
  resync(masterSec: number): void {
    for (const el of this.elements) {
      if (Math.abs(el.currentTime - masterSec) > RESYNC_DRIFT_SEC) el.currentTime = masterSec;
    }
  }

  /** 0..1 envelope per stem, read fresh each frame — time-domain RMS, not
   *  frequency-band splitting, since each stem IS already its own
   *  isolated instrument (no band-guessing needed the way the full-mix
   *  analyser in TutorialScene.readMusicBands() requires). */
  read(): StemEnvelopes {
    const out = {} as StemEnvelopes;
    for (const name of STEM_NAMES) {
      const an = this.analysers.get(name);
      const bin = this.bins.get(name);
      if (!an || !bin) {
        out[name] = 0;
        continue;
      }
      an.getByteTimeDomainData(bin);
      let sumSq = 0;
      for (let i = 0; i < bin.length; i++) {
        const v = (bin[i]! - 128) / 128;
        sumSq += v * v;
      }
      out[name] = Math.sqrt(sumSq / bin.length);
    }
    return out;
  }

  dispose(): void {
    for (const el of this.elements) {
      el.pause();
      el.src = "";
    }
    this.elements = [];
    this.analysers.clear();
    this.bins.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
