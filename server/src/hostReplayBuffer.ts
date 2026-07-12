// Host-box replay-buffer signaling (Phase 3a of the capture rework).
//
// When the host machine runs gpu-screen-recorder's RAM replay buffer
// (stream-kit/launch-replay-buffer.sh), the game gets kill clips with
// effectively ZERO in-game cost: the dedicated NVENC block encodes the
// screen continuously into RAM, and saving a clip is just "SIGUSR1 → mux
// the last N seconds to disk". No preserveDrawingBuffer, no drawImage
// copies, no MediaRecorder — nothing on the game's main thread at all.
//
// This module is the trigger side: on a player-killed sim event, wait the
// same aftermath lookahead the in-browser recorder uses, then signal the
// recorder. The recorder's -sc hook (stream-kit/on-replay-saved.sh) pushes
// the saved file through the normal /clips/upload path so host clips land
// in the same store/share/ops pipeline as browser clips.
//
// OFF unless JJ_HOST_REPLAY=1 — it only makes sense on the box that is
// actually running the buffer (the streaming/kiosk host).
//
// ⚠️ 2026-07-12 INCIDENT: this signal drives gpu-screen-recorder's
// FULL-MONITOR capture (stream-kit/launch-replay-buffer.sh — now refuses
// to run). On this box (Jake's daily-driver desktop, not a dedicated
// kiosk) it captured his real screen — browser tabs, a DM thread — and
// uploaded 26 clips of it to the public store before anyone noticed. A
// single-var accidental `JJ_HOST_REPLAY=1` in an env block is exactly how
// that happened. The second var below is a deliberate typing tax so
// re-enabling this requires reading this comment first — the capture
// process itself is already blocked at the script level too. The
// permanent replacement is clipRenderQueue.ts (isolated headless render,
// never touches the real screen) — prefer that; it needs no flag at all.

import type { SimEvent } from "@sim/types.ts";

const ENABLED =
  process.env.JJ_HOST_REPLAY === "1" &&
  process.env.JJ_HOST_REPLAY_DEDICATED_KIOSK_BOX === "1";
/** Aftermath window before saving — mirrors ClipRecorder's LOOKAHEAD_MS. */
const LOOKAHEAD_MS = 3_000;
/** Min spacing between saves: a multi-kill inside one window is one clip
 *  (the buffer holds the whole sequence anyway). */
const DEBOUNCE_MS = 10_000;

let lastSignalAtMs = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function signalRecorder(): void {
  // -f matches the launcher's full cmdline; pkill never matches itself and
  // this process's argv doesn't contain the pattern (spawn args are
  // pkill's, not ours).
  const proc = Bun.spawn(["pkill", "-SIGUSR1", "-f", "gpu-screen-recorder -w"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  void proc.exited.then((code) => {
    if (code !== 0) {
      console.warn("[host-replay] no gpu-screen-recorder replay buffer running to signal");
    } else {
      console.log("[host-replay] kill clip save signaled");
    }
  });
}

/** Call once per tick with the step's sim events. Cheap no-op when disabled
 *  or when the tick has no kill. */
export function maybeSignalHostClip(events: readonly SimEvent[]): void {
  if (!ENABLED || events.length === 0) return;
  let killed = false;
  for (const e of events) {
    if (e.t === "player-killed") {
      killed = true;
      break;
    }
  }
  if (!killed) return;
  const now = Date.now();
  if (pendingTimer !== null || now - lastSignalAtMs < DEBOUNCE_MS) return;
  lastSignalAtMs = now;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    signalRecorder();
  }, LOOKAHEAD_MS);
}
