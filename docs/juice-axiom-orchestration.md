# JAKESJAM — Bite-Sized Juice + Axiom Orchestration

**Status:** Working orchestration contract for presentation, combat-read, and
game-feel work. This document turns the juice skill, the canonical design
axioms, and the local game-design book corpus into independently executable
packages.

**Authority:** `CLAUDE.md` wins on runtime truth. `docs/design-axioms.md` owns
design reasoning. `.claude/skills/game-feel-juice/SKILL.md` owns the render-only
juice boundary. `docs/presentation-completion-goal.md` owns the final completion
matrix.

---

## 1. The unit of orchestration

Do not divide work into isolated "VFX", "audio", and "animation" tasks.
Game feel is judged as a complete reaction stack, so the smallest useful work
package is:

> **One meaningful player action, its target-state change, its complete layered
> reaction, its recovery rhythm, and the evidence proving the player can read
> and feel it.**

Examples of valid packages:

- Starter shot: throw anticipation → launch → recoil → sound → recovery.
- Heavy hit: impact-site change → victim reaction → sound → restrained freeze.
- Kindled Ward absorb: brace → catch → charge response → chime → settle.
- Draft pick: commit → chosen-card response → sound → build confirmation.

Examples of invalid packages:

- "Add particles to every ability."
- "Do all class audio."
- "Add camera shake globally."
- "Polish `ConstructVfxController.ts`."

Files are implementation details, not orchestration boundaries.

---

## 2. Five operational axioms

The full twenty axioms remain canonical. Workers actively carry these five;
the remaining axioms are diagnostic lenses loaded when relevant.

1. **Every action produces a legible state change.** A silent or invisible
   result reads as broken. (`A1`, `A16`, `A19`)
2. **Every escalating loop names its brake.** Use caps, costs, diminishing
   returns, slow cycles, or difference-fed negative feedback. (`A3`)
3. **Every option has an orthogonal reason to exist.** A weaker copy is not a
   choice. (`A7`)
4. **Complexity is revealed at the player's pace.** Keep conscious decisions
   small; background automatic loops and teach combinations after primitives.
   (`A5`, `A10`, `A12`)
5. **The representative player's enjoyment wins.** The target is the newcomer
   clicking a URL, not the developer who already knows the system. (`A12`)

Important interpretations:

- "2–4 major loops" means **conscious decisions to track**, not a literal ban
  on automatic internal loops.
- Perceived fairness never excuses broken mathematics; fairness must be both
  mechanically defensible and visibly legible.
- Prefer emergence over high-stakes dice, but randomness is valid when it
  preserves agency, is consented to, or forces useful improvisation.
- Use layered disclosure before building separate optimizer and immersion
  interfaces.

---

## 3. Juice contract

Every meaningful event uses at least three coordinated channels, selected
from:

- animation / pose;
- construct or impact VFX;
- sound;
- camera response;
- render-only hit-stop;
- colour / brightness response;
- recoil or scale punch;
- particles / debris.

Three channels are a floor, not permission to fire every channel. One channel
leads; the others confirm. Busy eyes are offloaded to audio.

### Hard boundaries

- Juice stays under `client/src/game/`; never put presentation behavior in
  `client/src/sim/`.
- Hit-stop may affect render/tween presentation only. The sim, network tick,
  and input feed never pause.
- Never let a weak shake overwrite a stronger shake; use one arbitration bus.
- Fighters, targets, and hitboxes remain the loudest read on screen (`A18`).
- Phone/Pi tiers simplify richness but never remove the core mechanical read.
- Replay-rendered presentation uses deterministic inputs when the evidence
  contract requires repeatable frames.

### Intensity vocabulary

| Tier | Typical events | Presentation intent |
|---|---|---|
| `micro` | step, UI focus, minor tick | Confirmation without attention theft |
| `action` | basic shot, jump, shield raise | Clear authored rhythm |
| `hit` | normal impact, card proc | Target change is unmistakable |
| `heavy` | bash, explosion, major ability | Strong but fight remains readable |
| `kill` | player death, execute | Brief peak with immediate recovery |
| `cast` | Emission, signature defense | Class-defining sensory fingerprint |
| `round` | round start/end, draft commit | Macro pacing punctuation |

Numerical values live in one shared budget module, not in this document.

---

## 4. Book-corpus grounding

The local `book_extractions` Qdrant collection contains the four design books
in `~/Downloads`:

- Ernest Adams, *Fundamentals of Game Design (Third Edition)*;
- Ernest Adams, *Fundamentals of Role-Playing Game Design*;
- Ernest Adams, *Fundamentals of Shooter Game Design*;
- Ernest Adams & Joris Dormans, *Game Mechanics: Advanced Game Design*.

Use the corpus to retrieve mechanisms, not decorative quotations. Useful query
families:

```text
<mechanic> feedback action reaction recovery readability
<system> positive feedback investment return speed brake
<choice set> dominant strategy orthogonal differentiation opportunity cost
<player journey> pacing demand rest replenish learning primary secondary skills
<economy> reward schedule desired behavior resource source drain converter
```

The intended MCP operation is:

```text
qdrant-find({ query: "..." })
```

### Current local compatibility note

The collection uses Qdrant's unnamed 384-dimensional vector. The currently
installed `mcp-server-qdrant` requests a named vector
`fast-all-minilm-l6-v2`, so its normal search currently fails. Until the MCP
adapter detects unnamed-vector collections and omits `using=`, use the local
read-only fallback with:

- Qdrant URL and API credential loaded from the existing `qdrant-books`
  entry in `~/.claude.json` (never copy the credential into the repo);
- collection `book_extractions`;
- embedding model `sentence-transformers/all-MiniLM-L6-v2`;
- a query-points request that omits the vector-name/`using` argument;
- payload fields `author`, `title`, `section`, and `text`.

Do not migrate or rewrite the collection merely to fix the reader. Repair the
read adapter or provide a maintained read-only wrapper.

### Evidence rule

A work package records:

- the retrieved mechanism in paraphrase;
- source title + section;
- which axiom it supports or challenges;
- what observable acceptance test follows from it.

Do not use retrieval volume as confidence. One diagnostic passage plus direct
play evidence is stronger than many vaguely related results.

---

## 5. Dependency waves

### Wave 0 — Shared rails (single owner)

Ship before broad parallel presentation work:

1. Machine-readable mechanic/event registry.
2. Event-to-presentation ownership matrix.
3. Shared intensity budgets.
4. Camera-shake arbitration.
5. Render-only hit-stop arbitration.
6. Audio priority/ducking policy.
7. Particle/transient-object budgets.
8. Forced autoplay scenario interface.
9. Evidence-path convention.
10. Phone/Pi degradation contract.

Wave 0 owns interfaces, not individual ability art.

Current evidence:

- Event registry: `client/src/game/render/eventPresentationRegistry.ts` —
  exhaustive over `SimEvent["t"]`, with honest complete/partial/missing state,
  channel stack, intensity tier, and low-tier core.
- Registry gate: `eventPresentationRegistry.test.ts` — complete events require
  at least three distinct channels and known missing reads cannot disappear
  silently from the backlog.
- Existing rails to reuse: `ActionCamera` / `CameraJuice`, `SlowMotion`,
  `qualityProfile.ts`, `SimEventRouter`, and `scripts/autoplay.ts`.
- Numerical intensity contract: `presentationBudgets.ts` owns monotonic
  priority, shake, render-hit-stop, and transient ceilings for all seven
  vocabulary tiers. It also defines phone/potato transient degradation while
  explicitly excluding core pose, silhouette, state-chip, and effect-site
  reads from degradation. Router shot/hit/kill values now consume this rail.
- Audio absence is channel-local degradation: `SimEventRouter` uses a silent
  audio adapter rather than returning early, so autoplay gating or unavailable
  WebAudio can never suppress visual, UI, hit-stop, or camera reactions.
- Render-time arbitration: `RenderTimeArbiter.ts` is now the sole production
  writer of `tweens.timeScale`. Source-keyed holds compose by strongest active
  scale, repeated requests extend rather than truncate, input releases only
  slow-motion, and hit-stop expiry reveals any remaining slow-motion hold.
  Online and practice scenes share the arbiter with `SlowMotion`; standalone
  router consumers receive overlap-safe internally keyed holds.
- Evidence contract: `scripts/presentationEvidence.ts` defines required beats,
  anticipation/action/impact/recovery frames, separate video and audio-only
  artifacts, six semantic review lenses, defects, and tier identity.
  `presentationScenarios.ts` is the scenario registry; it distinguishes
  naturally drivable cases from those still needing a deterministic force
  hook. `bun run presentation:evidence` audits every registered scenario at
  potato, phone, and standard tiers and fails honestly on missing runs.
- Autoplay capture bridge: `scripts/autoplay.ts --scenario <id> --quality
  <tier>` enables a browser-local evidence channel. `SimEventRouter` publishes
  only already-dispatched authoritative event tags when `?evidence=1`; the
  harness timestamps them and writes an explicitly `unreviewed` manifest next
  to the WebM. Inputs alone never count as triggered mechanics, and Playwright
  video does not masquerade as an isolated audio artifact.
- Evidence attribution and audio hardening: dispatched evidence events now
  identify local actor/target involvement; remote-only events are retained
  under `remote:*` beats but cannot satisfy a local package. Evidence mode
  mirrors the game audio limiter into a MediaStreamDestination and writes a
  genuine Opus audio-only artifact (the Playwright WebM remains video-only).
  A generic all-required-beats gate ends captures after recovery rather than
  burning an entire match, and event-relative `framePlan` recipes drive
  deterministic anticipation/action/impact-burst/recovery extraction through
  `scripts/extractPresentationFrames.ts`.
- First closed status package: `player-slowed` now has a persistent paired
  foot-level drag wake in `StatusVfxController`; the authoritative movement
  reduction and existing SLOW chip complete the three-channel read.
- First closed class-defense package: `syz-ward-absorbed` now routes to a
  cool-white protected-vessel pulse, a smaller ally-caster attribution pulse,
  break-scaled shape, and locally gated shake. The registry has no events left
  classified as `missing`; `partial` remains the active completion backlog.
- Ability animation contract: `abilityAnimation.ts` exhaustively assigns all
  47 shipped activation kinds a physical verb, class cadence, anticipation,
  action window, reach, commitment, handedness, and recovery. Authoritative
  `ability-activated` events drive the render-only rig gesture. The full-rig
  harness deterministically advances a clean fighter at 120 Hz and has captured
  all four semantic phases for every contract; this proves animation coverage,
  not the ability's gameplay effect or audio.
- Ability evidence ownership: `presentationScenarios.ts` now generates one
  independently audited package per shipped active. Class catalog abilities
  use deterministic loadout-station equip; the five class-blind actives are
  explicitly `forced-hook-required`. Autoplay records `ability:<kind>` beats,
  preventing one unrelated activation from satisfying every ability row.
- Cinematic melee rebuild: Interstice and Kindred load from planted feet,
  carry hips/torso/head through the attack, share one arm/blade angle function,
  and retain only the accelerated world-space blade-tip path. Full-fighter
  filmstrips replaced construct-only approval and caught both tether harness
  contamination and an over-circular rogue trajectory before sign-off.
- Focused evidence (2026-07-18): registry/router/budget/arbitration/evidence tests pass, client TypeScript
  passes, and `git diff --check` is clean. Full Convex codegen remains an
  environment gate because it attempts restricted network access.

### Wave 1 — Core action grammar

After Wave 0, these are independently assignable when they have exclusive file
ownership:

- move/run;
- jump/land;
- Aegis dash-bash;
- shield raise/hold/reflect/break;
- starter shot;
- normal hit-confirm;
- heavy hit;
- kill/death;
- draft offer;
- draft selection;
- Emission ready;
- Emission cast;
- round start/end.

Stabilize these before catalog abilities so later workers reuse a coherent
language for "hit", "heavy", "kill", and "cast".

### Wave 2 — Class streams

Run one stream per class:

- Geometrician;
- Interstice;
- Kindred;
- Syzygist.

Within a class, split only where packages do not share a controller hotspot:

1. weapon / sacred verb;
2. defense verb;
3. movement verb;
4. Emission refraction;
5. catalog abilities in small, non-overlapping batches.

Each ability package owns anticipation → action → effect-site read → target
reaction → sound → recovery → UI confirmation → evidence.

### Wave 3 — Systemic refractions

Compose the stable core/class grammar:

- Six-axis reads;
- element variants;
- status effects;
- chaos tells;
- card effects refracted through each class;
- Resonance flourish;
- ally-target threads;
- team-defense reads;
- void-kill ascension denial.

Prefer composition of existing primitives over another effects language.

### Wave 4 — Dynamic-system brakes (separate from presentation)

Independently model and test:

- Syzygist Bleed Tithe + Contagion + Flock Pulse brake;
- Kindred Retribution Edge brake;
- Geometrician Return Glass brake;
- first-blood feedback review;
- rack non-domination tests;
- class-resource vs Emission-charge loop count;
- progressive exposure for newcomers;
- resource-aware bot difficulty.

For each, diagram:

```text
investment → production → advantage → next investment
```

Then name the brake and validate it by simulation. Dynamic systems cannot be
signed off by inspection alone.

### Wave 5 — Convergence

1. Force every scenario.
2. Record video and audio.
3. Extract anticipation, action, impact, and recovery frames.
4. Judge the whole feedback stack semantically.
5. Record every defect, not only the worst one.
6. Fix the full defect list.
7. Repeat until consecutive complete passes find nothing new.
8. Lock values only after convergence.

---

## 6. Concurrency and ownership

Use at most four simultaneous streams unless the working environment provides
more isolated worktrees and an explicit integrator.

Suggested four-slot allocation:

| Slot | Responsibility |
|---|---|
| 1 | Shared-contract/integration owner |
| 2 | Package stream A |
| 3 | Package stream B |
| 4 | Harness, evidence, and independent review |

Rules:

- One active owner per shared hotspot.
- Every package declares allowed files and forbidden shared files before work.
- Existing dirty files remain owned by their original author until explicitly
  handed off.
- If two packages need the same hotspot, serialize them or extract a seam first.
- The integrator resolves interfaces; package workers do not opportunistically
  redesign shared contracts.
- A package is not complete while its forced scenario is unobserved.

Common hotspots requiring explicit ownership:

- `client/src/sim/World.ts`;
- `client/src/game/scenes/OnlineMatchScene.ts`;
- `client/src/game/render/SimEventRouter.ts`;
- `client/src/game/systems/ConstructVfxController.ts`;
- `client/src/main.ts`;
- shared palette/style files.

---

## 7. Bite-sized package template

Copy this block for every package:

```md
# Package: <action or mechanic>

## Boundary
- Player action:
- Target/state change:
- Triggering sim event(s):
- Explicitly out of scope:

## Reasoning
- Primary axiom:
- Supporting axioms:
- Book mechanism (paraphrased):
- Source title / section:
- Desired player behavior:

## Feedback stack
- Leading channel:
- Confirming channel 1:
- Confirming channel 2:
- Optional channel:
- Intensity tier:
- Recovery rhythm:
- Audio-only tell:
- Readability ceiling:
- Phone/Pi form:

## Ownership
- Allowed files:
- Forbidden/shared files:
- Upstream dependency:
- Downstream consumers:

## Acceptance
- [ ] Trigger produces a legible effect-site state change.
- [ ] At least three coordinated feedback channels fire.
- [ ] Fighter, target, and hitbox remain readable.
- [ ] Sim/network/input clocks never pause.
- [ ] Audio communicates the state without watching the effect.
- [ ] Repeated use is not fatiguing.
- [ ] Low tier retains the core read.
- [ ] Forced harness scenario exercises the package.
- [ ] Anticipation/action/impact/recovery evidence captured.
- [ ] Relevant tests and typecheck pass.

## Evidence
- Scenario command:
- Recording:
- Frames:
- Audio-only review:
- Test output:
- Remaining defects:
```

### Package sizing rule

A package should normally fit one focused implementation/review cycle. Split it
when it has more than one distinct player action, more than one target-state
change, or requires unrelated shared-file ownership. Merge tiny tasks when they
cannot be meaningfully judged outside the same feedback rhythm.

---

## 8. Review questions

Review each package in this order:

1. Can a newcomer tell what changed and why?
2. Does the reaction strength match the gameplay stake?
3. Is the action's rhythm clear from anticipation through recovery?
4. Can the state be tracked by ear when the screen is full?
5. Does any effect obscure the target, fighter, or next decision?
6. Does this option have a reason to exist that is different in kind?
7. If it generates advantage, where is its brake?
8. Does it add another conscious loop, or can it remain backgrounded?
9. Does it survive repeated use without fatigue?
10. Has it been run and observed, rather than approved from code alone?

---

## 9. Definition of done

A package is done only when:

- its complete action/reaction/recovery loop exists;
- the effect is legible at its site;
- at least three restrained, coordinated channels support it;
- it stays inside render/sim boundaries;
- its axiom and book-derived mechanism are recorded;
- its forced scenario has been observed;
- evidence covers anticipation, action, impact, and recovery;
- low-tier behavior retains the mechanic's read;
- automated checks pass;
- every defect from the latest review pass is resolved or explicitly returned
  to the queue with a new package boundary.
