# Map design — research & the generative ruleset

Companion to `docs/game-feel-tuning.md` (movement metrics) and
`client/src/sim/data/mapGen.ts` (the generator that enforces all of
this). Sources: ROUNDS analysis in `docs/rounds-reference/`, plus the
canon of small-arena design — Towerfall (single-screen readability),
Duck Game (sightline discipline), Smash (tier flow + ledge risk),
Spelunky (chunk-validate generation), and Quake arena theory
(circulation loops, no dead ends).

## The laws (validator-enforced, not vibes)

Derived from OUR measured movement (jump apex 139px, safe step ≤129px
= 93% of max jump, run 330px/s, bullet range 780px, jetpack for
anything taller):

1. **Reachability** — every platform must be reachable from the floor
   through jump-sized steps (rise ≤129px, horizontal gap ≤180px while
   rising / ≤300px falling), OR be explicitly a *perch* (jetpack-gated
   high ground — and it must LOOK like one: top tier only).
   This law is checked as a route graph over platform tops. The T1 bug
   (unreachable ledges shipped for weeks) can no longer exist.
2. **Sightlines ≤ ~420px unbroken** per horizontal band on a 1280-wide
   arena (scale: ~1/3 arena width; ROUNDS/Duck Game keep engagements
   inside half a screen). Enforced by scanning shoulder-height bands
   between platforms/cover.
3. **Circulation** — ≥2 distinct jump-routes from floor to the mid
   tier (no single chokepoint to height). Enforced on the route graph.
4. **Openness band** — platform+cover footprint 8–19% of arena area.
   Below = featureless spam-box; above = corridor mess. (Towerfall
   maps measure ~10–14%; JAKESJAM's upper bound sits a bit higher to
   allow the variable band count + scatter/clutter ledges added for
   platform-density variety.)
5. **Spawn fairness** — spawns ≥360px apart, never inside geometry,
   ground within a jump-fall below, and mirrored when the arena is
   mirrored.
6. **One-way platforms everywhere** except floor/walls/ceiling —
   vertical flow beats vertical blockage (existing house rule, kept).
7. **Tier rhythm** — floor → T1 (~486) → T2 (~360) → perch (~232) on
   a 640-tall arena: each hop costs 122–129px (93% of max jump, per
   the feel doc), perch costs jetpack fuel by design.

## Why generated > hand-set for the always-on world

The world recycles every completed match. Hand-set maps make recycles
repetitive within one session; procgen makes every match a fresh read
of the SAME language (fixed tier heights, fixed step costs, familiar
cover shapes) — variety without re-learning movement. Curated maps
stay where curation wins: `boxworks-mini` (the tightest possible 1v1)
remains in rotation, `boxworks-tower` keeps its vertical-chaos slot,
room mode keeps classic `boxworks`.

Determinism: the seed rides IN the mapId (`gen:123456`). The server
picks the seed; client and server both expand it through the same
pure function — byte-identical geometry, same guarantee the curated
maps have, zero new wire format.

Generation is **generate → validate → repair-or-reroll (bounded,
deterministic)**: a seed that produces an invalid arena deterministically
advances an internal attempt counter, so `gen:N` always means the same
final map everywhere.

## Curated-map audit (same validator)

The validator also runs against every curated map in CI
(`mapValidation.test.ts`). Current status: boxworks-mini passes
post-T1; boxworks cells and tower audited with perch exemptions where
high ground is deliberately jetpack-gated.
