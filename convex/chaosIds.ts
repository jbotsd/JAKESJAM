// Mirror of CHAOS_MODIFIER_IDS in client/src/sim/data/chaosModifiers.ts.
// Convex's V8 sandbox can't import outside `convex/`, so the list is
// duplicated here. A parity test in
// client/src/sim/__tests__/chaosIdsParity.test.ts asserts the two arrays
// stay in lockstep — failing CI is the canary if either copy drifts.
//
// Adding a modifier:
//   1. Append to CHAOS_MODIFIER_IDS in client/src/sim/data/chaosModifiers.ts
//   2. Append the matching id here
//   3. Add the modifier definition in `chaosModifiers` (client list)
//   4. Run `bunx convex deploy` so the schema validator picks it up
export const CHAOS_MODIFIER_IDS = [
  "low-gravity",
  "slow-motion",
  "golden-gun",
  "slappers-only",
  "fire-hazard",
  "random-shapes",
  "max-recoil",
] as const;

export type ChaosModifierId = (typeof CHAOS_MODIFIER_IDS)[number];
