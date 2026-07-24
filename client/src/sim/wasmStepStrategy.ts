// Phase B1 — the only real `StepStrategy` adapter.
//
// `WasmStepStrategy` wires the netcode loop into `wasmHost.step()`.
// The translation between TS shape and wasm shape is:
//
//   - per-tick keys map: built from `inputsByPlayer` here, written
//     into wasm memory via `wasmHost.writeInputs`.
//   - SimEvents: wasm-emitted events (numeric kind + payload slots)
//     translated to the discriminated union TS expects via
//     `convertWasmEventsToTs` (still living in World.ts; B-final
//     moves it here).
//
// This adapter replaces the `maybeWasmActual` URL-flag probe in
// World.ts. The clientLoop holds one instance, instantiated once.

import type {
  InputFrame,
  PlayerId,
  SimEvent,
  StepResult,
  WorldState,
} from "./types.js";
import type { WorldRuntime } from "./World.js";
import { convertWasmEventsToTs } from "./World.js";
import { wasmHost, type PlayerInputBits } from "./wasm/wasmHost.js";
import type { StepStrategy } from "./stepStrategy.js";

export class WasmStepStrategy implements StepStrategy {
  step(
    state: WorldState,
    runtime: WorldRuntime,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
    dtMs: number,
  ): StepResult {
    if (!wasmHost.isReady()) {
      throw new Error(
        "[wasm-step-strategy] step() called before wasmHost.ready() resolved.",
      );
    }

    // Build the keys map from inputsByPlayer + the runtime's
    // prevKeys cache (so wasm sees both this-tick + last-tick keys
    // for edge detection).
    const inputsMap = new Map<string, PlayerInputBits>();
    for (const [pid, frame] of Object.entries(inputsByPlayer)) {
      if (!frame) continue;
      const prev = runtime.prevKeys.get(pid as PlayerId) ?? 0;
      inputsMap.set(pid, {
        keys: frame.keys,
        prevKeys: prev,
        aimX: frame.aimX,
        aimY: frame.aimY,
      });
    }
    wasmHost.writeInputs(inputsMap);

    // Loadout delivery (fire configs + card hand + equipped actives)
    // happens INSIDE the step now, AFTER the pack (Track Z1b finding
    // (c)): the old pre-step `writeFireConfigsForState(state)` call here
    // wrote configs the step's own pack immediately zero-filled, so
    // step_world never saw them — starter pistol regardless of cards.

    const result = wasmHost.step(state, dtMs);

    // Translate wasm event tags → discriminated TS SimEvents.
    const events: SimEvent[] = convertWasmEventsToTs(
      result.events,
      result.state,
    );

    // Update runtime.prevKeys for next-tick edge detection. Note:
    // the wasm sim ALSO tracks current_keys/prev_keys per player,
    // but the runtime cache is what the next strategy.step() reads
    // when building its inputsMap.
    for (const [pid, bits] of inputsMap) {
      runtime.prevKeys.set(pid as PlayerId, bits.keys);
    }

    return {
      state: result.state,
      events,
      matchComplete: result.matchComplete,
    };
  }

  ready(): Promise<void> {
    return wasmHost.ready();
  }

  isReady(): boolean {
    return wasmHost.isReady();
  }
}

/**
 * Page-singleton — one wasm-step adapter per process. clientLoop
 * imports this directly; no globalThis.
 */
export const wasmStepStrategy: StepStrategy = new WasmStepStrategy();
