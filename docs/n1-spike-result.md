# N1.1 — raylib confirmation spike: RESULT

Run 2026-08-10 on the dev box (Arch, RTX 4080, Hyprland/Wayland, Zig
0.15.2, raylib 5.5 vendored and built in-repo).

```
window      : OK (1280x720)
gl          : OpenGL 3.3 (raylib PLATFORM_DESKTOP default)
shapes      : 500 additive-blended, moving
frames      : 899 measured, UNCAPPED
frame p50   : 1.02 ms
frame p99   : 1.48 ms      (60 Hz budget = 16.67 ms)
frame worst : 18.35 ms
text        : OK — HUD text from a TTF
audio       : OK — canonical meme SFX decoded from file (assets/sfx-memes/bruh.wav)
mouse       : OK — set/get position round-trips
gamepad     : OK — gamepad 0 present
VERDICT     : HAS 60 Hz headroom (~11x)
```

**Every item on the bar passes.** Per row 1.2 this promotes: raylib is
confirmed, ADR-0008 moves from spike-gated to decided, and SDL3 stays the
named fallback behind its existing switch triggers rather than being
re-argued.

## Measure the capability, not the cap

The first run reported `p99 16.67 ms` and a cheerful "60 Hz HELD". That
number was worthless: `SetTargetFPS(60)` makes raylib *sleep* to hit the
cap, so p99 comes back as exactly the budget no matter how much headroom
exists. It is a meter reporting what you asked for.

`--uncapped` is the run that means something, and the gap is the whole
story — **16.67 ms vs 1.48 ms**. The spike now prints which mode produced
the number and refuses to say "held" on a capped run.

## Findings the shell work inherits

1. **Zig 0.15.2 cannot link this box's `crt1.o`.** GCC 16 emits an
   `.sframe` section whose `R_X86_64_PC64` relocation Zig's linker does
   not handle:
   `error: unhandled relocation type R_X86_64_PC64 at offset 0x3c ... in crt1.o:.sframe`
   Fixed by pinning a glibc version on the target
   (`.glibc_version = 2.39`) so Zig supplies its own start files. That
   puts Zig in cross-compile mode, which then stops it searching host
   library paths, so `/usr/lib` must be added explicitly for GL/X11. Both
   halves are in `sim/build.zig` with the reasoning. This is an L13 "this
   box bites" finding, NOT a reason to move the toolchain pin.

2. **The repo's brand fonts cannot be used natively as-is.**
   `client/public/fonts/*` are `.woff2`; raylib loads TTF/OTF. The native
   build needs TTF/OTF cuts of Space Grotesk / Space Mono / Noto Serif
   Display, or a woff2 decoder. Proven with a system TTF so the capability
   is confirmed while the asset gap stays visible.

3. **raylib is vendored, not installed.** `sim/vendor/raylib` (gitignored),
   built with cmake to a static `libraylib.a`. This box is a daily driver
   whose nvidia stack moves on every `-Syu`; a spike is not a reason to
   touch it. Reproduce with the commands in `sim/vendor/README.md`.

4. **GL 3.3 confirmed**, which is exactly the constraint ADR-0008 accepted
   when it chose raylib over SDL3 (no render-backend flip). No GL
   instability observed across ~2500 frames — the ADR's GL-instability
   switch trigger did not fire.

5. `worst` frame is ~18-19 ms even uncapped, i.e. one hitch per run. Not
   investigated; almost certainly compositor/first-draw. Recorded so a
   future frame-pacing pass does not treat it as new.
