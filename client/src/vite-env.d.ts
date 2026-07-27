/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly CONVEX_URL?: string;
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __JAKESJAM_ASSET_BASE__?: string;
  // Set by the legacy standalone HTML builds (tools/build-standalone.mjs).
  // The cloud lobby flow ignores it; kept for backwards compatibility with
  // pre-built standalone HTML pages still in circulation.
  __JAKESJAM_DEFAULT_ROLE__?: "host" | "player";
  __JAKESJAM_CONVEX_URL__?: string;
}

// MediaStreamTrackProcessor (Insertable Streams for MediaStreamTrack) is a
// Chromium-only API not yet in TypeScript's bundled DOM lib (AudioData/
// VideoFrame/VideoEncoder already are). ClipRecorder.ts uses it to tap the
// live game audio as a stream of AudioData frames for the WebCodecs worker
// path (clip-goal D4/B3 fix) — same Chromium-only posture as the rest of
// this file's WebCodecs/mediabunny stack.
declare class MediaStreamTrackProcessor<T = VideoFrame | AudioData> {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<T>;
}
