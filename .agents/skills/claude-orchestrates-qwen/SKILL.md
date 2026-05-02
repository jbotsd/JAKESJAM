---
name: claude-orchestrates-qwen
description: >
  How Claude (this session, the orchestrator) drives qwen35-9b-uncensored
  (the local pi-coding-agent workhorse) to ship verified code in the
  JAKESJAM game-jam codebase. ALWAYS APPLICABLE in this repo when an
  orchestrating model receives a code-change request from the user.
  Triggers on: "fix", "implement", "refactor", "add", "wire up", "build",
  "ship", "go", "exhaustively", "do all", or any task where qwen will
  execute via pi -p / pi -c and Claude verifies. Pairs with claude-handoff,
  atomic-edit-protocol, anti-fabrication, verify-after-change.
version: 1.0.0
---

# Claude Orchestrates Qwen — JAKESJAM Pattern

## Why this skill exists

JAKESJAM uses a two-tier model setup: a frontier-grade orchestrator
(Claude, with full file read + skill-aware reasoning) plans, and a
local 9B model (qwen35-9b-uncensored-q6 via pi-coding-agent) executes.
Without discipline this collapses into either:
- Claude doing all the work (defeats the point of local execution)
- qwen running away with scope, fabricating outputs, or hanging on
  tasks it can't structure (the empty-output failure mode)

This skill encodes the orchestration pattern that actually shipped 11
fixes across 27 files in one session with zero fabrications and zero
test regressions.

## The hard line

**Claude loads the Skill, does the recon, writes precise edit
instructions with exact old_string/new_string, qwen executes, Claude
verifies. Don't ask qwen to summarise. Don't ask qwen to plan. Don't
ask qwen anything where the answer requires a paragraph of prose —
that's where the empty-output failure happens.**

## qwen's actual capabilities and failures

Verified across the shipping session:

**What qwen does reliably (319/319 valid tool calls, 0 fabrications):**
- Structured tool calls (read, edit, multi_edit, write, bash, grep)
- Exact-string find/replace from a precise old_string/new_string brief
- Running verification commands (typecheck, bun test) when told the
  exact command to run
- Atomic file changes — single concern per edit

**What qwen fails at (consistently):**
- Producing a final narrative summary at end of -p execution (empty
  stdout). The work lands; the report doesn't.
- Reconnaissance that requires synthesising findings across many files
  into a structured report
- Open-ended planning ("how should we architect X?")
- Multi-step tasks where each step's output feeds the next without
  explicit tool-call structure

## The 5-step orchestration loop

For every task:

### 1. Claude loads the relevant Claude skill via the Skill tool

Don't paraphrase the skill — load the actual SKILL.md content into
your context. Multiple skills are fine in one Skill batch:
`game-feel-juice`, `phaser4-game`, `ts-pocock`, etc.

The skill content gives you:
- Exact target values (e.g. "80ms hit-stop, 0.012 shake bucket")
- File paths the recipe applies to
- Anti-patterns to avoid
- Verification commands

### 2. Claude does the recon

- `Read` the relevant files yourself — qwen's empty-output makes its
  recon reports unreliable
- `Grep` for the gap (e.g. `tweens.timeScale`, `Math.random`,
  `as any`)
- Confirm the gap is real before writing the edit instruction

### 3. Claude writes a precise edit brief for qwen

Brief format that consistently lands:

```markdown
FIX <one-line description>

<one-paragraph reason citing the skill>

Use <edit | multi_edit> on <file_path>:

old_string:
<exact text — copy-paste from your Read>

new_string:
<exact replacement>

After:
- bash: <typecheck command>
- bash: <test command if relevant>

Stop after.
```

For multi-file changes, list each edit with its own file_path. Use
multi_edit only when all edits are in the same file.

### 4. qwen executes

```bash
timeout 600 /home/jimothy/.bun/bin/pi -p --no-session @/tmp/<step>.md \
  2>&1 | tee /tmp/<step>.out | tail -30
```

`--no-session` is fine for one-shot edits. Use `-c` to continue a
session if a multi-step plan needs prior context (rare; usually
better to keep each step self-contained).

`-p @<file>` reads the prompt from a file — long prompts on the
command line break shell quoting.

### 5. Claude verifies independently

- `Read` the changed file at the changed line range — confirm the
  edit landed where expected
- Run the typecheck/test command yourself; don't trust qwen's report
  even when it produces one
- Per `verify-after-change` skill: each layer has its own command
  (sim → bun test, server → bun typecheck && bun test, convex →
  npx convex dev --once)

## Tooling state that makes this work

- **ollama-proxy** at `~/.pi/agent/ollama-proxy.mjs` enforces:
  - `num_ctx: 32768` (was silently 8192 — caps were lying)
  - Sampler: `temp=0.3 top_p=0.8 min_p=0.05 presence_penalty=0.2`
    (was effectively `1.0/0.95/0/1.5` = literally tuned for
    fabrication)
  - Anti-fab system prompt re-injected every turn (system-prompt
    drift over long sessions is a known qwen failure mode)
  - Tool-call JSON repair (strips `<think>` leakage, balances
    braces, handles smart quotes)
  - Fabrication detector (regex for `=== STATUS ===` banners,
    `cat << 'EOF'` heredocs, "Took 0.0s" — replaces matching
    output with a self-correction nudge)

  Stats: `curl http://127.0.0.1:11435/__pi/stats` returns repair +
  fabrication counters. Last full session: 319 attempted, 0 needed
  repair (qwen tool-call format is now reliable), 0 fabrications
  detected.

- **Pi extensions** under `~/.pi/agent/extensions/`:
  - `local-tools.ts` — web_search, tor_search, qdrant_search etc.
  - `multi-edit.ts` — atomic batched find/replace on one file
  - `loop.ts` — `/loop N <prompt>` runs N times sequentially
  - `split-fork.ts` — `/split-fork <prompt>` forks session
  - `critique.ts` — `/critique` scores last turn for fabrication
  - `skill-load.ts` — `/skill <name>` force-loads a SKILL.md
  - `diff.ts`, `files.ts`, `tps.ts`, `redraws.ts`, `prompt-url-widget.ts`
  - `thinking-auto.mjs`, `tool-toggle.mjs`

- **Project skills under `.agents/skills/`** — pi auto-discovers
  here, NOT under `.claude/skills/` (they're symlinked across).
  23 skills total covering every JAKESJAM domain.

## When qwen surprises you (positively)

Qwen sometimes makes legitimate adjacent edits to keep typecheck
green — e.g. when chaos-pipe step 6 made `chaosModifierIds` a
required `MatchHost` constructor arg, qwen also patched
`worldHost.ts:97` and `tickSlew.test.ts:81` to pass `[]` so
typecheck stayed clean. Read the diff before assuming scope creep —
sometimes it's correct API-cascade work.

## When qwen surprises you (negatively)

When orchestrator-style prompts (multi-step plans with "report
back") fail with empty output but the actual edits still land. Don't
panic — verify the file state and proceed. The work is real even
when the narrative isn't.

## Anti-patterns (don't do these)

- ❌ Asking qwen "tell me what you found" — empty output 80% of the
  time. Have qwen write findings to a file, OR Claude reads the
  files itself.
- ❌ Sending generic "implement hit-stop" — qwen will start
  exploring instead of editing. Send exact edit specs.
- ❌ Trusting an Explore agent's gap report blindly. The first
  scan flagged 4 "unindexed Convex queries" that already had
  `withIndex()` — generic agents miss skill context.
- ❌ Letting qwen do its own verification only. Always re-run the
  typecheck/tests yourself.
- ❌ Big multi-step `-c` chains. State drifts. Prefer many short
  `--no-session` calls with explicit context in each prompt.
- ❌ Writing the edit yourself "because it's faster". Defeats the
  pattern. Reserve direct edits for one-line typos and
  documentation.
- ❌ Inventing skills, packages, or files that don't exist.
  Verified concrete, real, in-repo locations or skip the task.

## The handoff brief template (cheat sheet)

```markdown
TASK: <one-line>

Per <SKILL_NAME> SKILL <citation> — <why this is the right pattern>.

Use `edit` on <file_path>:

old_string:
<paste from Read>

new_string:
<exact replacement>

After:
- bash: cd <project> && <typecheck command> 2>&1 | tail -5

Stop after.
```

## When the task is bigger than one edit

Break into sub-steps. Each sub-step gets its own `--no-session`
prompt. Claude tracks the chain. Each sub-step ends with
verification. Don't try to give qwen a 5-step plan and let it
manage its own state — it will lose the thread.

Pattern from the chaos-pipe ship (7 steps, all green):
1. STEP 1 — recon (Claude actually did this directly; qwen
   empty-output makes recon unreliable)
2. STEP 2 — schema add field
3. STEP 3 — copy field on insert
4. STEP 4 — return field from query
5. STEP 5 — confirm consumer typed (no-op edit, just confirm)
6. STEP 6 — wire registry handoff (multi-file, removes TODO)
7. STEP 7 — verify (typecheck + tests on every layer)

Each step Claude wrote a /tmp/step-N.md, ran pi -p --no-session,
verified, moved on.

## Pre-flight checklist (every task)

- [ ] Loaded the relevant Claude Skill via Skill tool
- [ ] Read the actual files involved
- [ ] Confirmed the gap is real (grep, read)
- [ ] Wrote precise old_string / new_string with exact whitespace
- [ ] Identified the verification command from
      `verify-after-change` skill
- [ ] Wrote the brief to `/tmp/<step>.md`
- [ ] Ran qwen via `pi -p --no-session @<file>` with timeout
- [ ] Read the changed file at the change site to confirm it landed
- [ ] Ran typecheck + relevant tests independently
- [ ] If anything failed: handed back to qwen with a fix-brief, did
      NOT do the fix myself

## Source

- `.agents/skills/claude-handoff/SKILL.md` — the orchestrator
  contract qwen reads at the start of every task
- `.agents/skills/anti-fabrication/SKILL.md` — proxy + system-prompt
  rules backing the orchestration
- `.agents/skills/atomic-edit-protocol/SKILL.md` — single-concern,
  read-before-edit, grep-after rules
- `.agents/skills/verify-after-change/SKILL.md` — file-path → verify
  command lookup
- `~/.pi/agent/ollama-proxy.mjs` — proxy config that makes qwen
  reliable enough to orchestrate
- Verified across: commits `12f060c` and `ad68e6a` on JAKESJAM
  main — 11 fixes across 27 files, 180 tests pass, 0 fabrications.
