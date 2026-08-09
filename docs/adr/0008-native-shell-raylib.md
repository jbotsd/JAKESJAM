# ADR-0008: raylib is the native desktop shell (SDL3 is the named fallback)

## Status

**CONFIRMED (2026-08-10).** Accepted 2026-08-09 spike-gated; the spike
has since run and met every item on its bar, so this is no longer
provisional. Full result in `docs/n1-spike-result.md`; the headline is
500 additive-blended shapes at frame **p99 1.48 ms** against a 16.67 ms
budget, plus TTF text, a canonical SFX decoded from file, mouse and
gamepad — all through `@cImport` on `raylib.h` with no third-party
bindings.

SDL3 remains the named fallback under "Switch triggers" below, and those
triggers stay live. One of them was checked directly by the spike: GL 3.3
was stable across ~2500 frames on this box, so the GL-instability trigger
has NOT fired.

This is the `native-desktop-goal.md` N1 decision. It supersedes that
doc's original three-spike plan (sokol vs SDL3 vs raylib) with one spike
plus a named fallback — the doc's N1 section is amended to match. No
re-litigation of the other candidates.

This ADR **reverses an initial same-day recommendation of SDL3**. The
reversal reasons are recorded in full below so the argument is settled
by the document rather than re-derived from memory.

## Context

Gospel Track N's end-state artifact is a native desktop build: the same
Zig core in a shell that contains no TypeScript, no JS runtime, and no
web view. As of 2026-08-09 the sim is 17,520 lines of Zig across 20
modules, feature-complete after E1, with a 142-test native suite already
compiling — the core is done and portable. What does not exist is the
shell.

The shell must supply, and *only* supply (NL1 — the shell holds zero
game behavior):

- window + swapchain + frame timing, with the sim on its own fixed tick
- raw keyboard/mouse now, gamepad later (E4/N-AIM aim dialects)
- 2D procedural rendering: batched shapes, **additive blending**,
  **render-to-texture** — the browser client's visual grammar is
  procedural rigs, constructs and glow (`ProceduralPlayerRig` 3,385
  lines, `LightConstruct` 2,824, `CosmicArenaLayer` 1,085), not sprite
  sheets, so shapes-and-shaders port far better than art would
- **TTF text** for HUD, killfeed, nameplates
- **decode + playback** of 27 MB canonical meme SFX (L7: recordings,
  never synthesized) plus `client/public/` audio; the in-game
  `ProceduralAudio` synth graph (1,117 lines) ports onto whatever mixer
  the shell provides
- sockets at N3 (out of scope for this ADR beyond not blocking it)

Two constraints shape the choice more than raw capability:

1. **NL3 — baked tier first.** N2's visual bar at first light is the
   Pi/phone baked tier, not the live desktop tier. Feel parity is a
   footage-driven polish tail measured in weeks of iteration passes.
   Iteration speed therefore compounds; it is not a nice-to-have.
2. **NL6 — this box bites.** The dev desktop has a reproducible
   RTX 4080 / nvidia-open context-teardown hard-lock. Renderer choice
   interacts with it.

Verified on this box, 2026-08-09: `raylib 6.0-1` is in Arch `extra`
(one `pacman -S` away); `sdl3 3.4.14-1` is already installed; Zig
resolves to the pinned 0.15.2 via the repo's mise shim while
`/usr/bin/zig` is 0.16.0 (a spike run outside the repo silently builds
under the wrong toolchain — see Consequences).

## Considered alternatives

1. **SDL3 — runner-up, and the named fallback.** Genuinely wins four
   things: `SDL_GPU` spans Vulkan/Metal/D3D12 where raylib is OpenGL
   only; runtime render-backend selection (a real NL6 mitigation on
   this box — flip to Vulkan or software when GL wedges); Steam Input,
   Deck gyro/trackpad, rumble and controller hot-plug; and Valve
   funding plus the Steam runtime's expectations at N4.

   Rejected as the *first* shell because it satisfies fewer of the
   criteria above per dependency. `SDL_Render` supplies no text at all
   (needs SDL_ttf) and its audio decodes WAV only (needs SDL_mixer or
   miniaudio), so the N2 shell becomes three C dependencies to build
   and cross-compile instead of one. The initial recommendation tried
   to fix the audio half by pulling in miniaudio as a separate pick —
   which is circular, because raylib's audio layer *is* miniaudio plus
   the dr_libs decoders. SDL3 is also a much larger C codebase to
   cross-compile for the Windows target than raylib is.

   Two arguments made against raylib in the initial recommendation were
   **wrong and are withdrawn**: (a) "raylib owns the loop" — it does
   not; the caller writes `while (!WindowShouldClose())`, so a fixed
   tick with an accumulator decoupled from render works identically
   under either lib (raylib does carry global state, which is a real
   but far smaller complaint); (b) "raylib's gamepad story is thin" —
   it runs on GLFW, which carries the SDL controller mapping database,
   so basic pad support draws on the same data SDL does. The surviving
   SDL input advantage is Deck-shaped (gyro/trackpad/rumble/hot-plug
   via Steam Input), not "gamepads work".

2. **sokol.** The best Zig citizen of the three — floooh maintains
   idiomatic bindings and tracks Zig releases, which is a real ongoing
   tax avoided. Rejected because `sokol_app` ships no gamepad API (a
   long-standing, acknowledged gap) against a roadmap that explicitly
   wants stick dialects and Deck play, and because text and audio
   decode both become vendored side-quests (`sokol_audio` is a raw
   callback with no decoder; text is bitmap debugtext or a fontstash
   binding). Strongest on engineering taste, weakest on batteries.

3. **Hand-rolled OpenGL + GLFW.** Full control, no lib opinions.
   Rejected: this is a reimplementation of what raylib already is,
   paid for in the weeks that N2 is trying to save. Revisit only if
   both raylib and SDL3 fail, which would itself be surprising.

4. **Wrap the existing web build in a native webview** (Tauri/Electron
   shape). Ships "a desktop version" in about a day. **Rejected on
   definition:** the artifact would contain a JS runtime, the Phaser
   shell, and the TS sim mirror — it fails the scope line at the top of
   `native-desktop-goal.md`, delivers none of the point (one engine,
   native performance, no TypeScript), and would make E3's de-mirror
   harder by giving the TS sim a second reason to live. Recorded here
   because it is the obvious cheap move and should stay rejected on
   purpose rather than by omission.

5. **Defer the shell decision until after E3.** Rejected. N0 is
   unblocked today and does not depend on this choice, but N2 is the
   visible deliverable and it stalls entirely without a shell. Nothing
   about E3 changes the criteria.

## Decision

**raylib is the native desktop shell for N2**, vendored and built
through `zig build`, consumed via `@cImport` on `raylib.h` rather than
third-party bindings — which removes binding-version risk against the
0.15.2 pin and keeps the C-interop story identical to what any other
candidate would have required (`addTranslateC` after the L2 toolchain
jump, for raylib the same as for SDL).

It is selected because it satisfies the whole N2 criteria list out of
one dependency-light C library:

1. **Rendering** — batched 2D shapes, `BLEND_ADDITIVE` plus custom
   blend modes, `RenderTexture2D` for render-to-texture. This is the
   baked-tier grammar exactly.
2. **Text** — `LoadFontEx` gives TTF rasterization, with SDF font
   support available for scale-independent HUD text.
3. **Audio** — decodes wav/ogg/mp3/flac natively (raudio, built on
   miniaudio + dr_libs), so the 27 MB of canonical recordings play
   without a fourth-party decoder and the `ProceduralAudio` graph has a
   mixer to land on.
4. **Live tier later** — custom GLSL via `BeginShaderMode`, so
   "shaders arrive with the live-tier VFX" is not exclusive to SDL_GPU
   for 2D glow work.
5. **Frame control** — the caller owns the loop, so the sim keeps its
   own fixed tick and the shell interpolates for presentation.
6. **Build + cross-compile** — small C library, no heavy system
   dependency graph, vendors cleanly into the Zig build for the
   x86_64-windows target that N-platform wants green from day one.
7. **Available now** — `extra/raylib 6.0`, so N1's spike starts the
   same session it is picked.

The decisive structural argument is **reversibility**. NL1 keeps the
shell free of game behavior and the N0 hash passport *proves* it
mechanically, so a later shell swap is bounded work — rendering, input,
audio, sockets — against a sim that never changes, with a check that the
swap altered nothing about the game. Given a reversible decision, the
right thing to optimize is speed to first playable, because the polish
tail is dozens of footage-driven iteration passes where loop speed
compounds. Paying today for a Steam Deck future that N4 has explicitly
parked — while the funnel carries roughly zero real signups — would be
buying a structure before it is earned.

### Switch triggers (when SDL3 takes over, no re-argument needed)

- **Steam Deck / Steam Input becomes a real deliverable** rather than a
  parked N4 line: gyro, trackpads, rumble, or Steam Input mapping.
- **GL instability costs lanes on this box** — if the NL6 hard-lock
  recurs during shell work, the ability to flip render backend at
  runtime is worth the migration on its own.
- **Live-tier VFX outgrow GL 3.3 shaders** (judged unlikely for 2D).
- **Multi-window** becomes a requirement (ops overlay, tooling).

Any one trigger firing means: write the follow-up ADR, port the shell,
run the N0 passport to prove the game did not change.

## Consequences

### Positive

- N2 starts against one dependency instead of three, with text and
  audio decode already solved; the first windowed build is days, not
  weeks, of dependency plumbing.
- The `@cImport`-direct approach means no third-party binding tracks
  our Zig version — one less thing to break at the L2 jump.
- Cross-compiling the Windows target stays cheap, which keeps the
  N-platform "keep Windows green from day one" rule affordable rather
  than aspirational.
- Iteration speed serves the footage loop, which is where the game's
  remaining quality actually comes from.

### Negative / cost

- **OpenGL only.** No Vulkan/Metal/D3D12 path and no software
  fallback, so NL6's discipline stops being belt-and-braces and becomes
  the actual mitigation: sysrq armed, `nvidia-persistenced` running,
  work committed before first launch of a new spike build, never spike
  while humans are on the public host. A wedge costs a reboot.
- **Steam Deck gap.** Gyro/trackpad/rumble/Steam Input are not
  available at raylib's layer; if N4 turns real, that is a migration.
- Global library state and raylib's own conventions (`Camera2D`,
  texture/font lifetimes) are idioms to learn and to keep firmly on the
  shell side of the NL1 wall.
- Smaller escape hatch for exotic platform needs than SDL's ecosystem.

### Neutral

- The decision is reversible by construction (NL1 + the N0 passport)
  and is *expected* to be revisited if a trigger fires. Recording it
  now buys sequencing, not permanence.
- Audio, text and input all sit behind the shell wall, so a future swap
  touches no sim code and no test that matters to game behavior.
- Nothing here affects N0, which is unblocked today and shell-agnostic.
- **Linking on this box (found by the spike, 2026-08-10):** Zig 0.15.2
  cannot link the system `crt1.o` — GCC 16 emits an `.sframe` section
  whose `R_X86_64_PC64` relocation Zig's linker rejects outright. The fix
  is to pin `glibc_version` on the build target so Zig supplies its own
  start files, which puts it in cross-compile mode and then requires an
  explicit `/usr/lib` library path for GL/X11. Both halves are in
  `sim/build.zig`. This is a property of THIS machine's toolchain, not of
  raylib, and is explicitly not a reason to move the Zig pin.
- **Asset gap (found by the spike):** the repo's brand faces ship as
  `.woff2`, which raylib cannot load. The native shell needs TTF/OTF cuts
  of Space Grotesk / Space Mono / Noto Serif Display, or a woff2 decoder.
- **Toolchain footgun, unrelated to the pick but fatal to spike data:**
  `/usr/bin/zig` on this box is 0.16.0 and only the repo's mise shim
  resolves the pinned 0.15.2. A spike built from a scratch directory
  compiles under the wrong toolchain and returns misleading C-interop
  friction. Spikes run inside the repo or via `mise exec`.

## What this replaces

- `native-desktop-goal.md` N1.2's three-spike plan (sokol / SDL3 /
  raylib) — amended to a single raylib spike with SDL3 as the named
  fallback, per NL4's "spiked, not vibed" (a scored comparison exists;
  it is this document, and it is not ceremonial).
- The same-day initial recommendation of SDL3, withdrawn above with
  its two faulty premises named.

## References

- `docs/native-desktop-goal.md` — Track N detail, laws NL0-NL6, phases
- `docs/gospel-goal.md` — Track N orchestration, L2 toolchain pin, L7
  standing rules (canonical SFX recordings; crystal/diamond grammar)
- ADR-0006 — Zig/wasm sim substrate (why the core is Zig at all)
- ADR-0001 — sim purity contract (why NL1's shell wall is enforceable)
- `docs/RENDER_OVERHAUL_PLAN.md` — the baked vs live tier NL3 refers to
- Verified on-box 2026-08-09: `extra/raylib 6.0-1`, `sdl3 3.4.14-1`
  installed, `mbedtls 3.6.5-1` installed (relevant to the still-open
  N3 transport row, not to this ADR)
