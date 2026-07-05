// Highlight-trigger evaluator — pure rules over the SAME SimEvent stream the
// renderer already consumes (see SimEventRouter). No audio/motion/OCR
// inference: the sim already knows exactly when something highlight-worthy
// happened, so a "highlight" is just a small rule set over ground-truth
// events. Feed real wall-clock time in (performance.now(), not sim ticks) so
// ClipRecorder can slice its rolling buffer by timestamp.
//
// See docs/monetization brief (2026-07) for the product rationale.

import type { PlayerId, SimEvent } from "../../sim/types.js";

export type HighlightKind = "multi-kill" | "chain-kill" | "parry-kill";

export type Highlight = {
  kind: HighlightKind;
  label: string;
  playerId: PlayerId;
  atMs: number;
};

/** Kills within this window count toward a multi-kill. */
const MULTI_KILL_WINDOW_MS = 6_000;
const MULTI_KILL_THRESHOLD = 2;
/** A kill counts as a "parry-kill" if the killer parried within this long before it. */
const PARRY_KILL_WINDOW_MS = 2_000;

const LABELS: Record<HighlightKind, string> = {
  "multi-kill": "Multi-kill",
  "chain-kill": "Chain-lightning kill",
  "parry-kill": "Parry-kill",
};

/**
 * Stateful (per-match) tracker. Call `ingest` once per tick with that tick's
 * events and the current wall-clock time; returns any highlights newly
 * triggered THIS call. Pure w.r.t. its own state — no scene/rendering deps,
 * so it's usable server-side (replay-driven, Path B) unchanged.
 */
export class HighlightTracker {
  private killTimestampsByPlayer = new Map<PlayerId, number[]>();
  private lastParryAtByPlayer = new Map<PlayerId, number>();
  /** Players already credited for the multi-kill currently in progress, so a
   *  4th, 5th... kill in the same window doesn't re-fire the tag. */
  private multiKillFiredForWindowStart = new Map<PlayerId, number>();

  ingest(events: readonly SimEvent[], nowMs: number): Highlight[] {
    const out: Highlight[] = [];
    for (const event of events) {
      if (event.t === "parry-deflected") {
        this.lastParryAtByPlayer.set(event.playerId, nowMs);
        continue;
      }
      if (event.t !== "player-killed") continue;
      const killerId = event.killerId;
      if (killerId === null) continue;

      if (event.cause === "chain-lightning") {
        out.push({ kind: "chain-kill", label: LABELS["chain-kill"], playerId: killerId, atMs: nowMs });
      }

      const lastParryAt = this.lastParryAtByPlayer.get(killerId);
      if (lastParryAt !== undefined && nowMs - lastParryAt <= PARRY_KILL_WINDOW_MS) {
        out.push({ kind: "parry-kill", label: LABELS["parry-kill"], playerId: killerId, atMs: nowMs });
      }

      const timestamps = this.killTimestampsByPlayer.get(killerId) ?? [];
      timestamps.push(nowMs);
      const windowStart = nowMs - MULTI_KILL_WINDOW_MS;
      while (timestamps.length > 0 && timestamps[0]! < windowStart) timestamps.shift();
      this.killTimestampsByPlayer.set(killerId, timestamps);

      if (timestamps.length >= MULTI_KILL_THRESHOLD) {
        const firstInWindow = timestamps[0]!;
        if (this.multiKillFiredForWindowStart.get(killerId) !== firstInWindow) {
          this.multiKillFiredForWindowStart.set(killerId, firstInWindow);
          out.push({ kind: "multi-kill", label: LABELS["multi-kill"], playerId: killerId, atMs: nowMs });
        }
      }
    }
    return out;
  }
}
