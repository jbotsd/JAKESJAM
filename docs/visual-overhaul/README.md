# Visual Overhaul Docs

Read in this order:

1. **[DIRECTION.md](DIRECTION.md)** — start here. Pillars, phases, success criteria.
2. **[CURRENT-STATE.md](CURRENT-STATE.md)** — what we have now, what to tear out.
3. **[PALETTE-TOKENS.md](PALETTE-TOKENS.md)** — exact hex tokens. Single source of truth for colors.
4. **refs/** — per-image reference distillations.
   - **[refs/04-rounds-DRAFT-SCREEN.md](refs/04-rounds-DRAFT-SCREEN.md)** — ★ highest priority, draft UI spec.
   - [refs/01-rounds-platforms-shotgun.md](refs/01-rounds-platforms-shotgun.md) — arena + character grammar.
   - [refs/02-rounds-explosion-cascade.md](refs/02-rounds-explosion-cascade.md) — explosion VFX vocabulary.
   - [refs/03-rounds-suspended-cubes-arena.md](refs/03-rounds-suspended-cubes-arena.md) — HUD + atmosphere + arena gimmicks.

## Status
- Rounds folder reference distillations: **complete** (4/4).
- Main folder reference distillations: **deferred** — image buffer constraints + 25/75 weighting mean rounds + code audit cover the bulk of needed direction.
- Code audit + synthesis docs: **complete**.

## What's next (when human says go)
Implement Phase A from `DIRECTION.md` — code-only, no new assets. Estimated 1-2 days.
