---
name: atomic-edit-protocol
description: >
  How to edit code without breaking neighbors or rewriting whole files.
  Use whenever you're about to modify any file in client/, server/,
  convex/, or tools/. Triggers on: "fix", "change", "update", "refactor",
  "add to", "modify", "edit", or any task that mutates source code.
  Specifically replaces the urge to call write on a file you've never read.
version: 1.0.0
---

# Atomic Edit Protocol

## Why this skill exists

Small models (you) have a strong pull toward "I'll just rewrite the whole
file with my version" — which:
- Loses formatting, comments, imports the model didn't see
- Silently drops code outside the model's attention window
- Replaces working code with reconstructions that look right but aren't

This protocol forces you to work in small, verifiable increments.

## The hard line

**Never `write` to a file that already exists. Use `edit` or `multi_edit`.
Always `read` before you `edit`. Always `read` (or `grep`) the change site
after editing.**

## The 4-step loop (one concern, one file, one cycle)

1. **READ** the file. The exact lines you'll change. Tool: `read`.
   - For files >500 lines, read the relevant section by `offset` + `limit`,
     or use `grep` first to find the line range.
   - You must have just-read content in this turn before editing — not
     remembered from earlier.

2. **EDIT** with surgical precision. Tool: `edit` (single change) or
   `multi_edit` (multiple changes in the same file, atomic).
   - `old_string` must be a unique slice of the file. If it's not unique,
     enlarge it with surrounding context until it is. Or use `replace_all`
     when you actually want to rename every occurrence.
   - `new_string` differs only in the concern you're addressing. Don't
     reformat unrelated lines. Don't rename variables you weren't asked
     about.

3. **VERIFY THE CHANGE LANDED** — read back. Tool: `read` with `offset`
   to the changed region, or `grep` for the new symbol.
   - Confirms the edit applied where you expected.
   - Catches the case where `old_string` was matched in a different
     location than you intended.

4. **VERIFY YOU DIDN'T BREAK NEIGHBORS** — `grep` for callers / importers
   of what you changed. Tool: `grep`.
   - Renamed a function? `grep` for the old name, fix call sites.
   - Changed a type signature? `grep` for the type name, check all uses.
   - Added a required field? `grep` for the constructor, update all
     creation sites.

## When to use which edit tool

| Situation | Tool |
|---|---|
| One change in one file | `edit` |
| Multiple changes in the same file (e.g. add import + use it + update type) | `multi_edit` |
| New file (path doesn't exist) | `write` |
| Renaming a symbol everywhere | `multi_edit` with `replace_all: true`, OR `bash` + `sed` after a `grep -l` survey |

## Anti-patterns

- ❌ `write` over an existing file with your "improved version"
- ❌ Editing without reading the file in this turn
- ❌ Edits that touch >50 lines of unrelated formatting
- ❌ Series of `edit` calls on the same file (use `multi_edit`)
- ❌ Skipping the post-edit `grep` for callers — this is how you break TS
  exhaustiveness checks silently
- ❌ Editing then claiming "tests pass" without running tests

## JAKESJAM-specific edit hot spots

These places have hidden dependencies — always grep before editing:

- `client/src/sim/types.ts` — branded IDs flow everywhere; rename = global blast
- `client/src/sim/constants.ts` — constants imported by tests; changing = test failures
- `server/src/protocol.ts` — wire format; changing = client/server desync
- `convex/schema.ts` — schema; changing requires migration plan
- Anything under `client/src/sim/` — runs identically on server; do NOT
  add Phaser imports, DOM, Math.random, or non-deterministic anything

## Reporting an edit

After the 4-step loop, one short summary:

```
edited <path>:<lines>
- <one-line description of what changed>
- callers checked: <command run> → <count> usages, all consistent
```

That's it. No banners.
