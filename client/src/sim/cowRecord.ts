// Copy-on-write record wrapper for sim hot paths.
//
// Pattern: a tick may or may not need to mutate a per-tick "next" record
// (e.g. WorldState.projectiles). The eager `{...source}` clone allocates
// regardless. CoW defers the clone until the first mutation; if nothing
// changes, `view()` returns the original reference and the tick costs
// zero allocations for that record.
//
// Required by Phase D1 (game-loop-perf audit). Used in client/src/sim/World.ts
// for state.projectiles. NOT for state.satellites — that record is
// reassigned wholesale by stepSatellites every tick, so the CoW wouldn't
// save any allocation there.

export class CowRecord<K extends string | number, V> {
  private readonly source: Record<K, V>;
  private mutated: Record<K, V> | null = null;

  constructor(source: Record<K, V>) {
    this.source = source;
  }

  /** Read a value. Cheap — never triggers a copy. */
  get(k: K): V | undefined {
    return (this.mutated ?? this.source)[k];
  }

  /** Membership check. Cheap. */
  has(k: K): boolean {
    return k in (this.mutated ?? this.source);
  }

  /** Write. The first write triggers a one-time spread of `source`. */
  set(k: K, v: V): void {
    if (!this.mutated) this.mutated = { ...this.source };
    this.mutated[k] = v;
  }

  /** Delete. Same first-write spread semantics as set(). */
  delete(k: K): void {
    if (!this.mutated) this.mutated = { ...this.source };
    delete this.mutated[k];
  }

  /**
   * Return the record. If never mutated, returns `source` by reference
   * (zero-allocation tick). Once mutated, returns the cloned record.
   */
  view(): Record<K, V> {
    return this.mutated ?? this.source;
  }

  /** True iff at least one set/delete has happened. Useful for tests. */
  isMutated(): boolean {
    return this.mutated !== null;
  }
}
