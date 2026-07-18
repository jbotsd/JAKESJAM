// Pure shell place FSM — unit-testable without DOM or Phaser.

import type { ExclusivePlace, MatchMode, PlaceId, ShellLayer, ShellState } from "./types.js";

export function createShellState(): ShellState {
  return { exclusive: "home", layer: null, matchMode: "none" };
}

export function shellGoto(state: ShellState, place: PlaceId): ShellState {
  if (place === "home") {
    // Leaving match is a separate action; goto home while match active only
    // closes layers and keeps matchMode so UI knows we're still in-match.
    if (state.matchMode !== "none") {
      return { ...state, layer: null };
    }
    return { exclusive: "home", layer: null, matchMode: "none" };
  }
  if (place === "room") {
    // Pre-join: exclusive private-room place. In-match / hangout: toggle
    // room as an overlay layer so Menu/Esc can open+close it without
    // leaving the walkable hangout (Jake 2026-07-17).
    if (state.matchMode !== "none") {
      return {
        ...state,
        layer: state.layer === "room" ? null : "room",
      };
    }
    return { exclusive: "room", layer: null, matchMode: "none" };
  }
  if (place === "settings") {
    return { ...state, layer: "settings" };
  }
  if (place === "clips") {
    return { ...state, layer: "clips" };
  }
  if (place === "credits") {
    return { ...state, layer: "credits" };
  }
  if (place === "pause") {
    if (state.matchMode === "none") return state;
    return { ...state, layer: "pause" };
  }
  return state;
}

export function shellCloseLayer(state: ShellState): ShellState {
  return { ...state, layer: null };
}

export function shellTogglePause(state: ShellState): ShellState {
  if (state.matchMode === "none") return state;
  if (state.layer === "pause") return { ...state, layer: null };
  return { ...state, layer: "pause" };
}

export function shellSetMatchMode(_state: ShellState, mode: MatchMode): ShellState {
  if (mode === "none") {
    return { exclusive: "home", layer: null, matchMode: "none" };
  }
  // Entering match: hide exclusive chrome, clear layers.
  return { exclusive: "home", layer: null, matchMode: mode };
}

/** Visibility derived from state — single source for DOM apply. */
export type ShellVisibility = {
  home: boolean;
  room: boolean;
  settings: boolean;
  clips: boolean;
  pause: boolean;
  credits: boolean;
  /** True when match chrome should own the screen (splash/lobby hidden). */
  matchActive: boolean;
};

export function shellVisibility(state: ShellState): ShellVisibility {
  const matchActive = state.matchMode !== "none";
  return {
    matchActive,
    home: !matchActive && state.exclusive === "home",
    // Exclusive room (pre-join) OR room layer overlay (in hangout / match).
    room:
      (!matchActive && state.exclusive === "room") || state.layer === "room",
    settings: state.layer === "settings",
    clips: state.layer === "clips",
    pause: state.layer === "pause" && matchActive,
    credits: state.layer === "credits",
  };
}

export type { ExclusivePlace, ShellLayer, ShellState };
