---
name: root
description: >
  The JAKESJAM master routing layer. Use when the user's request is broad
  ("fix the game") or multi-domain ("setup netcode and matching").
  Routes to the most specific sub-skill based on the request domain.
---

# JAKESJAM Master Route

Default skill that understands all domains and routes to specialists.

## Routing Matrix

| User Intent (keywords) | Target Skill | Target File |
| --- | --- | --- |
| "Phaser", "scene", "canvas", "sprite", "atlas", "audio" | phaser4-game | .claude/skills/phaser4-game/SKILL.md |
| "deterministic", "seed", "RNG", "sim", "prediction" | game-sim-determinism | .claude/skills/game-sim-determinism/SKILL.md |
| "netcode", "WebSocket", "msgpack", "snapshot", "interpolation" | game-netcode | .claude/skills/game-netcode/SKILL.md |
| "60 FPS", "stutter", "jank", "jitter", "frame", "accumulator" | game-loop-perf | .claude/skills/game-loop-perf/SKILL.md |
| "TTK", "damage", "weapon", "parry", "dodge", "combat" | combat-balance-ttk | .claude/skills/combat-balance-ttk/SKILL.md |
| "juice", "shake", "hit-stop", "particle", "kickback" | game-feel-juice | .claude/skills/game-feel-juice/SKILL.md |
| "TypeScript", "satisfies", "branded", "escap" | ts-pocock | .claude/skills/ts-pocock/SKILL.md |
| "MMR", "Glicko", "Elo", "OpenSkill", "rating", "matchmaking" | matchmaking-skill-rating | .claude/skills/matchmaking-skill-rating/SKILL.md |
| "test", "bun:test", "determinism test" | sim-tests | .claude/skills/sim-tests/SKILL.md |
| "replay", "spectator", "POV" | replay-spectator | .claude/skills/replay-spectator/SKILL.md |
| "card", "draft", "rogue-lite", "synergy", "pick rate" | roguelite-draft-design | .claude/skills/roguelite-draft-design/SKILL.md |
| "onboarding", "FTUE", "tutorial", "first time" | onboarding-ftue | .claude/skills/onboarding-ftue/SKILL.md |
| "fly", "Dockerfile", "deploy", "server", "Fly\.io" | fly-game-deploy | .claude/skills/fly-game-deploy/SKILL.md |
| "architecture", "refactor", "module", "interface", "seam" | improve-codebase-architecture | .claude/skills/improve-codebase-architecture/SKILL.md |
| "Convex", "schema", "migration", "auth", "component" | convex (roots to sub-skills) | .agents/skills/convex/SKILL.md |

## Default Behavior

If multiple keywords match:
1. Check domain priority: sim > net > game > convex > infrastructure
2. Use the most specific match
3. Mention alternatives if ambiguous

Example: "fix the combat prediction" → game-sim-determinism (not just "combat")

## Sub-skill Dispatch (for Convex)

If the user says "Convex" and one of these:
- "new project", "quickstart", "scaffold" → convex-quickstart
- "login", "auth", "users", "role" → convex-setup-auth
- "component", "extract", "reusable" → convex-create-component
- "migrate", "schema change", "backfill" → convex-migration-helper
- "slow", "perf", "read-heavy", "OCC" → convex-performance-audit
- Just "Convex" → route to the root convex skill which reads all 5 sub-skills

## Trigger Context Loading

When triggered, also load:
1. `.agents/skills/ROOT-SKILL.md` (this file)
2. The matching skill file(s) + any related skills
3. The user's `CONTEXT.md` domain context

## Example Sessions

### Session 1: "The prediction keeps snapping after a kill"
**Triggers:** prediction, kill, snap
**Loads:**
- `.claude/skills/game-sim-determinism/SKILL.md` (events, soft determinism)
- `.claude/skills/game-netcode/SKILL.md` (reconciliation, interpolation)
- `.claude/skills/game-feel-juice/SKILL.md` (kill stack, hit-stop)
- `.claude/skills/game-loop-perf/SKILL.md` (fixed timestep)

**Action:** Grep `projectileImpacted` in sim files, check if kill event pauses the sim loop.

### Session 2: "Setup auth and Convex for the new project"
**Triggers:** auth, Convex, project
**Loads:**
- `.agents/skills/convex-setup-auth/SKILL.md`
- `.agents/skills/convex-quickstart/SKILL.md`

**Action:** Ask which auth provider, scaffold or integrate.

### Session 3: "Make the game feel juicier"
**Triggers:** juice, feel
**Loads:**
- `.claude/skills/game-feel-juice/SKILL.md` (primary)
- `.claude/skills/phaser4-game/SKILL.md` (secondary: tweens, rendering)

**Action:** Review kill stack, draft confirm, particle events against Nijman's checklist.
