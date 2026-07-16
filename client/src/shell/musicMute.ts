// The music system's context law, in one testable place (venue-sprint2-goal
// S2.C.2): every music context has exactly one track, the mute toggle applies
// to ALL of them (a muted player must never hear a context switch), and
// "which track is active" is a total function of the context. main.ts owns
// the HTMLAudioElements and the crossfade RAF machinery; this module owns the
// mapping rules so adding a context (e.g. "venue") is compile-time exhaustive
// — a Record<MusicContext, T> that misses a key does not build.

export type MusicContext = "menu" | "world" | "venue";

export type MutableTrack = { muted: boolean };

/** Mute law: the toggle silences every context's track, active or not. */
export function applyMusicMute<T extends MutableTrack>(
  tracks: Record<MusicContext, T>,
  muted: boolean,
): void {
  for (const key of Object.keys(tracks) as MusicContext[]) {
    tracks[key].muted = muted;
  }
}

/** The one track a given context plays. */
export function activeTrack<T>(tracks: Record<MusicContext, T>, context: MusicContext): T {
  return tracks[context];
}

/** Every track that must fade OUT when `context` takes over. */
export function inactiveTracks<T>(tracks: Record<MusicContext, T>, context: MusicContext): T[] {
  return (Object.keys(tracks) as MusicContext[])
    .filter((c) => c !== context)
    .map((c) => tracks[c]);
}
