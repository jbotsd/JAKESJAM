// Typed window CustomEvent dispatchers for match ↔ shell handoff.
// Scenes may import THIS file only (not ShellController) to emit events.

import type { ClipUploadedDetail, MatchMode, PlaceId } from "./types.js";
import { ShellEvents } from "./types.js";

export function emitShellGoto(place: PlaceId): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.GOTO, { detail: { place } }));
}

export function emitMatchStarted(mode: MatchMode): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.MATCH_STARTED, { detail: { mode } }));
}

/** The player just finished a full cycle and is looking at the results —
 *  the end-of-demo moment Doors 1.2 aims the email ask at. */
export function emitCycleCompleted(): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.CYCLE_COMPLETED));
}

export function emitClipUploaded(detail: ClipUploadedDetail): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.CLIP_UPLOADED, { detail }));
}

export function emitClipsConsentChanged(enabled: boolean): void {
  window.dispatchEvent(
    new CustomEvent(ShellEvents.CLIPS_CONSENT_CHANGED, { detail: { enabled } }),
  );
}

export function emitClipSaveNow(): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.CLIP_SAVE_NOW));
}

export function emitPauseToggle(): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.PAUSE_TOGGLE));
}

export function emitRequestLeaveMatch(): void {
  window.dispatchEvent(new CustomEvent(ShellEvents.REQUEST_LEAVE_MATCH));
}

export { ShellEvents };
export type { ClipUploadedDetail, MatchMode, PlaceId };
