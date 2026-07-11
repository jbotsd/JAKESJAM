# Binipe SFX kit — design in Bitwig, the game plays your exports

The game now runs a **sample-first** audio path: any cue you ship samples
for uses YOUR sound; anything missing falls back to the procedural synth.
Ship one cue at a time — nothing breaks.

## Flow
1. Design in Bitwig (Serum, whatever). Mono or stereo, any length.
2. Export WAVs to `~/Music/binipe-sfx/` named `<cue>-01.wav`,
   `<cue>-02.wav`, ... — **3–5 variants per cue** (the engine round-robins
   them + adds ±6% pitch jitter, so repeats never machine-gun).
3. `bun scripts/process-sfx.ts ~/Music/binipe-sfx/` — trims, loudness-
   normalizes per cue, encodes, writes the manifest.
4. `cd client && bun run build` → refresh → your sounds are live.

## Cue list (the game's actual triggers)

| Cue | Fires on | Design brief (iron-of-heaven) |
|-----|----------|-------------------------------|
| `shoot` | every shot | **The AK brief**: supersonic crack + machined bolt-clack + short metal body. Tactile, hooky, ~150–250ms. This one gets heard 1000×/session — variants matter most here |
| `hit` | damage confirmed | anvil tink over a thud — metal-on-metal, 100–180ms |
| `parry` | deflect | THE bell — bright clash ring with real tail, the Overwatch "reflected!" tell |
| `shield-up` | shield raised | metallic shimmer-up |
| `shield-hit` | shield absorbs | damped gong |
| `shield-break` | shield pops | shatter + ring-out |
| `explosion` | kills/blasts | boom + deep gong tail (the death already rings gnostic) |
| `dash` | aegis slide | blade-draw schwing |
| `jump` / `land` | movement | short, quiet, tactile |
| `pickup` / `card` | UI positive | chimes — keep musical, these pitch-pair |
| `fire` | burn tick | crackle |

Loudness targets are handled by the pipeline (explosion/parry loudest,
movement quietest) — export at a sane level and don't limit-slam; the
normalizer does the leveling.

## Notes
- 48kHz output; keep transients sharp — the engine never fades your attack.
- `charge` shots play slightly pitched-down automatically; design `shoot`
  neutral.
- The procedural synth remains the fallback forever — a missing file can
  never silence the game.
