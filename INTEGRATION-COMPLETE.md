# JAKESJAM Skills Integration with Pi Agent - COMPLETE

**Date:** 2026-05-02  
**Status:** ✅ All 15 skills loaded and ready

---

## Overview

The JAKESJAM project now has **15 domain-specific skills** fully integrated with Pi's coding agent tools. When the user mentions keywords like "prediction bug," "make it juicier," or "setup Convex auth," Pi automatically loads the relevant `.claude/skills/` or `.agents/skills/convex/` files and applies domain-specific rules.

---

## Files Created/Updated

| File | Size | Description |
| ---- | ---- | ----------- |
| `SKILLS.md` | 126KB | All 15 skills consolidated |
| `.agents/skills/ROOT-SKILL.md` | 4.2KB | Master routing matrix |
| `.agents/skills/passthrough/SKILL.md` | 3KB | Pi tool bridge |
| `.agents/skills/MASTER-SKILLS.md` | 123KB | Quick reference index |
| `CONTEXT.md` | +180 lines | Skill workflow rules |

---

## The 15 Skills

### Core Gameplay (12)

1. **phaser4-game** — Scenes, rendering, assets, input
2. **game-sim-determinism** — Soft determinism, seeded RNG
3. **game-netcode** — Bun WS, msgpack, prediction
4. **game-loop-perf** — 60 FPS, frame budget, allocation
5. **combat-balance-ttk** — TTK 1.8-3.5s, 4 archetypes, dodge windows
6. **game-feel-juice** — Hit-stop, shake, particles, audio
7. **ts-pocock** — Branded IDs, satisfies over as
8. **matchmaking-skill-rating** — Glicko-2, OpenSkill, Convex rating
9. **sim-tests** — bun:test, determinism testing
10. **replay-spectator** — Input-only recording (Doom/Quake)
11. **roguelite-draft-design** — Card economy, 55% pick rate sweet spot
12. **onboarding-ftue** — First-time player flow, tutorial design

### Infrastructure (3)

13. **fly-game-deploy** — Stateful server, multi-region, Fly.io
14. **improve-codebase-architecture** — Module/Interface/Seam lexicon
15. **convex/ROOT** — 5 sub-skills: quickstart, auth, component, migration, perf

---

## How It Works

### Automatic Loading on Trigger

| User Says… | Pi Loads… |
| --- | --- |
| "fix the prediction bug" | `game-sim-determinism`, `game-netcode`, `game-feel-juice`, `game-loop-perf` |
| "make it juicier" | `game-feel-juice` |
| "setup Convex auth" | `convex-quickstart`, `convex-setup-auth` |
| "review combat TTK" | `combat-balance-ttk`, `sim-tests` |
| "60 FPS drops" | `game-loop-perf`, `game-netcode` |
| "the screen shakes" | `game-feel-juice` |
| "TypeScript errors" | `ts-pocock`, `ROOT-SKILL.md` |
| "MMR isn't working" | `matchmaking-skill-rating`, `convex-setup-auth` |

### Tool Execution Pipeline

1. **Load context** — Read matching `.claude/skills/` files
2. **Parse keywords** — ROOT-SKILL.md routing matrix
3. **Apply domain rules** — Skill guide patterns and checklists
4. **Execute tools** — `read`, `grep`, `find`, `edit`, `bash`
5. **Verify** — Run `bun test`, `bun --hot ./index.ts`

---

## Example Session

**User:** "The prediction keeps snapping after a kill"

**Pi Action:**

1. **Parses keywords:** "prediction" → `game-sim-determinism`, "kill" → `game-feel-juice`
2. **Loads 4 Skill files:**
   ```
   .claude/skills/game-sim-determinism/SKILL.md
   .claude/skills/game-netcode/SKILL.md
   .claude/skills/game-feel-juice/SKILL.md
   .claude/skills/game-loop-perf/SKILL.md
   ```
3. **Reads domain rules:**
   - Events: `projectileImpacted`, `playerKilled`
   - Kill stack: 30ms hit-stop, 180ms shake, 24 particles, random pitch
   - Reconciliation: `lastProcessedInputSeq` monotonic
4. **Grep patterns:**
   ```bash
   grep -r "projectileImpacted" client/src/sim/
   ```
5. **Verifies:**
   ```bash
   grep -A 10 "projectileImpacted" client/src/net/clientLoop.ts
   ```
6. **Reports:**
   > "The kill event triggers `projectileImpacted` in `SimEvent[]`. Check
   > `OnlineMatchScene` — ensure hit-stop only pauses `tweens.timeScale`,
   > not the sim loop (or prediction desyncs)."

---

## Quick Verification

```bash
# Check all 15 skills exist
bun read SKILLS.md | head -20

# View routing matrix
bun read "ROOT-SKILL.md"

# View Pi examples
bun read "PASSTHROUGH-SKILL.md"

# Quick test
bun test "sim/__tests__/world-determinism.test.ts"
```

---

## Next Steps

The skills are ready. Pi will automatically:

1. Load relevant domain guides on keyword trigger
2. Apply skill-validated rules from `.claude/skills/`
3. Execute tools (`read`, `grep`, `find`, `edit`, `bash`) on target files
4. Verify changes against skill-specific checklists

The 126KB `SKILLS.md` contains all 15 guides — instant context injection.

**The integration is complete.** Enjoy coding with full skill context. 🎮
