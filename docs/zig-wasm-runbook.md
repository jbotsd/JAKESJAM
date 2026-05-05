# Zig→WASM substrate runbook

What to do if the wasm sim breaks in production.

## Quick reference: emergency disables

| Failure | Mitigation | Time-to-mitigate |
|---|---|---|
| Wasm 404 in browser console | Vercel build failed to bundle wasm. Re-run deploy or check Vercel build logs. | ~5 min (redeploy) |
| `[wasm-sim] failed to load` console error | Wasm failed to instantiate. Client falls back to TS native automatically. No user impact, but determinism gap. | Already mitigated via fallback |
| Predict↔authority drift visible (jitter, snap) | Server-side wasm not active. Set `JAKESJAM_WASM_COLLISION=1` (or unset to default-on per F3). | ~3 min via flyctl |
| Specific user reports broken sim | Tell them to append `?wasm-collision=0&wasm-player=0&wasm-rng=0` to URL. | Instant |
| Whole-server emergency revert | `flyctl secrets set JAKESJAM_WASM_COLLISION=0 JAKESJAM_WASM_PLAYER=0` | ~3 min for VM roll |
| Whole-substrate emergency revert | `git revert <substrate-commits> && git push` | ~10 min via CI |

## Diagnostics

### Is wasm actually running?

Open browser console at `https://jakesjam.vercel.app`. Within ~1s
of load you should see:

```
[wasm-sim] ready — state=65536B, currentTick=0, exports=72, trig LUT installed (1024 entries)
[wasm-rng] swap applied — sim RNG now executes in Zig wasm
[wasm-collision] swap applied — sim collision now executes in Zig wasm
[wasm-player] swap applied — stepPlayer now executes in Zig wasm
```

If you see only the first line and then `[wasm-rng]` etc. say
"disabled by ?wasm-X=0", you're in opt-out mode. Drop the flag.

If you see no `[wasm-sim] ready` line, wasm failed to load. Check
Network tab for `/wasm/sim.wasm` — if 404, re-deploy.

### Is the server using wasm?

Fly logs:
```sh
flyctl logs -a jakesjam-srv-sin | grep wasm-sim
```

You should see at startup:
```
[wasm-sim] server-side trig LUT installed (1024 entries) — predict ↔ authority trig now bit-identical
[wasm-sim] server-side resolveMoveCached now executes in Zig wasm
[wasm-sim] server-side stepPlayer now executes in Zig wasm
```

If trig LUT install is missing, server is running pre-`6e088d2`
code — redeploy.

### Cross-host parity check (manual)

Two-tab playtest:
1. Tab A: `https://jakesjam.vercel.app` (wasm default-on)
2. Tab B: `https://jakesjam.vercel.app/?wasm-collision=0&wasm-player=0&wasm-rng=0`
3. Same playtest in both. Tab A should show no rig jitter when
   standing on a platform; Tab B may show small jitter.

If Tab A also shows jitter, server-side wasm isn't active OR a
different determinism gap exists. Check server Fly logs.

## Common failure modes

### "Wasm 404 after deploy"

**Cause**: Vercel build env doesn't have Zig.
**Fix**: `scripts/vercel-build.sh` installs Zig at build time —
verify `vercel.json` `buildCommand` points at it. Re-run deploy.
Confirm by `curl -sI https://jakesjam.vercel.app/wasm/sim.wasm` →
`200 OK` with `Content-Type: application/wasm`.

This was the original bug in v0.37 (commit `99ffa73` triggered the
fix; complete fix at `3cf5fb2`).

### "Wasm load fails with `xz: File format not recognized`"

**Cause**: Zig download URL is wrong.
**Fix**: Confirm URL is `zig-x86_64-linux-{ver}.tar.xz` (cpu first,
then os) — NOT `zig-linux-x86_64-...`. See `scripts/vercel-build.sh`.

### "Fly Docker build fails with `client/public/wasm: not found`"

**Cause**: GitHub runner didn't run `zig build` before flyctl.
**Fix**: Confirm `.github/workflows/deploy.yml` `deploy-server`
job has `mlugg/setup-zig@v2` + `cd sim && zig build` step before
flyctl deploy.

### "Server logs show `[wasm-sim] server-side load failed`"

**Cause**: Wasm artifact missing from Docker image.
**Fix**: Verify `server/Dockerfile` has `COPY client/public/wasm
./client/public/wasm`. If yes, verify build pipeline produces the
wasm before docker build.

### "Predict↔authority shows non-zero reconcile delta"

**Cause**: Either client OR server is running TS-only, not wasm.
**Fix**: Check console (client) + Fly logs (server) for the
`[wasm-sim] *swap applied*` lines. If either is missing, the
substrate isn't fully active. Defaults should be on per F3 —
verify env vars aren't accidentally `=0`.

### "Match feels slower / FPS drops after wasm enable"

**Cause**: Unlikely; perf bench shows ~6% overhead. If genuinely
slow, check `bun run sim:bench` numbers vs the baseline in
`docs/zig-wasm-perf-baseline.md`.

## Rollback ladder

In order of severity:

1. **Per-user**: append `?wasm-collision=0&wasm-player=0` to URL.
   Instant. Doesn't affect other users.

2. **Server-side disable** for all users:
   ```sh
   flyctl secrets set --app jakesjam-srv-sin \
     JAKESJAM_WASM_COLLISION=0 JAKESJAM_WASM_PLAYER=0
   ```
   ~3 min for Fly VM roll. Server now runs TS-native; clients
   that don't have an opt-out URL flag still use wasm but reconcile
   against the TS-server (some drift expected).

3. **Client-side disable** via redeploy: edit `runtime.ts` to
   force the disable path, push, wait for Vercel deploy. ~10 min.

4. **Full substrate revert**: `git revert <commit-range> && git
   push`. Reverts everything, including the F3 default-on flip.
   System falls back to pre-substrate TS-only sim (with the
   determinism bug). Last resort.

## Adding new sim work safely

See `docs/zig-wasm-migration-complete.md` "How to extend" + the
`.claude/skills/zig-code-quality/SKILL.md` "Lessons learned"
section.

Common gotchas (each cost real debugging time during the
migration):

1. **Operator order matters.** `(a*b)/c` ≠ `a*(b/c)` at last-ULP
   precision. Match TS's left-to-right evaluation in Zig.
2. **Don't use `Math.hypot`.** Use `Math.sqrt(a*a + b*b)`.
3. **`pub export fn`** — both keywords needed (only `export` is
   a Zig footgun).
4. **Trig LUT must install on every host.** If you add server
   work that uses `lutCos/lutSin/lutAtan2`, confirm
   `loadServerSim()` ran first.
5. **Don't break the TS-native fallback.** It IS the emergency
   rollback path.

## Contact

Questions about the substrate: see `docs/adr/0006-zig-wasm-sim-substrate.md`
for rationale, `docs/zig-wasm-migration-complete.md` for the
retrospective, `.claude/skills/zig-code-quality/SKILL.md` for
the porting playbook.
