// Pure, Phaser-free planner for the Syzygist entanglement construct. Takes the
// snapshot WorldState + last frame's memo and returns WHAT to draw this frame —
// no GameObjects, no pool, no Phaser. The painter (ConstructVfxController) turns
// the plan into self-light via LightConstruct. This split is the north-star §5
// contract (presentation as an independent, testable layer over sim state) and
// mirrors renderContract/deathFx's pure-producer + carried-state pattern.
//
// The read (docs/presentation-overhaul-goal.md, Syzygist first): a cool-white
// thread from each priest to every fighter carrying their Focus Hex mark —
//   bind  a burst where a mark catches
//   hold  a breathing thread, re-emitted on a short cadence so it tracks both
//   feed  devotion motes crawling victim -> priest
//   snap  a burst where a mark lets go

import type { CharacterArchetype, PlayerId, Vec2, WorldState } from "../../sim";

// The tether is drawn EVERY frame into the controller's dedicated off-pool layer
// (not re-emitted as pooled transients — that starved the 4-bolt pool), so it
// needs no cadence. Motes are a steady trickle home on a slow cadence.
const MOTE_EMIT_MS = 150;

/** What to draw this frame. Empty arrays = nothing to emit. */
export type ConstructPlan = {
  tethers: { from: Vec2; to: Vec2; phaseSec: number }[]; // priest -> victim
  motes: { from: Vec2; to: Vec2 }[]; // victim -> priest
  binds: Vec2[]; // catch bursts
  snaps: Vec2[]; // release bursts
};

/** Frame-to-frame state the planner carries (like makeDeathFxState). */
export type EntanglementMemo = {
  moteCadence: Map<string, number>;
  active: Set<string>;
  lastVictimPos: Map<string, Vec2>;
  phaseSec: number;
};

export function makeEntanglementMemo(): EntanglementMemo {
  return {
    moteCadence: new Map(),
    active: new Set(),
    lastVictimPos: new Map(),
    phaseSec: 0,
  };
}

export function planEntanglement(
  state: WorldState,
  deltaMs: number,
  getPosition: (id: PlayerId) => Vec2 | undefined,
  resolveClassId: (characterId: CharacterArchetype) => string,
  memo: EntanglementMemo,
): ConstructPlan {
  memo.phaseSec += deltaMs / 1000;
  const plan: ConstructPlan = { tethers: [], motes: [], binds: [], snaps: [] };

  // Priests (the anchor) and marked victims (the bound), both alive & placed.
  const priests: { id: PlayerId; pos: Vec2 }[] = [];
  const victims: { id: PlayerId; pos: Vec2 }[] = [];
  for (const [pidStr, player] of Object.entries(state.players)) {
    if (!player.alive) continue;
    const pid = pidStr as PlayerId;
    const pos = getPosition(pid);
    if (!pos) continue;
    if (resolveClassId(player.characterId) === "priest") {
      priests.push({ id: pid, pos });
    }
    if (
      player.focusHexMarkUntilTick !== undefined &&
      player.focusHexMarkUntilTick > state.tick
    ) {
      victims.push({ id: pid, pos });
    }
  }

  // Each marked victim binds to its NEAREST priest. v1 attribution: the mark
  // field records no caster, so with 2+ priests we guess by proximity — exact
  // for the common single-priest fight, a known simplification otherwise.
  const live: Set<string> = new Set();
  const pairs: { key: string; priest: Vec2; victim: Vec2 }[] = [];
  for (const v of victims) {
    let best: { id: PlayerId; pos: Vec2 } | null = null;
    let bestD = Infinity;
    for (const pr of priests) {
      if (pr.id === v.id) continue; // no self-tether
      const dx = pr.pos.x - v.pos.x;
      const dy = pr.pos.y - v.pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = pr;
      }
    }
    if (!best) continue;
    const key = `${best.id}|${v.id}`;
    live.add(key);
    pairs.push({ key, priest: best.pos, victim: v.pos });
  }

  // bind — a pair that wasn't live last frame catches now.
  for (const pair of pairs) {
    if (!memo.active.has(pair.key)) plan.binds.push(pair.victim);
  }

  // snap — a pair that was live last frame and isn't now lets go.
  for (const key of memo.active) {
    if (!live.has(key)) {
      const at = memo.lastVictimPos.get(key);
      if (at) plan.snaps.push(at);
    }
  }

  // hold + feed — the tether is drawn every frame (persistent off-pool layer);
  // motes spawn on a slow cadence as pooled transients.
  for (const pair of pairs) {
    memo.lastVictimPos.set(pair.key, { x: pair.victim.x, y: pair.victim.y });
    plan.tethers.push({ from: pair.priest, to: pair.victim, phaseSec: memo.phaseSec });

    const m = (memo.moteCadence.get(pair.key) ?? 0) + deltaMs;
    if (m >= MOTE_EMIT_MS) {
      memo.moteCadence.set(pair.key, 0);
      plan.motes.push({ from: pair.victim, to: pair.priest }); // vitality home
    } else {
      memo.moteCadence.set(pair.key, m);
    }
  }

  // Retire bookkeeping for pairs no longer live.
  for (const key of memo.moteCadence.keys()) {
    if (!live.has(key)) memo.moteCadence.delete(key);
  }
  for (const key of memo.lastVictimPos.keys()) {
    if (!live.has(key)) memo.lastVictimPos.delete(key);
  }

  memo.active.clear();
  for (const key of live) memo.active.add(key);

  return plan;
}
