// Doors 1.4 (open-doors-goal.md): a never-spawned player is never told
// they died. This is the copy-branch proof: the ONE decision function the
// scene runs (OnlineMatchScene death-overlay block) must route a pending
// entrant to NEXT BELL spectate framing and only ever route a
// spawned-then-dead player to the ELIMINATED treatment. The announcer rite
// (eliminated → soul-reclaimed) is scoped to the "eliminated" variant's
// branch in the scene, so variant IS the announcer entitlement.

import { describe, expect, test } from "bun:test";
import {
  deathOverlayPresentation,
  nextBellCountdown,
  PENDING_ENTRANT_TITLE,
  PENDING_ENTRANT_SUBTITLE,
} from "../deathOverlayPresentation.js";
import { deathWaitCountdown, type RoundPhase } from "../phaseCountdown.js";
import { DRAFT_WINDOW_MS, ROUND_OVER_HOLD_MS } from "../../../sim/round.js";

const ALL_PHASES: RoundPhase[] = ["countdown", "fighting", "round-over", "drafting"];

describe("copy branch — the Doors 1.4 rule", () => {
  test("never-spawned → pending-entrant, NEXT BELL in EVERY phase, never RESPAWNING", () => {
    for (const phase of ALL_PHASES) {
      const pres = deathOverlayPresentation(false, phase, 5_000, null);
      expect(pres.variant).toBe("pending-entrant");
      expect(pres.wait.label).toBe("NEXT BELL");
    }
  });

  test("never-spawned ignores a respawnSeconds value — a player who never lived has no respawn", () => {
    // Defensive: even if a caller passes respawn info, the pending variant
    // must not flip to the mid-round RESPAWNING treatment.
    const pres = deathOverlayPresentation(false, "fighting", 5_000, 4);
    expect(pres.variant).toBe("pending-entrant");
    expect(pres.wait.label).toBe("NEXT BELL");
  });

  test("spawned-then-dead → eliminated, wait identical to the classic deathWaitCountdown", () => {
    for (const phase of ALL_PHASES) {
      for (const respawnSeconds of [null, 4]) {
        const pres = deathOverlayPresentation(true, phase, 5_000, respawnSeconds);
        expect(pres.variant).toBe("eliminated");
        expect(pres.wait).toEqual(deathWaitCountdown(phase, 5_000, respawnSeconds));
      }
    }
  });

  test("pending copy is spectate framing in venue vocabulary, not death language", () => {
    const pres = deathOverlayPresentation(false, "fighting", 10_000, null);
    if (pres.variant !== "pending-entrant") throw new Error("expected pending-entrant");
    expect(pres.title).toBe(PENDING_ENTRANT_TITLE);
    expect(pres.subtitle).toBe(PENDING_ENTRANT_SUBTITLE);
    const copy = `${pres.title} ${pres.subtitle}`.toUpperCase();
    expect(copy).not.toContain("ELIMINAT");
    expect(copy).not.toContain("DIED");
    expect(copy).not.toContain("DEATH");
    expect(copy).toContain("BELL"); // the countdown reference
  });
});

describe("nextBellCountdown — the pending entrant's bell clock", () => {
  test("countdown: still NEXT BELL (a parked entrant never 'respawns'), exact remaining count", () => {
    // deathWaitCountdown says RESPAWNING here (a dead player has already
    // re-formed at countdown entry) — a gate-parked entrant has NOT, so
    // the label must stay NEXT BELL with the remaining count as the number.
    const t = nextBellCountdown("countdown", 3_000);
    expect(t.label).toBe("NEXT BELL");
    expect(t.seconds).toBe(3);
    expect(t.approx).toBe(false);
  });

  test("fighting: full-cycle upper bound, approx — same bell math as deathWaitCountdown", () => {
    const t = nextBellCountdown("fighting", 85_000);
    expect(t.label).toBe("NEXT BELL");
    expect(t.approx).toBe(true);
    expect(t.seconds).toBe(Math.ceil((85_000 + ROUND_OVER_HOLD_MS + DRAFT_WINDOW_MS) / 1000));
  });

  test("round-over: remaining + draft window, approx", () => {
    const t = nextBellCountdown("round-over", 2_500);
    expect(t.approx).toBe(true);
    expect(t.seconds).toBe(Math.ceil((2_500 + DRAFT_WINDOW_MS) / 1000));
  });

  test("drafting: exact — the bell IS the end of drafting", () => {
    const t = nextBellCountdown("drafting", 15_000);
    expect(t.approx).toBe(false);
    expect(t.seconds).toBe(15);
  });

  test("negative remaining clamps to 0, never renders a negative number", () => {
    expect(nextBellCountdown("countdown", -500).seconds).toBe(0);
    expect(nextBellCountdown("drafting", -500).seconds).toBe(0);
  });
});
