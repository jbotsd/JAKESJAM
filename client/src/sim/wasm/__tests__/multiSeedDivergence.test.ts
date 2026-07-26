// Track Z0a (convergence-goal.md) — port of orphaned-branch commit 5e1676a's
// multiSeedDivergence.test.ts: the deepest correctness check in the Zig-e2e
// investigation. Drives a REALISTIC multi-player, multi-tick, multi-seed
// scripted match through BOTH orchestrators in lockstep (same inputs fed to
// each, every tick) and measures how far apart their full game state drifts.
// This is fundamentally different from every other parity test in this suite,
// which checks ONE isolated concern (a single weapon fire, a single
// fire-hazard spawn). Nothing else here exercises hundreds of consecutive
// ticks of movement + combat interacting the way a real match actually does.
//
// This test is Track Z's convergence METER, not a proven-green gate. Z0b
// (2026-07-23) ported fast-respawn round semantics + muzzle geometry +
// the shrink-zone storm and got finals down to 329/185/445/278/361px
// (from 1067/217/867/1043/376 at the Z0a baseline), leaving two evidenced
// hypotheses: the missing fire-recoil substrate and the un-ported
// tick-order reorder. Z0c (2026-07-23) built BOTH and the meter got
// WORSE — recorded honestly, with the per-item split:
//
//   Z0c BEFORE (Z0b's after):   AFTER Item A (recoil):  AFTER A+B (reorder):
//   seed=1     : final  329px | final 1696px           | final 1696px
//   seed=42    : final  185px | final 1562px           | final 1562px
//   seed=1337  : final  445px | final 1246px           | final 1246px
//   seed=90210 : final  278px | final 1661px           | final 1661px
//   seed=271828: final  361px | final  898px           | final 1147px
//
// What the numbers do NOT mean: the ports themselves are wrong. Both are
// proven at the micro level — the recoil kick is bit-identical per shot
// (throwaway TS-vs-Zig probe during Z0c: shooter vx/vy equal to 1e-9),
// and a shot fired at tick T now travels the IDENTICAL distance on both
// sides at T (tickOrderParity.test.ts asserts full position+age equality,
// 47.3221px both sides — its old "Zig integrates one tick late" carve-out
// is deleted). Pre-death samples confirm it: t=60 deltas are equal or
// slightly better than Z0b's on every seed. Item B on top of Item A
// changed almost nothing in this sweep (one sample on one seed) — the
// one-tick flight skew was never this harness's dominant term.
//
// Why the finals exploded anyway — the NEXT evidenced hypothesis, both
// halves verified in-code during Z0c: the blowup starts at the FIRST
// death-timing disagreement on every seed and never re-converges, because
// (1) TS grants the round's first-blood killer a PERSISTENT 1.15x
// move-speed multiplier (World.ts:2532 `firstBloodMul`, round.ts:37
// FIRST_BLOOD_SPEED_MULTIPLIER) with NO Zig mirror at all (grepped: the
// only `first_blood` in sim/src is a comment) — after the first kill the
// TS-side killer walks 15% faster than its Zig twin for the REST of the
// round, a sustained divergence engine that recoil's velocity coupling
// now compounds on every shot (before Z0c the un-kicked Zig shooter's
// friction-anchored drift plateaued near 161-330px; kicks at
// slightly-different muzzle angles turn that plateau into growth); and
// (2) respawn seat choice is position-dependent (assignedSpawnPoint's
// greedy farthest-from-roster placement, mirroring TS assignSpawnPoints)
// — once death ticks diverge, the two sims re-seat the same player at
// DIFFERENT spawn seals, which is exactly the 1400-1700px step-plateaus
// in the samples. First-blood is the next port target; it is small,
// self-contained state (round.firstBloodPlayerId + one speed_mul term).
//
// Z0d (2026-07-23) built exactly that port — first-blood is now fully
// mirrored (WorldStateHeader.first_blood_idx_plus1 + the section-4/chain
// award sites + both round-machine clears + the speed_mul term + bridge
// round-trip and the first_blood wasm event; firstBloodParity.test.ts
// proves claim tick, claimant, clearing semantics, AND an exactly-equal
// boosted steady-state step across the boundary) — and the meter did not
// move:
//
//   Z0d BEFORE (Z0c's after):    AFTER first-blood mirror:
//   seed=1     : final 1696px  | final 1696.0px
//   seed=42    : final 1562px  | final 1561.8px
//   seed=1337  : final 1246px  | final 1246.4px
//   seed=90210 : final 1661px  | final 1667.5px
//   seed=271828: final 1147px  | final 1147.1px
//
// VERDICT: hypothesis MISS at the meter level. The mechanism was real and
// is proven ported at the micro level, but it never got the chance to be
// this harness's dominant term: every seed crosses 200px of divergence
// within 98-171 ticks (1.6-2.9s) while health/alive mismatches are still
// ZERO — movement alone forks the sims long before the first death, so a
// per-round post-kill 15% walk-speed edge is noise here.
//
// Why movement forks — the NEXT evidenced hypothesis, all three legs
// verified in-code during Z0d: the full-sync path ZEROES Zig's movement
// MEMORY every tick. packWorldState never writes the player_movement
// parallel array (worldStateBridge.ts leaves that region zero-filled in
// the packed buffer; unpack just skips it), and runWasmStepSync /
// serverWasmHost overwrite the ENTIRE WorldState buffer with that packed
// image before every step_world call — so Zig's stepPlayer runs every
// tick with grounded_last_frame=false and blank coyote/jump-buffer/
// air-jump/dash memory, while TS's runtime.movement Map persists the real
// memory across ticks. Concretely (probed while building
// firstBloodParity.test.ts): (1) grounded players accelerate with
// AIR_ACCELERATION instead of GROUND_ACCELERATION (player.zig:312) —
// measured ramp 0.65 vs 0.86 px/tick^2, a bounded ~23px offset per
// movement burst; (2) ground friction never applies (player.zig:314) — an
// idle post-recoil shooter keeps vx=-92.9 on the Zig side while TS decays
// it 60/tick; (3) ground jumps are IMPOSSIBLE Zig-side (every jump branch
// gates on grounded/coyote/air-jump memory) while this sweep's scripted
// bots press Jump on ~10% of ticks — each press forks the two sims'
// y-trajectories outright. The fix is small and mechanical — persist the
// movement-memory region across packs (copy it back from the prior
// wasm-side state after heap.set, or pack/unpack it like any other
// array) — but it touches BOTH hosts' pack cadence, a substrate change
// that is its own track item, not part of Z0d's one-item scope.
//
// Z0e (2026-07-23) built exactly that — the bridge now packs AND unpacks
// the player_movement parallel array (worldStateBridge.ts, keyed by
// player id via the new `WorldState.movementMemory` carrier; both hosts'
// mergeUnpacked ride it between packs; movementMemoryBridge.test.ts
// proves layout vs wasm's @offsetOf, codec round-trip, and the Z0d probe
// shape as a lockstep gate: idle vx decays to exactly 0 both sides,
// ground jumps fire again) — and the meter moved MORE than any port so
// far, the largest tightening of the whole harvest:
//
//   Z0e BEFORE (Z0d's after):    AFTER movement-memory bridge:
//   seed=1     : final 1696.0px | final  376.5px
//   seed=42    : final 1561.8px | final  196.2px
//   seed=1337  : final 1246.4px | final  449.6px
//   seed=90210 : final 1667.5px | final  280.4px
//   seed=271828: final 1147.1px | final  378.0px
//
// VERDICT: hypothesis CONFIRMED. Onset of >200px divergence moved from
// 98-171 ticks (1.6-2.9s, pre-death, movement-only) out to 181-309 ticks
// (3.0-5.2s), and the t=60 samples now read 0.0-23.5px (previously
// 60-160px+): movement alone no longer forks the sims. Finals now sit
// BELOW the orphan branch's own observed steady state (595-1,084px on
// its 2026-07-14 codebase). LIVE-MODE IMPLICATION, confirmed in-code:
// this was never harness-only — matchHost's USE_WASM_STEP_WORLD path
// and the client's ?wasm-world=2 path both repack every tick, so live
// Zig authority ran with no ground friction, ground-jumps impossible,
// and air-acceleration on the ground — a direct mechanical explanation
// for part of the 2026-07-06 "wrong-feeling movement / Zig version is
// garbage" verdict that reverted the Zig default.
//
// NEXT evidenced hypothesis (Z0e observations): the remaining pattern is
// step-plateaus (recurring ~160-164px and larger) whose onsets coincide
// with health/alive-mismatch windows — death-TICK disagreements (small
// residual combat deltas: seed=1337 already shows healthΔ=14.4 at t=60
// while positions still track within 8px, i.e. borderline hit-resolution
// flips) amplified by position-dependent respawn seating (Z0c finding
// (2): once death ticks diverge, assignedSpawnPoint's farthest-from-
// roster greedy re-seats the same player at DIFFERENT seals). The dead-
// player frozen-position gap + seat gap dominate every sample >150px.
// Also known and deliberately NOT fixed here (same bug class, separate
// item): the melee_swing parallel array is still zeroed by every pack —
// irrelevant to this sweep (scripted bots never melee) but the swing FSM
// can never leave windup on the live wasm path.
//
// Z1a (2026-07-24) closed three Z1 items — all CORRECTNESS items whose
// code paths this sweep structurally cannot exercise, and the meter says
// exactly that:
//
//   Z1a BEFORE (Z0e's after):     AFTER items 1+2+3:
//   seed=1     : final  376.5px | final  376.5px (onset 230)
//   seed=42    : final  196.2px | final  196.2px (onset 267)
//   seed=1337  : final  449.6px | final  449.6px (onset 309)
//   seed=90210 : final  280.4px | final  280.4px (onset 267)
//   seed=271828: final  378.0px | final  378.0px (onset 181)
//
// VERDICT: byte-identical, and that is the EXPECTED reading, not a miss —
// each item's trigger is absent from this harness by construction:
//   1. melee_swing bridged (Z0e's sibling finding above, CLOSED — the
//      swing FSM survives the repack; meleeSwingMemoryBridge.test.ts's
//      lockstep gate proves both sides resolve melee on the same tick):
//      scripted bots never melee here.
//   2. class-scaled combat hitboxes mirrored into Zig (combat.zig
//      combatHitboxScale — melee arc, dash-through, projectile, fire-
//      patch; combatHitboxScaleParity.test.ts): every bot in this sweep
//      is characterId "balanced", scale 1.0, boxes byte-identical.
//   3. ally substrate (isAlly + findNearestAllyIdx + hasRallyLightSource)
//      + Aegis Share / Rally Light / Borrowed Time / Glass Ward ported
//      (smoke.zig's "ally substrate" suite; allySubstrateBridge.test.ts),
//      incl. the haste move-multiplier ride-along fix in Zig's speed_mul
//      chain: this sweep is FFA (isAlly always false) with no equipped
//      abilities.
//
// NEXT evidenced hypotheses recorded by Z1a's own digging — the SAME
// wipe-on-repack bug class Z0e/Z1a-item-1 fixed, in WIDER families,
// verified in-code against packWorldState/runWasmStepSync:
//   (a) the entire Zig-only PlayerEntity tail span [384, 620) — EVERY
//       Phase-4 ability window (sunlance/overclock/measure, facet/focus/
//       judgment/read marks, kindled_resolve, ghost_guard, razor_route,
//       undercut, edge_storm, seal, second_wind, channel_hold_ms...) is
//       zero-filled by every pack: under live full-sync wasm authority
//       every cast window is ONE-TICK-ONLY. (Z1a's four new fields were
//       bridged at [632, 656) precisely to not join this family; Z1a
//       also fixed self_lattice's missing has_syz_ward flag, whose
//       absence wiped its ward pool the same way.)
//   (b) player_equipped_actives is zero-filled by every pack too (bridge:
//       "Skipped for now") — under full-sync, ability EQUIPMENT is
//       stripped every tick, so no ability can be cast at all on the
//       live wasm path; smoke.zig drives casts through raw stepWorld
//       instead.
//   (c) client runWasmStepSync writes fire configs BEFORE the pack
//       overwrites that region (server's serverWasmHost writes them
//       AFTER pack, correctly ordered) — all-starter-pistol harnesses
//       mask it; carded clients on ?wasm-world=2 would lose their
//       builds.
// Together (a)+(b) mean "abilities under live wasm authority" is a
// substrate track item (bridge the tail span + equipment), not an
// ability-by-ability port question.
//
// Z1b + Z2 (2026-07-24) closed exactly that substrate — findings (a),
// (b), (c) plus the Z2 server-honesty items that share the same files.
// BASELINE NOTE first: this slice branched from a later main than Z1a's
// recorded run (the Kindled K5 amplitude retune + "Geometrician is
// ALWAYS raycast" merges moved 4 of 5 seeds), so the honest before
// column is the fork-point re-run, not Z1a's table:
//
//   Z1b BEFORE (fork re-run):        AFTER (a)+(b)+(c)+Z2:
//   seed=1     : final  376.5px (230) | final 376.5px (onset 230)
//   seed=42    : final  247.5px (175) | final 258.5px (onset 175)
//   seed=1337  : final  222.9px (262) | final 219.2px (onset 262)
//   seed=90210 : final  762.1px (144) | final 762.7px (onset 144)
//   seed=271828: final  433.7px (229) | final 360.6px (onset 180)
//
// VERDICT: essentially flat, small mixed movement — the EXPECTED
// reading, same shape as Z1a's: this harness's bots hold zero cards and
// cast zero abilities, so the closed items (every [384,620) ability
// window bridged field-level; equipped-actives/hand/fire-config loadout
// delivered post-pack via resolve_player_loadout; the client's pre-pack
// fire-config ordering fixed; Zig-owned drafting + full event
// forwarding server-side) are structurally invisible here except two
// ride-alongs that ARE visible: (1) the wizard fire channel
// (channel_hold_ms) now survives the repack, so Zig's GEO ramp accrues
// like TS's; (2) the "balanced"(=wizard) bots' class-aware resolved
// config now actually reaches step_world (the old path stepped on the
// valid=0 starter fallback every tick), so BOTH sides now fire the
// geo-raycast delivery instead of TS-raycast-vs-Zig-projectile. Those
// two nudged 4 seeds by <75px in both directions (271828's onset moved
// earlier but its final tightened 73px). The real Z1b/Z2 wins are
// proven at their own gates instead: abilityWindowBridge.test.ts,
// loadoutBridge.test.ts, draftOfferParity.test.ts (offers byte-identical
// + tick-identical draft timing for the same seed),
// matchHostZigDraft.test.ts, matchHostWasmEvents.test.ts.
//
// Z1c item 1 (2026-07-24) closed exactly the hitscan-resolve gap Z1b's own
// note above named: world.zig's fire site now branches on the resolved
// `delivery` field (weapon_build.zig) instead of ignoring it, so a
// raycast build (every "balanced"=wizard bot in this harness — none hold
// cards, so none have flipped delivery) resolves same-tick hitscan damage
// in Zig too, matching World.ts's resolveHitscanShot/resolveRangedHit
// instead of spawning a traveling ProjectileEntity that lands its hit on
// some LATER tick:
//
//   Z1c BEFORE (Z1b's after):        AFTER (hitscan resolve + headshot):
//   seed=1     : final  376.5px (230) | final  376.5px (onset 230)
//   seed=42    : final  258.5px (175) | final  247.5px (onset 175)
//   seed=1337  : final  219.2px (262) | final  230.0px (onset 249)
//   seed=90210 : final  762.7px (144) | final  274.2px (onset 160)
//   seed=271828: final  360.6px (180) | final  437.9px (onset 229)
//
// VERDICT: mixed, not uniformly better — the honest reading, not a clean
// win. seed=90210 improved dramatically (762.7px → 274.2px, the biggest
// single-seed swing in this file's whole history), consistent with the
// hypothesis this item targets: a same-tick hit no longer disagrees with
// a delayed-travel-time one on WHICH tick a kill lands, which is exactly
// the kind of one-tick death-timing fork this file's own header already
// names as the dominant divergence engine (different death tick → the
// two sims re-seat respawns at different spawn seals → the sample-window
// frozen-position gap this whole sweep tracks). seeds 1337/271828 got
// modestly WORSE (11-77px) — plausible explanations not yet isolated:
// this is a v1 hitscan port (see resolveHitscanFire's own scope-note doc
// comment in world.zig — decoys/destructibles/impact-AOE/split-spawn/the
// shooter-side amp chain/mirror-shield reflect/Ghost Guard evasion are
// all deliberately unported), so a shot that WOULD have been suppressed
// or amplified by one of those mechanics on the TS side now resolves
// through a plainer chain in Zig, which can just as easily shift a
// death tick EARLIER as it can align it. seed=1's identical onset/final
// (zero cards fired that round before the recorded window, or the first
// divergent hit happened to be identical either way) is the null case,
// not a regression signal. Recorded honestly per this file's own meter
// contract — the CORE claim (same-tick hit resolution, headshot
// agreement) is proven exactly, not statistically, by
// hitscanResolveParity.test.ts and combatHitboxScaleParity.test.ts;
// THIS file only ever measured aggregate full-match drift, never
// per-mechanic correctness.
//
// Still open on the Z1 list (Z1c's remaining items, deliberately
// untouched this pass): six-axes axis payloads, team peel, ninja dash
// i-frames, Kindled Ward partial mitigation, contagion self-jump guard.
//
// Z1c "six-axes axis payloads" — leech (2026-07-24): appended
// `ResolvedFireConfig.leech_fraction`, consumed at both the real-projectile
// spawn/hit site and the hitscan resolve site, plus the chassis-aware
// max-health cap fix (was a flat 100 — see world.zig's leech-application
// comment). Contagion's self-jump guard (item 6) was already closed the
// same pass as item 1 (see the ledger row above); this is the actual
// six-axes-payloads item named in the "still open" note directly above:
//
//   BEFORE (item 1's after, unchanged): AFTER (leech + cap fix):
//   seed=1     : final  376.5px (230) | final  376.5px (onset 230)
//   seed=42    : final  247.5px (175) | final  247.5px (onset 175)
//   seed=1337  : final  230.0px (249) | final  230.0px (onset 249)
//   seed=90210 : final  274.2px (160) | final  274.2px (onset 160)
//   seed=271828: final  437.9px (229) | final  437.9px (onset 229)
//
// VERDICT: byte-identical, EXPECTED — this harness's bots are cardless
// (same header note as Z1a/Z1b above), and the only card that carries a
// nonzero `leechFraction` today (Stolen Fangs, `classModifiers.priest`) is
// both class-gated AND behind a documented, separate classModifiers-codegen
// gap (see world_state.zig's `leech_fraction` field doc comment and
// `fireConfigShared.ts`'s `patchLeechFraction` stopgap) — structurally
// invisible to a cardless sweep, same shape as every prior "flat, expected"
// entry in this ledger. The real proof is at its own gate:
// leechFractionParity.test.ts (a Priest build with Stolen Fangs + a
// max-health card leeches identically on both engines, capped at the real
// 120 max health, not the old flat 100).
//
// Z1c "team peel" (2026-07-24): world.zig's new `findTeamPeelWarderIdx`/
// `applyTeamPeel` (combat.zig's `isAllyBodyInWardCone`/
// `computeTeamPeelMitigation`), wired into all four hit sites (real-
// projectile, hitscan, resolveInstantAoeCasts, stepMeleeSwing):
//
//   BEFORE (leech's after, unchanged): AFTER (team peel):
//   seed=1     : final  376.5px (230) | final  376.5px (onset 230)
//   seed=42    : final  247.5px (175) | final  247.5px (onset 175)
//   seed=1337  : final  230.0px (249) | final  230.0px (onset 249)
//   seed=90210 : final  274.2px (160) | final  274.2px (onset 160)
//   seed=271828: final  437.9px (229) | final  437.9px (onset 229)
//
// VERDICT: byte-identical, EXPECTED — this harness's bots are FFA (no
// `teamId` set anywhere in its roster construction), and `isAlly`/
// `findTeamPeelWarderIdx` both fail closed for any player without a team
// id (same "true no-op outside team modes" contract TS's own
// `findTeamPeelWarder` doc comment states) — structurally invisible here,
// same shape as Z1a's ally-substrate entry above. The real proof is at its
// own gate: teamPeelParity.test.ts (an eligible Warder mitigates a
// teammate's hit identically on both engines — 60% blocked, Kindling
// granted — and a control case with the Warder facing away shows zero
// peel on both engines too).
//
// Z1c "ninja dash i-frames" (2026-07-24): world.zig's new `isNinjaEvading`
// (`state.player_movement[idx].dash_active_ms > 0.0` + sprinter class),
// wired ahead of Ghost Guard at all four hit sites (real-projectile,
// hitscan, resolveInstantAoeCasts, stepMeleeSwing):
//
//   BEFORE (team peel's after, unchanged): AFTER (ninja dash i-frames):
//   seed=1     : final  376.5px (230) | final  376.5px (onset 230)
//   seed=42    : final  247.5px (175) | final  247.5px (onset 175)
//   seed=1337  : final  230.0px (249) | final  230.0px (onset 249)
//   seed=90210 : final  274.2px (160) | final  274.2px (onset 160)
//   seed=271828: final  437.9px (229) | final  437.9px (onset 229)
//
// VERDICT: byte-identical, EXPECTED — this harness's bots are all
// "balanced" (wizard) per the header's own repeated note, never Ninja
// (sprinter), so `isNinjaEvading`'s class gate fails closed for every bot
// here regardless of dash state — structurally invisible, same shape as
// every class-gated entry in this ledger. The real proof is at its own
// gate: ninjaDashIframesParity.test.ts (a dashing Ninja evades a hitscan
// hit AND a real injected ProjectileEntity hit identically on both
// engines; three control cases — non-dashing Ninja, dashing non-Ninja —
// prove the gate isn't an always-evade bug).
//
// Z1c "Kindled Ward partial mitigation" (2026-07-24), the FOURTH and final
// item on the Z1 list: world.zig's new Paladin-specific branch inside
// every "shield_active" check (`combat.isSourceInWardCone`/
// `combat.computeKindledWardMitigation`), replacing the generic 100%-block
// for Paladin (partial + Kindling, cone-gated) and excluding Ninja
// entirely (shield never mitigates, dash i-frames only) at all four hit
// sites:
//
//   BEFORE (ninja i-frames' after, unchanged): AFTER (Kindled Ward):
//   seed=1     : final  376.5px (230) | final  376.5px (onset 230)
//   seed=42    : final  247.5px (175) | final  247.5px (onset 175)
//   seed=1337  : final  230.0px (249) | final  230.0px (onset 249)
//   seed=90210 : final  274.2px (160) | final  274.2px (onset 160)
//   seed=271828: final  437.9px (229) | final  437.9px (onset 229)
//
// VERDICT: byte-identical, EXPECTED — this harness's bots are all
// "balanced" (wizard), never Paladin (heavy) or Ninja (sprinter), and the
// PRE-EXISTING generic 100%-block path (Wizard/Priest) is explicitly
// UNCHANGED by this item (proven by kindledWardMitigationParity.test.ts's
// own regression case) — structurally invisible here. The real proof is
// at its own gate: kindledWardMitigationParity.test.ts (a Paladin facing
// the threat takes the mitigated 40% + banks Kindling identically on both
// engines; three control cases — Paladin facing away, Ninja's shield,
// Wizard's unaffected generic block — prove every gate, not a uniform
// nerf/buff). This closes the Z1 list Z1c opened with six items (six-axes
// axis payloads, team peel, ninja dash i-frames, Kindled Ward partial
// mitigation, plus item 1's hitscan resolution + headshot band and the
// contagion self-jump guard, both merged earlier) — zero remaining.
//
// Z3 (2026-07-26) — sweep until dry: the first true COVERAGE pass over
// this meter, distinct from every entry above (each of which measured ONE
// port's before/after on the same fixed 5 seeds). No sim code changed for
// this entry — the canonical SEEDS=[1,42,1337,90210,271828] table below
// was re-run first and came back byte-identical to Z1c's last row (376.5 /
// 247.5 / 230.0 / 274.2 / 437.9px, onsets 230/175/249/160/229), confirming
// the codebase is unchanged since Z1c. The sweep then drove the SAME
// harness logic (runOneSeed, byte-for-byte copy) across 500 ADDITIONAL
// seeds the canonical 5 never cover, in 8 rounds, tracking two running
// maxima (worst FINAL divergence, worst MID-MATCH sample) plus any bound
// break (>=2000px or non-finite) as the "new divergence" signal:
//
//   round 1 (seeds      2-    51, 50 seeds):   worst final 1669.3px
//     (seed=45), worst mid-match sample 1877.3px (seed=45)
//   round 2 (seeds   1000-  1049, 50 seeds):   worst final 1163.2px
//     (seed=1029) — no new ceiling
//   round 3 (seeds  90000- 90049, 50 seeds, near canonical 90210's order):
//     worst final 1267.1px (seed=90040) — no new ceiling
//   round 4 (seeds 271800-271849, 50 seeds, near canonical 271828's order):
//     worst final 1168.4px (seed=271833) — no new ceiling
//   round 5 (seeds 500000-500049, 50 seeds):   worst final  669.2px
//     (seed=500004) — no new ceiling
//   round 6 (seeds 999950-999999, 50 seeds):   worst final  487.6px
//     (seed=999997) — no new ceiling
//   round 7 (100 seeds, uniform-random over [0, 2^31)): worst final
//     1367.3px (seed=1027092698) — no new ceiling
//   round 8 (100 seeds, uniform-random over [0, 2^31)): worst final
//     1387.8px (seed=673305906) — no new ceiling
//
// No round ever broke the 2000px bound or produced a non-finite delta.
// Round 1 WAS new information — its 1669.3/1877.3px ceiling sits far above
// anything the canonical 5 seeds show (their worst final is 437.9px,
// seed=271828) — recorded honestly rather than folded away. Rounds 2-8
// (SEVEN consecutive rounds, well past the 2-consecutive bar this doc's
// acceptance requires) never exceeded round 1's ceiling. VERDICT: DRY.
// The meter's true worst-case shape, given today's unchanged code, tops
// out around 1,670-1,880px — meaningfully closer to the 2,000px assertion
// bound than the 5 canonical seeds alone ever suggested, but still inside
// it on every one of 505 seeds tried (5 canonical + 500 swept). This is a
// coverage finding, not a code change: the canonical 5 remain the
// permanent CI gate (fast, already characterized in the ledger above); the
// 500 swept seeds ran through a throwaway driver
// (`_z3_sweep_scratch.ts`, deleted after this run, never committed — this
// file's own SEEDS array was not widened, to keep CI runtime the same)
// built specifically to answer whether a wider seed population hides a
// failure mode the fixed 5 miss. On this pass, it doesn't — up to the
// bound's own margin. Whoever next touches the death-timing/respawn-
// reseat divergence engine this file's header already names (the
// dominant driver of every entry above) should know the real ceiling is
// ~1.7-1.9k px, not the ~440px the canonical seeds alone imply.
//
// If the sweep exceeds its bound, the per-seed record above is the
// deliverable the next track consumes.
//
// Z5 (2026-07-26) — the residuals Z1c documented rather than hid, item 1
// (kindled_resolve cast wired) + item 2 (all 9 classModifiers-codegen-gap
// cards now cross) + item 3 (hitscan v1 scope cuts: shooter-side amp
// chain + Ghost Guard, mirror-shield retrace, impact-AOE routing for the
// player-hit case — 3 of 5 sub-items; decoy/destructible candidates and
// split-spawn remain open, see world.zig's "Hitscan resolution" section
// header). Re-ran byte-identical to Z3's row (376.5/247.5/230.0/274.2/
// 437.9px, same onsets) — expected: this sweep's bots are all "balanced"
// (wizard), so every class-gated fix here (Paladin's Kindled Resolve,
// Ninja's Ghost Guard, the classModifiers cards' non-wizard readings, the
// Mirror Shield card, explosive/slow-field impact cards) is structurally
// invisible to bots that never equip or qualify for any of them — the
// SAME "cardless/class-blind bots can't exercise a class-gated fix" note
// every prior class-scoped entry in this ledger already records.
//
// Harness-fidelity lessons KEPT from the branch (5e1676a + 3f16fe3):
//   - setWorldArenaBounds is called (5e1676a's root-cause fix: without it,
//     Zig's void kill-plane gate is never armed → a player who falls off the
//     map dies in TS but falls forever in Zig → unbounded fake divergence).
//   - Module-level wasm state is PINNED per seed run (3f16fe3's warning: the
//     wasm module + TS backend caches are shared across every test file in
//     one bun process — statics/pads/slopes/target-score left behind by
//     another file would corrupt this measurement).
// Adaptations beyond the branch spec, closing harness gaps it still had
// (each one is a place the branch measured harness artifacts, not sim):
//   - REAL statics are wired to Zig (platformToAABB of the same MAP the TS
//     runtime collides against). The branch passed setWorldStatics([], [])
//     while TS kept the floor via its collision cache — a one-sided terrain
//     gap of exactly the kind 5e1676a itself diagnosed.
//   - setWorldLaunchPads([]) / setWorldSlopes([]) — mirrors production
//     syncWorldStaticsToWasm's always-clear cadence.
//   - setWorldTargetScore(resolveModeConfig(...)) — mirrors matchHost's
//     Z0a wiring; also pins the module cache against cross-file leakage.
//   - TRUE prevKeys are fed to Zig (branch hardcoded prevKeys: 0, making
//     every held key look freshly-pressed to Zig's edge-triggered jump/fire
//     while TS tracked real prev-keys via runtime.prevKeys).
//   - setWorldMapSize does not exist on main (the branch used it for
//     fire-hazard chaos positioning; this sweep runs no chaos modifiers) —
//     dropped, nothing consumes it here.
//
// Player movement is routed through the SAME compiled wasm stepPlayer on
// BOTH sides (TS's Layer-F backend swap, default-on in production — see
// runtime.ts applyWasmPlayerFlag). Any divergence found is attributable to
// orchestration-level differences (weapon fire, projectile motion, combat
// resolution, round machine), not movement-kernel drift, which
// longHorizonCanary covers separately.
//
// Deliberately does NOT assert byte-identity — two independently maintained
// orchestrators are not bit-exact and claiming so would be dishonest. It
// MEASURES and REPORTS divergence magnitude/onset per seed: either the
// numbers are small and bounded (strong evidence) or they're a concrete,
// reproducible failure with an exact seed to investigate next.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm"))
    return Promise.resolve(
      new Response(ab as ArrayBuffer, { headers: { "Content-Type": "application/wasm" } }),
    );
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();
await applyWasmPlayerFlag(); // TS movement now runs the SAME wasm stepPlayer Zig uses

const PLAYER_COUNT = 4;
const DT_MS = 1000 / 60;
const TICKS = 1200; // 20 real seconds at 60Hz — long enough for many fire/move cycles
const MAP: MapDefinition = {
  id: "divergence-test-arena",
  name: "Divergence Test Arena",
  size: { x: 1600, y: 900 },
  spawns: Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    x: 300 + i * 250,
    y: 400,
  })),
  platforms: [
    // Center-origin (platformToAABB convention): spans x 0..1600, top at
    // y=700 — a full-width floor under every spawn. The branch's floor def
    // ({x:0,y:700}) only covered HALF the arena under this convention.
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const LeftBit = 1 << 0;
const RightBit = 1 << 1;
const JumpBit = 1 << 4;
const FireBit = 1 << 6;

/** Deterministic per-player LCG — same scripted-bot pattern as
 *  tests/e2e/playtest-bots.spec.ts, reimplemented here since that file runs
 *  under Playwright, not bun:test. */
function makeLcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function scriptedInputsForTick(
  seed: number,
  tick: number,
  playerIds: string[],
): Map<string, { keys: number; aimX: number; aimY: number }> {
  const out = new Map<string, { keys: number; aimX: number; aimY: number }>();
  for (let pi = 0; pi < playerIds.length; pi++) {
    const rng = makeLcg(seed * 7919 + pi * 104729 + Math.floor(tick / 30));
    const r1 = rng();
    const r2 = rng();
    let keys = 0;
    if (r1 < 0.35) keys |= LeftBit;
    else if (r1 < 0.7) keys |= RightBit;
    if (r2 < 0.1) keys |= JumpBit;
    if (rng() < 0.4) keys |= FireBit;
    out.set(playerIds[pi]!, {
      keys,
      aimX: 200 + rng() * 1200,
      aimY: 300 + rng() * 300,
    });
  }
  return out;
}

function makePlayer(id: string, x: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 400,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

type DivergenceSample = {
  tick: number;
  maxPositionDeltaPx: number;
  maxHealthDelta: number;
  aliveMismatchCount: number;
};

async function runOneSeed(seed: number): Promise<{
  samples: DivergenceSample[];
  finalMaxPositionDeltaPx: number;
  firstBigDivergenceTick: number | null;
}> {
  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) => `p${i}`);

  // TS side
  const runtime = createRuntime(MAP);
  let tsState: WorldState = {
    tick: Tick(0),
    rngState: seed,
    players: Object.fromEntries(
      playerIds.map((id, i) => [PlayerId(id), makePlayer(id, 300 + i * 250)]),
    ) as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: { phase: "fighting", countdownRemainingMs: 90_000, scores: {}, roundIndex: 1, winnerPlayerId: null },
  };

  // Zig side — identical initial state, different object identity. Pin ALL
  // module-level wasm state per seed run (3f16fe3): the wasm instance + TS
  // backend caches are shared across every test file in this bun process.
  // Statics are the REAL floor — the exact AABBs the TS runtime's collision
  // cache is built from (createRuntime → buildStaticCache over the same
  // platforms) — so neither side has terrain the other lacks.
  setWorldStatics(
    MAP.platforms.map(platformToAABB),
    MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  // Arena bounds (ceiling clamp + void kill-plane) — 5e1676a's root-cause
  // fix, mirrored from what syncWorldStaticsToWasm always does in
  // production. Without the kill-plane, Zig's void-kill gate
  // (g_kill_plane_y > 0) is never armed: a player who falls off the map
  // dies correctly in TS but stays alive-and-falling (and responding to
  // input) forever in Zig — the branch's original seed=1 unbounded-growth
  // finding (~16px/tick, 19,315px by tick 1199) was exactly this.
  setWorldArenaBounds(
    runtime.ceilingClampY,
    MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  // Spawn points (Track Z0b Item A) — mirrors syncWorldStaticsToWasm's new
  // production wiring so Zig's mid-round fast respawn seats players at the
  // SAME assignSpawnPoints seals TS uses (and pins the module cache per
  // seed run, same discipline as the other setters above).
  setWorldSpawnPoints(MAP.spawns);
  // Match win-target — mirrors matchHost's Z0a wiring (and pins the module
  // cache: suddenDeathTriggerParity.test.ts sets 3 in this same process).
  // TS's stepWithRuntime reads the identical resolveModeConfig value.
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
  let zigState: WorldState = structuredClone(tsState);

  const samples: DivergenceSample[] = [];
  let firstBigDivergenceTick: number | null = null;
  // True previous-tick keys per player — fed to Zig's input patch so its
  // edge-triggered presses (jump, fire) see the same transitions TS's
  // runtime.prevKeys tracking gives the TS orchestrator. (The branch
  // hardcoded prevKeys: 0 — every held key read as freshly-pressed, a
  // harness-only divergence source.)
  const prevKeys: Record<string, number> = {};
  for (const id of playerIds) prevKeys[id] = 0;

  for (let t = 0; t < TICKS; t++) {
    const scripted = scriptedInputsForTick(seed, t, playerIds);

    // TS step
    const tsInputs: Record<PlayerId, InputFrame | null> = {};
    for (const id of playerIds) {
      const s = scripted.get(id)!;
      tsInputs[PlayerId(id)] = {
        seq: InputSeq(t + 1),
        tick: Tick(t + 1),
        keys: s.keys,
        aimX: s.aimX,
        aimY: s.aimY,
        dtMs: DT_MS,
      };
    }
    tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

    // Zig step — same scripted inputs, via the global input stash.
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map(
      playerIds.map((id) => {
        const s = scripted.get(id)!;
        return [id, { keys: s.keys, prevKeys: prevKeys[id]!, aimX: s.aimX, aimY: s.aimY }];
      }),
    );
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
    for (const id of playerIds) prevKeys[id] = scripted.get(id)!.keys;

    // Compare.
    let maxPos = 0;
    let maxHealth = 0;
    let aliveMismatch = 0;
    for (const id of playerIds) {
      const a = tsState.players[PlayerId(id)];
      const b = zigState.players[PlayerId(id)];
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > maxPos) maxPos = d;
      const hd = Math.abs(a.health - b.health);
      if (hd > maxHealth) maxHealth = hd;
      if (a.alive !== b.alive) aliveMismatch++;
    }
    if (t % 60 === 0 || t === TICKS - 1) {
      samples.push({ tick: t, maxPositionDeltaPx: maxPos, maxHealthDelta: maxHealth, aliveMismatchCount: aliveMismatch });
    }
    if (firstBigDivergenceTick === null && maxPos > 200) {
      firstBigDivergenceTick = t;
    }
  }

  return {
    samples,
    finalMaxPositionDeltaPx: samples[samples.length - 1]!.maxPositionDeltaPx,
    firstBigDivergenceTick,
  };
}

describe("multi-seed TS-vs-Zig full-match divergence sweep (Track Z0a)", () => {
  const SEEDS = [1, 42, 1337, 90210, 271828];

  for (const seed of SEEDS) {
    test(`seed=${seed}: ${TICKS} ticks, ${PLAYER_COUNT} players, movement+combat`, async () => {
      const result = await runOneSeed(seed);
      console.log(
        `[divergence-sweep seed=${seed}] samples:`,
        result.samples
          .map(
            (s) =>
              `t=${s.tick} maxPosΔ=${s.maxPositionDeltaPx.toFixed(1)}px maxHealthΔ=${s.maxHealthDelta.toFixed(1)} aliveMismatch=${s.aliveMismatchCount}`,
          )
          .join(" | "),
      );
      if (result.firstBigDivergenceTick !== null) {
        console.log(
          `[divergence-sweep seed=${seed}] FIRST >200px divergence at tick ${result.firstBigDivergenceTick} (${(result.firstBigDivergenceTick / 60).toFixed(1)}s into the match)`,
        );
      }
      // The branch's observed steady state (5 seeds, 2026-07-14 codebase):
      // one death-timing disagreement early, then a FLAT bounded gap for
      // the rest of the match (595-1,084px observed; 2,000px bound). A
      // dead player's position freezes wherever they died in each
      // implementation, so a one-tick death-timing disagreement leaves a
      // bounded frozen-position gap, not a growing one. Main's codebase
      // has known un-ported divergences the branch didn't (see the file
      // header) — if this bound trips, record the seeds/ticks and skip
      // per Track Z0a's meter contract rather than shipping red CI.
      expect(Number.isFinite(result.finalMaxPositionDeltaPx)).toBe(true);
      expect(result.finalMaxPositionDeltaPx).toBeLessThan(2000);
    });
  }
});
