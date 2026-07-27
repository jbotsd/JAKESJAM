// lagCompensatedStep — the offline-replay mirror of matchHost.tick()'s
// authoritative rewind → step → unshift → record sequence.
//
// clip-goal STUDY 3 (2026-07-27), D1 — "the credited kill has no visual
// corroboration", reproduced in 7 of 7 real-pipeline clips. Root cause,
// traced frame-by-frame back to the sim: matchHost.ts applies
// LagCompensator's "rewind opponents for the shooter" technique INLINE in
// its own tick loop (buildRewindPlan → stepWithRuntime → unshiftAfterStep →
// recordTick), but `ReplayScene.stepTicks()` fed the exact same recorded
// inputs straight into `stepWithRuntime` with NO lag compensation at all.
// Lag comp isn't an edge case — `buildRewindPlan` fires whenever a firing
// player's input.tick trails the current server tick, i.e. essentially
// every real shot fired under nonzero network latency. Any kill that only
// connected LIVE because an opponent was rewound to their past position
// for that one tick simply never happens when the replay steps the same
// inputs without the rewind: the victim isn't where the shot needed them to
// be, `player-killed` doesn't fire at the recorded tick (or fires against a
// different target, or not at all), and the highlight camera — which has
// no ground truth beyond "who's near the star" — has nothing real to frame.
// This is why the lower-third can say "KILL" over two full-health actors,
// or a bystander, or an empty screen: the replay's world state has quietly
// diverged from the live world's at exactly the moment that mattered.
//
// The fix is parity, not a guessed patch: replay re-simulation must apply
// THE SAME rewind/unshift LagCompensator applied live, fed the SAME
// recorded InputFrame.tick values, starting from the SAME empty position
// history at tick 0 (ReplayScene already fast-forwards from tick 0 through
// every intermediate tick via repeated stepTicks() calls, so the history
// ring builds up identically). Both call sites now route through this one
// function so they can't diverge again — matchHost.ts keeps its own inline
// copy (untouched, live-path-critical, already covered by
// matchHostLagCompDiag.test.ts) but this is the SAME LagCompensator class,
// SAME sequence, single-sourced for the replay side and unit-tested here
// against exactly the scenario that produces D1: a shot that only connects
// because of the rewind.

import { LagCompensator } from "./LagCompensator";
import { stepWithRuntime, type WorldRuntime } from "./World";
import type { InputFrame, PlayerId, SimEvent, WorldState } from "./types";

export function stepTickWithLagCompensation(
  state: WorldState,
  runtime: WorldRuntime,
  inputsByPlayer: Record<PlayerId, InputFrame | null>,
  lagComp: LagCompensator,
  dtMs: number,
): { state: WorldState; events: SimEvent[] } {
  const rewindPlan = lagComp.buildRewindPlan(state, inputsByPlayer);
  const stepInputState = rewindPlan ? rewindPlan.stateForStep : state;
  const result = stepWithRuntime(stepInputState, runtime, inputsByPlayer, dtMs);
  let nextState = result.state;
  if (rewindPlan) nextState = lagComp.unshiftAfterStep(nextState, rewindPlan);
  lagComp.recordTick(nextState);
  return { state: nextState, events: result.events };
}
