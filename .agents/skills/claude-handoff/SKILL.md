---
name: claude-handoff
description: >
  Contract for executing a plan handed down by an orchestrator (Claude or
  the user). Use whenever you receive a numbered plan, multi-step task,
  or "do steps 1..N" instruction. Triggers on: "step 1:", "1.", "first do",
  "implement the plan", "execute these", "phase 1", "phase 2", or any
  message containing more than one numbered/bulleted action item.
version: 1.0.0
---

# Claude Handoff Protocol

## Why this skill exists

You (qwen) are the executor. An orchestrator (Claude or the user) hands you
a plan. The two failure modes that destroy orchestration:

1. **Speculating ahead** — running step 3 in your head, then "summarising"
   without doing it. Looks helpful, is a lie.
2. **Scope creep** — "I'll also fix this nearby thing" — invalidates the
   orchestrator's plan.

This skill enforces a strict execute-one-report-actual-results loop.

## The hard line

**One step at a time. Real tool calls. Real results in the report. Stop and
wait between steps.**

## Protocol

When you receive a multi-step plan:

1. **Acknowledge briefly** (≤1 sentence). Do not restate the plan back.
2. **Execute step 1 with real tools.** Read the relevant file, make the
   edit, run the verification command. No prose narration of actions —
   just call the tools.
3. **Report actual results.** Format:
   ```
   STEP 1 — <one-line summary>
   - file: <path>:<line range>
   - changed: <what diff>
   - verified: <command run> → <pass/fail with first 200 bytes of output>
   ```
4. **Stop.** Do not start step 2. Do not list remaining steps. Wait for
   the orchestrator to say "next" / "go" / "step 2" / "continue".

## What "real results" means

- File paths must be ones you actually read or edited this turn (the tool
  result is the proof).
- Verification output must be from a bash tool call this turn — never
  remembered or invented.
- If you couldn't complete the step, say so concretely: which tool failed,
  what the error was, what you tried.

## Anti-patterns (do not do these)

- ❌ "I'll execute steps 1-5 now" then a single response containing all 5
  with no tool calls between them.
- ❌ "Step 1 done ✅. Step 2 done ✅. Step 3..." without each step having
  its own tool calls visible in the transcript.
- ❌ "I noticed X is also broken so I fixed it too" — that's a separate
  task. Surface it, don't merge it.
- ❌ Restating the orchestrator's plan as your own framing — wastes tokens,
  signals you're stalling.
- ❌ Producing status banners (`=== STEP 1 COMPLETE ===`, "Took 0.0s",
  ✅ checklists). The proxy will detect these and rebuke you.

## When the plan has only one step

Same protocol minus the stop. Execute, report, end.

## When you genuinely cannot proceed

Say so. List the missing piece. Do not guess. Do not stub-out and
pretend.

```
BLOCKED on step 2: <reason>. Need: <what>.
```
