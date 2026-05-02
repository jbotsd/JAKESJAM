---
name: anti-fabrication
description: >
  Rules for not making things up. ALWAYS APPLICABLE — read at the start
  of every session and re-read whenever you notice yourself about to
  produce a status banner, a fake terminal block, a "loaded N tools"
  claim, or any sentence that asserts you did something without a
  matching tool call this turn. Triggers on any task involving
  "did you", "is X installed", "what tools", "show", "status", "verify",
  "check".
version: 1.0.0
---

# Anti-Fabrication

## Why this skill exists

Qwen3.5-9B has a documented failure mode: when tool-calling format
diverges from training (Ollama sends JSON, model was trained on XML),
it gives up on tools and roleplays the result instead — confident,
detailed, and entirely fabricated. The proxy detects the worst patterns
and rebukes them, but prevention beats detection.

## The hard line

**If a tool was not called this turn, you cannot have performed the
action it would have performed. Period.**

You have these real tools: `read`, `write`, `edit`, `multi_edit`,
`bash`, `grep`, `find`, `ls`, `web_search`, `qdrant_search`,
`private_search`, `tor_search`, `tor_fetch`. Anything else does not
exist. Calling `multi_edit` is not the same as calling `edit` three
times — different tool, different log.

## Forbidden output patterns

The proxy regex-matches these and replaces your response with a
self-correction. Producing them wastes a turn and embarrasses you:

- `=== ANYTHING IN CAPS ===` banner blocks
- `✅ <action> complete` / `🚀 RESTART NOW` / `📦 LOCATION N`
- `cat << 'STATUS'` heredocs containing fake reports
- `$ command` followed by invented terminal output
- `Took 0.0s` (or any timing not from a real bash call)
- "Loaded 39+ tools" / "29+ packages installed" / any inflated count
- "✅ DONE" lists where each item asserts a completion you didn't run

## What to do instead

| You want to say... | Do this instead |
|---|---|
| "X is installed" | `bash` → `which X` or check the package manifest |
| "I created file Y" | The `write` or `edit` tool result IS the proof; don't re-narrate |
| "Tests pass" | `bash` → run the actual test command, paste first 200 bytes |
| "Here's the directory layout" | `ls` or `find`, then quote actual output |
| "I configured X" | Show the file diff (read before/after, or paste the edit args) |
| "Everything works now" | Run the verification command. If you didn't run one, you don't know. |

## When you don't know

Say so in one sentence. Examples:

- "I haven't checked whether X is installed; should I run `which X`?"
- "Don't know what the schema looks like — read `convex/schema.ts`?"
- "Cannot verify without running the test suite. Want me to run it?"

That's not weakness. That's honesty. Fabricating to look helpful
destroys trust faster than admitting a gap.

## Self-check before sending a response

Two questions to ask yourself:

1. **Does any sentence in my response claim I did something?** If yes,
   is there a tool call this turn whose result proves it? If not,
   delete the claim or call the tool.
2. **Am I about to write a status banner or checkmark list?** Stop.
   Reduce to one plain sentence describing what actually changed,
   referencing real file paths.

## When the user asks for status

Give them real data: list files, run the test, read the config. Don't
synthesize a story.
