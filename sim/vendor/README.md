# Vendored native dependencies

Gitignored. Nothing here is committed — these are build inputs fetched on
demand, so a clone stays small and nobody inherits a stale binary.

## raylib (gospel N1.1 / ADR-0008)

```sh
cd sim/vendor
git clone --depth 1 --branch 5.5 https://github.com/raysan5/raylib.git raylib
cd raylib
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_EXAMPLES=OFF
cmake --build build -j"$(nproc)"
```

Produces `build/raylib/libraylib.a`, which `sim/build.zig`'s
`spike-raylib` step links against.

**5.5, not 6.0.** Same judgement as the Zig pin (0.15.2 over 0.16): take
the release with mileage on it, not the one tagged last week. Revisit
deliberately, not by default.

**Built here rather than installed system-wide** on purpose. This box is a
daily driver whose nvidia stack moves on every `-Syu`; a spike is not a
reason to touch it (L2, L13).

Then:

```sh
cd sim && zig build spike-raylib
./zig-out/bin/jjspike --frames 900 --uncapped   # run from the REPO ROOT (asset paths)
```
