# GOAL — Zig `step_world` full-authority parity (the long shot)

**Status:** Active, in progress. Phase 0 shipped 2026-07-20 (4 commits, all independently
verified). Phases 1+ not yet started — this doc is the map for the rest.
**Scope boundary (hard, does not move without Jake explicitly saying so):** this goal makes
`step_world` honestly *capable* of running a full match — it does **not** flip
`USE_WASM_STEP_WORLD`/`?wasm-world` to default-on in production. That flip is a separate,
later, human-verification decision. It was tried once (2026-07-06) and reverted after real
live-playtest bugs that automated checks missed ("the TS version was great but the Zig
version is garbage" — Jake, quoted in `server/src/matchHost.ts:64-80`). Nothing in this doc
authorizes trying that again without a real playtest first.
**Also does not authorize:** reversing `docs/six-axes-goal.md`'s "Zig learns nothing new in
this goal" doctrine for the *production default path* — TS stays authoritative for
weapon/hit/ability/event resolution there, unconditionally. This goal only concerns
`step_world`, the opt-in alternate implementation. Porting the 40+ ability cards into Zig is,
by definition, extending what `step_world` can do — it does not touch what ships by default.
**Parents:** `docs/six-axes-goal.md` (the doctrine this respects and the line it draws),
`docs/adr/0006-zig-wasm-sim-substrate.md` (why this exists at all), `docs/zig-wasm-exports.md`
(current export surface, 144 functions as of the pre-Phase-0 audit).
**Origin:** Jake, 2026-07-20 — asked for a deep audit of Zig parity/superiority, then "go deep
on unwired stuff, make a goal to get it all in."

---

## Mission

`step_world` (`sim/src/world.zig`) is a real, substantial, independently-tested parallel
implementation of the arena combat loop — not a stub. But a 2026-07-20 exhaustive audit found
it was missing almost everything past the physics/collision/round-timer skeleton: **0 of the
40 class ability cards**, **both melee attacks entirely**, **the entire draft/offer system**,
**the deferred-write pattern that makes cross-player ability effects safe**, a novel entity
type (Paper Double), two newer per-class mechanics (Priest's tendril rework, Wizard's fire-rate
ramp), and a card-data model too thin to even *represent* an ability card (no `classId`,
`unique`, `maxStacks`, `rarity`, or `active.kind`/`cooldownMs` fields existed anywhere in
Zig's card table).

**Done for THIS goal =** `step_world` can run a genuine multi-round match end to end — draft
included — with every current ability, both melee attacks, and every entity type behaving
identically to the TS sim, verified by Zig's own test suite plus (where the wasm ABI carries
the relevant state) cross-checked against TS. Not flipped live. Ready to be.

---

## What this is not

| Not this | Why |
|---|---|
| A production cutover | Explicit scope boundary above. `USE_WASM_STEP_WORLD` stays off by default through and past this entire goal. |
| A rewrite of the doctrine for the default path | `docs/six-axes-goal.md`'s "Zig learns nothing new" still governs what ships to real players by default. This goal only grows the *opt-in* alternate. |
| A performance project | The 2026-07-20 audit found wasm-swapped `stepPlayer` is 6% *slower* than TS-native, RNG 3x slower — the whole substrate's value is cross-host determinism (comptime struct-size asserts, a shared trig LUT), not speed. Nothing in this goal should be justified on a perf claim without a fresh benchmark. |
| A balance pass | Every number ported from TS is ported AS-IS. If TS's own numbers are mid-tune (several are, this whole session), Zig mirrors whatever TS currently says, not what "should" be tuned — divergence-from-TS is the only bug class this goal cares about. |
| One giant PR | Each phase below ships as its own reviewable, independently-buildable, independently-tested commit (or small commit series) — matching how Phase 0 actually landed (4 separate commits, each `zig build && zig build test` green before the next started). |

---

## Locked doctrine for this goal

1. **TS is the source of truth for every port.** When Zig and a design doc disagree on a
   number, timing constant, or edge case, read the live TS code (`client/src/sim/World.ts`
   and friends), not memory, not an older doc, not this goal doc's own line-number citations
   (the file shifts — re-verify current line numbers before trusting old ones, as every phase
   in this doc's own history already had to).
2. **No dynamic allocation, fixed max + count, exactly like everything else in `sim/src/`.**
   Every new collection follows the established `MAX_X: usize` + `[MAX_X]T` + `count: usize`
   shape (see `MAX_PENDING_INSTANT_AOE`, `MAX_PAPER_DOUBLES` from Phase 0 for the precedent).
3. **Host-only state stays host-only.** Ability-window timers, swing-phase memory, and
   anything TS itself keeps off the wire (see `types.ts`'s own "never wire-encoded/hash-mixed"
   comments) gets a parallel host-only array (the `MeleeSwingMemory` pattern from Phase 0),
   never crammed into the comptime-size-asserted wire-contract structs.
4. **Correctness over completeness per phase.** A phase that ships 6 of 10 abilities fully
   correct, with the other 4 explicitly flagged as deferred in code comments, is a *better*
   commit than one that ships all 10 with 2 silently wrong. Same "honest partial over padded"
   discipline this whole session has used everywhere else.
5. **Every phase gets its own regression proof for the ONE property that actually matters.**
   Phase 0's AOE-queue phase didn't just test "damage applies" — it proved the *ordering*
   guarantee (a same-tick state change is visible to the deferred resolver). Every phase below
   names its own load-bearing property up front; find it, write the test that would fail
   loudly if that property regressed, don't just test the happy path.
6. **Investigate before assuming — every single phase in Phase 0 found the brief's own
   assumptions were wrong somewhere** (AbilityKind count, whether parry applies to melee, the
   codegen's silent filter bug). Treat every "per the audit" citation in this doc as a
   starting hypothesis to verify, not a fact.

---

## Phase 0 — Foundation (SHIPPED, 2026-07-20)

Four commits, each independently audited (`zig build && zig build test` clean, diffs
hand-read) before the next started:

| Commit | What it closed |
|---|---|
| `6aa0dc9` | 7 missing `ProjectileEntity` fields (bit-packed, no size growth); Wizard's fire-rate ramp (`PlayerEntity` 384→392 bytes) plus a bonus fix (haste multiplier was already a field but unread at the composition site); Paper Double's full entity mechanics (step, swept collision, compaction) — spawn-on-cast deliberately NOT wired yet (needs Phase 1). |
| `4340859` | The `PendingInstantAoe` deferred-write queue + resolver primitive (`world.zig` section "6b") — the architecture 5-6 abilities need, not the abilities themselves. Proved the one property that matters: a same-tick state change (a shield raised via input this tick) is visible to the deferred resolver, not a stale pre-tick snapshot. |
| `1f6b0cc` | Base melee for both classes — arc-hit-check, swing FSM, contact-delay gating, damage, mitigation (resolved *inline*, not deferred — investigated and confirmed Zig's per-player loop has none of TS's "frozen snapshot, commit whole record" hazard the AOE queue exists for). Corrected the brief's own wrong assumption: parry does NOT apply to melee in TS, verified directly against `combat.ts`, locked in with a test. Ability-card hooks into melee (Undercut, Judgment Line, etc.) deliberately NOT wired yet. |
| `110f825` | Extended Zig's card-data model — `CardMeta` (sibling to `CardMod`, not an extension of it) carrying `classId`/`unique`/`maxStacks`/`rarity`/`active{kind,cooldownMs,durationMs}` for every one of 104 cards. Fixed a real, previously-silent bug: the old codegen filtered out all 45 pure-ability cards from Zig entirely (`.filter(c => c.modifier)`), not just missing fields — zero presence. New 45-member `AbilityKind` enum (not 40 — verified against the live union, which had drifted since the original audit). |

**What Phase 0 does NOT do**: nothing casts yet. The data exists, the queue exists, melee
swings exist — but there is still no mechanism anywhere in Zig that reads "player pressed
ability slot 1, they have card X equipped, X has an active with kind Y and cooldown Z" and
dispatches to a resolution branch. That's Phase 1.

---

## Phase 1 — Ability-cast dispatch core (the next unblock)

**Why this is next, not straight into porting abilities**: every remaining phase needs SOME
way to actually trigger an ability. Building this once, generically, then wiring abilities
into it one at a time is far cheaper than each phase reinventing "how does a keypress become
a resolved effect."

**Scope:**
- A generic dispatch loop in `world.zig`: for each player, for each of the (currently 3)
  ability slots, on a rising edge of that slot's input bit — look up the equipped card's
  `CardMeta.active` (Phase 0's new field), check cooldown against a per-slot cooldown timer
  (needs a new host-side or wire-contract cooldown field — check whether `PlayerEntity`
  already has slot-cooldown fields from earlier TS parity work, e.g. `slot1CooldownUntilTick`
  equivalents; if absent, add them following the established growth pattern), and dispatch to
  a `switch (active.kind) { ... }` — initially with every arm as an explicit `// not yet
  ported` no-op, not missing arms (Zig's exhaustive-switch checking on an enum is exactly the
  safety net that makes "did I forget one" impossible to silently ship — use it).
- **First real abilities to wire, as proof the dispatch mechanism itself works end-to-end**:
  the melee-hook abilities (Undercut, Judgment Line, Unbroken Seal, Read Mark, Second Wind,
  Edge Storm's wave-off) since melee already exists (Phase 0) and these are pure consumption
  at an existing hit-resolution site, not new mechanics. Then the AOE-queue abilities (Wall
  Bloom, Shock Ring, Prism Fan, Flock Pulse, Shard Ring, Paper Double's burst) since the queue
  already exists (Phase 0) too.
- **Load-bearing property to test**: cooldown gating actually blocks a re-press mid-cooldown,
  and a slot with no card equipped (or an equipped card with no `active`) is inert, not a
  crash. This is the property that keeps a future "wire ability #23" pass from needing to
  re-derive cooldown-gating correctness every time.

**Explicitly deferred to later phases**: ally-targeted abilities (need `findNearestAlly`/
`isAlly`, doesn't exist in Zig — Phase 3), abilities needing a mark/window field not yet on
`PlayerEntity` (add incrementally, per-ability, following the established growth pattern —
don't pre-add 30 fields speculatively).

---

## Phase 2 — Draft/offer-roll system

Now unblocked by Phase 0's card-data model. Ports `client/src/sim/round.ts`'s `enterDrafting`
(currently `round.zig`'s own header comment says outright: *"Drafting transitions land in a
follow-on cut... Phase H7b after the data port"* — that's this phase).

**Scope, in the TS's own dependency order:**
1. Wire the dead `RoundPhase.drafting` branch (`round.zig`'s existing no-op wait-state) into a
   real transition: round-over → drafting → (offers resolved/expired) → countdown.
2. Candidate-pool filtering: exclude already-owned `unique` cards, cards at `maxStacks`, ability
   cards when the 3 rack slots are full, cards not matching the player's `classId`.
3. Weighted sampling: `winner`/`catch_up`/`standard` role classification, catch-up bucket/
   rarity boosts, bounded-dedupe 3-offer roll.
4. Ability pity-floor (force at least one ability offer if the hand holds zero actives).
5. Pick application: auto-pick-on-expiry for stragglers, write the pick into the player's card
   set (whatever Zig's equivalent of `player.cards`/`playerPatches` ends up being — check
   `card_count`/the existing partial-crossing noted in the PlayerEntity field audit before
   inventing a new mechanism).

**Load-bearing property**: a full multi-round match (3+ rounds) run entirely inside `step_world`
via hand-fed inputs produces a materially different, correctly-gated rack for a player who
picked ability cards vs. one who didn't — i.e. this isn't just "the phase transitions," it's
"the pick actually changes what Phase 1's dispatch loop sees equipped."

---

## Phase 3 — Ally-targeting substrate

A cross-cutting prerequisite several remaining abilities share (Aegis Share, Rally Light,
Borrowed Time, Glass Ward, Haste Gift all need it) — build once, not per-ability.

**Scope:** port `client/src/sim/team.ts`'s `isAlly` and whatever `findNearestAlly`-equivalent
World.ts's ability cases call (check exact helper names/signatures at each of the 5 call sites
before assuming one shared shape — some may want "nearest ally in range" vs. "all allies in
range," don't force a single helper if TS itself doesn't).

---

## Phase 4 — Remaining ability ports, sequenced by real dependency, not alphabetically

Everything left after Phases 1-3, grouped by what they need (not by class or role — several
class catalogs mix categories):

**4a. Self-only window buffs (no new substrate needed, cheapest remaining tier):**
Sunlance, Overclock, Measure, Recoil-step, Hard-aperture, Return-glass, Bastion-pulse,
Kindled-resolve, Ghost-guard, Self-lattice — each is "open a timed window on the caster,
consumed at an existing site" (fire-rate composition, shield-tick, etc. — several of these
sites Phase 0 already touched for the Wizard ramp, likely the exact same composition
call-sites need one more term each).

**4b. Targeting/marking (needs a caster-remembers-target field, small addition per-card):**
Facet-break, Focus-hex, Read-mark (the marking half — the melee-consumption half already
landed in Phase 1) — each writes a `targetId`/`markUntilTick` pair on the caster, consumed at
an existing hit-resolution site.

**4c. Movement (needs a collision-free-landing search — new substrate, build once):**
Slip-node, Plant-charge, Bulwark-step, Drift-step, Razor-route — port whatever "search for the
farthest/nearest collision-free point along a direction" helper TS's `World.ts` uses for
these (there's likely one shared shape here too, same "build the substrate once" logic as
Phase 3's ally-targeting).

**4d. Ally-targeted (needs Phase 3):** Aegis Share, Rally Light, Borrowed Time, Glass Ward,
Haste Gift.

**4e. Structurally distinct, port individually (each has its own real mechanic, no shared
substrate to build first):** Bleed Tithe (homing + fire, partially substrate-covered already
per the original audit — verify what's real vs. assumed), Severance, Contagion (jump-
targeting), Needle (auto-target lunge), Sunspike (the best-integrated ability projectile in
TS, per an earlier audit — should be the easiest of this group), Lattice (lingering-zone
queue, a THIRD deferred-write shape distinct from Phase 0's AOE queue — may warrant its own
small primitive, don't force it into the AOE queue's shape if TS itself doesn't).

**4f. Paper Double's actual cast-triggering.** Phase 0 built the entity mechanics; this wires
the `"paper-double"` ability-switch case (now possible once Phase 1's dispatch exists) to
actually spawn one.

---

## Phase 5 — Wire-contract cleanup (small, can run any time after Phase 0, low priority)

Independent of the ability-porting phases above — pure correctness/hygiene, safe to slot in
whenever convenient:

- Bridge the 7 new `ProjectileEntity` fields (Phase 0) across the wasm ABI to TS
  (`worldStateBridge.ts` or equivalent) — currently Zig-internal only, unused cross-boundary.
- Fix the stale `PLAYER_ENTITY_SIZE` constant on the TS side (still says 384, Phase 0 grew the
  real struct to 392) — flagged by Phase 0's own agent as "not touched, out of bounds," follow
  up before it causes a real ABI mismatch bug.
- Two accidental `PlayerEntity` field gaps the original audit found (real gaps, not
  doctrine-excluded): `wardShellUntilTick` and `regenTickLastApplied` — both have sibling
  fields that already crossed to Zig, these two were left behind for no apparent reason.
- Refresh `docs/zig-wasm-perf-baseline.md` (2.5 months stale, pre-dates the export-surface
  doubling) — not because this goal is about perf, but because a stale number sitting
  unbannered next to properly-bannered "superseded" docs is its own small honesty gap.
- One-line update to `CLAUDE.md`/`AGENTS.md` acknowledging `step_world`'s real growth since
  2026-07-08 (the "not live in production" conclusion stays correct, just the "how much exists"
  picture is stale for a reader coming in cold).

---

## Phase 6 — The actual finish line (not authorized to execute — human gate)

Once Phases 1-5 land and `step_world`'s own test suite proves full parity: this is the point
where flipping `USE_WASM_STEP_WORLD` to default-on in production becomes a real question worth
asking Jake, backed by genuine evidence instead of the 2026-07-06 attempt's thinner base. This
phase is **real, extensive human playtesting** (the exact bar the 2026-07-06 revert note set) —
not a tool-verifiable checklist, not something any agent should attempt to close by itself, and
not something to start without Jake explicitly asking for it. Every phase above stops short of
this on purpose.

---

## Sequencing note

Phases 1→2→3→4 are listed in dependency order, not necessarily execution order — 2 and 3 don't
depend on each other and could run in parallel once 1 lands, if there's appetite to parallelize.
4a-4f within Phase 4 are ALSO independent of each other once 1/3 land (they don't depend on
each other, only on the phases above them) — a good place to fan out multiple agents at once,
unlike Phase 0 where several items touched the same files and needed sequencing to avoid
collision. Re-evaluate file-overlap risk at execution time, not from this doc alone — the file
layout will have shifted by then.
