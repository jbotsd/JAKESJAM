// Shell place + match-mode types and typed jakesjam:* event names.
// Scenes emit these; they never import ShellController.

export type PlaceId = "home" | "settings" | "clips" | "room" | "pause" | "credits";

export type MatchMode = "none" | "practice" | "world" | "private";

/** Exclusive full-screen places (mutually exclusive). Layers overlay them. */
export type ExclusivePlace = "home" | "room";

export type ShellLayer = null | "settings" | "clips" | "pause" | "credits";

export type ShellState = {
  exclusive: ExclusivePlace;
  layer: ShellLayer;
  matchMode: MatchMode;
};

/** Window CustomEvent type names used for match ↔ shell handoff. */
export const ShellEvents = {
  GOTO: "jakesjam:shell-goto",
  ENTER_WORLD: "jakesjam:enter-world",
  ENTER_PRACTICE: "jakesjam:enter-practice",
  ENTER_ROOM: "jakesjam:enter-room",
  MATCH_STARTED: "jakesjam:match-started",
  MATCH_ENDED: "jakesjam:match-ended",
  RETURN_TO_LOBBY: "jakesjam:return-to-lobby",
  BACK_TO_SPLASH: "jakesjam:back-to-splash",
  CLIP_UPLOADED: "jakesjam:clip-uploaded",
  /** Consent toggle flipped (settings / match chrome / pause). Scene hot-starts recorder. */
  CLIPS_CONSENT_CHANGED: "jakesjam:clips-consent-changed",
  /** Manual "Save clip now" — no multi-kill required. */
  CLIP_SAVE_NOW: "jakesjam:clip-save-now",
  PAUSE_TOGGLE: "jakesjam:pause-toggle",
  REQUEST_LEAVE_MATCH: "jakesjam:request-leave-match",
  START_MATCH: "jakesjam:start-match",
} as const;

export type ClipUploadedDetail = {
  url: string;
  kind: "vertical" | "original";
  pairId?: string;
  label?: string;
};

export type ShellGotoDetail = { place: PlaceId };

export type MatchStartedDetail = { mode: MatchMode };

export type EnterRoomDetail = { mode: "host" | "join" };
