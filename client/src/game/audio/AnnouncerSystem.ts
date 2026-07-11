// Announcer — Jake's Halo-style voice (docs/ANNOUNCER_SCRIPT.md).
//
// Files live at /audio/announcer/<key>.m4a (produced by
// scripts/process-announcer.ts). EVERYTHING here degrades gracefully:
// a missing file marks the key dead and the game plays exactly as it
// did before the announcer existed — so this wiring ships before the
// recording session.
//
// Priority ladder: a higher-priority line interrupts a lower one; equal
// or lower waits out the global cooldown. Per-key cooldowns keep "KILL"
// from machine-gunning in a mayhem round.

export type AnnouncerKey =
  | "kill"
  | "double-kill"
  | "triple-kill"
  | "multi-kill"
  | "first-blood"
  | "fight"
  | "round-over"
  | "victory"
  | "eliminated"
  | "soul-reclaimed"
  | "sudden-death"
  | "welcome"
  | "draft"
  | "killing-spree"
  | "unstoppable"
  | "lore-intro";

const PRIORITY: Record<AnnouncerKey, number> = {
  kill: 1,
  "double-kill": 2,
  "triple-kill": 3,
  "multi-kill": 4,
  "killing-spree": 3,
  unstoppable: 4,
  "first-blood": 3,
  fight: 5,
  "round-over": 4,
  victory: 6,
  eliminated: 2,
  "soul-reclaimed": 2,
  "sudden-death": 5,
  welcome: 5,
  draft: 2,
  "lore-intro": 7,
};

/** Per-key repeat suppression (ms). */
const KEY_COOLDOWN: Partial<Record<AnnouncerKey, number>> = {
  kill: 2_500,
  eliminated: 4_000,
  "soul-reclaimed": 4_000,
};

const GLOBAL_GAP_MS = 900;

const audio = new Map<AnnouncerKey, HTMLAudioElement | null>();
const lastPlayedAt = new Map<AnnouncerKey, number>();
let current: { el: HTMLAudioElement; priority: number } | null = null;
let lastLineEndedAt = 0;
let volume = 0.9;

function elementFor(key: AnnouncerKey): HTMLAudioElement | null {
  if (audio.has(key)) return audio.get(key)!;
  const el = new Audio(`/audio/announcer/${key}.m4a`);
  el.preload = "auto";
  el.addEventListener("error", () => audio.set(key, null)); // 404 → dead key
  audio.set(key, el);
  return el;
}

/** 0..1 — wired to the music volume slider (announcer rides a bit above). */
export function setAnnouncerVolume(musicVolume01: number): void {
  volume = Math.min(1, Math.max(0, musicVolume01 * 1.25));
}

export function announce(key: AnnouncerKey): void {
  const el = elementFor(key);
  if (!el) return;
  const now = performance.now();
  const keyCd = KEY_COOLDOWN[key] ?? 0;
  if (keyCd && now - (lastPlayedAt.get(key) ?? -1e9) < keyCd) return;
  const pri = PRIORITY[key];
  if (current && !current.el.ended && !current.el.paused) {
    if (pri <= current.priority) return; // let the bigger line finish
    current.el.pause(); // interrupt upward
  } else if (now - lastLineEndedAt < GLOBAL_GAP_MS && pri < 4) {
    return; // breathe between minor lines
  }
  el.currentTime = 0;
  el.volume = volume;
  const played = el.play();
  played?.catch(() => audio.set(key, null)); // autoplay/deco failures → dead
  lastPlayedAt.set(key, now);
  current = { el, priority: pri };
  el.onended = () => {
    lastLineEndedAt = performance.now();
    if (current?.el === el) current = null;
  };
}

/** Stop whatever is speaking (scene teardown / user skip). */
export function silenceAnnouncer(): void {
  current?.el.pause();
  current = null;
}
