# Integrating Agent Stuffs, Extensions, & Tools

This guide integrates high-value extensions and skills from [agent-stuff](https://github.com/mitsuhiko/agent-stuff) and [rhubarb-pi](https://github.com/qualisero/rhubarb-pi) into JAKESJAM for Pi-based development.

## 📦 Prerequisites

- [Pi](https://github.com/badlogic/pi-mono) installed and running
- Node.js 20+ for bun packages
- JAKESJAM repo at `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM`

---

## 🎯 1. Install Core Extensions (CRITICAL)

These provide the most immediate value for JAKESJAM development:

```bash
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
bun install -g @mariozechner/pi-coding-agent

# Install extensions (recommended for JAKESJAM)
bun install -g mitsupi
pi install mitsupi --files --review --loop --session-breakdown --split-fork
```

### 1.1 Files Browser (`files.ts`)

**Purpose**: Unified file browser with git status + session references.

**Usage**:
```bash
/ff .agents/skills  # List .agents/skills files
/fdo client/src/sim/World.ts  # Open and diff
/fe ClientLoop  # Find files containing "ClientLoop"
```

### 1.2 Code Review (`review.ts`)

**Purpose**: Code review command with TUI diff, PR-style diff, custom fix loop.

**Usage**:
```bash
# Review working tree
/review

# Review specific file
/review client/src/sim/World.ts

# Review with custom instructions
/review --instructions "Check for @sim/ imports"
```

### 1.3 Prompt Loop (`loop.ts`)

**Purpose**: Rapid iteration prompts with auto-continue.

**Usage**:
```bash
# Loop 10 times: tune weapon TTK
/loop 10 "Tune weapon TTK to 2.5s"

# Loop with auto-continue
/loop 5 "Iterate: fix sim determinism"
```

### 1.4 Session Breakdown (`session-breakdown.ts`)

**Purpose**: 7/30/90-day usage graphs with cost tracking.

**Usage**:
```bash
/sb-7  # 7-day view
/sb-30 # 30-day view
/sb-90 # 90-day view
```

### 1.5 Split-Fork (`split-fork.ts`)

**Purpose**: Branch current session to new right-hand process.

**Usage**:
```bash
/split-fork "Optimize 60FPS rendering in MatchScene"
```

---

## 🏆 2. Install High-Value Skills

```bash
pi install mitsupi --commit --github --review --loop --files \
  --session-breakdown --split-fork --tmux --whimsical
```

### 2.1 Git Commits (`/commit`)

**Purpose**: Create commits with Conventional Commits style.

**Usage**:
```bash
# Interactive commit
/commit

# Direct commit with message
/commit -m "feat: add weapon card system" \
  -m "Fix: TTK calculation in @sim/combat.ts"
```

**JAKESJAM Pattern**:
```bash
/commit -m "feat: tune weapon TTK to 2.5s band" \
  -m "Fix: @sim/combat.ts TTK calculation" \
  -m "Refactor: Extract weapon balance constants"
```

### 2.2 GitHub CLI (`/github`)

**Purpose**: GitHub: issues, PRs, runs, APIs.

**Usage**:
```bash
# List PRs
/gh pr list --state open

# Review PR #42
/gh pr view 42

# Create PR from branch
/gh pr create --base main --head feat/weapon-tuning \
  --title "feat: tune weapon TTK to 2.5s band" \
  --body "Fixes #40, improves TTK consistency"
```

**JAKESJAM Pattern**:
```bash
# Review 42 open PRs
/gh pr list --state open --limit 20

# Review a specific PR for review
/gh pr view 5 --files --labels
```

### 2.3 Mermaid Diagrams (`/mermaid`)

**Purpose**: Create/validate Mermaid diagrams.

**Usage**:
```bash
# Generate diagram from text
/mermaid "classDiagram: PlayerClient, ServerHost"
```

**JAKESJAM Pattern**:
```bash
# Netcode diagram
/mermaid "sequenceDiagram: PlayerClient ->> ServerHost: inputs\ntitle: 16.67ms tick boundary\nPlayerClient -x> ServerHost: 0-4ms net\nPlayerClient <- ServerHost: 8ms baseline\ntitle: Interpolation window\ntitle: Reconciliation at 16ms"
```

### 2.4 Tmux Integration (`/tmux`)

**Purpose**: Drive tmux sessions via keystrokes.

**Usage**:
```bash
# Create panes for concurrent development
/tmux new-window -t 0:"MatchScene" -l
/tmux new-window -t 1:"Client Loop" -l
/tmux select-window -t 0
/tmux select-pane -t 1
```

**JAKESJAM Pattern**:
```bash
# Concurrent simulation runs
/tmux new-window -t sim1 -l "Sim: @sim/CombatTestA" -n 0
/tmux new-window -t sim2 -l "Sim: @sim/CombatTestB" -n 1
/tmux new-window -t netcode -l "Net: clientLoop predictTest" -n 2
```

---

## 🎨 3. UI/UX Enhancements

### 3.1 Prompt Editor (`prompt-editor.ts`)

**Purpose**: Save/load prompt modes with history.

**Usage**:
```bash
# Save current prompt mode
/pe-save --name "JAKESJAM-Phaser-Rendering"

# Load saved mode
/pe-load "JAKESJAM-Phaser-Rendering"

# List saved modes
/pe-list
```

**JAKESJAM Pattern**:
```bash
# Save skill-specific prompt modes
/pe-save --name "JAKESJAM-Combat-TTK" \
  --instruction "Use TTK 1.8-3.5s, 4 archetypes, ≤500ms dodge, 120-180ms parry"

/pe-save --name "JAKESJAM-Netcode-Prediction" \
  --instruction "Use 60Hz fixed timestep, <8ms/tick headroom, @sim/World deterministic"
```

### 3.2 Session Color (`session-color`)

**Purpose**: Distinguish sessions with colored footer bands.

**Usage**:
```bash
# Install (from rhubarb-pi)
bun install -g rhubarb-pi
bun run install:session-color

# Set color and save
/color-set #ff6b6b
/color-save
/color-next  # Rotate through 40 colors
```

### 3.3 Session Emoji (`session-emoji`)

**Purpose**: AI-analyze conversation context for emoji.

**Usage**:
```bash
# Install (from rhubarb-pi)
bun run install:session-emoji

# Toggle emoji mode
/emoji-toggle

# Set emoji manually
/emoji-set "🎮"
```

### 3.4 Background Notify (`background-notify`)

**Purpose**: Audio beep + terminal focus when done.

**Usage**:
```bash
# Install (from rhubarb-pi)
bun run install:background-notify

# Enable background notify
/notify-enable

# Config
/notify-config --beep-time 2000
/notify-config --focus true
```

### 3.5 Safe Git (`safe-git`)

**Purpose**: Require approval before dangerous git ops.

**Usage**:
```bash
# Install (from rhubarb-pi)
bun run install:safe-git

# Set level
/safegit-set off        # Off (default)
/safegit-set low        # Warn on hard reset, medium on push/commit
/safegit-set medium     # Confirm on push/commit
/safegit-set high       # Confirm on all git ops
```

**JAKESJAM Pattern** (50+ commits):
```bash
/safegit-set low        # Warn, allow
```

---

## ⚡ 4. Performance & Productivity

### 4.1 Multi-Edit (`multi-edit.ts`)

**Purpose**: Batch edits + Codex-style batch patch support.

**Usage**:
```bash
# Multi-edit with multiple changes
/me ClientLoop.ts "Add deterministic test suite" \
  "Add 3 seed runs (same inputs, same outputs)" \
  "Add 3 different seeds" \
  "Add 3 round types"
```

### 4.2 Notify (`notify.ts`)

**Purpose**: Desktop notifications when done.

**Usage**:
```bash
# Install (agent-stuff)
bun install -g mitsupi
bun install -g rhubarb-pi
bun run install:notify --from agent-stuff
bun run install:background-notify --from rhubarb-pi

# Toggle notifications
/notify-enable
/notify-test
/notify-status
```

### 4.3 Tmux Pane Control (`control.ts`)

**Purpose**: Session control helpers.

**Usage**:
```bash
# List controllable sessions
/control-list

# Control pane
/control-panes --pane-height-40
```

---

## 📊 5. Analytics & Tracking

### 5.1 Session Breakdown (`session-breakdown.ts`)

**Purpose**: 7/30/90-day usage + cost graphs.

**Usage**:
```bash
# 7-day breakdown
/sb-7

# 30-day breakdown
/sb-30

# 90-day breakdown
/sb-90
```

### 5.2 Usage Bar (`usage-bar`)

**Purpose**: AI provider usage statistics.

**Usage**:
```bash
# Install (from awesome list)
git clone https://github.com/hjanuschka/shitty-extensions.git
cd shitty-extensions
bun run install:usage-bar

# Or via npm
bun install -g @hjanuschka/shitty-extensions
pi install usage-bar
```

### 5.3 Session Emoji (`session-emoji`)

**Purpose**: AI emoji representing conversation context.

**Usage**:
```bash
# Install (from rhubarb-pi)
bun run install:session-emoji

# Toggle
/emoji-toggle

# Set
/emoji-set "🎮"
/emoji-set "💬"
/emoji-set "💭"
/emoji-set "🔍"
/emoji-set "✅"
```

---

## 🧪 6. Testing & QC

### 6.1 CI/Quality (`quality.ts`)

**Purpose**: Session quality gates and CI integration.

**Usage**:
```bash
# Install (from awesome list/community)
git clone https://github.com/crossjam/quality-pi.git
cd quality-pi
bun run install:quality
```

### 6.2 Memory Mode (`memory-mode`)

**Purpose**: Save instructions to `AGENTS.md`.

**Usage**:
```bash
# Install (from shitty-extensions)
git clone https://github.com/hjanuschka/shitty-extensions.git
cd shitty-extensions
bun run install:memory-mode
```

---

## 🎵 7. Fun & Productivity

### 7.1 Whimsical (`whimsical.ts`)

**Purpose**: Random thinking messages.

**Usage**:
```bash
# Install (agent-stuff)
bun install -g mitsupi
bun run install:whimsical

# Toggle whimsical thinking
/whimsical-toggle

# Check active status
/whimsical-status
```

### 7.2 Answer (`answer.ts`)

**Purpose**: Interactive TUI for Q&A.

**Usage**:
```bash
# Install (agent-stuff)
bun run install:answer --from agent-stuff

# Interactive Q&A
/answer "What's the current TTK target?"

# Answer with options
/answer "Pick: /loop 5, /review, /files"
```

---

## 🚀 8. Quick Start (JAKESJAM)

```bash
# 1. Install mitsupi
bun install -g mitsupi

# 2. Install extensions
pi install mitsupi --files --review --loop --session-breakdown --split-fork

# 3. Install rhubarb-pi extensions
bun install -g rhubarb-pi
bun run install:session-color
bun run install:session-emoji
bun run install:safe-git

# 4. Restart Pi
# Then: /pe-save --name "JAKESJAM-Core" --instruction "Load 15-skill catalog, use 60Hz fixed timestep"
# /files --.agents/skills
# /review --client/src/sim/
# /gh pr list --state open --limit 5
```

---

## 🎯 9. JAKESJAM-Specific Workflows

### 9.1 Weapon Tuning

```bash
# Split-fork for parallel work
/split-fork "Tune weapon TTK to 2.5s band"

# Loop 5 iterations
/loop 5 "Tune weapon TTK to 2.5s band"
/pe-read "JAKESJAM-Combat-TTK"  # Load skill mode
/review --client/src/sim/data/weapons.ts  # Review combat data
/files --.agents/skills/combat-balance-ttk   # Show skill reference
/commit --"feat: tune weapon TTK, review combat data"
```

### 9.2 Netcode Stress-Test

```bash
/split-fork "Stress-test 10-player netcode"
/files --client/src/net/    # Show netcode files
/review --client/src/net \
  --instructions "Check 60Hz fixed timestep, <8ms/tick headroom"
/files --client/src/sim \
  --grep "@sim/World"      # Find sim files
```

### 9.3 UI/Visual Polish

```bash
/split-fork "Add particle effects to kill stack"
/pe-save --name "JAKESJAM-Feel-Juice" \
  --instruction "Nijman: 30ms kill-stop, 180ms shake, 24 particles, random pitch"
/review --client/src/game/scenes/MatchScene.ts \
  --instructions "Check @sim/procedural.ts, tweens.pause()"
/files --.agents/skills/game-feel-juice   # Show juice reference
```

---

## 📝 10. Reference: All Extensions by Category

### Core Productivity (CRITICAL)
| Extension | Command | Install From |
| --- | --- | --- |
| Files | `/ff .agents/skills` | agent-stuff |
| Review | `/review client/src/sim/` | agent-stuff |
| Loop | `/loop 5 "Tune TTK"` | agent-stuff |
| Session Breakdown | `/sb-7` | agent-stuff |
| Split-Fork | `/split-fork` | agent-stuff |
| Multi-Edit | `/me ClientLoop.ts` | agent-stuff |
| Prompt Editor | `/pe-save --name "JAKESJAM"` | agent-stuff |

### Git/Safety (HIGH)
| Extension | Command | Install From |
| --- | --- | --- |
| Git Commit | `/commit -m "feat: ..."` | agent-stuff |
| GitHub CLI | `/gh pr list` | agent-stuff |
| Safe Git | `/safegit-set medium` | rhubarb-pi |
| Session Emoji | `/emoji-toggle` | rhubarb-pi |
| Session Color | `/color-save` | rhubarb-pi |
| Background Notify | `/notify-enable` | rhubarb-pi |

### UI/UX (MEDIUM)
| Extension | Command | Install From |
| --- | --- | --- |
| Tmux | `/tmux new-window` | agent-stuff |
| Answer | `/answer "What's TTK?"` | agent-stuff |
| Whimsical | `/whimsical-toggle` | agent-stuff |
| Control | `/control-list` | agent-stuff |

### Testing/QC (LOW PRIORITY)
| Extension | Command | Install From |
| --- | --- | --- |
| Quality | `/quality-run` | crossjam/quality-pi |
| Memory Mode | `/memory-save` | shitty-extensions |
| Usage Bar | `/usage-list` | shitty-extensions |

---

## 🔄 11. Maintenance

### Update Packages

```bash
# Update all
bun update mitsupi rhubarb-pi

# Update specific
bun update -g @mariozechner/pi-coding-agent
```

### Check Versions

```bash
# Pi version
/pi --version

# mitsupi version
/pi version mitsupi 2>/dev/null || bun list -g mitsupi

# rhubarb-pi version
bun list -g rhubarb-pi 2>/dev/null || echo "rhubarb-pi not installed"
```

### Restore Defaults

```bash
# Uninstall all mitsupi extensions
bun uninstall -g mitsupi

# Uninstall all rhubarb-pi extensions
bun uninstall -g rhubarb-pi
bun run uninstall:all  # Or per-package

# Restore built-in tools (from pi-mono examples)
git clone https://github.com/badlogic/pi-mono.git
cd pi-mono/packages/coding-agent/src
git checkout examples/git-checkpoint.ts
# Load into pi with --extension git-checkpoint.ts
```

---

## 🆘 12. Troubleshooting

### Extension Not Loading

```bash
# Check if installed
ls ~/.pi/agent/extensions/ | grep -E "files|review|loop"

# Restart pi
# Or reload extension
pi reload --extension-files
```

### Safe Git Too Strict

```bash
/safegit-set low
# Or /safegit-set off
```

### Background Notify Not Working

```bash
# Check macOS terminal activation
brew install alsa-lib  # Linux
bun run install:background-notify
/notify-test
```

### Session Color Not Showing

```bash
# Check color state
/color-status

# Reset
/color-clear
```

---

## 📚 13. Further Reading

| Resource | URL |
| --- | --- |
| **Agent-Stuff** | https://github.com/mitsuhiko/agent-stuff |
| **Rhubarb-Pi** | https://github.com/qualisero/rhubarb-pi |
| **Awesome Pi Agent** | https://github.com/qualisero/awesome-pi-agent |
| **Pi Docs** | https://github.com/badlogic/pi-mono |
| **Pi Extensions** | https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions |

---

## ✅ 14. Checklist

- [ ] Install mitsupi: `bun install -g mitsupi`
- [ ] Install extensions: `pi install mitsupi --files --review --loop --session-breakdown --split-fork`
- [ ] Install rhubarb-pi: `bun install -g rhubarb-pi`
- [ ] Enable session color: `bun run install:session-color && /color-save`
- [ ] Enable session emoji: `bun run install:session-emoji && /emoji-toggle`
- [ ] Enable safe git: `bun run install:safe-git && /safegit-set low`
- [ ] Enable background notify: `bun run install:background-notify && /notify-enable`
- [ ] Restart Pi and test: `/files --.agents/skills`

---

**Date**: 2026-05-02  
**Target**: JAKESJAM with 15-skill catalog + 25+ extensions
