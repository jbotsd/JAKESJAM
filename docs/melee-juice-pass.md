# Melee Juice Pass — Interstice and Kindled

## Target

The slash must feel good as one temporal sentence, not as an arc effect:

`readable load → violent acceleration → confirmed contact → travel past contact → exposed recovery`

The supplied Fab still and YouTube Short are pose/timing references only. No
third-party mesh, animation, or audio is imported.

## Research translated into constraints

- The Fab Dual Sword Animations V2 pack separates combo attacks, individual
  attack stages, and stage-to-idle break animations. The useful mechanism is
  explicit stage ownership: recovery is authored, not whatever remains after
  the strike (`https://www.fab.com/listings/a9409c38-d72c-4306-99af-9a8ccdbd6119`).
- Epic's Motion Warping documentation places the target-warp window from the
  opening of an attack to the strike, not through the entire recovery. In this
  2D renderer that means aim alignment governs coil/cut; follow-through remains
  committed rather than magnetically tracking the target after contact
  (`https://dev.epicgames.com/documentation/unreal-engine/motion-warping-in-unreal-engine`).
- Epic's locomotion guidance treats pose warping as a way to keep pose and
  movement coherent while gameplay tuning remains independent. Here the hand
  pivots follow the live procedural rig while sim position and hit geometry
  remain authoritative (`https://dev.epicgames.com/documentation/en-us/unreal-engine/locomotion-in-unreal-engine`).
- Muriel Cartwright's GDC animation material emphasizes readable anticipation;
  the implementation reserves a distinct pre-cut window rather than hiding the
  wind-up inside one easing curve.
- Book-corpus mechanism already retrieved for A1/A16: visible state change
  closes the action-feedback loop. Therefore whiffs retain motion/trail but do
  not fabricate contact sparks; confirmed `slash-hit`/`hit-confirmed` owns the
  impact response.
- A 3-D kinematic study of kendo strikes measures centre-of-body displacement
  and wrist, elbow, shoulder, hip, and knee angles as one motion system; that
  rules out treating the glowing blade as an isolated rotating prop
  (`https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART001437084`).
- Saber-fencing kinematic analysis found blade-tip velocity strongly related
  to joint-angle economy. The useful game-animation translation is not
  "freeze the joints," but stage their contribution: load the upper arm,
  extend through contact, then let wrist/blade travel continue after the hand
  begins folding (`https://emerginginvestigators.org/articles/21-230`).
- Game animation principles reinforce that acceleration/deceleration, arcs,
  follow-through, and overlapping action sell relative mass. The fighter's
  body chain and weapon therefore do not start or stop on the same frame
  (`https://www.gamedeveloper.com/production/the-12-principles-of-animation-in-video-games`).

## Pass 1 — structure

### Interstice

- 280 ms render sentence.
- 22% anticipation, 35% accelerated cross-body cut, 27% follow-through, 16%
  recovery.
- Alternating active hand; off-hand occupies a distinct guard/counterbalance
  pose instead of duplicating the lead blade at one pivot.
- Both blade pivots follow the rig's current hands throughout the attack.
- Full procedural body shifts back during load, forward during cut, stays
  committed through follow-through, then returns.

### Kindled

- 430 ms render sentence: longer load and recovery than Interstice.
- Shield hand remains braced across the body during sword commitment.
- Dense edge passes the target and holds its ending line before returning.
- Shield is offset from the sword lane so offense and defense remain separately
  legible.

## Pass 2 — semantic filmstrip review

Captured with deterministic progress sampling in the live Phaser construct
harness (`scripts/constructHarnessShots.ts`), rather than wall-clock screenshot
sampling.

Findings and fixes:

1. Previous wall-clock capture skipped most of each attack because screenshot
   latency exceeded the short cut window. Harness now sets exact normalized
   progress for every frame.
2. Kindled board crowded the sword lane. Board moved to the off-line brace.
3. Painters produced timed "impact" sparks even on whiffs. Removed; confirmed
   sim contact owns impact punctuation.
4. Interstice follow-through is now visibly held across multiple samples,
   instead of immediately springing back at contact.

## Pass 3 — separation and honesty

Re-captured 18 exact Interstice samples and 22 exact Kindled samples after the
lane and contact fixes.

- Interstice preserves a quiet six-sample coil, crosses the target during a
  short high-density trail burst, and holds the low finishing line before
  dissolving into recovery.
- Kindled remains visibly slower: the sword begins behind the raised board,
  crosses its face without being hidden by it, then finishes low while the
  shield continues to read as a defensive brace.
- Neither whiff emits a contact spark. Trail communicates velocity; only a
  confirmed hit is allowed to communicate collision.

## Ground-up cinematic rebuild

The compact painter-first pass was superseded after live direction called for
a wider, more cinematic motion grounded in the path a held blade really takes.

- Interstice is now a 360 ms sentence with a 32% ground-loaded coil and a
  deliberately narrow 20% acceleration window. Its nominal sweep is 2.25
  radians; coil-to-overshoot blade travel is roughly 3.24 radians (186°), with an
  82 px blade reach. This remains screen-wide without becoming a full windmill.
- Kindled is now a 560 ms sentence with a deeper 38% load, a 2.5-radian dense
  edge path, 88 px reach, and longer committed finish.
- Feet remain planted at their authoritative render contacts while hips,
  chest, and head compress during the load and release into forward centre-of-
  mass travel. Chest and head now lead progressively beyond the pelvis during
  the cut so the shoulder line visibly carries force through the target.
- Blade orientation and the trail sampler consume the same authored blade
  curve. The arm consumes a separate linked shoulder-to-hand curve, allowing
  elbow-led loading and wrist/blade lag without disconnecting the hilt from
  the live hand.
- The persistent trail is sampled from actual world-space blade-tip positions,
  including translating hand/body motion. Slow anticipation points are
  excluded: only the acceleration-through-follow path emits a luminous arc.
- The deterministic harness reconstructs that same tip history, rather than
  approving isolated weapon poses that cannot prove motion.

## Kinetic-chain correction

The full-rig filmstrip exposed a deeper anatomical lie: the old hand target was
placed directly on the blade angle. Upper arm, forearm, hand, and sword became
one rigid spoke rotating from the shoulder—visually a spear on a clock hand,
not a slash.

- Interstice now has five explicit linked poses: ready, compact overhead coil,
  elbow-led acceleration, extension through contact, and cross-body fold. The
  hand radius contracts from 29 px to 20 px during load, reaches roughly 37 px
  at the radial intercept, extends to 45 px immediately beyond it, then folds
  while the blade continues to its finishing line.
- The cut curve accelerates into a 68% contact point, then brakes. This creates
  dense tip spacing at the start/end and sparse, high-speed spacing through
  the target instead of a generic ease-in/ease-out rotation.
- The off hand is a late counterguard, not a duplicate slash. It closes the
  exposed line after the dominant blade crosses while keeping a separate arm
  silhouette.
- Kindled always cuts with the sword hand. Combo direction reverses the same
  sword's travel; it no longer animates the shield hand on alternating swings.
  The shield elbow stays bent and the board remains forward through contact.
- Grounded attacks widen and plant the stance. Hips/chest carry forward while
  the feet remain behind, making force visibly originate below the shoulder.
- Melee temporarily raises arm-solver frequency during the contact window so
  the generic soft locomotion spring cannot erase a 70–130 ms cut. Interstice
  remains whippier than Kindled.
- Decorative wrist-centred crescent bands were removed. The cinematic ribbon
  and blade ghosts are reconstructed from sampled world-space tip travel, so
  hand translation and torso drive visibly bend the arc.

## Authoritative radial intercept

The cut is a compound arc, not a circle stamped around the player. The shoulder
is a translating first centre; shoulder-to-hand motion supplies one changing
radius, and the blade supplies a second rotating radius. Their sum produces the
world-space tip path. The captured aim line is the radial intercept through
that path.

- `meleeContactT()` places the intercept at the 68% velocity apex inside each
  cut: about 164 ms after Interstice starts and 300 ms after Kindled starts.
- At that instant the blade is within 0.08 radians of the captured aim line and
  still has authored travel remaining on its far side. Contact is punctuation,
  not the ending pose.
- The authoritative sim now withholds player and practice-dummy damage until
  those crossings: 44 ms into Interstice's active phase and 100 ms into
  Kindled's. It continues checking through the remaining active tail, so a
  body entering late can still be struck.
- Tests prove no damage one tick before the intercept, damage at the intercept,
  peak angular speed at the crossing, and unchanged mark/execute/shield-rider
  behavior on the newly aligned hit frame.

## Proximal-to-distal release (baseball-bat correction)

The useful baseball-swing comparison is the transfer order, not a literal
two-handed sword grip. A strong swing loads into the rear side, braces the
front side, opens the pelvis before the chest, lets the shoulders chase that
opening, and delivers the hands/weapon last. The old body pass planted the feet
but still released pelvis, chest, shoulders, hand, and blade too nearly as one
block.

- `meleeKineticChain()` now authors separate pelvis, chest, head, shoulder-line,
  and front-brace curves. Early-cut tests prove pelvis drive leads while the
  shoulders remain closed. The head now stays comparatively quiet over the
  brace while the chest turns underneath instead of lunging ahead of it.
- The shoulder axis rotates around the live chest instead of staying welded to
  the aim perpendicular. That makes torso separation visible in the 2D rig.
- The hand uses an earlier, steadier transfer curve; the blade keeps the later
  contact-peaked whip. The hand therefore begins traveling with the torso while
  the blade visibly lags, catches, and becomes the fastest link at the radial
  intercept. A finite-difference contract proves distal blade angular speed is
  more than twice hand angular speed at that crossing.
- Kindled retains the shield brace and one-handed sword anatomy. Interstice
  retains its off-hand counterguard. Only the force-transfer mechanism comes
  from the bat analogy.
- Fresh deterministic full-body filmstrips at 18 Interstice and 22 Kindled
  phases confirm rear-side coil, front-side brace, delayed shoulder release,
  and weapon-led follow-through without foot skating.

## Ability-animation rail

`abilityAnimation.ts` now exhaustively owns timing and physical gesture for
every shipped `AbilityKind`. `ability-activated` drives the caster rig through
that render-only contract. Shared gesture families keep the vocabulary
learnable, while duration, anticipation, reach, body commitment, handedness,
and class cadence are authored per ability. An exhaustiveness test covers all
active cards and checks the distinct Interstice/Geometrician/Kindled/Syzygist
weight bands.

## Current evidence and remaining review

- Complete procedural-fighter filmstrips now cover 18 exact Interstice phases
  and 22 exact Kindled phases, including the linked arm and planted feet.
- Review at potato, phone, and standard tiers.
- Review confirmed hit and deliberate whiff side by side.
- Audio-only review remains open; no unrelated or synthetic sword cue may be
  substituted for a missing canonical recording.
