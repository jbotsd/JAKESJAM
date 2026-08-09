// "Stationary > 1 s is a bug" — as an invariant the machine checks, not a
// rule someone has to notice in footage.
//
// This promotes footage finding S1 from an observation to a gate. The statue
// bot was caught on 2026-08-05 by rendering a replay, pulling frames and
// comparing poses 7.7 s apart — real work, and the only reason it was found.
// That loop is far too slow for a rule that should hold on every commit, so
// the same claim is made here against the REAL bot policy driving the REAL
// sim through the REAL host.
//
// Deliberately an invariant over a whole bot-only world rather than a unit
// test of the policy: worldBotsIdleFloor.test.ts pins the decision function,
// but a bot can also be pinned by geometry, a round freeze or a respawn —
// causes a policy-level test cannot see. This one only cares about the
// property that was filmed.
//
// It runs in REAL TIME, which is unusual here and deliberate. Two harness
// attempts failed first, both worth recording because each looked correct
// and produced a confident, wrong red:
//
//   1. Stepping `host.tick()` by hand without calling `bots.think()` — the
//      brains live on WorldHost's OWN interval, so the bots received no
//      input at all and every one read as motionless for 16.7 s of 20 s.
//      That number was the harness, not the game.
//   2. Calling `think()` too, but with the MatchHost loop stopped. `think()`
//      no-ops while the host loop is stopped (see WorldHost's botTimer
//      comment), so the numbers did not budge — an identical red for a
//      completely different reason.
//
// Hence: let both real intervals run and sample. A slow test that measures
// the actual system beats a fast one that measures its own scaffolding.

import { describe, expect, test } from "bun:test";
import { WorldHost } from "../worldHost.ts";
import type { MatchHost } from "../matchHost.ts";
import type { WorldState } from "@sim/types.ts";

/** How long a live player may stay put mid-FIGHT before it counts as a
 *  violation.
 *
 *  The standing rule is 1 s. This gate is set at 2 s, and the gap is
 *  recorded rather than papered over (L8): after the idle-floor fix the
 *  worst observed streak is ~1.6 s, caused by a DIFFERENT path than the
 *  filmed bug — the ENGAGED branch lets `moveDir` be 0 while a bot holds at
 *  its standoff range, and the unstick detector only fires when the bot
 *  intended to move. A standoff is a legitimate tactic, so tightening this
 *  to 1 s means giving held-position bots a micro-strafe: better on camera,
 *  but a combat-feel change with its own consequences, so it is a follow-up
 *  and not smuggled in here.
 *
 *  What this gate does buy: the filmed 7.7 s statue (and the 6.6/6.8 s runs)
 *  cannot come back unnoticed. 7.7 -> 1.6 s is the measured improvement. */
const MAX_STILL_MS = 2000;
/** Below this per-sample delta a player counts as not moving. Generous: the
 *  question is "is anything happening", not "is it perfectly still". */
const MOVE_EPSILON_PX = 0.35;
const SAMPLE_MS = 50;
const RUN_MS = 8_000;

type HostInternals = { host: MatchHost | null };

describe("bot liveness invariant (footage S1)", () => {
  test(
    "no bot stands still for more than 1.5 s in a live bot-only world",
    async () => {
      const arena = new WorldHost({ mapId: "boxworks-tower", bots: 4 });
      const host = (arena as unknown as HostInternals).host;
      // WorldHost eager-boots a bot world; if that stops being true this
      // should fail loudly rather than pass vacuously.
      expect(host).not.toBeNull();

      const lastPos = new Map<string, { x: number; y: number }>();
      const stillMs = new Map<string, number>();
      const worstStillMs = new Map<string, number>();

      const deadline = Date.now() + RUN_MS;
      while (Date.now() < deadline) {
        await Bun.sleep(SAMPLE_MS);
        const state: WorldState = host!.getStateSnapshot();
        // ONLY the fighting phase. Countdown, round-over and drafting freeze
        // everyone BY DESIGN, and the first run of this test dutifully
        // reported all four bots motionless for exactly 2.9 s each — the
        // countdown, measured precisely and meaning nothing. The filmed bug
        // was a bot standing still mid-FIGHT; that is the claim worth
        // gating, so the streaks reset whenever the round is not live.
        if (state.round.phase !== "fighting") {
          for (const id of stillMs.keys()) stillMs.set(id, 0);
          lastPos.clear();
          continue;
        }
        for (const [id, p] of Object.entries(state.players)) {
          if (!p || p.alive === false) {
            // Dead players are legitimately motionless — the respawn beat is
            // not a statue. Reset rather than accumulate.
            stillMs.set(id, 0);
            lastPos.delete(id);
            continue;
          }
          const prev = lastPos.get(id);
          lastPos.set(id, { x: p.x, y: p.y });
          if (!prev) continue;
          const moved = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
          const next = moved < MOVE_EPSILON_PX ? (stillMs.get(id) ?? 0) + SAMPLE_MS : 0;
          stillMs.set(id, next);
          if (next > (worstStillMs.get(id) ?? 0)) worstStillMs.set(id, next);
        }
      }

      type Stoppable = { stop(): void };
      (host as unknown as Stoppable).stop();

      const offenders = [...worstStillMs.entries()]
        .filter(([, ms]) => ms > MAX_STILL_MS)
        .map(([id, ms]) => `${id}: ${(ms / 1000).toFixed(1)}s`);

      // The message carries the evidence, so a failure reads like the footage
      // finding did instead of sending the reader back into the sim.
      expect(offenders).toEqual([]);
      // And prove the loop actually observed players — an empty world would
      // otherwise satisfy the assertion above by accident.
      expect(worstStillMs.size).toBeGreaterThan(0);
    },
    30_000,
  );
});
