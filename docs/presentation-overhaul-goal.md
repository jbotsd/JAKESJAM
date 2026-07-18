# GOAL — Presentation Overhaul: character-generated light constructs (done-done)

**Status:** North star for the massive graphical / animation / weapons pass. Fleshes
`class-overhaul-workboard.md` chunk 2.7 (heaven-tank VFX) into an exhaustive spec, and is the
concrete execution of the north-star's §4 (every mechanic reads at its site) and §5 (VFX is an
independent layer over the event stream). **Doctrine parents:** `design-axioms.md` §VII
(A16–A20 — the presentation axioms), `IDENT-GRAMMAR.md` (forbidden geometry), `character-
sheets-v1.md` (per-class feel + the *avoid* lists), `jakesjam-north-star-goal.md`.
**Reasoning:** the read IS the mechanic (A16); the class is the lens the effect refracts through
(A17); readability caps spectacle (A18). **Last written:** 2026-07-18.

---

## Mission

Every weapon, every shield, every cast in JAKESJAM is **self-light the character projects** —
not geometry bolted to a hand, but a coherent particle construct the rig *generates* from its
own body. A Geometrician conjures a crystal lance; an Interstice ninja projects twin blades of
light; a Kindred paladin **raises a fortress-board of divine energy in front of themselves** and
holds the line. One particle spine, refracted four ways (A17). The graphical pass is not paint
on top of the game — it is the game becoming *legible and alive*: the read that closes every
feedback loop (A16), rendered world-class.

**Done =** a rig-anchored light-construct system that generates per-class weapons and shields as
projected particles; the Paladin's Kindled Ward reads as a held divine energy shield across
raise / absorb / feed / drop; every ability and card effect has a construct-level read that
ships with the mechanic; and the whole pass lives in the render layer, riding the existing sim
event stream, touching no sim logic.

---

## What this is not

| Not this | Why |
|----------|-----|
| Rigid weapon *models* attached to hand bones | Jake: "the character generated the particle effect." Constructs are projected self-light — fits crystal-tech, unifies weapon+shield+cast, animates procedurally |
| A new gameplay system | Zero sim changes. This is the *presentation* of mechanics that already emit events (`ability-activated`, `ward-absorbed`, `shot-fired`, `emission-cast` — verified present). §5 independence |
| Religious / templar iconography | `character-sheets-v1.md` bans it for Kindred (no "gothic plate," "blessed weapon lore," "smite-the-unclean," "church pavise heraldry"). "Divine" = **light density**, not liturgy |
| Forbidden sacred geometry | `IDENT-GRAMMAR.md`: no Eye-of-Providence, no triangle-capping-ring, no hexagram/pentagram, no accidental composites. Divine reads as *faceted crystal light*, invented not borrowed |
| Spectacle that buries the fight | A18 — the rig body and hitboxes stay the loudest read; constructs *frame* the body, never hide the enemy behind them |

---

## The spine — a rig-anchored light-construct system

One system generates all constructs; classes are presets over it (A17, discrete infinity).

- **Emission anchors.** The procedural rig (`ProceduralPlayerRig.ts`) exposes named anchors —
  lead hand, back hand, chest/core, feet, aim-point. A construct is particles *streaming from an
  anchor* into a target shape. Self-light: particles originate at the **body** (the core/hands),
  visibly proving the construct is self-generated (Autogenes source — the light is *yours*).
- **Construct = shape + flow + density.** A construct is defined by (1) a target silhouette
  (blade, board, lance, thread), (2) a flow (particles rushing out to *form*, holding to
  *sustain*, dissolving back to *drop*), (3) a density curve (thin/fast for blades, dense/settled
  for the ward). Density is the paladin's whole feel — heavy light.
- **Driven by sim events, nothing else (§5).** A construct's lifecycle hooks the events that
  already fire: `ability-activated` (raise), `ward-absorbed` (impact bloom), `shot-fired` /
  `emission-cast` (project), state-field expiry (drop). The render layer subscribes; it never
  reads sim logic or reconcile state beyond the snapshot fields already wired.
- **Performance is a first-class constraint (ties `END_PRODUCT_GOAL` §3).** The construct system
  runs inside the existing particle-pool / immediate-mode budget; it must bake for Pi/phone and
  degrade gracefully — a construct at potato tier is a simpler silhouette, never absent (A16: the
  read never disappears, only the polish).

---

## THE CENTERPIECE — the Kindred paladin's divine energy shield (Kindled Ward)

The class's entire fantasy is *hold-the-board heaven-tank* (`character-sheets-v1.md`: "board as
fortress + weapon," "self-light density," settled not sky-god). The ward is the deepest
construct in the game and the flagship of this pass.

### The four reads (each an event hook — A16)
1. **RAISE** (`ability-activated` / ward-hold begin): particles rush *out from the paladin's
   core and hands* and knit into a **dense faceted plane of light** in front of them, aim-facing.
   Not a flat disc — a *board*, a fortress panel with visible internal lattice (invented crystal
   facets, IDENT-GRAMMAR-legal). The rush reads "this came from *me*" (Autogenes). Anticipation
   frame: a brief in-draw (light gathers to the core) before it throws out — weight.
2. **HOLD / SUSTAIN**: the board *breathes* — slow settled pulse, particles circulating within
   the lattice, anchored to the paladin's brace stance (the rig plants, leans into it). Heavy,
   grounded, immovable-feeling. This is the "settled" contrast to the ninja's flick.
3. **ABSORB** (`ward-absorbed`, already firing): a hit lands → a **bright impact bloom at the
   contact point** on the board, a shock ripple across the lattice, and — critically — particles
   **feed back into the paladin's body** (the Kindling resource gain, made visible: the shield
   *drinks* the blow and returns it to you as power — A16 read of the economy, A14 reward steer).
4. **DROP / BREAK**: on window end or break, the board **dissolves back into the body** (particles
   return home, not scatter to the void) — reinforcing self-source, and distinct from a *shatter*
   (which would read as "you lost it" — reserve shatter for an actual overwhelm/break event).

### Feel contract (the *divine energy* read)
- **Divine = density of light, not religious symbol.** The awe comes from *how much light,
  how coherent, how heavy* — a wall of woven radiance — never from a cross, halo, or scripture.
- **Color:** the Kindred light register (kindled gold/white per `character-sheets-v1.md`; confirm
  against palette). Warm, dense, settled — distinct from the Emission's sapphire ward-shell
  (six-axes) and the Syzygist's cool-white. The player must tell paladin-ward from emission-ward
  at a glance.
- **Weight in animation:** every ward beat carries anticipation + follow-through; the rig *commits*
  (plant, brace) — a paladin holding the board should look like they could stop a truck.

### Depth hooks (each Kindred ability refracts the ward construct)
- **Bastion Pulse** (#7): a bright inward self-absorb flare — the board pulled tight to the body.
- **Aegis Share** (#8): the board's shadow extends a faint lattice toward allies (team read).
- **Consecrated Field** (#5): the same light *poured to the floor* — a settled ground-plane of the
  same lattice, self-sourced.
- **Unbroken Seal / Kindled Edge**: the paladin's *weapon* is the same light — a dense edge-construct
  (see Weapons below) — so ward and edge read as one material: **you fight and defend with the same
  divine light.** That unity IS the class identity.

---

## Weapons — projected constructs, per chassis (A17)

Weapons are the same self-light spine, shaped per class. Minimum viable = "weapons for
animations" (a construct present during the relevant animation so a slash has a blade to slash
with); full = the polished per-class construct language.

| Class | Weapon construct | Feel |
|-------|------------------|------|
| **Kindred** (paladin) | **Kindled Edge** — a dense, heavy light-blade/maul; same material as the ward | Settled weight, hard hits, commit frames |
| **Interstice** (ninja) | **Twin light-blades** — thin, fast, contact-close; wave arcs trail the slash | Flick, hit-stop, no follow-through drag |
| **Geometrician** (wizard) | **Crystal lance / prism** projected along aim | Angular, charge-and-release, geometry-first |
| **Syzygist** (priest) | Cool-white **thread/tether** + modest projectile motes | Entanglement, thin, unsettling-benevolent |

**Minimum-for-animation first:** every chassis verb (slash, ward-hold, cast, thrust) needs a
construct silhouette present during its animation *now*, even rough — because A16 says a slash
with no visible blade "reads as broken" and mis-tunes feel. Polish the silhouette later; ship
the read with the mechanic.

---

## The four-lens graphical pass (A17 · A18)

The pass sweeps every class so the *same* underlying mechanics read as unmistakably different
constructs — and the fighter stays loudest throughout (A18).

- **Per-class construct language locked** (crystal geometry / twin blades+waves / dense
  divine board+edge / cool-white threads) — a spectator names the class from the constructs alone.
- **Readability budget enforced:** with Emission + rack abilities + cards + resonance + chaos all
  able to fire at once, constructs must *frame* the bodies, never bury them. The footage-caught
  backdrop-louder-than-fighters leak (A1/A18) is fixed as part of this pass — scenery recedes so
  constructs and bodies own the read.
- **Sound is the second channel (A19):** every construct has an audible fingerprint (ward *raise*
  hum, absorb *chime*, edge *shear*, resonance *chord*) so a player tracks state by ear when the
  screen is full. Ties `audio-engine.md` / `audio-memeology.md`.

---

## Animation pass (on the procedural rig)

- **Anticipation → action → follow-through** for every construct beat (raise, slash, cast, absorb).
- **Weight per class:** Kindred *commits* (plant, brace, recover-slow); Interstice *flicks*
  (snap, no drag); Geometrician *charges* (wind, release); Syzygist *weaves* (smooth, tethered).
- **Hit-stop + follow** on impactful beats (already partially present — extend to constructs).
- **Rig respects the construct:** the hands/body pose to *hold the board*, *throw the blade*,
  *pour the field* — the animation and the construct are authored together, not layered blind.

---

## Phases

- **P0 — Spine + minimum reads.** The rig-anchored construct emitter + a rough silhouette per
  chassis verb (weapons-for-animation), hooked to the existing events. No mechanic renders
  read-less. *Unblocks everything; smallest.*
- **P1 — The divine shield (centerpiece).** Kindled Ward's four reads (raise/hold/absorb/drop) +
  feel contract, full polish. The flagship; proves the spine.
  **PREREQUISITE:** the paladin roster must be complete first. Kindred today is under-covered
  (buff ×1, movement ×1 — below its own ≥2/role floor), has 2 solo-dead abilities, and is ~60%
  the wizard's *build* depth (Tier 2, gated). You cannot world-class-render an incomplete class.
  Close the roster per `axiom-deviations-audit.md` § Kindred proposed fix (add "Kindled Resolve"
  + "Bulwark Step", solo-clause Aegis/Rally) and build to wizard-parity *before* P1 polish lands.
- **P2 — Weapons polish, all four lenses.** Per-class construct languages to world-class.
- **P3 — Ability/card construct pass.** Every ability + card effect gets its construct read
  (rides `ability-activated` etc.), per-class refracted.
- **P4 — Animation + audio + readability.** Anticipation/weight/hit-stop pass; audio
  fingerprints; the fighter-loudest / backdrop-recede enforcement; Pi/phone bake.

---

## Acceptance — it's done when

### A. Product (player / spectator)
1. A spectator names each class from its constructs alone, no HUD.
2. The paladin *raising the ward* reads as "a wall of their own light" and *feels* heavy.
3. Absorb visibly *feeds* the paladin (you see the shield turn a blow into power).
4. In a busy fight, a player tracks "a ward went up / a curse landed / resonance hit" by *ear*.
5. No cast or construct ever hides the enemy behind it (A18).

### B. Engineering
1. Zero sim-logic edits — the pass imports only render/event modules (§5 verified).
2. Every mechanic emits/uses a named event with a construct read; a checklist gate catches any
   read-less mechanic before merge (A16).
3. Constructs run inside the particle budget and bake for Pi/phone (degrade silhouette, never
   remove the read).

### C. Elegance
- One construct spine, four lenses — the ward, the edge, the blade, the lance, the thread are all
  *the same self-light material* refracted, so the whole game reads as one coherent crystal-tech
  world (A17, harmony can't be bolted on).
- "Divine" earned by light density and animation weight, not one borrowed symbol.

---

## Anti-patterns

1. **Rigid weapon models** bolted to bones instead of projected constructs (breaks the spine + the
   fiction).
2. **A read deferred to "the VFX pass later"** — the read ships with the mechanic; only polish
   defers (A16).
3. **Any forbidden geometry** (Eye/triangle-ring/hexagram) or **liturgical iconography** on Kindred.
4. **Spectacle over legibility** — a construct you can't see the fight through (A18).
5. **VFX reaching into sim** — coupling the pass to mechanics (breaks §5 independence).
6. **Per-class one-offs with no shared spine** — four bespoke effect systems instead of one
   refracted (breaks A17 and the perf budget).

---

## Relationship to other goals

| Goal | Relationship |
|------|--------------|
| `jakesjam-north-star-goal.md` | This is §4 (read at site) + §5 (independent layer) made concrete |
| `design-axioms.md` §VII | A16–A20 are the spec's spine; every read/feel claim traces to one |
| `END_PRODUCT_GOAL.md` | Its §2 (looks dramatically better) + §3 (smoothness) — this pass must bake per that vessel |
| `classes-goal.md` / `character-sheets-v1.md` | The per-class feel contracts + *avoid* lists this pass renders |
| `class-overhaul-workboard.md` 2.7 / 3.5 | The VFX chunks — this goal is their exhaustive spec |
| `IDENT-GRAMMAR.md` | The forbidden-geometry gate every construct passes |

---

## One-line definition of done

**Every fighter conjures their weapons and shields from their own light — and when a paladin
raises the board, a stranger watching sees a wall of divine radiance that person made, feels its
weight, and understands the whole fight without a word.**
