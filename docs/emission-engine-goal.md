# GOAL — Emission Engine (ability doctrine, done-done)

**Status:** North star. Single conflict-winner for "what the Ability button does and how abilities relate to cards."
**Supersedes on conflict:** any per-character bespoke-ability roadmap, any "pick your ultimate from a menu" sketch, the HUD comment declaring `abilityCharge` dead.
**Does not supersede:** `CLAUDE.md` on sim authority / deploy; `escalation-engine-goal.md` on draft economics — this goal only owns **the ability loop and its coupling to the card hand**.
**Last written:** 2026-07-16.

---

## Mission

Give the wizard-ninja fantasy its cast button: **the Emission** — a charged, seal-pressed release of everything the vessel has accumulated.

The ability is **composed from the card hand, never picked from a menu**. Your gun is the sentence; the Emission is the same sentence shouted. Every draft pick is thereby a dual-purpose decision (it mutates your gun AND your cast) — the Escalation Engine's decision weight multiplies without one new screen, currency, or content system.

**Done =** the Ability input casts a charge-gated, server-authoritative Emission whose element / impact / geometry are derived from the resolved build; charge economy is deterministic and hash-verified in TS + Zig; the action bar's reserved slot shows it; bots cast it; cards visibly change it; live humans on the real host confirm "my draft picks changed my ult."

---

## What this is not

| Not this | Why |
|----------|-----|
| A hero-shooter ability menu | Selection is the draft. A second selection surface dilutes the picker's monopoly on choice |
| Per-character bespoke ultimates | Characters are the **cast frame** (verb), cards are the **payload** (noun); no N-ability content matrix |
| A new entity type in the sim | The Emission is a parameterized fire event over the EXISTING projectile/impact/status machinery (the `applyDeliveryFeel` trick at ability scale) |
| An essence/currency system | `essenceCost` stays vestigial; charge comes from combat, not spend |
| A card content pass | War-crimes register, cursed tier, vampire are separate goals; this defines the engine they plug into |
| A Zig ability framework | Zig gets ONE cast branch reading pre-resolved parameters from host-written memory — exactly the `player_fire_config` pattern, nothing more |

---

## The reasoning flaw this kills

**Proxy:** "Depth needs an ability system → design a roster of abilities."
**Product:** "The picker is THE feature → the ability must be *made of* picks."

A picked-ability roster would compete with the draft for identity ("my character's ult" vs "my build"). Composition makes the draft *more* consequential retroactively — every card already owned becomes part of the cast. Content ROI is N cards → N gun variants × N emission variants, for one engine.

---

## Locked doctrine (one page, no alternatives)

### The loop (canonical)

```
deal/take damage → abilityCharge fills → full → press Ability →
  EMISSION: overcharged release resolved from the card hand →
  charge to 0 → refill through play → …
```

1. **Composed, not picked.** Emission parameters derive from the resolved build's existing axes: element (ranked), impact behavior, delivery identity, projectile count/shape, occupied buckets. No emission-selection UI exists.
2. **Emergent-first, bespoke-never-by-default.** v1 is ONE cast shape: the player's own resolved volley, amplified (count ×, impact radius ×, status durations ×) under a hard damage budget. Element identity forks (nova vs. storm vs. rift) are a later phase and only if playtests demand — the element/impact hit path already differentiates the feel for free.
   2a. **Ability-space is six orthogonal axes** (see "The Six Axes" below). Every ability-touching card charges one or more axes; axes compose by the same law the gun already obeys (`orthogonalScale` / rank-merge: contributions stack, never cancel, never overwrite). A hand deep in two axes expresses BOTH — a drain-heavy ninja hand makes a leeching execution-dash cast; a ward-heavy gnostic hand makes a retaliation rift. No axis is ever a mode switch.
3. **Charge from combat.** `abilityCharge` (0–100) fills from damage dealt (primary) and damage taken (lesser). No passive trickle in v1 — the meter is a record of participation.
4. **Charge persists through death and across rounds** within a match. Dying does not erase progress toward the comeback tool (additive-catch-up doctrine, same spirit as escalation). Resets at match end. Phase 3 audit owns revisiting this if bell-rush casts prove degenerate.
5. **Cast is server-authoritative.** `InputBit.Ability` (1 << 7 — already reserved, already inside `KNOWN_KEY_BITS`) requests it; the sim validates charge and emits. Clients never cast locally-first beyond ordinary prediction.
6. **Hangout mode no-ops the cast** (same as `stepWeapon`).
7. **The Emission cannot 100-0 a full-health player by itself.** Hard damage budget below base HP. It is a finisher, a zone claim, a status bomb — not a delete button.

### Charge economy (starting numbers — Phase 3 owns tuning)

| Rule | Value |
|------|-------|
| Meter range | 0–100 (existing `abilityCharge` field, already snapshot-synced + hash-mixed) |
| Fill from damage dealt | `+0.5 × damage` (post-chaos, actual applied) |
| Fill from damage taken | `+0.2 × damage` |
| Full charge ≈ | ~200 damage dealt at the 0.5 rate (less in practice — taken-side fill mixes in during a real fight; ≈ 1.5–2 kills-worth of participation) |
| Cast cost | 100 (full bar, always) |
| On death / round end | Charge kept |
| On match end | Reset to 0 |

### The Six Axes (ability-space, orthogonal by law)

The card system's proven composition law — buckets + `orthogonalScale` + rank-merge, where stacking never cancels — extends to ability-space as six named axes. Each axis is a *family* of both passive effects (always on, card-granted) and cast expression (amplified at Emission). Every axis has a plain name, a register name (the seal grammar from `cardSeals.ts`), and a one-line question it answers.

| Axis | Register | Question | Passive expression (examples) | At cast (examples) |
|------|----------|----------|-------------------------------|--------------------|
| **Drain** (vampire) | ⲦⲒⲘⲎ · *tithe* | What do you take? | Lifesteal on hit; charge-steal; kill-heal | Mass-leech volley; soul-redirect (ascension theft) |
| **Ward** (shield) | ⲤⲔⲈⲠⲎ · *shelter* | What do you refuse? | Shield charge/recharge mults; directional ward; stolen-fangs (exists) | Retaliation release (stored damage returned); bulwark field |
| **Stride** (movement) | ϩⲒⲎ · *path* (existing seal) | How do you move? | Air jumps, dash charges, gravity, wall-grip (all exist) | Blink-cast (detonate at dash end); cast resets dash; phase-step |
| **Sorcery** (wizard) | ⲪⲰⲤ · *light* (existing seal) | What do you project? | Element/impact/delivery/count (all exist — the gun) | The payload itself: nova/storm/wave geometry, statuses at scale |
| **Mystery** (gnostic) | ⲘⲨⲤⲦⲎⲢⲒⲞⲚ · *mystērion* | What law do you break? | Wrap/rift shots; marks pressed on victims; satellites-as-bound-aeons (proto-exists) | Ascension denial; unmaking zone; arena-rule violation |
| **Technique** (ninja) | ⲦⲈⲬⲚⲎ · *technē* | How do you strike? | Execution thresholds; counter-windows; recoil/precision control | Cast-from-dash frames; counter-cast; decoy/smoke instant |

**The orthogonality law (non-negotiable):**

1. Every ability-touching card charges one or more axes. Axis membership is **derived from modifier fields first** (lifesteal→Drain, shield mults→Ward, movement mults→Stride, element/impact→Sorcery, dash/execution→Technique, reality-rule fields→Mystery) — an explicit `abilityAxes` tag on cards is a Phase 3 refinement, not a prerequisite.
2. Axes **compose, never cancel, never gate each other**. No axis is a mode, a stance, or a mutually-exclusive spec. A hand can be deep in all six.
3. The Emission is the **readout of all axes at once** — the cast projects (Sorcery) while draining (Drain), warding (Ward), moving (Stride), violating (Mystery), and executing (Technique) in proportion to what the hand holds. Axis depth = expression intensity; empty axis = silent, never penalized.
4. New ability content MUST land as axis depth (new cards charging existing axes) before anyone proposes axis #7. Six is the vocabulary; cards are the sentences.

### Emission resolution (the payload)

Resolved by a pure function beside `createWeaponBuild` — same inputs, same determinism:

```
resolveEmission(build: ResolvedWeaponBuild) → EmissionConfig
  // Sorcery axis (v1 core — all fields exist on the build today)
  volleyCount   = clamp(build.projectile.count × 4, 6, 16)
  damagePerHit  = budgeted so total ≤ EMISSION_DAMAGE_BUDGET (70)
  impactRadius  = build.projectile.impactRadiusPx × 1.6 (min 48)
  element       = build.projectile.element   // status applied at scale
  impact        = build.projectile.impact    // explosive/sticky/slow/pierce at scale
  statusScale   = burn/freeze/slow durations × 2, capped (burn ≤ 3s)
  geometry      = radial burst from the vessel (v1; delivery identity may
                  bias arc later — raycast hand = tighter fan, beam = wave)
  // Axis sections — LIVE since 2026-07-17: docs/six-axes-goal.md is the
  // phase that landed them (deriveAxisProfile owns membership; conflict-
  // winner on axis/active policy). Reserved-until-Layer-2 fields noted there:
  drain         = { leechFraction }                    // Drain
  ward          = { storedReturnFraction, fieldMs }    // Ward
  stride        = { castAtDashEnd, dashReset }         // Stride
  mystery       = { denyAscension, wrapShots, markMs } // Mystery
  technique     = { executeBelowFrac, counterWindowMs }// Technique
```

**Interplay hooks this engine must accept later (not build now):**

| Later system | Axis | Plug point |
|--------------|------|-----------|
| War-crimes cursed tier | (cost, axis-neutral) | Cost modifiers: blood-cast (cast from health at empty), decay-cast |
| Vampire | Drain | Leech fraction rides `EmissionConfig` like any build stat — mass-leech cast |
| Ascension denial | Mystery | Void-element / Mystery-deep emission kills route the denial death FX |
| Dance/hype identity | (fill source, axis-neutral) | A card that fills charge from `danceEnergy` — one new fill source, same meter |
| `abilityModifier` on cards | (all) | Phase 3+: chargeRate / radius / budget-shape / explicit `abilityAxes` tags on `WeaponCardModifier` |
| Wrap/rift shots, execution thresholds | Mystery / Technique | New passive card mechanics; the axis table above is their filing system |

### Cast frame (characters = verb) — deferred, locked direction

`characters.ts` already declares `abilityType: "shield" | "brace" | "blink"`. v1 ignores it (everyone casts an instant radial release). The locked *direction* for the later phase: blink = emission detonates at dash destination; brace = channeled, armored, wider; shield = stores incoming damage, returns it in the release. Direction is locked so nobody designs characters against a different future.

In axis terms: the character's cast frame is a **starting lean on one axis** (blink → Stride, shield → Ward, brace → Ward/Technique) — a bias, never a lock. Cards can take any character deep into any axis; the frame colors *how* the composed payload is delivered, not *what* it may contain.

### Bots

- Bots cast under the same rules: full charge + a live target within ~600px + humanizing delay (1–3s), mirroring the bot draft pattern (`worldBots.ts:draft`).
- Bots must not be the only ones testing the cast path (same rule as escalation).

---

## Architecture

### Single source of truth

```
client/src/sim/data/emission.ts      resolveEmission() — pure, beside weaponBuild.ts
client/src/sim/weapon.ts (or emission.ts)  cast validation + volley spawn (TS branch)
client/src/sim/World.ts              charge fill at the hit-application site; Ability-bit wiring
sim/src/*.zig                        charge fill mirror + ONE cast branch reading
                                     host-written EmissionConfig bytes (player_fire_config pattern)
sim/src/weapon_build.zig             emissionFromConfig — derives the cast from the
                                     ALREADY-written player_fire_config (superseded
                                     packEmissionConfig: zero new ABI surface)
UI: ActionBarSystem                  reserved slot → Emission diamond (facetedRing charge)
UI: HudCompositor                    feed abilityCharge (delete the "dead field" comment)
Bots: worldBots.ts                   cast policy beside draft policy
Net: protocol.ts                     NO changes — Ability bit + abilityCharge already on the wire
```

**Invariant:** `abilityCharge` mutates only at (a) the damage-application site, (b) a successful cast, (c) match reset. Any other writer is a bug. The state hash already mixes it — TS/Zig divergence is loud by construction.

### Determinism contract

- `resolveEmission` is pure over `ResolvedWeaponBuild` — cached exactly like builds (same invalidation: the `cards` array reference).
- Volley spawn consumes RNG only where the gun's spawn already does (chaos random-shapes); otherwise angles are deterministic fan math.
- Charge fill uses post-chaos applied damage — one number, already computed at the hit site, no second damage model.
- No `Date.now`, no client-side cast authority.

### Wasm boundary (the whole cost, stated honestly)

Two Zig touches, both mirroring existing patterns:

1. **Charge fill** in the hit path (`projectile.zig`/`combat.zig`) — must land in the same tick as TS or the hash screams. Small, testable.
2. **Cast branch** in the fire step: when Ability bit set + charge full, read the host-written `EmissionConfig` bytes and spawn the volley through the existing projectile-spawn path. Parity-test export `resolve_emission_test` mirroring `resolve_build_test`.

No card knowledge enters Zig beyond today's. `cards_gen.zig` untouched in v1.

### UI / UX contract

- Action bar: the first RESERVED diamond becomes the Emission slot — facetedRing fills with charge (same resource language as everything else), pulses once at full. No new visual style.
- Keyboard: one key (proposal: `E`; final call at implementation — must not collide with dash `C`). Touch: the slot itself is the button (TouchControls addition).
- Cast feedback: rig hand-seal flash — the dominant card's Coptic seal (from `cardSeals.ts`) flashes at the vessel on cast. The seal grammar IS the casting grammar; no new iconography.
- Nameplate status row (separate work) is the legibility layer for emission statuses landing on victims.
- HUD copy register: the meter is "EMISSION" — the draft overlay already glosses cards as *"pick one emission into the vessel."* The name was canon before the system existed; keep it.

### Feature flag (ship safely)

**As implemented (2026-07-16):** the engine shipped ENABLED by direct user
call ("go") — the flag is the emergency lever, not the gate. Server env
`EMISSIONS=off` strips the Ability bit at `matchHost.applyInput`
sanitization, disabling the cast for humans AND bots in one place with no
client redeploy (clients may briefly mispredict a cast; reconcile corrects
it). Charge fill stays on either way — the meter is harmless without the
button. Delete the lever after the Phase 4 gate passes.

---

## Doc conflict resolution (mandatory deliverable)

| File | Action | Status |
|------|--------|--------|
| `CLAUDE.md` | Mechanics bullets: Ability = Emission, composed from hand, charge from combat, server-auth | ✅ 2026-07-16 |
| `client/src/game/ui/HudCompositor.ts` | Delete "abilityCharge is a dead sim field" comment when feeding it | ✅ 2026-07-16 |
| `client/src/game/ui/ActionBarSystem.ts` | Reserved-slot comment updates to name the Emission | ✅ 2026-07-16 |
| `docs/dev-stream-sim.md` | InputBitfield table: Ability bit goes from reserved to live | ✅ 2026-07-16 |
| `README.md` | Controls line gains the Emission key | ✅ 2026-07-16 |
| `docs/jakesjam-design-pillars.md` | Ability loop paragraph aligned to composed-from-hand | ✅ 2026-07-16 |

**Rule:** After ship, if a doc contradicts this goal on ability policy, the doc is wrong.

---

## Implementation plan (phased, each independently shippable)

### Phase 0 — Lock + the visible meter (docs + charge loop only) — ✅ SHIPPED 2026-07-16

- [x] Land this goal file; patch `CLAUDE.md`.
- [x] Charge fill at the hit site, TS + Zig, hash-verified (`emissionCharge.test.ts` 7 tests; Zig mirror in world.zig step 10 + hit_confirmed attacker stamps).
- [x] Action bar diamond fills (`ActionBarSystem.drawEmissionSlot` — facetedRing + point-of-light at full).
- [x] Bots accumulate charge identically (`emissionChargeBots.test.ts` — real MatchHost + WorldBots duel through the production input path).

### Phase 1 — The cast (v1: your volley, shouted) — ✅ SHIPPED 2026-07-16

- [x] `resolveEmission` (`sim/data/emission.ts`) + Zig cast branch (world.zig §6). NOTE: `packEmissionConfig` was superseded by a CLEANER design — the emission derives entirely from the already-written `player_fire_config` on both sides (`weapon_build.emissionFromConfig`), zero new ABI surface; `resolve_emission_test` parity green for every card (`emissionParity.test.ts`).
- [x] Ability input wiring (E key + EMIT touch slot, both gated client-side to full predicted charge), server validation, charge consume (`emissionCast.test.ts` 7 tests).
- [x] Damage budget clamp + status-duration caps in the resolver (`emissionResolver.test.ts` — every card + adversarial max-stack hand ≤ budget).
- [x] Cast feel: dominant-card Coptic seal-flash at the vessel + `CameraJuice.punchZoom` toward the cast (`emissionCastFeel`, OnlineMatchScene) + element-carrying heavy cast SFX (SimEventRouter).
- [x] Bot cast policy (`worldBots.ts` — full charge + target ≤600px + 1–3s humanized delay).
- [x] Hangout no-op (explicit guard + test).

### Phase 2 — Identity legibility — PARTIAL (remaining items playtest-adjacent)

- [~] Element-forked cast *presentation*: SFX carries the hand's element; the volley shards themselves already render element-colored/behaved (emergent — a fire nova LOOKS fire, a bounce cage LOOKS like a cage); local caster gets an element-tinted flash. Bespoke per-element VFX *shapes* remain doctrine-gated ("only if playtests demand in writing", locked doctrine #2).
- [x] Void-element emission kills route ascension-denial death FX (SOUL_DENIED — renderContract + deathFxPainter; 3 tests; same path in replay clips).
- [x] Victim-side legibility: statuses (incl. burn/freeze/slow — previously invisible on nameplates) land on the roster nameplate row with radial decay arcs + local chip strip. In-world above-head rig marks deferred (rig pose-path, riskier surface; StatusVfxController particles carry the world-space read meanwhile).

### Phase 3 — Cards touch the engine directly

- [ ] `abilityModifier` fields on `WeaponCardModifier` (chargeRate / radiusMult / budget shape) + codegen pass. NOTE: the axis half of this phase (axis membership, axis-live cast expression, ability cards) moved to `docs/six-axes-goal.md` (2026-07-17) — only the charge-economy modifiers remain here.
- [ ] Cursed cost variants (blood-cast) — gated on the cursed tier existing.
- [ ] Charge-economy audit: bell-rush casts, carry-over degeneracy, TTK interaction. Retune numbers table above.

### Phase 4 — Live funnel gate (non-skippable)

- [ ] Real host, 2–4 humans or 1 human + bots, ≥5 rounds, checklist below.
- [ ] Flag default flips to `emission_v1`; flag deleted next release.

---

## Test architecture

### Unit (must be green)

| Case | Expect |
|------|--------|
| Deal 200 damage | Charge = full (fill math exact at the 0.5 dealt rate) |
| Cast at <100 charge | Rejected, no spawn, charge unchanged |
| Cast at 100 | Volley spawned per `resolveEmission`; charge = 0 |
| Emission vs full-health target | Total possible damage ≤ budget (< base HP) |
| Fire-element hand casts | Burn applied to hit victims at capped duration |
| Death mid-charge | Charge preserved through respawn |
| Round rollover | Charge preserved; match end resets |
| Hash parity | TS and Zig agree on charge every tick (existing hash harness) |
| `resolve_emission_test` | Zig config matches TS for every card in the pool |
| Hangout mode | Ability bit is a no-op |

### Forbidden "green but unplayable"

Phase 4 live checklist is part of **done**. Unit green alone does not close this goal.

---

## Acceptance — it's done when

### A. Product (human)

On the **real** host URL, ≥5 rounds:

1. The meter's purpose is discoverable without being told (fill → pulse → press → payoff).
2. Asked after drafting: *"Did any pick change what your Emission does?"* → **Yes, and they can say how.**
3. A fire-hand cast and a bounce-hand cast are visibly different events to a spectator.
4. Nobody was 100-0'd by a single cast.
5. The cast moment reads on stream/clips without explanation (seal-flash + camera punch carry it).

### B. Engineering

1. `bun test` + typecheck green, including new parity tests.
2. State hash stable across a full bot match with casts (TS vs Zig).
3. No new wire messages; no protocol bump.
4. Grep clean: no "dead sim field" comments about `abilityCharge`.

### C. Elegance bar

- One resolver family owns the payload (`emission.ts` beside `weaponBuild.ts`); UI and bots read its output, never re-derive.
- Zig contains zero card knowledge beyond today's; one cast branch total.
- No per-character code in v1; no per-element sim code ever unless a playtest demands it in writing.
- The draft overlay, the seals, and the cast share one vocabulary — emission, seal, vessel — with zero new nouns introduced.
- Axis membership is a pure derivation over `WeaponCardModifier` fields (one function, testable); no card lists axes by hand in v1, and no code branches on "which axis is this card" outside that derivation + the resolver.

---

## Anti-patterns (do not reintroduce)

1. **Ability menus / loadout screens.** The draft is the only chooser.
2. **Bespoke per-ability Zig logic.** Parameters cross the boundary; behavior does not.
3. **A second damage model** for emissions. One hit path, budgeted inputs.
4. **Charge as a purchasable/essence sink.**
5. **Casting as a round-opener meta** left unaudited (Phase 3 owns it — don't ship past it).
6. **New HUD visual language** for the meter (facetedRing or nothing).
7. **Declaring done from unit tests only.**
8. **An axis as a mode, stance, or spec.** Axes stack; anything that makes Drain and Ward mutually exclusive violates the composition law.
9. **Axis #7 before axis depth.** New ability ideas file under an existing axis as cards; the vocabulary is closed until every axis has real content and a playtest demands more.
10. **Axis membership as hand-authored spam.** Derive from modifier fields; explicit tags only where derivation is genuinely ambiguous (Phase 3).

---

## Relationship to other goals / systems

| System | Relationship |
|--------|--------------|
| `escalation-engine-goal.md` | Upstream. The draft feeds the hand; the hand feeds the Emission. This goal multiplies that goal's decision weight |
| War-crimes register / cursed tier | Downstream content: cost modifiers, register language for cast lines |
| Vampire / status-nameplate work | Siblings: statuses the Emission applies at scale must be legible on nameplates |
| Ascension denial | The void-emission kill is its marquee trigger |
| combat-balance-ttk skill | Owns the damage numbers; this goal owns the loop and the budget's existence |
| Camera systems (AI-lock, beat-cut) | The cast is a legitimate punch-zoom moment; no new camera work required |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Hash desync from charge-fill drift | Phase 0 ships fill alone, soaked on bots, before any cast exists |
| Emission feels samey across hands | Element/impact/status already differentiate; Phase 2 presentation fork; bespoke sim shapes only on written playtest demand |
| Bell-rush full-bar openings degenerate | Phase 3 audit; fallback lever = carry-over cap %, one constant |
| Scope creep into character ults | Cast-frame direction locked but explicitly deferred; reopening = new goal |
| Budget clamp makes casts feel weak | Budget buys AoE/status/zone, not raw HP deletion — the fantasy is the seal-press moment, tuned by feel in Phase 4 |

---

## Success metric (north star, not vanity)

**Casts per human per match ≥ ~1 per round by mid-match**, AND in playtest interviews players describe their Emission *in terms of their cards* ("my burn nova," "my bounce cage") — unprompted. If they name it by their build, composition won.

Long-run (post axis content): players describe builds as **axis blends** — "vampire ninja," "ward gnostic" — without those phrases appearing anywhere in the UI. The vocabulary emerging in players' mouths from stacking alone is the proof the axes are real and orthogonal.

---

## One-line definition of done

**One button, no menu: the vessel fills from the fight, the seal presses, and everything the draft built comes out at once — deterministic in two languages, budgeted below a kill, legible from across the arena.**
