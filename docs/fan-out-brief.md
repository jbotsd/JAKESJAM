# Fan-out brief — how a second agent joins without racing the goal

Written 2026-08-09, the day two agents ran `docs/gospel-goal.md` against
one checkout. Nothing was lost, but only because their edits happened to
land on different lines of the same files. This is the standing procedure
so the next one is safe by construction rather than by luck. Policy lives
in the goal doc as **L5** (worktree-per-writer) and **L5a** (one goal,
one runner); this file is the operational how.

## The rule in one line

**Only ONE agent runs the goal. Everyone else gets a scoped brief.**

An endless goal's whole control flow is "read STATUS, pick the next
weakest thing". Point two agents at it and they pick from one queue,
write one STATUS, rebuild one `dist` and restart one `:8088`. They do not
divide the work — they race for it.

## Who owns what

| Owner | Surface |
|---|---|
| **Goal runner** (one session) | `docs/gospel-goal.md` STATUS · merges · `bun run build` / `dist` · `:8088` and `:8089` restarts · the E2 flip · task list |
| **Lane worker** (any number) | ONLY the files its brief names, in its OWN worktree, on its OWN branch |

A lane worker never writes STATUS. It reports what it landed; the runner
records it. Two half-truths in the file that is supposed to be ground
truth is worse than a slower file.

## Starting a lane

A worktree is already prepared:

    .claude/worktrees/doors-lane   (branch track-d/doors-lane)

`node_modules` is symlinked at root, `client/` and `server/` — without
those the lane cannot run tests (L5). `sim.wasm` is gitignored, so run
`bun run sim:build` in the lane before any wasm suite or it fails stale.

For a new lane:

    git worktree add .claude/worktrees/<name> -b track-x/<name>
    ln -sfn "$PWD/node_modules"        .claude/worktrees/<name>/node_modules
    ln -sfn "$PWD/client/node_modules" .claude/worktrees/<name>/client/node_modules
    ln -sfn "$PWD/server/node_modules" .claude/worktrees/<name>/server/node_modules

## The brief template

Paste this at the lane worker — note it does NOT say `/goal`:

> Work ONLY on **<item>** from `docs/gospel-goal.md`. Do not run the
> goal, do not pick further items, and do not update the STATUS block —
> the goal runner owns it.
>
> Work in `.claude/worktrees/<name>` on branch `track-x/<name>`. Do not
> edit files outside <the item's surface>. Do not run `bun run build`,
> do not touch `client/dist`, and do not restart `:8088` / `:8089` — one
> session owns deploys, and a half-built bundle going live is the
> failure mode this exists to prevent.
>
> Gates before you report done: `bun test` in `client/` and `server/`,
> `bun run typecheck` in both, and — for any UI change — the four
> canonical viewports per L7. Commit small, no AI attribution.
>
> When it is green, report the branch and the commit hashes. The runner
> merges `--no-edit` and records STATUS.

## Merging a lane

    git merge --no-edit track-x/<name>
    # full gates on main, then:
    git worktree remove .claude/worktrees/<name>
    git branch -d track-x/<name>

Then the runner writes ONE STATUS entry covering the merge.

## The failure modes this prevents, observed

- **Broken shared bundle.** A lane's in-flight `main.ts` edit put
  backticks inside an `innerHTML` template literal; `bun run build`
  failed (TS1005) while the runner was mid-verification. In a worktree
  that is the lane's problem alone.
- **STATUS interleaving.** Both sessions wrote goal-doc entries on the
  same afternoon. It merged cleanly by luck.
- **Duplicated work.** Both wrote their own four-viewport e2e constant
  block. Harmless here; the same coin-flip decides whether two agents
  implement the same item twice.
