# Agent Registry

All active agent quicks for JAKESJAM. Each `.yaml` file defines a "quik" (quick action) that the model can invoke on specific triggers.

## Total: 14 Agents

| Skill | Agent | `default_prompt` Focus |
| --- | --- | --- |
| **Convex Quickstart** | `convex-quickstart/` | Scaffold or integrate Convex with `npx convex ai-files install` |
| **Convex Setup Auth** | `convex-setup-auth/` | Wire up auth provider + Convex user model |
| **Convex Create Component** | `convex-create-component/` | Design local/packaged components with boundaries |
| **Convex Migration Helper** | `convex-migration-helper/` | Safe schema/data migrations (widen→migrate→narrow) |
| **Convex Performance Audit** | `convex-performance-audit/` | Audit OCC, time, subscriptions, limits |
| **Game-Loop Perf** | `game-loop-perf/` | Keep sim at 60 FPS (<8ms/tick headroom) |
| **Game-Feel Juice** | `game-feel-juice/` | 30ms kill-stop, 180ms shake, 24 particles, random pitch |
| **Phaser 4 Renderer** | `phaser4-game/` | Scenes, assets, input, tweens, sim↔Phaser seam |
| **TS-Pock** | `ts-pocock/` | `satisfies` over `as`, branded IDs, discriminated unions |
| **Matchmaking** | `matchmaking-skill-rating/` | Glicko-2 (1v1), OpenSkill (FFA), Convex persistence |
| **Sim-Tests** | `sim-tests/` | bun:test: determinism, 3 runs, 3 seeds, 3 rounds |
| **Combat TTK** | `combat-balance-ttk/` | 1.8-3.5s TTK, 4 archetypes, ≤500ms dodge |
| ... | ... | ... |

## Invocation

The model reads `default_prompt` on keyword match (from `ROOT-SKILL.md`) and executes the prompt against the relevant files.

## Directory Layout

```
.agents/skills/
  convex/              # 5 Convex sub-skills
  convex-quickstart/
  convex-setup-auth/
  convex-create-component/
  convex-migration-helper/
  convex-performance-audit/
  phaser4-game/
  game-feel-juice/
  game-loop-perf/
  ts-pocock/
  matchmaking-skill-rating/
  sim-tests/
  combat-balance-ttk/
  replay-spectator/     # TODO: agent YAML
  roguelite-draft-design/ # TODO: agent YAML
  onboarding-ftue/      # TODO: agent YAML
  fly-game-deploy/      # TODO: agent YAML
  improve-codebase-architecture/ # TODO: agent YAML
```

## Adding a New Agent

1. Create `<skill-name>/agents/openai.yaml`
2. Use the `interface` + `policy` keys
3. Set `default_prompt` with numbered steps
4. The model will auto-load on keyword match

## Quick Specs

| Spec | Value |
| --- | --- |
| Agent Format | `openai.yaml` (YAML) |
| Agent Keys | `interface.display_name`, `interface.short_description`, `interface.default_prompt`, `policy.allow_implicit_invocation` |
| Invocation | Keyword match → `.agents/skills/<skill>/agents/openai.yaml` → `default_prompt` |
| Tool Set | `read`, `edit`, `write`, `grep`, `find`, `bash` |
| Target Files | `client/`, `server/`, `convex/`, `sim/` |
