# Movement, shield & directional-shield augment cards

Brief (2026-07-04): "go deep on movement, shield and direction shield augment
cards too."

## What was actually wrong

Most of the relevant card modifiers were **defined but dead** — resolved into
the build and then never read by the sim:

- `moveSpeedMultiplier` — never folded into the player step's speed mult
  (`speedMul` was only `slow × freeze`). Phase Soles / Crystal Plating did
  nothing.
- `mirrorShield` — only recolored projectiles; no reflect.
- Shield charge/recharge — `tickShield` was called with `{ dtMs }` only, so no
  card could touch the shield's size or refill.
- `parryCooldownMultiplier` — `tryStartParry` got no cooldown override, so
  Quick Parry was dead too.

So "go deep" here meant **wiring the dead modifiers live** and adding a real
suite on top.

## The wiring (this pass)

All TS-authoritative. Movement rides the EXISTING step multipliers, so it
crosses into the Zig `stepPlayer` for free — no new wasm marshaling:

- `build.moveSpeedMultiplier` → folded into `speedMul` (World.ts).
- `build.gravityMultiplier` → multiplies the step's gravity mult (glide/heavy).
- Shield: `tickShield` now gets `maxCharge = SHIELD_MAX × shieldChargeMultiplier`
  and `rechargePerSecond = base × shieldRechargeMultiplier`.
- Parry: `tryStartParry` gets `cooldownMs = base × parryCooldownMultiplier`.
- **Mirror shield**: `tryDeflectDamage` returns `shieldReflected` when a mirror
  build blocks a hit; World.ts reuses the parry-reflect path (reverse velocity +
  reassign owner at the projectile-drop site) to bounce the shard back.
- **Aim (directional) shield**: `tryDeflectDamage` takes `directionalShield`;
  the shield only blocks hits within a 120° arc around the player's AIM
  (`SHIELD_AIM_ARC_RADIANS`) — flank/back shots pass through.

## The cards (this pass)

Movement:
- **Sprint Coils** (uncommon) — moveSpeed ×1.18, ×3.
- **Glide Membrane** (uncommon) — gravity ×0.74, floaty hang time for wall play.
- **Lead Boots** (uncommon) — gravity ×1.35 + moveSpeed ×1.06, snappy fall / faster wall-jump cadence.

Shield:
- **Bulwark Core** (uncommon) — shield charge ×1.6.
- **Rapid Capacitor** (uncommon) — recharge ×1.8.
- **Mirror Shield** (rare) — blocked shots reflect back (flag now LIVE).

Directional / aim:
- **Aim Barrier** (rare) — directional block, but a huge frontal reserve (×2.2 charge).
- **Riot Mirror** (legendary) — directional + mirror: an aimed reflect wall.

Covered by unit tests (`combat.test.ts`): mirror reflects, plain shield doesn't,
aim shield blocks from the aim arc but not from behind, omni shield blocks all.

## Deferred — the movement tier that needs Zig

These want NEW per-player step params or movement-memory state, which means
extending the `step_player` wasm signature / `PlayerStep` struct + the marshaling
(the `touchingWallDir` pattern). Designed, not yet built:

- **Jump / wall-jump power** cards (`jumpMultiplier`, `wallJumpMultiplier`) —
  scale `JUMP_VELOCITY` / `WALL_JUMP_VY`. One new scalar param each.
- **Extra air-jump / double-jump** — needs a jump-count memory field.
- **Dash / air-dash** — needs a dash-cooldown + burst-velocity memory field and
  a new input bit.
- **Sticky grip / slow slide** (`wallSlideMultiplier`) — scale `WALL_SLIDE_MAX_FALL`.

Recommendation: batch these as one wasm-signature bump (add a small
`MovementAugments` param block) rather than one param per card.

## Parity note

The mirror/aim shield + all the wiring are on the **TS-authoritative** path and
live today. The Zig world orchestrator (`world.zig`, opt-in, not authoritative)
has only basic shield absorption and does NOT resolve card builds at all, so
mirroring these needs card-build resolution in Zig first — a Phase-2 migration
item, tracked alongside the reflect-parry parity work.
