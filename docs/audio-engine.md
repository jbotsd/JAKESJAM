# Combat audio engine — procedural weapon & shield synthesis

Brief (2026-07-04): "deep, nuanced weapon + shield noises, algorithmic /
procedural — and leverage Serum 2 / the Zig engine if it fits."

## Decision: procedural, not baked samples

The old engine (`AudioSystem.ts`) was live Web-Audio bleeps — one oscillator
+ filtered noise per cue. Functional but flat. The new engine
(`ProceduralAudio.ts`) synthesizes every shot/shield event live from **game
state**, so nothing is a frozen sample:

- **Weapons** are keyed by `element` (fire/ice/lightning/void/…), `charge`
  (overcharge → deeper/longer/heavier), `intensity` (damage), and weapon
  class — with per-shot micro-variation (pitch/filter/timing jitter). A fire
  shot crackles; ice is a crystalline FM bell; lightning is a fast FM zap;
  void is a dark sub-swell. Every trigger is subtly different.
- **Shields** get a full lifecycle: a rising "bwoom" on raise, a continuous
  LFO-modulated **energy hum** while held (driven off the local player's
  `shieldActive`), a resonant metallic **deflect** ping, and a
  downward-sweep + shatter-shards **break**. **Parry** is a sharp bright
  metallic "ting" with a reverse pre-swell (the "catch").

Why procedural over Serum-baked wavs: a baked sample is identical every time
and carries download weight. Procedural audio *reacts* (element, charge,
velocity, shield energy), varies infinitely, and ships as code.

## Why not Serum 2 at runtime (and where it still helps)

Serum 2 is a native VST — it can't run in a browser. It **is** usable
programmatically on this machine (yabridged Windows VST3 at
`~/.vst3/yabridge/Serum2.vst3`, driveable from a home-dir py3.12 venv via
`pedalboard`/`dawdreamer`, or real-time via Carla + PipeWire capture — a
`/tmp`-noexec snag blocked the first attempt, not a real incompatibility).
Its role here is **design reference**: the synthesis vocabulary
(multi-osc detune, FM pairs, filtered noise, envelopes, LFO mod) is
reproduced algorithmically in Web Audio. If a *signature* wavetable timbre is
wanted, Serum can bake it offline to a short buffer that the engine
sample-and-replays — a future option.

## Why not the Zig sim engine (yet)

The Zig→WASM substrate exists for **bit-exact determinism** (client and
server must agree). Audio is **local and cosmetic** — it never has to match
across machines — so determinism, the whole reason for Zig here, doesn't
apply. Web Audio also gives reactive graphs for free (the live shield-hum
LFO) with no JS↔WASM buffer marshaling.

**Where Zig would genuinely win:** sample-level DSP the Web-Audio node graph
can't express — physical-modeled metallic resonance, granular crackle,
complex FM/waveshaping stacks — reusing `trig.zig` (sine LUT) and `rng.zig`
(noise). The clean upgrade path is a **hybrid**: a Zig kernel renders the
one-shot SFX buffers (deep DSP), Web Audio plays them + keeps the reactive
parts (hum, spatial send). Deferred because (a) it's a real subsystem and
(b) sound quality needs ear-in-the-loop iteration the current Web-Audio
engine already supports today.

## Architecture (`ProceduralAudio.ts`)

Signal path: `voices → master gain → soft limiter → destination`, plus a
light generated-impulse **reverb send** for space on shields/impacts.
Primitives: `blip` (pitched osc + slide), `noiseInto` (filtered noise
burst), `fmPing` (inharmonic metallic bell, optional bandpass resonance),
`env` (AD gain), a looping noise buffer, and a per-trigger `rand`. Silent
until unlocked by a user gesture.

Wiring: `SimEventRouter` maps events → cues with params —
`shot-fired → shoot(element,charge)`, `hit-confirmed → hit(intensity)`,
`parry-deflected → parry`, `shield-popped → shield-break`. The scene
resolves a shot's element from the firing player's newest live projectile
and edge-detects the local shield to start/stop the hum.

Offline Practice (`MatchScene`) still uses the legacy bleep engine — the
live world (the product) gets the procedural engine.

## Tuning knobs

- `ELEMENTS` table: per-element waveform / FM ratio+index / body pitch /
  sweep / air band / tone (warmth). One source of truth for weapon timbre.
- `MASTER` (0.22): overall level under the limiter.
- Shield hum gain (0.05) sits deliberately under gameplay.
