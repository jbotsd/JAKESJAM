# MOTION-THEORY — Motion-Design & Title-Sequence Theory for the JAKESJAM Ident

Research dossier for the 27.9s self-drawing sacred-geometry boot ident
(gnostic seal constructs itself → bone-serif logo stamp → resolve).
Companion to `docs/IDENT-GRAMMAR.md` (per-ident breakdowns) — this doc is the *theory* layer:
title-sequence masters, the animation principles, easing craft, self-construction drawing,
AV-sync theory, and typography-in-motion. Ends with concrete prescriptions.

Track structure it must serve (fixed, from IDENT-GRAMMAR):
quiet intro 0–4.8s → DROP 4.8s → build 5–14s → high 14–19s → peak 19–26s → resolve 26–27.9s.

---

## 1. The title-sequence masters

### Saul Bass — economy, symbol, single-idea storytelling

Bass's whole method compresses to two verbs he used himself: **symbolize and summarize**.
He reduced a film (or a corporation — AT&T, United, Bell) to one pictographic mark, and he
believed every line, shape, and color must *serve a purpose* — the Bauhaus inheritance via
György Kepes: strip decorative elements, keep clean geometric forms with a clear job.
His stated goal for titles: make the audience **"see familiar parts of their world in an
unfamiliar way"** — the ordinary made strange through reduction.

What this means for an ident:

- **One symbol carries everything.** The gnostic seal *is* the Bass move — a single
  geometric emblem that summarizes the studio. Nothing else should compete with it.
- **Titles condition the audience.** Bass treated the title as the emotional tuning fork for
  what follows — its job is to install a mood *before* content starts, not to show off.
- **Economy is the discipline, not the budget.** Every added element must fight for its life.
  If the seal, the stamp, and the resolve tell the story, a fourth idea is a subtraction.

Sources: [Smashing Magazine — What Saul Bass Can Teach Us](https://www.smashingmagazine.com/2021/02/saul-bass-teach-web-design/),
[Film Art Gallery — Bass logos](https://filmartgallery.com/blogs/news/saul-bass-didnt-just-design-movie-posters-exploring-his-iconic-logos-and-timeless-influence),
[Encyclopedia of Design — Bass titles](https://encyclopedia.design/2023/06/14/saul-bass-opening-and-closing-titles/),
[Stunning Proof — three Bass lessons](https://stunningproof.com/2015/08/26/three-lessons-in-design-principles-from-saul-bass/).

### Kyle Cooper — Se7en: texture and imperfection as emotion

Cooper's Se7en titles (1995) put typography **scrawled into scratch board, shot on film**,
over tabletop photography of the killer's notebooks. In interviews (Watch the Titles /
Art of the Title) he talks explicitly about his **love for the imperfection of handmade
things** — the jitter, the misregistration, the scratched emulsion are not style-sauce, they
are *characterization*: the titles get you inside a mind. Fincher's brief was tone, and
Cooper answered with **texture as the emotional carrier**, not with motion complexity.

Lessons:

- **Imperfection is a signal of the hand, and the hand is a signal of intent.** A seal that
  draws itself with slight ink-gain, arc wobble ≤1px, or breathing line weight reads
  *ritual*; a mathematically sterile stroke reads *loading spinner*.
- **Texture must be diegetic to the world.** Se7en's scratches belong to the killer's
  notebooks. Our grain/ink belongs to bone, vellum, engraving — never "VHS filter."
- **Type can be part of the artifact.** Cooper's type is *in* the material (scratched into
  it), not floating above it. The bone-serif lockup should feel cut into the same surface
  the geometry lives on.

Sources: [Art of the Title — Kyle Cooper](https://www.artofthetitle.com/designer/kyle-cooper/),
[Watch the Titles — Cooper interview pt. 1](https://www.watchthetitles.com/interview/kyle-cooper-interview-pt-1-2/),
[The Fincher Analyst — 30 years of Se7en's titles](https://thefincheranalyst.com/2025/09/26/30-years-of-kyle-coopers-classic-title-sequence-for-se7en/).

### Danny Yount — Iron Man, Sherlock Holmes: restraint under spectacle

Yount (Prologue) designed Kiss Kiss Bang Bang, Iron Man, Iron Man 3, Tron: Legacy, Sherlock
Holmes. Two transferable ideas from his interviews/talks:

- **"A title is a guitar solo."** His words: he gets a short time in the spotlight and has to
  use it *to make the film better* — the solo serves the song. A 27.9s ident is exactly one
  guitar solo long; its job is to make the game feel bigger, not to be a second game.
- **Process-as-content.** For Sherlock Holmes he shot the *actual Victorian printing
  process* — linotype, woodblock headline composition — and let the mechanics of making
  become the sequence. That is precisely the "self-drawing construction" thesis: showing the
  *making* of the mark is more premium than showing the finished mark with effects on it.
- **Restraint against overwhelm.** On Iron Man 2 / Tron he describes the balance as not
  overwhelming the audience while staying visually rich — spectacle is budgeted, not
  continuous.

Art of the Title's accumulated interview wisdom on **pacing an opening** consistently lands
on the same shape: a slow, confident establishment (earn attention with stillness), a clear
midpoint escalation, and a **terminal lockup that arrives once and holds** — the audience
must never wonder whether the sequence has ended.

Sources: [Art of the Title — Danny Yount](https://www.artofthetitle.com/designer/danny-yount/),
[Art of the Title — Sherlock Holmes (2009)](https://www.artofthetitle.com/title/sherlock-holmes/),
[TypeEd — Yount solves the mystery of the title sequence](https://type-ed.com/resources/rag-right/2013/11/30/danny-yount-solves-mystery-title-sequence),
[AIGA talk — The Art of the Title Sequence](https://www.aiga.org/inspiration/talks/danny-yount-the-art-of-the-title-sequence).

---

## 2. The 12 principles, filtered for logo/motion-graphics work

Of Disney's twelve (Thomas & Johnston), five do almost all the work in ident/logo motion;
the rest are either trivially present (staging, appeal) or dangerous at this scale
(squash-and-stretch on a sacred seal would read cartoon).

| Principle | Ident application | Discipline |
|---|---|---|
| **Anticipation** | Before every hit, a small *contrary* motion: geometry contracts/dims 100–160ms before the drop strike; the logo plate rises/recedes a beat before the stamp. | Anticipation must be smaller and faster than the action it precedes. If the wind-up is visible as its own event, it's too big. |
| **Follow-through / overshoot** | The stamp lands past its rest state and settles back. Rings keep rotating a few degrees after the strike stops them. | **5–10% past target is enough; >15% reads as a glitch** (Figma motion fundamentals). One overshoot cycle only — a second bounce reads rubber, not bone. |
| **Slow in / slow out** | Every non-hit motion eases. The *only* legitimate linear/instant events are the hits themselves. | Reserve hard cuts for sync points; everything else accelerates and decelerates. |
| **Secondary action** | Dust/particle puff on stamp, faint glow bloom on strike, tick-marks trembling after a hit. | Secondary action **responds with a slight delay** to the primary and must never be readable as its own beat. Budget: ≤2 secondary systems alive at once. |
| **Timing (+ exaggeration)** | Weight comes from frame counts: heavy = few frames of travel, long settle. The stamp should travel in ≤3 frames and settle for ~15–30. | Exaggerate contrast between fast and slow, not the motions themselves. |

The meta-rule from UI-motion practice (IxDF, Figma): the principles exist to make motion feel
*physical*; in a premium context you apply them at near-threshold amplitude — felt, not seen.

Sources: [IxDF — Disney's 12 principles applied to UI](https://ixdf.org/literature/article/ui-animation-how-to-apply-disney-s-12-principles-of-animation-to-ui-design),
[Figma — Motion fundamentals: Easing](https://help.figma.com/hc/en-us/articles/41238219562007-Motion-design-fundamentals-Easing),
[Adobe — 12 principles](https://www.adobe.com/creativecloud/animation/discover/principles-of-animation.html),
[Uxcel — 12 principles for motion design](https://uxcel.com/blog/12-principles-of-animation-a-guide-to-motion-design-133),
[Mt. Mograph — bounce & overshoot](https://mtmograph.com/blogs/tools/the-bounce-and-overshoot-animation-trick-every-motion-designer-should-know).

---

## 3. Easing-curve craft — what reads "premium"

### The three canonical systems

**Apple (WWDC23 "Animate with springs").** Apple's position: springs, not curves, for
anything that moves *into place*, because springs are the only animation family that
**preserves velocity** (no C1 discontinuity when an animation is interrupted or starts
moving). Their API reduces to two perceptual parameters — `duration` (time to *perceived*
settle, independent of bounce) and `bounce` (−1…1). Key craft insight: **default bounce is
0** — Apple's own system animations are overwhelmingly smooth springs (critically damped),
and bounce is added only when playfulness is the message. "Premium Apple feel" =
spring(duration: 0.3–0.5, bounce: 0…0.15), i.e. barely-there overshoot.

**Material 3 (emphasized easing).** M3's premium register is the *emphasized* set — more
dramatic deceleration than the standard set, used for large/hero transitions:

- `emphasized-decelerate` — `cubic-bezier(0.05, 0.7, 0.1, 1.0)` (enter: near-instant launch, very long luxurious landing)
- `emphasized-accelerate` — `cubic-bezier(0.3, 0.0, 0.8, 0.15)` (exit: slow lean-in, fast departure)
- `standard` — `cubic-bezier(0.2, 0.0, 0, 1.0)`
- Durations: short1–4 = 50/100/150/200ms, medium1–4 = 250/300/350/400ms,
  long1–4 = 450/500/550/600ms, extra-long1–4 = 700/800/900/1000ms.
  M3 pairs *emphasized* curves with the **long/extra-long** buckets.

**IBM Carbon (productive vs expressive).** Carbon's taxonomy: *productive* motion (task UI —
efficient, subliminal) vs *expressive* motion (brand moments — visible, dramatic). An ident
is 100% expressive-tier by definition. Exact tokens (from `@carbon/motion` source):

- standard-productive `cubic-bezier(0.2, 0, 0.38, 0.9)` · standard-expressive `cubic-bezier(0.4, 0.14, 0.3, 1)`
- entrance-productive `cubic-bezier(0, 0, 0.38, 0.9)` · entrance-expressive `cubic-bezier(0, 0, 0.3, 1)`
- exit-productive `cubic-bezier(0.2, 0, 1, 0.9)` · exit-expressive `cubic-bezier(0.4, 0.14, 1, 1)`

### Why these read premium

Common thread across all three systems: **asymmetry**. Premium curves are *not* symmetric
ease-in-out; they launch fast and land long (decelerate-dominant for entrances), or lean in
slow and leave fast (accelerate-dominant for exits). Symmetric ease-in-out
(`0.42,0,0.58,1`) is the "PowerPoint transition" tell. The second thread: **long tails** —
the last 10% of the distance takes 30–40% of the time. Deceleration is where expensiveness
lives, because it mimics mass + damping.

### Numeric recommendations for our four verbs

| Verb | Curve | Duration | Notes |
|---|---|---|---|
| **Strike** (one-frame hit) | *No easing curve on the hit itself* — a 1-frame cut to the post-state. The *decay/ring-out* after uses expo-out `cubic-bezier(0.16, 1, 0.3, 1)` | hit: 1 frame (16ms) · ring-out: 300–500ms | Easing a strike kills it. Synchresis (§5) needs the visual transient inside ±1 frame of the audio transient. |
| **Settle** (post-stamp) | back-out `cubic-bezier(0.34, 1.56, 0.64, 1)` (≈8% overshoot) or spring(duration: 0.4, bounce: 0.15) | 350–500ms | One overshoot only. For the bone-serif lockup, clamp overshoot to scale 1.05–1.08 → 1.0. |
| **Breathe** (idle life) | sinusoidal in-out `cubic-bezier(0.37, 0, 0.63, 1)`, ping-pong | 3000–4000ms per half-cycle | Amplitude ±1.5–2% scale or ±0.03 opacity. Below-threshold motion = the Valve trick. |
| **Drain / resolve** (exit) | M3 emphasized-accelerate `cubic-bezier(0.3, 0.0, 0.8, 0.15)` or Carbon exit-expressive `cubic-bezier(0.4, 0.14, 1, 1)` | 1200–1900ms | Exits accelerate *away*; a decelerating exit feels like the ident is reluctant to leave. |

Sources: [Apple — Animate with springs (WWDC23 10158)](https://developer.apple.com/videos/play/wwdc2023/10158/),
[WWDCNotes — Animate with springs](https://wwdcnotes.com/documentation/wwdc23-10158-animate-with-springs/),
[Material 3 — Easing & duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs),
[material-components-android — Motion.md](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md),
[Carbon Design System — Motion](https://carbondesignsystem.com/elements/motion/overview/),
[@carbon/motion source](https://github.com/carbon-design-system/carbon/tree/main/packages/motion),
[kvin.me — two-parameter spring animations](https://www.kvin.me/posts/effortless-ui-spring-animations).

---

## 4. Line-drawing / self-construction animation

### SVG stroke-draw mechanics & speed profiles

Technique (canonical since Jake Archibald 2013): set `stroke-dasharray = pathLength`,
animate `stroke-dashoffset` from `pathLength` → 0. Use `getTotalLength()` at runtime (or
`pathLength="1"` normalization) rather than hard-coded lengths; if hard-coding, slightly
overestimate. For maximum cross-browser consistency some authors animate `stroke-dasharray`
instead of `dashoffset`.

**Speed-profile theory — the core aesthetic decision:**

- **Constant velocity (`linear`) reads mechanical/plotter.** Right when the drawing agent is
  a *machine*: laser, CNC, plotter, divine automaton. Uniform speed communicates
  indifference and inevitability.
- **Eased (`ease-in-out` per stroke) reads hand-drawn.** A human hand accelerates out of the
  stroke start and decelerates into the stop; per-stroke easing is what makes a trace feel
  *drafted* rather than *printed*. Ease-in ramps also read as "the pen biting the surface."
- The premium hybrid for a ritual/occult construction: **eased per-stroke, but constant
  angular velocity for full-circle sweeps.** Compass circles ARE mechanical (the compass is
  a machine); connecting chords and tick-marks are hand strokes. Matching the physics of the
  imagined instruments is what sells "someone is constructing this."
- **Per-stroke segmentation matters more than the curve.** One giant path drawn in one go
  always reads as a loading animation. Break the figure into its *construction strokes*
  (each arc, each chord its own path with its own start/stop) — the pauses between strokes
  are where the hand lives.

### Compass-and-straightedge construction ORDER (the classical sequence)

The hexagon-in-circle construction — the seed of nearly all sixfold sacred geometry — has a
canonical order (Euclid IV.15 / Math Open Reference), and *because the side of a hexagon
equals its circumradius*, the compass never changes setting:

1. **The generating circle** (compass at center O, radius r).
2. **First mark**: compass point on the circle at A, same radius r, arc cutting the circle.
3. **Walk the circle**: keep the setting, step the compass around — six arcs yield exactly
   six points (the "seed of life" petals appear for free if arcs are drawn full).
4. **Chords**: straightedge connects adjacent points → hexagon.
5. **Inscribed triangle**: connect *alternate* vertices (A-C-E) → equilateral triangle; the
   other three (B-D-F) give the inverted triangle → hexagram/Seal of Solomon.

So the drawing order for a gnostic seal is theory-correct as: **circle → six radius-arcs →
hexagon chords → alternate-vertex triangle(s) → interior detail (ticks, monad)**. Construction
lines *precede* figure lines; the figure emerges from scaffolding.

**Islamic geometric pattern practice (Eric Broug)** codifies the same aesthetic into a
teaching method used for centuries: every pattern is built with **only compasses and
straightedge, no measurement** — circles drawn from intersections of existing lines, new
lines connecting existing intersections. The sequence is always: (1) circle, (2) divide the
circle (into 4/5/6/8/12/16), (3) build the underlying grid of construction lines, (4) *trace
the final pattern* out of a subset of those lines, (5) **remove the scaffolding** so only the
pattern remains. That final step — construction lines fading as the true figure inks itself
heavier — is the single most "drawing-order aesthetic" move available to us, and it maps
perfectly to a two-pass ident: faint scaffold pass during the build, bold ink pass at high/peak.

**Golden-ratio construction** (if the seal wants a φ element): the classical square-midpoint
method — draw square ABCD → mark midpoint M of one side → compass at M, radius M-to-opposite-corner →
arc extends the side to the golden point → complete the 1:φ rectangle. Again: an *arc
revealing a proportion*, i.e. drama from a compass swing, which is inherently animatable.

Sources: [Jake Archibald — Animated line drawing in SVG](https://jakearchibald.com/2013/animated-line-drawing-svg/),
[CSS-Tricks — How SVG line animation works](https://css-tricks.com/svg-line-animation-works/),
[O'Reilly Using SVG — Drawing with dashes](https://oreillymedia.github.io/Using_SVG/extras/ch13-drawing.html),
[Math Open Reference — hexagon inscribed in circle](https://www.mathopenref.com/constinhexagon.html),
[TED-Ed — Eric Broug, The complex geometry of Islamic design](https://ed.ted.com/lessons/the-complex-geometry-of-islamic-design-eric-broug),
[Broug — Islamic Geometric Design (Thames & Hudson)](https://www.goodreads.com/book/show/17573893-islamic-geometric-design),
[Bier — review of Broug, construction sequences](https://digitalcommons.unl.edu/textileresearch/14/).

---

## 5. Film-sound theory of AV sync

### Chion: synchresis, sync points, added value

Michel Chion (*Audio-Vision: Sound on Screen*):

- **Synchresis** (synchronism + synthesis): "the spontaneous and irresistible mental fusion,
  completely free of any logic, between a sound and a visual when these occur at exactly the
  same time." The brain *welds* any coincident sound and image into one event — which is why
  a geometric strike landing on a musical hit doesn't feel like sync, it feels like the
  geometry *made the sound*.
- **Sync points** are scarce by design: the salient moments where audio and vision mesh,
  "crucial for meaning and dynamics." A sequence with sync points everywhere has none —
  synchresis is a currency you spend, and continuous spending is inflation (IDENT-GRAMMAR's
  THQ case shows exactly this failure).
- **Added value**: sound "enriches a given image" such that the result seems to come
  naturally from the image alone. The practical inversion for an ident: the *visual* should
  appear to *cause* the score. When the drop hits at 4.8s and the first triangle strikes
  into place on that exact frame, the audience experiences the seal as generating the music.

Precision requirement: synchresis operates at "exactly the same time" — in practice **±1
frame at 60fps (±16ms)**. Audio leading video by up to ~20ms is perceptually forgiven; video
leading audio is noticed sooner. Land visual transients ON the audio sample, never "near."

### Trailer-house hit grammar: rise / hit / tail

The working grammar of trailer sound (BOOM Library, Richard Pryn, trailer-music practice):

- **Riser** — long tension sound, pitch/modulation climbing, whose entire job is to make a
  future moment feel inevitable. Visual analog: accelerating construction density, tightening
  rotation, brightening scaffold.
- **Hit** — the transient. In the "braaam" era (post-Inception 2010, Zimmer lineage) hits are
  low, huge, and *sparse* — the braam works because it is not competing with anything.
- **Tail** — the reverb decay after a hit that "carries us a little forward." Visual analog:
  ring-out — glow bloom decaying, dust settling, rings still trembling. **Every visual hit
  needs a visual tail**; a hit with no tail reads like a dropped frame.
- **Silence before impact / the stopdown** — the signature move: riser… *cut to
  silence/near-silence for 2–8 frames*… THEN the hit. The gap multiplies the hit's perceived
  size. Visual analog: the anticipation freeze — all motion stops for 50–130ms before the
  stamp. (EA's stamp-then-whisper, IDENT-GRAMMAR §5, is the same contour reversed.)

Sources: [Chion annotation — U. Chicago](http://csmt.uchicago.edu/annotations/CHION.HTM),
[J W Strand — locating Chion's synch points](https://www.jwstrand.com/blog/2018/10/30/locating-audio-vision-michel-chions-synchpoints),
[Shaping Waves — Chion's Audio-Vision theory](https://www.shapingwaves.com/13016/),
[BOOM Library — trailer sound design tips](https://www.boomlibrary.com/blog/top-tips-for-trailer-sound-design/),
[Richard Pryn — ultimate guide to trailer hits](https://richardpryn.com/trailer-hits/),
[Nathan Fields — three-act trailer music structure](https://www.nathanfieldsmusic.com/blog/three-act-structure-trailer-music),
[Derek Lieu — secrets of trailer sound design](https://www.derek-lieu.com/blog/2022/1/17/secrets-to-trailer-sound-design).

---

## 6. Screen typography in motion — the serif reveal

### Technique inventory, ranked for "expensive"

| Technique | Reads as | Verdict for a bone-engraved serif |
|---|---|---|
| **Stamp** (arrive oversized/off-plane → land with settle + secondary dust) | Weight, authority, permanence — the letterform *becomes part of the surface* | **The correct choice.** Matches engraving (type struck into material — the Cooper principle), matches id Software's forge-stamp lineage, gives the score a sync point. |
| **Mask-wipe reveal** (type already in place, revealed by a moving edge) | Precision, editorial, Vogue-cover | Strong runner-up; premium but *cool/detached* — better for fashion than for a seal that was just ritually constructed. Usable for the secondary line ("by Intrepid Development"). |
| **Track-in from wide letter-spacing** (letters slide from +tracking to final) | Contemporary-luxury (perfume ads) | Wide spacing itself is a luxury signal, but continuous glyph motion during the peak fights the geometry. Use only the *last 4–6%* of the contraction as the visible portion. |
| **Light sweep / specular pass** | Materiality (metal, stone, bone) | Legitimate ONCE, after settle, as the "the object now exists" confirmation. More than once = car commercial. |
| **Letter-by-letter cascade** | Playful, kinetic-typography | Wrong register. Cascades fragment a lockup; a seal demands the name arrive as one object. |
| **Fade/dissolve** | Neutral, safe | The cheap default; wastes the peak's sync point. |

### Letter-spacing dynamics

Luxury typography convention: **uppercase + generous tracking** reads expensive; and glyphs
need breathing room or they blur in motion. Dynamic tracking should be *asymptotic*: if
tracking animates at all, ease from slightly-wide (+3–5%) to final over the settle window —
letters drifting the last few percent into place under the same deceleration as the stamp.
Never animate tracking *outward* on a reveal (reads as the lockup disintegrating), and never
animate word-spacing separately from tracking.

### When NOT to animate type

- **When the message is permanence.** For brands selling stability, motion undercuts the
  claim. An engraved lockup's whole semantic is "this was always here" — therefore the type
  gets exactly ONE motion event (the stamp) and is then **absolutely static**. Post-stamp
  wobble, drift, breathing, or float applied to the *type* destroys the engraving conceit —
  the *scene* may breathe (light, dust, geometry), the type may not.
- **When it would run every session.** A boot ident is seen hundreds of times; motion that
  delights once irritates at N=50. This argues for restraint AND for a skip affordance,
  but within the ident itself: fewer, better type events.
- **When readability loses.** If any technique leaves the name unreadable until the final
  frames of the peak, it has failed — the lockup must be fully legible by ~1s after stamp.

Sources: [Dan Houston — luxury typography](https://medium.com/@dan_houston/luxury-design-for-digital-marketing-typography-475704260e7c),
[RMCAD — typography for motion graphics](https://www.rmcad.edu/blog/typography-for-motion-graphics-fonts-that-move-the-message/),
[Number Analytics — typography in motion / logo animation](https://www.numberanalytics.com/blog/typography-in-motion-logo-animation-guide),
[Todaymade — kinetic typography, when not to animate](https://www.todaymade.com/blog/kinetic-typography-examples).

---

## 7. PRESCRIPTIONS FOR OUR IDENT

Concrete, implementation-ready. Times are absolute in the 27.9s timeline; ms are per-event.
Frame = 16.67ms @60fps.

### 7.1 Sync-point budget (Chion discipline)

**Exactly 5 synchresis events. No more.** Everything else follows the music's *energy
envelope*, never its transients.

| # | Time | Audio | Visual |
|---|---|---|---|
| S1 | 4.80s | DROP | First strike: generating circle completes + flash-inks to full weight, 1 frame |
| S2 | ~9.5s (on a build accent) | mid-build hit | Hexagon chords snap from scaffold-faint to inked |
| S3 | 14.0s (high begins) | escalation entry | Triangle(s) strike in — alternate-vertex chords, 1 frame each on consecutive accents |
| S4 | ~19.2s (first peak accent) | biggest hit | **LOGO STAMP** (see 7.4) |
| S5 | 26.0s (resolve begins) | last accent / release | Light sweep completes + drain begins |

Precision: visual transient within **±1 frame** of the audio transient; if you must err, let
audio lead by ≤1 frame, never video. Spoken line "Jakes Jam — by Intrepid Development"
placed *after* S4's settle, over relative stability (the EA whisper contour): name lands
~19.9–21.5s, byline ~21.5–23.5s.

### 7.2 The strike (one-frame hit) recipe

Per strike (S1–S3): **anticipation → gap → cut → ring-out**.

1. **Anticipation**: 130ms contraction — element scales to 0.97 and dims 10%, curve
   `cubic-bezier(0.3, 0.0, 0.8, 0.15)` (M3 emphasized-accelerate).
2. **The gap (silence-before-impact)**: 3–5 frames (50–83ms) of total freeze. For S4 only,
   stretch to 8 frames (133ms).
3. **The hit**: 1 frame. No tween — cut to post-state (full stroke weight, +25% brightness
   bloom). Easing a strike kills it.
4. **Ring-out (the tail)**: bloom + any displaced secondary elements decay over 400ms with
   expo-out `cubic-bezier(0.16, 1, 0.3, 1)`. Every hit gets a tail; a hit without visual
   decay reads as a dropped frame.

### 7.3 Stroke-draw speed profiles (the self-construction)

- **Compass sweeps (circles, arcs): constant angular velocity** (`linear` on dashoffset).
  The compass is a machine; uniform sweep = inevitability. Circle S1 sweep: begin ~3.0s,
  360° in ~1.7s, timed so the gap+hit land exactly at 4.80s.
- **Straightedge strokes (chords, ticks, radii): eased per stroke** — entrance-expressive
  `cubic-bezier(0, 0, 0.3, 1)` per chord, 180–350ms each. This is what reads hand-drafted.
- **Segment everything.** Each arc/chord/tick is its own path with its own start/stop;
  inter-stroke pauses of 60–150ms are where the hand lives. Never one mega-path.
- **Quantize stroke starts to the musical grid** during build/high (5–14–19s): stroke
  onsets on 8th-note boundaries of the track tempo (energy-following, not hit-stealing —
  these are NOT sync points, so they may drift ±1 frame freely).
- **Two-pass Broug structure**: pass 1 (0–14s) draws *scaffold* at 35% opacity, 1px —
  generating circle, six radius-arcs, division ticks; pass 2 (14–19s) inks the *true
  figure* (hexagon → triangles → monad) at full weight along existing scaffold lines;
  19–26s the scaffold **fades out 60%** while the figure brightens — the pattern emerges,
  construction lines retired, exactly as in Islamic-pattern practice.
- **Construction order is canon**: circle → six same-radius arcs → hexagon chords →
  alternate-vertex triangles → interior monad/ticks. Scaffold precedes figure, always.

### 7.4 The logo stamp (S4, ~19.2s)

- Bone-serif lockup arrives from 8–12% oversized and slightly toward camera, travels in
  **≤3 frames**, hits at scale 1.0 on the peak accent.
- **Settle**: overshoot to 0.965 (compression into the surface — engraving pushes IN, so
  overshoot *under* target, not over), return to 1.0 in 420ms via
  `cubic-bezier(0.34, 1.56, 0.64, 1)` — or spring(duration: 0.42, bounce: 0.15). ONE cycle.
- **Secondary action** (≤2 systems): bone-dust puff ejecting radially (600ms, expo-out) +
  the geometry ring gets a 2° rotational kick that decays over 800ms.
- **Tracking**: optional last-4% contraction — letters at +4% tracking on arrival, easing
  to 0% during the 420ms settle, same curve. Never outward.
- **Light sweep**: exactly one specular pass across the engraved face, 700ms, starting
  ~1.2s after the stamp (≈20.9s), `cubic-bezier(0.4, 0.14, 0.3, 1)` (Carbon
  standard-expressive). Never repeats.
- **After settle the type is FROZEN.** The scene breathes (see 7.5); the lockup does not.
  Engraving = permanence; any post-stamp type motion refutes the material.

### 7.5 Breathe (peak hold, 19–26s) and drain (26–27.9s)

- **Breathe**: whole-scene (not type) sinusoidal `cubic-bezier(0.37, 0, 0.63, 1)`
  ping-pong, 3.5s half-period, amplitude ±1.5% glow intensity and ±0.5% seal scale —
  sub-threshold, the Valve stillness trick. Teal energy accent may pulse with the track's
  low end (envelope-follow, ±0.04 opacity).
- **Drain**: at 26.0s (S5) everything exits *accelerating away* —
  `cubic-bezier(0.3, 0.0, 0.8, 0.15)` (M3 emphasized-accelerate) over 1500ms: scaffold
  remnants first (300ms head start), then geometry, lockup LAST and fastest (final 600ms),
  landing on black/next scene by 27.7s with 200ms of black as the visual reverb tail.
  A decelerating exit would read reluctant; the ident must leave like it has somewhere to be.

### 7.6 Global curve kit (the only easings allowed)

| Token | cubic-bezier | Use |
|---|---|---|
| `strike-tail` | `(0.16, 1, 0.3, 1)` | post-hit decay, dust, blooms |
| `settle` | `(0.34, 1.56, 0.64, 1)` | stamp settle (or spring d=0.42 b=0.15) |
| `draw-chord` | `(0, 0, 0.3, 1)` | straightedge strokes entering |
| `draw-arc` | `linear` | compass sweeps only |
| `anticipate` / `exit` | `(0.3, 0.0, 0.8, 0.15)` | pre-hit contractions, the drain |
| `sweep` | `(0.4, 0.14, 0.3, 1)` | light sweep, slow reveals |
| `breathe` | `(0.37, 0, 0.63, 1)` | idle sinusoid |

Banned: symmetric default `ease-in-out (0.42,0,0.58,1)`, `ease` default, any curve applied
to a hit frame, any second bounce.

---

*Compiled 2026-07-12. Companion docs: `IDENT-GRAMMAR.md` (ident case studies),
`visual-language-gnostic-vessel.md` (aesthetic frame), `MUSIC-MANIFEST.md` (track).*
