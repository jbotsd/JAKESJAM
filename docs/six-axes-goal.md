# GOAL — The Six Axes, Live (axis-composed Emission + drafted actives, done-done)

**Status:** North star. Single conflict-winner for "what the Emission expresses beyond the Sorcery core, and how active abilities enter the game."
**Supersedes on conflict:** the "reserved axis sections resolve to inert defaults" contract in `emission-engine-goal.md` (this goal IS the phase that lands them); any sketch that adds actives outside the draft; any "5th ability slot" or "axis #7" proposal.
**Does not supersede:** `emission-engine-goal.md` on the charge economy / cast authority / composed-never-picked doctrine (all still law); `escalation-engine-goal.md` on draft economics; `CLAUDE.md` on sim authority / deploy; `docs/ui-axioms.md` on button form.
**Parent:** `docs/emission-engine-goal.md` — read it first; its Six Axes table, orthogonality law, and register names are the vocabulary of this file.
**Last written:** 2026-07-17.

---

## Mission

The Emission currently shouts only the **Sorcery** axis (element / impact / count / bounces / homing). Five axes sit inert in the resolver. Two moves, one doctrine:

**Layer 1 — the cast reads the WHOLE hand.** Every axis section in `EmissionConfig` goes live, derived from modifier fields hands *already* carry today (`stolenFangs` → Drain, shield mults → Ward, dash/air-jump/speed → Stride, void/cursed → Mystery, pierce → Technique). A fangs + double-jump + bounce hand casts a *leeching, dash-refunding shrapnel cage* — with zero new cards.

**Layer 2 — ability cards.** A new card category `"ability"`: cards that ARE actives. Drafted / loadout-equipped onto the rack (see `docs/classes-goal.md` catalog > slots), bound to keys **1–3** (exactly **3** slots — Jake soft lock 2026-07-17), cooldown-based. Each belongs to one axis, and *also* deepens that axis's section of the caster's Emission — every card stays a multi-purpose decision (active + cast + identity).

**Done =** the Emission's payload visibly changes with non-Sorcery picks; five starter actives (one per non-Sorcery axis) are draftable, castable on keys 1–3 / touch, server-authoritative, cooldown-synced, bot-used, kill-switchable; the **three** ability slots (classes-goal soft lock 2026-07-17) are scarcer than the five axes so loadout + draft — not a menu of everything — decides which powers you are; live humans confirm it on the real host.

---

## What this is not

| Not this | Why |
|----------|-----|
| A loadout / hero-kit screen | Acquisition is the draft, only the draft. Actives are CARDS — offered, picked, stacked into the same hand |
| A mana/resource system for 1–3 | Actives are cooldown + class resource (classes-goal); Emission keeps the charge meter for E |
| A 5th slot or 6th active | Four slots, five non-Sorcery axes. Scarcity IS the design — you can never hold every answer |
| Axis #7 | The vocabulary is closed (parent doctrine). All new ability content files under an existing axis |
| A Zig ability framework | Actives are TS-authoritative like all weapon/hit/event logic (`CLAUDE.md` sim authority). Zig learns nothing new in this goal |
| A balance pass on the gun | `combat-balance-ttk` owns damage numbers; this goal owns the axis machinery and starting values only |
| The war-crimes copy pass | Card names/flavor below are WORKING NAMES. The register pass is its own deliverable with Jake's sign-off (he owns copy taste) |

---

## The reasoning flaw this kills

**Proxy:** "More buttons = more depth → design a roster of abilities and a place to equip them."
**Product:** "The picker is THE feature → actives must be *picks*, and the cast must be the readout of *everything* picked."

A loadout would compete with the draft; ability cards make the draft deeper retroactively — the same three-offers moment now sometimes says *"become the vampire, the ghost, or the counter-blade."* And because slots (4) < axes (5), identity is chosen under scarcity, which is what makes it identity.

---

## Locked doctrine (additions to the parent — no alternatives)

1. **One derivation function.** `deriveAxisProfile(build)` in `sim/data/emission.ts` is the ONLY place axis membership is computed — from `ResolvedWeaponBuild` modifier fields for passives, from `active.kind` for ability cards. No card lists axes by hand; no code outside the derivation + resolver branches on "which axis is this."
2. **Compose, never cancel** (parent law, restated because Layer 2 tempts violations): Veil does not break Ward; Counter does not disable shields; a hand can hold all four slots from one axis's future card pool if it wants. No stances, no modes, no mutual exclusion.
3. **Empty axis = silent, never penalized.** A pure-Sorcery hand's cast is exactly today's cast. Layer 1 only ADDS expression.
4. **Actives are server-authoritative, cooldown-gated, hangout-no-op'd** — the exact Emission cast contract, four more times.
5. **Slots fill in draft order and never reorder.** Slot 1 is your first ability pick forever (same law as the acquired-glyph row). Muscle memory is sacred.
6. **The picker stops offering ability *fills* when 3 slots are full** (may still offer specs/swaps). Enforced at offer-roll time (`enterDrafting` candidate pool), never by silently failing a pick. Slot count: `docs/classes-goal.md` (catalog > 3 slots).
7. **Every ability card deepens its axis in the Emission.** No active-only cards: picking Crimson Tithe makes your CAST leech harder too. The dual-purpose law (gun AND cast) becomes triple-purpose (active AND cast AND identity).
8. **No 100-0 anywhere.** Execute thresholds, counters, and leech are finishers/sustain under the parent's budget philosophy — nothing in this goal can delete a full-health player in one press.
9. **Working numbers below are starting values.** Phase 4's playtest + the tune pass own them. Ship the machinery, tune the constants.
10. **The legibility law** (Jake, 2026-07-17: *"at every point it should be clear what's going on"*). Every axis effect has a world-space read AT ITS SITE the moment it happens — cast (seal-flash + punch), shell (contracting sapphire ward rings + WARD nameplate chip), leech (crimson thread victim→caster + local pickup cue), wrap (clean position snap; the trail BREAKS at the seam — a screen-wide streak reading as hitscan is a legibility bug), refund (dash/jump pips snap full), execute (the kill read). A mechanic with no read does not ship. This is stricter than acceptance A3: it applies to every effect at every moment, not just "which active was pressed."

### The axis derivations (Layer 1 — from fields that exist TODAY)

One row per axis: what marks membership, what the cast does when the axis is charged. All derivation inputs are existing `ResolvedWeaponBuild` fields (`cardTypes.ts`).

| Axis | Membership derivation | Cast expression (config section → sim effect) | Working numbers |
|------|------------------------|-----------------------------------------------|-----------------|
| **Drain** ⲦⲒⲘⲎ | hand modifiers: `stolenFangs` | `drain.leechFraction` — emission shards heal the caster a fraction of post-mitigation damage dealt | 0.35 (fangs) |
| **Ward** ⲤⲔⲈⲠⲎ | hand modifiers: `mirrorShield \|\| directionalShield \|\| shieldChargeMultiplier > 1 \|\| shieldRechargeMultiplier > 1` | `ward.fieldMs` — cast leaves a ward shell on the caster (damage taken × 0.5 while live). Nova + immunity beat | 700 ms |
| **Stride** ϩⲒⲎ | hand modifiers: `dashChargesAdd > 0 \|\| airJumpsAdd > 0 \|\| moveSpeedMultiplier > 1 \|\| jumpMultiplier > 1` | `stride.dashReset` — cast refunds air-dash charges + air jumps (zeroes the used-counters the player step already reads) | true |
| **Sorcery** ⲪⲰⲤ | element / impact / count / bounces / homing | LIVE since v1 (the parent's core) | — |
| **Mystery** ⲘⲨⲤⲦⲎⲢⲒⲞⲚ | resolved `element === 'void'` (cursed-rarity cards join when the tier exists) | `mystery.denyAscension` (unifies the renderer's existing void-kill derivation — one source); `mystery.wrapShots` — shards wrap arena bounds instead of dying at them | both true for void |
| **Technique** ⲦⲈⲬⲚⲎ | resolved `projectile.pierceCount > 0` | `technique.executeBelowFrac` — a shard hitting a player below this health fraction finishes them | 0.15 |

**Derivation notes (locked; amended 2026-07-17 during Phase 1):**
- **Axes are earned by PICKS — birthright/innate kit never lights one.** `resolvePlayerBuild` floors `dashCharges` at 1 for everyone (the universal ground dash) and gives the Shielded character `directionalShield` innately; deriving from those resolved scalars would light Stride for every player and Ward for every Shielded body with zero picks. So Drain/Ward/Stride scan the hand's CARD MODIFIER fields; Mystery/Technique read resolved projectile fields (element rank-merge and pierce max-merge have clean zero baselines on every path). Character kit stays the parent doc's deferred cast-frame *lean* — bias, never membership.
- `homingStrength` feeds Sorcery's carry only — one field never feeds two axes (identity stays legible).
- `maxHealthAdd` marks nothing — vitality is not vampirism.
- The dominant unclaimed fields (`orbitingSatellites`, `overchargeMultiplier`, `ammoRegenPerSecond`) stay Sorcery-adjacent and silent; claiming them is future axis-depth content, not a Layer 1 stretch.
- Leech reads the SAME post-mitigation applied-damage number the charge fill reads (one damage model — parent anti-pattern 3). Emission shards carry `leechFraction` the way they already carry `statusScale`.
- Mitigation order with the ward shell (deterministic, one line): parry > counter-stance (Layer 2) > ward shell > held shield > health.

### The starter five (Layer 2 — one active per non-Sorcery axis)

Names are working names (copy pass = separate deliverable). Cooldowns are per-slot, tick-based, additive-optional on the wire. `[E-coupling]` = what the card ALSO does to your Emission's axis section.

| # | Card (axis) | Active (press 1–3) | CD | E-coupling |
|---|-------------|--------------------|----|------------|
| 1 | **Crimson Tithe** (Drain) | 3 s window: your gun's shots leech 50% of post-mitigation damage as health | 14 s | `drain.leechFraction` → 0.6 |
| 2 | **Shelter Seal** (Ward) | Plant a ward field at the aim point: eats enemy projectiles (absorb budget ~120 damage), expires 2.5 s | 12 s | `ward.fieldMs` → 1200; `ward.storedReturnFraction` → 0.25 (damage the shell ate returns in your next cast's budget, capped) |
| 3 | **Shadow Step** (Stride) | Blink ~240 px toward aim, collision-safe landing, 250 ms exit-seal telegraph. No i-frames (Veil owns evasion) | 9 s | cast also grants a brief speed surge (existing `speedBoostUntilTick`, ~1.2 s) |
| 4 | **Veil of Nought** (Mystery) | 1.5 s unmade: homing loses lock, satellites don't track you, nameplate row can't read you, rig renders spectral to enemies (you see yourself) | 16 s | cast applies a 600 ms self-veil on release |
| 5 | **Severing Answer** (Technique) | 0.5 s counter-stance while moving freely: the next hit taken is negated and returned to the attacker (returned damage capped ≤ 35) | 12 s | `technique.executeBelowFrac` → 0.22 |

**Card data law:** ability cards are ordinary `CardDefinition`s — `category: "ability"`, new bucket `"ability"` (joins `CATCH_UP_BUCKETS`: identity-rich, non-winners see them more), `unique: true`, rarity rare (Tithe/Step) / legendary (Seal/Veil/Answer), plus one new field:

```
active?: {
  kind: 'crimson-tithe' | 'shelter-seal' | 'shadow-step' | 'veil-of-nought' | 'severing-answer';
  cooldownMs: number;
  durationMs?: number;
}
```

`kind` → axis lives in `deriveAxisProfile` (doctrine #1). `createWeaponBuild` resolves them into `build.actives: ResolvedActive[]` in hand order, length ≤ 4 by offer-gating (doctrine #6).

---

## Architecture

### Single source of truth

```
client/src/sim/data/emission.ts      deriveAxisProfile() + axis sections resolved LIVE
client/src/sim/data/cards.ts         the five ability CardDefinitions (active specs)
client/src/sim/data/cardTypes.ts     category + bucket unions widen; active field; ResolvedWeaponBuild.actives
client/src/sim/World.ts              Layer 1 effects at existing sites (leech/ward/stride/execute/wrap);
                                     Layer 2: four cast branches beside the Emission's, cooldown validation
client/src/sim/types.ts              InputBitfield bits 10..13 = ability slots 1..4 (comment table);
                                     PlayerEntity additive fields: slot cooldown ticks, titheUntilTick,
                                     veilUntilTick, counterUntilTick, wardShellUntilTick
client/src/net/snapshotDelta.ts      new fields join the delta patch (additive-optional contract —
                                     same as pendingLockCharges; NO protocol bump)
server/src/matchHost.ts              KNOWN_KEY_BITS 0x3ff → 0x3fff; ABILITIES=off strips bits 10..13
                                     (EMISSIONS=off lever, four more bits)
server/src/worldBots.ts              per-kind cast policies beside the emission policy
UI: ActionBarSystem.ts               slots [M1][M2][E][1][2][3][4][passive glyphs…]; cooldown = radial
                                     sweep (the nameplate decay-arc language); ready-flash on refill
UI: TouchControls.ts                 ability buttons appear as drafted (0–4), same arm/pulse pattern as EMIT
UI: draft overlay                    ability cards read as ACTIVE at a glance (glyph + key hint)
sim/src/*.zig                        NOTHING. Actives + axis effects are TS-authoritative (see below)
```

### Determinism + wire contract

- `deriveAxisProfile` is pure over `ResolvedWeaponBuild`, cached with the build (same WeakMap invalidation as `resolveEmission`).
- Cooldowns are ticks (`slotCooldownUntilTick`), never wall-clock. All new player fields are **additive-optional** — older snapshots read "no cooldown, no buff" (the `pendingLockCharges` contract). They join the state hash: drift is loud.
- Input bits 10–13 already fit the wire's u16 — no format change anywhere. `KNOWN_KEY_BITS` widens; sanitization stays the single admission gate.
- Blink placement uses the existing collision-resolve to land safely (slide-back), consuming no RNG.

### The Zig line (stated honestly, decided now)

Prod combat steps in TS (`stepWithRuntime`); Zig owns player-movement physics + rng/collision only. Therefore:

1. **Layer 2 actives**: TS-only, full stop. Same authority class as weapons/hits/events. The wasm world-step dev mode (`USE_WASM_STEP_WORLD=1`, off in prod) will not know actives exist — recorded as an explicit parity deferral beside the pre-existing B2 gap (2026-07-06 revert note).
2. **Layer 1 axis effects**: also TS-only for the same reason. The Zig emission cast mirror (`emissionFromConfig`) keeps casting the Sorcery core — correct-but-shallower in dev-wasm mode. The eventual fix is sketched, not built: an axis-payload block appended to `player_fire_config` (≈8 bytes: leech u8, wardMs u16, flags u8, executeFrac u8). Nobody builds it until wasm world-step parity matters again.
3. **Stride refund** touches counters the Zig player step *reads* (air-dash/air-jump used) — the refund writes the same host-side fields landing already resets, through the existing per-tick parameter path. No new ABI.

### Feature flags (ship safely)

- `ABILITIES=off` (server env) strips bits 10–13 at `matchHost.applyInput` — humans AND bots, one place, no client redeploy. Mirrors `EMISSIONS=off` exactly. Delete after the Phase 4 gate.
- Layer 1 has no flag: axis effects only fire on hands that carry the fields, and `EMISSIONS=off` already kills the cast wholesale.

### UI / UX contract

- **Action bar**: ability slots appear ON ACQUISITION (pick/loadout lands → slot pops in), key-labeled **1–3**, cooldown drawn as a radial sweep — the same decay-arc language the nameplate status row uses. Ready = the EMIT ready-flash pattern. No new visual style (ui-axioms §7 owns form; register every new button in the button registry).
- **Touch**: one button per owned active (0–4 present), same arm/pulse contract as EMIT. Portrait AND landscape verified at the four canonical viewports before done (sizing-on-fleek is a hard house rule).
- **Draft overlay**: an ability card must read as "this is an ACTIVE on a key" in under a second — glyph + key hint + axis seal. Copy register (war-crimes pass) is drafted as a table for Jake's review, never shipped unreviewed.
- **Spectator legibility**: every active emits a SimEvent and every event gets a read (Tithe = crimson thread from victim to caster; Seal = the planted ward's own body; Step = exit seal; Veil = spectral shimmer; Answer = the returned hit's flash). If a spectator can't tell WHAT was pressed, it isn't done.

---

## Doc conflict resolution (mandatory deliverable)

| File | Action | Status |
|------|--------|--------|
| `docs/emission-engine-goal.md` | Axis sections "inert until their phases land" → point here as that phase; Phase 3 `abilityModifier` row notes this goal took the axis half | ✅ 2026-07-17 |
| `CLAUDE.md` | Controls: keys 1–3; mechanics bullet: ability cards + axis-live Emission; `ABILITIES=off` lever beside `EMISSIONS=off` | ☐ |
| `README.md` | Controls table gains 1–3 | ☐ |
| `docs/dev-stream-sim.md` | InputBitfield table: bits 10–13 reserved → live | ☐ |
| `client/src/sim/types.ts` | Bitfield doc comment (bits 10..13) | ☐ |
| `docs/jakesjam-design-pillars.md` | Pillar 1 paragraph: the hand also grants actives; "every card is a dual-purpose decision" → triple | ☐ |
| `docs/ui-axioms.md` + button registry | Register the four slot buttons + touch buttons | ☐ |
| `client/src/game/ui/acquiredAbilities.ts` | Header comment: passive glyphs vs active slots — one derivation feeds both rows | ☐ |
| `sim/data/cards_gen` codegen (Zig) | Confirm the generator tolerates `category: "ability"` / skips `active` (Zig needs no active knowledge) | ☐ |

**Rule:** after ship, if a doc contradicts this goal on axis/active policy, the doc is wrong.

---

## Implementation plan (phased, each independently shippable)

### Phase 0 — Lock + derivation (no behavior change) — ✅ SHIPPED 2026-07-17

- [x] Land this goal file; patch the parent-doc pointer rows (implementation-tied doc rows land with their phases — patching "bits 10–13 live" before they are would be lying).
- [x] `deriveAxisProfile(build)` + tests (`axisProfile.test.ts`, 12 tests / 767 expects): EXHAUSTIVE per-card membership map (drain=stolen-fangs; ward=aim-barrier/bulwark-core/mirror-shield/rapid-capacitor/riot-mirror; stride=blink-dash/double-jump/lead-boots/spring-heel/sprint-coils; mystery=void-fracture; technique=pierce-chain/voltaic-spark/void-fracture — two axes via two FIELDS, legal); composed hands; crystal-plating 0.98 negative; empty hand lights none.
- [x] `EmissionConfig` axis sections populated from the profile — doctrine #3 regression green (pure-Sorcery hand's sections deep-equal the inert defaults; prior resolver suite untouched and passing).

### Phase 1 — Layer 1: the cast reads the whole hand — ✅ SHIPPED 2026-07-17

- [x] Drain: shards carry `leechFraction`; heal at the damage-application site (post-mitigation — the SAME number the charge fill reads; monotone clamp so boss-HP bodies never lose health; self-damage and chain-lightning secondaries never leech). `emission-leech` SimEvent + crimson thread (StatusVfxController, chain-arc language re-tinted, one smooth sag not lightning jitter) + local-caster pickup cue (SimEventRouter). Tests: fangs hand heals exactly the event sum; plain hand heals zero; solo cast leeches nothing.
- [x] Ward: `wardShellUntilTick` on cast — additive PlayerEntity field, P_HI bit 7 on the delta wire, hash-mixed (buff-tick precedent). Damage × 0.5 applied BEFORE `tryDeflectDamage` (order-exact for parry > shell > shield; counter joins in Layer 2). Scope: the projectile path (direct + AOE) — bash/DoT keep their own sites in Layer 1. Reads: WARD nameplate chip (nominal 700 ms decay arc) + contracting sapphire rings in-world (inverted from the frost ring's expansion so the two never read alike). Comparative test: warded run takes exactly ×0.5 of the identical un-warded run.
- [x] Stride: cast zeroes `airJumpsUsed`/`dashUsedInAir` in the host movement memory — the exact reset landing performs; the wasm player step round-trips both counters through the ABI every tick (`playerWasmBackend.ts` write 134 / read 182), so the refund reaches the Zig-stepped prod server with no new ABI. Tests: movement hand refunds mid-air; plain hand's counters stay spent.
- [x] Mystery: wrap-flagged shards fold across the map rect (position-only, velocity/range untouched, interior statics still bounce/block); `denyAscension` now derived through `resolveEmission().mystery` in renderContract — ONE derivation, replay path identical. Legibility: ProjectileVfx trail BREAKS at the wrap seam (segment-length guard) so the fold never smears a screen-wide streak. Tests: void shard folds; plain shard flies off and never returns; existing 3 denial tests still green.
- [x] Technique: execute below 15% of spawn health, never from above it (14% dies to an 11.67-damage shard; 16% survives it — both pinned).
- [x] Every effect: hangout inherited via the cast gate (explicit hangout cast test already green); `bun test` (1016 client + 203 server) + typecheck green.
- [x] Deploy + **:8088 server restart** (PID cycled, world healthy, live bundle = fresh build `index-BVC8qs6Y.js`). Live fangs-hand observation folds into Phase 4's human session — bots draft by weight, so a scripted wait on the right bot hand would be theater, not verification (test coverage owns the mechanics).

### Phase 2 — Layer 2 engine + pilot card (Crimson Tithe end-to-end) — ✅ SHIPPED 2026-07-17

- [x] Input bits 10–13 live: types.ts bitfield comment, `KNOWN_KEY_BITS` 0x3fff, `ABILITIES=off` lever. Mask extracted as pure `sanitizeKeyMaskFor` (exported) — tested directly (`sanitizeKeyMask.test.ts`, 5 tests) instead of env-flip module gymnastics; humans AND bots route through the one `applyInput` gate (integration precedent: emissionChargeBots).
- [x] Card plumbing: `category`/`WeaponBucket` unions +"ability", `active` spec on CardDefinition, `build.actives` resolved in draft order (`createWeaponBuild` now admits modifier-less active cards), offer-gating at MAX_ABILITY_SLOTS in `enterDrafting`, `"ability"` joined CATCH_UP_BUCKETS. NOTE: the 4-slots-held→zero-offers case is untestable until 4 distinct ability cards exist (only the tithe does) — the unique-card re-offer exclusion is pinned instead; full-cap test lands with Phase 3's cards.
- [x] Cooldown state: `slot1..4CooldownUntilTick` + `titheUntilTick` (additive PlayerEntity fields, P_HI bits 8–12, hash-mixed); round-trip + old-shape-decodes test in snapshotDelta.test.ts.
- [x] Crimson Tithe complete: sim active (window buff; `weapon.ts` stamps `leechFraction` on fired shots — the SAME hit-site/thread/event machinery as a Drain-hand Emission, one damage model), action-bar slot (cooldown sweep + crimson window pulse + hotkey label, `drawActiveSlot`/`activeSlots.ts`), TITHE nameplate chip, touch buttons (appear as drafted, ready-arming, portrait column/landscape row), bot policy (per-slot humanized delay, target ≤520px), `ability-activated` event + router cue, tests (`abilitySlots.test.ts`, 6: activation/cooldown/edge/window-leech math/no-actives/hangout+death + draft-exclusion with vacuity guard).
- [x] Zig codegen confirmed tolerant: the generator filters `c.modifier` (tithe emits no entry), parity tests index the same filtered list, and card hands cross the wasm bridge count-only — no index drift possible.
- [x] Deployed behind `ABILITIES=off` (soak: healthy world, zero error lines) → flipped on. Suites: 1026 client + 208 server, 0 fail; typecheck clean both packages. OPS NOTE (hard-won): restarting the game server needs the FULL canonical env from `scripts/host-public.sh` — a bare PORT/ADMIN_SECRET restart silently drops `SERVE_CLIENT_DIR` (site 404s while the API stays healthy), `REGION`, `WORLD_BOTS`, `PUBLIC_URL`. This bit us live for ~1h mid-phase; restored.

### Phase 3 — The remaining four + coupling — ✅ SHIPPED 2026-07-17 (copy signed off, sizing pass done)

- [x] Shelter Seal shipped as the **risk-register fallback: self-bulwark** (2.5s ward shell on the caster — reuses ALL Phase-1 shell machinery: ×0.5 damage, WARD chip, sapphire rings). The placed ward-field entity (absorb budget, projectile-eating) is the RECORDED UPGRADE, gated on playtest demand — it needs the one new entity kind + wire surface, and shipping a live, legible active today beat holding four cards hostage to it. `ward.storedReturnFraction` stays 0 until the banking mechanic exists (a config value nothing consumes is a lie).
- [x] Shadow Step (blink toward aim, farthest collision-free landing ≤240px sampled deterministically; THROUGH walls is the fantasy, inside them is forbidden; a fully-blocked press is a no-op that never burns cooldown; v1 is instant — the 250ms exit telegraph is a playtest-gated refinement). Veil of Nought (homing + satellite target-selection blindness via tick-aware selectors; breaks on firing — a window, never a state; VEIL chip). Severing Answer (counter-stance at the hit site — order parry > counter > shell > shield, negates the hit, returns min(35, raw) through a REAL hit-confirmed so charge/kill-feed/audio read it free; parry-deflect flash at the stancer; consumed on use; CNTR chip).
- [x] E-coupling for all five: Tithe→leech 0.6, Seal→fieldMs 1200, Answer→execute 0.22, Veil→600ms self-veil on cast (mystery.markMs), Step→1.2s speed surge on cast. Tests pin every value + both cast effects.
- [x] Bot policies: the Phase-2 per-slot humanized-delay policy is kind-agnostic and covers all five; bots draft ability cards under normal weights (catch-up boosted). Kind-aware refinements (e.g. Veil on retreat) are tune-pass material.
- [x] Tests: `abilityActivesPhase3.test.ts` (8 — blink range/blocked, veil window/fire-break, homing-lock isolation via a curve-back seeker with control run, counter negate+capped return+consume, seal shell, all coupling values); suites 1034 client + 208 server, 0 fail; deployed live (`index-BjaaWpiZ.js`, full canonical env).
- [x] Copy table SIGNED OFF (Jake, "greenlight", 2026-07-17): Crimson Tithe / Veil of Nought / Severing Answer kept; `shadow-step` → **Interstice Writ**, `shelter-seal` → **Shelter Writ** (display fields only; ids untouched). Applied to cards.ts.

  | id (never changes) | Working name | Proposed name | Proposed flavor (tribunal register) | Draft-overlay gloss |
  |---|---|---|---|---|
  | `crimson-tithe` | Crimson Tithe | **Crimson Tithe** (keep) | *"The congregation pays in what it bleeds."* (keep) | ACTIVE 1-3 — 3s: your shots collect |
  | `shadow-step` | Shadow Step | **Interstice Writ** | *"Filed in the space between spaces. Approved before it was asked."* | ACTIVE 1-3 — blink to your aim |
  | `veil-of-nought` | Veil of Nought | **Veil of Nought** (keep) | *"The archons cannot audit what is not."* (keep) | ACTIVE 1-3 — 1.5s: unfindable; firing re-makes you |
  | `severing-answer` | Severing Answer | **Severing Answer** (keep) | *"Ask again."* (keep) | ACTIVE 1-3 — 0.5s: the next hit is returned |
  | `shelter-seal` | Shelter Seal | **Shelter Writ** | *"Here, the writ of violence does not run."* (keep) | ACTIVE 1-3 — 2.5s: damage halved |

  Recommendation: keep three as-written (they landed in the register first try); the two "Writ" renames make Stride/Ward read as *paperwork filed against reality* — pure tribunal voice. Jake owns the final call; renames are display-field-only edits.
- [x] Button registry landed (`docs/ui-axioms.md` §7d — exhaustive touch combat-button table, new-button-must-register law) + four-viewport sizing pass DONE WITH REAL SCREENSHOTS (390×844 / 844×390 / 820×1180 / 1440×900, playwright + touch emulation, buttons force-shown with real classes): all in-bounds, ready-state hierarchy reads, and the pass CAUGHT a real bug — a straight row of 4 slots overflowed narrow landscape; fixed with a 2×2 fold media query (≤900px landscape) before ship. Draft-overlay ACTIVE presentation: ability cards read through their existing card plates (name + "Active (…s cooldown)" description line); a bespoke ACTIVE badge is tune-pass polish, noted not blocking.

### Phase 4 — Live funnel gate (human, non-skippable)

- [ ] Real host, ≥5 rounds with ability cards in the pool, checklist below.
- [ ] `ABILITIES` lever deleted next release after pass.

---

## Test architecture (must be green)

| Case | Expect |
|------|--------|
| Pure-Sorcery hand | `EmissionConfig` identical to pre-goal snapshot (doctrine #3) |
| Fangs hand cast → shard hits | Caster healed leechFraction × post-mitigation; self-hit leeches 0 |
| Shield-family hand cast | Ward shell live `fieldMs`, halves damage, expires; mitigation order stable |
| Movement hand cast mid-air | Air-dash/air-jump counters zeroed |
| Void hand cast | Shards wrap bounds; kill routes denial FX (existing 3 tests keep passing) |
| Pierce hand shard vs 14% / 16% target | Executes / does not |
| Cast active on cooldown / in hangout / slot empty | Rejected, no state change |
| 4 actives held → draft roll | Zero ability cards offered |
| Each active | Cooldown gate, duration window, effect math, event emitted |
| Severing Answer vs 200-damage hit | Return capped ≤ 35 (100-0 test) |
| Snapshot with new fields → old decoder shape | Additive contract holds (no protocol bump) |
| Bits 10–13 under `ABILITIES=off` | Stripped for humans AND bots |
| Hash | New fields mixed; TS self-consistency across a bot match with actives |

Forbidden "green but unplayable": Phase 4 is part of done. Unit green alone closes nothing.

---

## Acceptance — it's done when

### A. Product (human, real host, ≥5 rounds)

1. A non-Sorcery pick visibly changes a cast: the fangs player says "my Emission heals me" **unprompted**.
2. Asked mid-match "what does your 2 key do?" → the player answers in the card's terms, instantly.
3. A spectator can name which active was pressed from the read alone, 4 of 5 times.
4. Someone passes on a gun card to take an ability card — and someone else does the opposite. Both feel right (the scarcity is real, neither choice dominates).
5. Nobody was 100-0'd by any single press; nobody perma-ghosts (Veil uptime feels like a window, not a state).

### B. Engineering

1. `bun test` + typecheck green; zig build untouched and green.
2. No protocol bump; no new wire messages; additive-fields contract test proves it.
3. Grep clean: no axis membership computed outside `deriveAxisProfile`; no active behavior outside `World.ts`'s cast branches.
4. `ABILITIES=off` verified live once (flip off → bits die → flip on).

### C. Elegance bar

- One derivation function; one resolver family; UI, bots, and sim all read their output, never re-derive.
- Zero Zig changes shipped (the parity deferral is a recorded note, not code).
- The slot row, the cooldown sweep, the ready-flash, the seals — all existing visual languages. Zero new nouns beyond the five card names.
- Every constant in the starter tables lives in `constants.ts`/card data — the tune pass edits data, not logic.

---

## Anti-patterns (do not reintroduce)

1. **Actives acquired anywhere but the draft.** No unlocks, no defaults, no "everyone starts with a dash-2".
2. **A 5th slot, a slot-swap UI, or slot reordering.** Four, draft order, forever (until a playtest demands otherwise IN WRITING).
3. **Resource costs on 1–3.** Cooldown + class resource per classes-goal; the Emission charge meter belongs to E.
4. **An axis feeding from two fields' identities** (e.g. homing marking both Sorcery and Technique). One field, one axis.
5. **Damage-immunity stacking into a state.** Veil evades targeting, Ward reduces, Counter answers once — none grants invulnerability, and no pair may compose into effective invulnerability.
6. **Zig learning about actives** before wasm world-step parity is a live goal again.
7. **Shipping the working names** past the dev host without the copy sign-off.
8. **Silent offer-gating bugs** — if ability offers stop appearing for any reason other than 3 slots held (fills) or legitimate offer-pool empty, that's a loud bug, not balance.
9. **New visual language** for slots/cooldowns (radial sweep + ready-flash or nothing).
10. **Declaring done from unit tests only.**

---

## Relationship to other goals / systems

| System | Relationship |
|--------|--------------|
| `emission-engine-goal.md` | Parent. Owns charge/cast/composition doctrine; this goal lands its reserved axis sections and adds the active layer |
| `escalation-engine-goal.md` | Upstream. Ability cards ride the same offers/weights machinery; catch-up bucket inclusion is this goal's only touch |
| War-crimes register pass | Downstream sibling: owns the five cards' real names + all cast lines (Phase 3 delivers the draft table) |
| Vampire direction | Crimson Tithe IS its first landing; deeper Drain content (soul-redirect denial variant) files under Drain later |
| Ascension denial | Mystery axis marquee — unchanged, now derived in one place |
| `ui-axioms.md` / button registry | Owns button form; this goal adds entries, never style |
| Character cast frames (deferred, parent doc) | Unchanged: frames bias axes, cards fill them. Nothing here blocks it |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Four new buttons overwhelm new players | Slots appear only as drafted — round 1 is today's game; complexity arrives at the player's own pick rate |
| Touch real estate at 4 actives | Buttons appear as owned (usually 1–2); four-viewport verification is a phase gate, not a follow-up |
| Veil degenerate with flag/objective modes later | Veil breaks on firing (locked now: shooting while veiled ends it early) |
| Ward field entity scope creep | One entity kind, absorb-budgeted, no health bar UI in v1; if it fights the netcode, fallback recorded: self-bulwark active instead |
| Counter-stance reads as parry duplicate | Parry is the shield's edge (defense); Answer is a pick, moving, and RETURNS damage — different verb, different read; playtest question #3 owns confirming it |
| Cooldown snowball (leader holds more actives) | Ability cards ride catch-up weights (non-winners see them MORE); audit in the tune pass |

---

## Success metric (north star, not vanity)

Players describe builds as **axis blends** — "vampire ninja," "ward gnostic" — without those phrases existing in the UI (parent's long-run metric; this goal is the machinery that makes it possible). Proximate: in a 5-round match where ability cards appeared, ≥1 human pick per match is an ability card, and actives are pressed ≥ once per round they're held.

---

## One-line definition of done

**Four keys earned one draft at a time, five axes fighting for them, and a cast that reads the whole hand — the vessel finally speaks every register it holds, deterministic, budgeted, and legible from across the arena.**
