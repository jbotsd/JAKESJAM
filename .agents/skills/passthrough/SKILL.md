---
name: passthrough
description: >
  Bridges the 15 JAKESJAM skills to Pi's tool set (read, edit, write, grep, find).
  Uses the routing logic in .agents/skills/ROOT-SKILL.md + the full context
  from SKILLS.md to answer any "what to do next" or "how to fix" with the
  project's specific patterns.
---

# Passthrough Skill

Bridges the 15 JAKESJAM skills to Pi's active tool set.

## Workflow

1. **Load SKILLS.md** (or relevant sub-skill file) into active context
2. **Parse the user's domain request** using ROOT-SKILL.md's routing matrix
3. **Select the best matching skill(s):**
   - If single-domain → use one skill
   - If multi-domain (e.g. "netcode and auth") → load both
   - If ambiguous → ask clarifying question with options
4. **Execute against files** in `client/`, `server/`, `convex/`, or `docs/`
5. **Verify** using skill-specific checklists

## Tool Mapping

| Pi Tool | When to Use | Example |
| ------- | ----------- | ------- |
| `read` | Loading context files | `read .claude/skills/phaser4-game/SKILL.md` |
| `grep` | Finding patterns from skill rules | `grep "Phaser.Math.Between" client/src/` |
| `find` | Locating files by pattern | `find client/src -name "*.ts" -exec grep -l "new Phaser" {}` |
| `edit` | Applying skill-validated fixes | Apply "No new in hot paths" from game-loop-perf |
| `bash` | Running verification | `bun test`, `bun --hot ./index.ts` |

## Skill Context Injection

When you see these keywords, inject the relevant SKILL.md content:

| Keyword | Loads |
| ------- | ----- |
| "Phaser" | phaser4-game |
| "determinism" | game-sim-determinism, game-netcode, game-loop-perf |
| "shake/juice" | game-feel-juice |
| "netcode" | game-netcode |
| "fly deploy" | fly-game-deploy |
| "Convex new" | convex-quickstart |
| "Convex auth" | convex-setup-auth |
| "Convex migrate" | convex-migration-helper |
| "Convex slow" | convex-performance-audit |
| "Convex test" | convex-quickstart (first step) |

## Example Session

**User:** "The prediction keeps snapping after a kill"

**Agent Action:**
1. Loads: game-sim-determinism, game-netcode, game-feel-juice, game-loop-perf
2. Grep: `grep -r "projectileImpacted" client/src/sim/`
3. Grep: `grep -r "StepResult" client/src/`
4. Reads: `.claude/skills/game-sim-determinism/SKILL.md` (events section)
5. Reads: `.claude/skills/game-netcode/SKILL.md` (reconciliation section)
6. Reads: `.claude/skills/game-feel-juice/SKILL.md` (kill stack section)
7. Identifies: Kill event has `projectileImpacted` event → triggers render-layer hit-stop
8. Verifies: `read client/src/net/clientLoop.ts` for `projectileImpacted` handling
9. Reports: "Check if hit-stop pauses the sim loop (should only pause tweens)"

## Root Context Files

These files provide the master routing layer:

- `.agents/skills/ROOT-SKILL.md` — Routing matrix (master)
- `.agents/skills/passthrough/SKILL.md` — This file (Pi bridge)
- `SKILLS.md` — All 15 skill files consolidated

Load these in order of specificity when context is needed.
