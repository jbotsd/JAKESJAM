// Refresh-mid-match recovery — gospel-goal Track D 1.7.
//
// The server has always supported this: a socket that comes back within
// `RECONNECT_GRACE_MS` (10 s, server/src/matchHost.ts) with the same
// playerId re-attaches to the SAME entity — `hasPlayer` short-circuits to
// a pure socket re-attach, no re-queue, no bell wait, run intact. And the
// client id already survives a reload by construction: a localStorage base
// plus a sessionStorage suffix, and sessionStorage outlives a reload in
// the same tab (see localPlayerId() in main.ts).
//
// The only missing piece was intent. On reload the boot path always landed
// on the splash, so nothing ever tried to reconnect and the 10 s grace
// expired unused — a refresh silently forfeited the run. This module is
// the marker that lets boot know it was mid-match a moment ago.
//
// Deliberately sessionStorage, not localStorage: resuming is a property of
// THIS tab's live session. A different tab, or this tab reopened tomorrow,
// must land on the splash like any other visit.

/** Server-side reconnect grace. Mirrored, not imported — the client bundle
 *  must not pull in server code. Keep in step with
 *  server/src/matchHost.ts's RECONNECT_GRACE_MS. */
export const SERVER_RECONNECT_GRACE_MS = 10_000;

/** How stale the marker may be and still trigger a resume. Under the
 *  server grace with room to spare: the marker is re-stamped while the
 *  match is live, so this budget is spent almost entirely on the reload
 *  itself. Attempting a resume slightly too late is not harmful (the
 *  player is admitted as a pending entrant and sees "YOU'RE IN / NEXT
 *  BELL" per Doors 1.4, never a false ELIMINATED) — but landing them in
 *  the venue when the run was genuinely gone is worse than honest. */
export const RESUME_WINDOW_MS = 8_000;

/** How often the marker is re-stamped while a match is live. Covers the
 *  crash/kill case that `pagehide` cannot. */
export const RESUME_HEARTBEAT_MS = 2_000;

const KEY = "jakesjam.inMatch";

/** Which surface to put the player back into. "arena" is a live fight;
 *  "venue" is the lobby, where re-entry is free anyway but the splash
 *  round-trip is still noise. */
export type MatchPlace = "venue" | "arena";

type Mark = { place: MatchPlace; at: number };

function read(): Mark | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Mark>;
    if (parsed.place !== "venue" && parsed.place !== "arena") return null;
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    return { place: parsed.place, at: parsed.at };
  } catch {
    // Storage unavailable or corrupt — never block boot over a resume hint.
    return null;
  }
}

function write(mark: Mark): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(mark));
  } catch {
    /* hardened browser — resume is a nicety, not a requirement */
  }
}

/** Record that the player is in a match right now. Safe to call often. */
export function noteInMatch(place: MatchPlace, now: number = Date.now()): void {
  write({ place, at: now });
}

/** The player left on purpose (menu, back-to-splash, match over). A
 *  deliberate exit must never be resumed — that would drag someone back
 *  into a fight they chose to leave. */
export function clearInMatch(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Where boot should send this visitor, or null for the normal splash path.
 * Pure so it can be tested without a DOM clock.
 */
export function resumableMatch(now: number = Date.now()): MatchPlace | null {
  const mark = read();
  if (!mark) return null;
  const age = now - mark.at;
  // A negative age means the clock moved backwards (suspend/resume, NTP
  // step). Treat it as unusable rather than trusting it.
  if (age < 0 || age > RESUME_WINDOW_MS) return null;
  return mark.place;
}

/**
 * Keep the marker fresh while a match is live, and stamp it one last time
 * as the page goes away. Returns a teardown that stops the heartbeat.
 *
 * `pagehide` alone would miss a crash or a kill; the interval alone would
 * leave up to RESUME_HEARTBEAT_MS of drift on a clean reload. Both is
 * cheap and covers each other's gap.
 */
export function startResumeHeartbeat(
  place: MatchPlace,
  scope: {
    addEventListener: Window["addEventListener"];
    removeEventListener: Window["removeEventListener"];
  } = window,
): () => void {
  noteInMatch(place);
  const timer = setInterval(() => noteInMatch(place), RESUME_HEARTBEAT_MS);
  const onHide = () => noteInMatch(place);
  scope.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    scope.removeEventListener("pagehide", onHide);
  };
}
