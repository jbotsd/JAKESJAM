---
name: verify-after-change
description: >
  Maps file paths to the verification command you must run after editing.
  Use after every code change before claiming "done". Triggers on: "done",
  "fixed", "should work now", "ready", "implemented", or whenever you've
  just used edit/write/multi_edit and are about to send a response.
version: 1.0.0
---

# Verify After Change

## Why this skill exists

"I made the change" is not the same as "the change works." Small models
routinely claim a fix is in place without ever running a check. This
skill is a lookup table: edited X, run Y.

## The hard line

**Every code edit must be followed by at least one verification command.
The output goes in your response. If you didn't run it, you don't know
if it works.**

## Verification matrix

Run the cell that matches the file you changed. Run more than one if the
change spans seams (e.g. sim → net → render).

### Sim layer (`client/src/sim/**`)

Authoritative determinism. Highest verification bar.

```bash
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
bun test client/src/sim/__tests__/world-determinism.test.ts
```

For broader sim suite:
```bash
bun test client/src/sim/__tests__/
```

If determinism fails, read `bisect-determinism` skill before guessing.

### Net layer (`client/src/net/**`, `server/src/protocol.ts`, snapshot/delta)

```bash
bun test client/src/net/
bun typecheck    # protocol changes ripple via TS
```

If wire format changed, also test client+server pair:
```bash
bun --filter server test
```

### Server (`server/src/**`)

```bash
cd server && bun typecheck && bun test
```

### Convex (`convex/**`)

```bash
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
npx convex dev --once    # validates schema & functions
```

For schema changes specifically: `convex-migration-helper` skill
applies — read it before merging.

### Phaser / client UI (`client/src/game/**`)

No automated test for visuals. Verification:

```bash
bun typecheck
```

Then state explicitly: "Browser verification required — no automated
test exists for `<scene/system name>`. The user should run `bun dev`
and confirm `<specific behavior>`."

### TypeScript (`*.ts` anywhere)

```bash
bun typecheck
```

Do this even if you also ran tests — typecheck catches structural
mismatches tests can miss.

### Lint / format (`*.ts`, `*.tsx`, `*.json`)

If the project has biome/eslint configured:
```bash
bun lint    # or: bunx biome check <path>
```

Optional but reduces churn.

### Build (after large refactors)

```bash
bun build
```

Catches dead imports and TS-but-not-ESM issues.

## What "passes" looks like

Tests:
```
✓ test name
1 pass, 0 fail
```

Typecheck:
```
<silent — exit 0>
```

If you see anything else, **the change is not done.** Report the
failure, don't paper over it.

## What to put in your report

```
edited <files>
verified: bun test sim/world-determinism → 12 pass, 0 fail (327ms)
verified: bun typecheck → clean
```

Include first 200 bytes of any non-trivial output. If a test fails,
include the failure message verbatim.

## When you cannot verify

Say so. Do not invent results.

```
edited <files>
verification: NOT RUN — <reason>. Suggested check: <command>.
```

Reasons that are OK: "behavior is browser-only", "requires running
server", "needs human eyes on a particle effect". Reasons that are
NOT OK: "tests would take too long", "I'm confident it works".
