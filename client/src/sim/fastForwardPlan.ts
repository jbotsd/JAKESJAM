// fastForwardPlan — batch sizes for advancing a tick counter to `target`
// without ever overshooting it (clip-goal STUDY 3, CL.C regression).
//
// ReplayScene fast-forwards from tick 0 to a clip render window's
// `fromTick` in batches (stepTicks(60) at a time, for speed) before it
// starts capturing frames. A fixed batch size can land anywhere up to
// `batchSize-1` ticks PAST target depending on the remainder — for the
// render window's `fromTick`, that eats into (or in a short trade,
// entirely consumes) the ~1.5s pre-kill approach lead-in the trim law
// promises, and in the worst case (`80ea1663`) skips past the credited
// kill's tick range entirely so the render opens on pure aftermath with
// no visible corroboration at all.
//
// Pure so the loop-control math is testable without a Phaser scene: given
// (current tick, target tick, batch size), returns the sequence of batch
// sizes that sum to EXACTLY `target - current`, each capped at `batchSize`.

export function fastForwardBatches(current: number, target: number, batchSize: number): number[] {
  const batches: number[] = [];
  let tick = current;
  while (tick < target) {
    const step = Math.min(batchSize, target - tick);
    batches.push(step);
    tick += step;
  }
  return batches;
}
