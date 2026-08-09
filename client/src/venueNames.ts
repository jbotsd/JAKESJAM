// One source of naming — venue-goal Pillar 6.1, gospel Doors 1.6.
//
// Every user-visible mode name imports from here. The rule exists because
// the product has been renamed twice ("Hot Lobby" → the venue/arena
// split), and each rename left copy stranded in surfaces nobody grepped:
// the badge said one thing, the overlay another, the docs a third. Naming
// drift is a legibility bug (ui-axioms), and it is the cheapest possible
// class of bug to make structurally impossible.
//
// The vocabulary, fixed:
//   THE VENUE  — the whole place: lobby + arena together.
//   THE LOBBY  — the walkable front room, where you wait for the bell.
//   THE ARENA  — where the fight happens, past the bell.
//
// DEVIATION from the Pillar 6.1 sketch, recorded rather than silent (L8):
// that sketch listed `BELL_COPY = (s: number) => ...` here. The bell's
// countdown formatter already exists as `game/ui/bellCountdown.ts`
// (`formatBellCountdown`) with its own test suite covering the approx-tilde
// and phase-dependent rounding rules. Moving a tested formatter to satisfy
// a doc's file layout would be churn, so this module owns the LABEL and
// bellCountdown keeps the formatting. "One source of naming" holds — there
// is exactly one place the words live.

/** The whole place — lobby plus arena. */
export const VENUE_NAME = "THE VENUE";

/** The walkable front room. */
export const LOBBY_NAME = "THE LOBBY";

/** Past the bell, where the fight is. */
export const ARENA_NAME = "THE ARENA";

/** Primary call to action on the splash / marketing surfaces. */
export const VENUE_CTA = "ENTER THE ARENA";

/** Caption over every next-bell countdown, wherever it appears (the venue
 *  strip, the death overlay, the phase readout). */
export const BELL_LABEL = "NEXT BELL";

/** The callsign prompt's kicker — identity precedes commitment (S2.C.3). */
export const VENUE_ASKS_NAME = `${VENUE_NAME} ASKS YOUR NAME`;

/** Document title while in each surface. */
export const VENUE_TITLE = "JAKESJAM — The Venue";
export const ARENA_TITLE = "JAKESJAM — The Arena";
