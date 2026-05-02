---
name: ts-pocock
description: Matt Pocock-style TypeScript discipline applied to JAKESJAM. Triggers when editing client/src/sim/, client/src/net/, server/src/, convex/. Enforces branded IDs, satisfies-over-as, exhaustive discriminated unions, and zero `as any` / `as unknown as` escape hatches.
---

# TS Pocock — JAKESJAM TypeScript Playbook

When editing `client/src/sim/`, `client/src/net/`, `server/src/`, or `convex/`, follow these rules. The goal is fewer runtime surprises and tighter contracts at the netcode/sim boundary where parity matters most.

## 1. Branded IDs everywhere

`PlayerId`, `EntityId`, `Tick`, `InputSeq` are branded types. `client/src/sim/types.ts` already defines them. Never let a raw `string`/`number` flow into a slot expecting one.

```ts
// ❌
const id: PlayerId = playerInfo.id; // raw string
// ✅
const id = playerInfo.id as PlayerId; // only at the trust boundary
```

When iterating `Object.keys(players)` you get `string[]`. Use the helper:

```ts
// client/src/sim/types.ts (extend if missing)
export const playerIds = (s: WorldState): PlayerId[] =>
  Object.keys(s.players) as PlayerId[];
```

## 2. `satisfies` over `as` for config literals

```ts
// ❌
const PALETTE = { health: "#f00", shield: "#0af" } as Record<string, string>;
// ✅
const PALETTE = { health: "#f00", shield: "#0af" } satisfies Record<string, string>;
```

Why: `satisfies` validates the shape *and* preserves the literal type so `PALETTE.health` is `"#f00"`, not `string`. Use this for palette, sim constants, weapon profiles, chaos modifier registries.

## 3. Discriminated unions + exhaustive switch

Protocol messages in `client/src/net/protocol.ts` and `server/src/protocol.ts` are discriminated by `t`. Every consumer must `switch (msg.t)` with a `default: const _: never = msg; throw new Error(…)`. No `as ClientMessage`, no `if (msg.t === "in") (msg as InMessage)…`.

## 4. `as const` + derived types for string-literal sets

```ts
// ❌
const CHAOS_IDS = ["lightning", "fire", "ice"];
type ChaosModifierId = string; // way too wide

// ✅
export const CHAOS_IDS = ["lightning", "fire", "ice"] as const;
export type ChaosModifierId = typeof CHAOS_IDS[number];
export const isChaosId = (v: unknown): v is ChaosModifierId =>
  typeof v === "string" && (CHAOS_IDS as readonly string[]).includes(v);
```

Use `isChaosId` instead of `as ChaosModifierId[]` casts after `JSON.parse`.

## 5. Validate at trust boundaries; trust internally

`JSON.parse`, `req.json()`, `localStorage.getItem`, WS payloads from clients — all return `unknown`. Validate once, use the validated type everywhere downstream. No re-validation in internal code.

```ts
function validateChaosIds(raw: string): ChaosModifierId[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChaosId);
}
```

## 6. Test mocks have types too

No `as any` in test files. Define mock types in `__tests__/test-utils.ts`:

```ts
export type MockScene = Partial<Phaser.Scene>;
export type MockGameObject = Partial<Phaser.GameObjects.GameObject>;
```

## 7. Phaser objects must be constructed

```ts
// ❌
const v = { x, y } as unknown as Phaser.Math.Vector2;
// ✅
const v = new Phaser.Math.Vector2(x, y);
```

## 8. Zero tolerance escape hatches

Forbidden in new code under `client/src/sim/`, `client/src/net/`, `server/src/`:
- `as any`
- `as unknown as X` (except at FFI/Convex codegen-pending boundaries — comment why)
- `// @ts-ignore`, `// @ts-expect-error` without a linked issue

If you find existing instances, add a `// TODO(ts-pocock): …` and fix opportunistically.

## 9. Verify

After every edit under the trigger paths:

```bash
bunx tsc --noEmit  # in client/ and server/
bun test client/src/sim/__tests__/
```

Both must pass before declaring done.
