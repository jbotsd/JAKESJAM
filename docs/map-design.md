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
2. **Sightlines ≤ 480px unbroken** on the floor band for mega docks
   (`MAX_SIGHTLINE` in mapGen). Cover pylons / lips break snipes so
   engagements stay mid-range (ROUNDS/Duck Game discipline). Enforced
   by scanning shoulder-height bands between platforms/cover.
3. **Circulation** — ≥2 distinct jump-routes from floor to the mid
   tier (no single chokepoint to height). Enforced on the route graph.
4. **Openness band** — platform+floor footprint ~6–28% of playable
   AABB (full floor + cover sits mid-band). Below = featureless spam;
   above = corridor mess.
5. **Spawn fairness** — spawns ≥280px apart on mega docks (≥12 pads,
   target 16), never inside geometry, standing pad under each spawn.
6. **One-way platforms everywhere** except floor/walls/ceiling —
   vertical flow beats vertical blockage (existing house rule, kept).
7. **Tier rhythm** — floor → T1 (~486) → T2 (~360) → perch (~232) on
   a 640-tall arena: each hop costs 122–129px (93% of max jump, per
   the feel doc), perch costs jetpack fuel by design.

## Hot Lobby mega scale — always floor + recoverable (≤16 vessels)

Product default is the always-on **Hot Lobby** (`WorldHost`), not 1v1 cells.
**There is always a continuous solid floor.** Fall off a high plate → land on
ground → climb back via hop-chained tiers (rise ≤129px). No soft-kill pits
between “islands.” Side walls contain play; open sky (partial ceiling only).

| Law extension | Value |
|---------------|--------|
| Default curated | `vessel-nexus` — 3000×1100, **full floor**, theme `voidVessel` |
| Procgen | 3000×1100 same laws (`mapGen.ts`) |
| Floor | **Always** full-width solid `floor` (recoverable ground) |
| Frame | Full-height side walls; **partial** ceiling (open sky center) |
| Cover | Floor-band pylons ~every 420–480px (break snipes ≤480) |
| Tiers | T1–T4 / nest hop-chained from ground; optional 1 chimney |
| Spawn target | **16** pads (validator floor **12**), min separation **280px** |
| Sightline | Floor band ≤ **480px** unbroken |
| Aesthetic | Sci-fi gnostic vessel chrome (`voidVessel` / `crystalDock` / `autogenesHull`) |

1v1 Dock Cell / multi-cell `boxworks` stay sealed-box for classic private rooms.

## Why generated > hand-set for Hot Lobby

Hot Lobby recycles every completed match. Hand-set maps make recycles
repetitive within one session; procgen makes every match a fresh read
of the SAME language (fixed tier heights, fixed step costs, familiar
cover shapes) — variety without re-learning movement. Curated maps
stay where curation wins: `vessel-nexus` (16-pad mega default),
`boxworks-tower` / Spire Dock (vertical chaos), room mode keeps
classic `boxworks` + Dock Cell.

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
(`mapGen.test.ts`). Current status: vessel-nexus fully reachable + 16
pads; boxworks-mini passes post-T1; tower audited with perch exemptions
where high ground is deliberately climb-gated.
