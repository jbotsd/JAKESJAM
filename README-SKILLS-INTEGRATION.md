# JAKESJAM Skills Integration with Pi Agent

## Overview

The JAKESJAM project now has **15 domain-specific skills** integrated with Pi's
coding agent tools. These skills are loaded automatically when the user mentions
keywords related to each domain.

## What Was Created

| File | Size | Description |
| ---- | ---- | ----------- |
| `SKILLS.md` | 126KB | All 15 skills consolidated in one place |
| `.agents/skills/ROOT-SKILL.md` | 4KB | Master routing matrix for domain dispatch |
| `.agents/skills/passthrough/SKILL.md` | 3KB | Pi tool bridge and examples |
| `.agents/skills/MASTER-SKILLS.md` | 126KB | Quick reference index |
| `CONTEXT.md` (updated) | +180 lines | Skill workflow rules |

## How It Works

### Automatic Loading on Trigger

When the user says something like:

| User says... | Pi loads... |
| --- | --- |
| "fix the prediction bug" | `game-sim-determinism`, `game-netcode`, `game-loop-perf`, `game-feel-juice` |
| "make it juicier" | `game-feel-juice` |
| "setup Convex auth" | `convex-quickstart`, `convex-setup-auth` |
| "review combat TTK" | `combat-balance-ttk` |
| "60 FPS drops" | `game-loop-perf` |

Pi automatically reads the relevant `.claude/skills/` or `.agents/skills/convex/`
directories before answering.

### Tool Execution

After loading context, Pi executes tools like:

```bash
# Grep patterns from the skill guide
grep -r "projectileImpacted" client/src/sim/

# Find files by pattern
find client/src -name "*.ts" -exec grep -l "new Phaser" {} \;

# Apply fixes validated by the skill
edit client/src/game/scenes/MatchScene.ts
```

## The 15 Skills

### Core Gameplay (12)

1. **Phaser 4 Client** — Scenes, rendering, assets, input
2. **Shared Simulation** — Soft determinism, seeded RNG
3. **Netcode** — Bun WS, msgpack, prediction
4. **60 FPS Perf** — Frame budget, allocation discipline
5. **Combat Balance** — TTK targets, archetypes, dodge windows
6. **Game Feel** — Hit-stop, shake, particles, audio
7. **TS Discipline** — Branded IDs, satisfies over as
8. **Matchmaking** — Glicko-2, OpenSkill, Convex rating
9. **Sim Testing** — bun:test, determinism tests
10. **Replay/Spectator** — Input-only recording
11. **Rogue-lite** — Card economy, telemetry balance
12. **Onboarding** — FTUE, tutorial design

### Infrastructure (3)

13. **Fly.io Deploy** — Stateful server, multi-region
14. **Architecture** — Module/Interface/Seam lexicon
15. **Convex** — 5 sub-skills: quickstart, auth, component, migration, perf

## Quick Reference

| Domain | Keyword Triggers | Primary Skill |
| ------ | --- | --- |
| Phaser Rendering | "Phaser", "scene", "sprite" | phaser4-game |
| Determinism | "determinism", "RNG", "seed" | game-sim-determinism |
| Netcode | "netcode", "WebSocket", "msgpack" | game-netcode |
| Performance | "60 FPS", "stutter", "jank" | game-loop-perf |
| Combat | "TTK", "combat", "weapon" | combat-balance-ttk |
| Feel/Juice | "juice", "shake", "hit-stop" | game-feel-juice |
| TS | "TypeScript", "satisfies" | ts-pocock |
| Matchmaking | "MMR", "Glicko", "Elo", "OpenSkill" | matchmaking-skill-rating |
| Testing | "test", "bun:test" | sim-tests |
| Replay | "replay", "spectator", "POV" | replay-spectator |
| Rogue-lite | "card", "draft", "rogue-lite" | roguelite-draft-design |
| FTUE | "onboarding", "tutorial" | onboarding-ftue |
| Infra | "fly", "Dockerfile", "deploy" | fly-game-deploy |
| Arch | "architecture", "refactor", "module" | improve-codebase-architecture |
| Convex | "Convex", "schema", "migration" | convex/ROOT |

## Example Session

**User:** "The prediction keeps snapping after a kill"

**Pi Action:**

1. Loads: `game-sim-determinism` + `game-netcode` + `game-feel-juice` + `game-loop-perf`
2. Greps: `grep -r "projectileImpacted"` in sim files
3. Reads: `.claude/skills/game-feel-juice/SKILL.md` for kill stack
4. Verifies: Kill event handles hit-stop correctly (pauses tweens, not sim loop)
5. Reports: "Check `OnlineMatchScene` — ensure hit-stop only freezes `tweens.timeScale`"

## Verification

All 15 skills are loaded and accessible:

```bash
bun read SKILLS.md | head -20  # Shows first 20 sections
bun read ".agents/skills/ROOT-SKILL.md"  # Shows routing matrix
bun read ".agents/skills/passthrough/SKILL.md"  # Shows Pi examples
```

## Next Steps

The skills are ready. Pi will:

1. Automatically load relevant skills on keyword trigger
2. Apply domain-specific rules and patterns
3. Execute tools (read, grep, find, edit) with validated context
4. Verify changes against skill checklists

The 126KB `SKILLS.md` contains all 15 skill guides — ready for instant context injection.
