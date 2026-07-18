// Team identity — class-overhaul-workboard.md chunk 1.1 ("Team identity
// threading into the sim"). Docs: docs/classes-goal.md "Venue integration"
// (Duos queue) is the design source; this file is deliberately the ONLY
// place that reasons about team membership.
//
// Scope, precisely (per the workboard chunk brief): give the sim the
// ability to answer "are these two players allies?" — nothing more. No
// friendly-fire rules, no team scoring, no win conditions. Those are later
// chunks (2.4 Paladin team peel, 3.3/3.4 Priest ally-targeting) — they
// import `isAlly` from here rather than comparing `.teamId` themselves, so
// the team-membership RULE stays defined in exactly one place.

import type { PlayerEntity } from './types.js';

/**
 * True iff `a` and `b` are on the same, defined team.
 *
 * `teamId` is absent for every ordinary FFA combatant (solo queue, private
 * rooms, bots outside a duo-mode bell — see `PlayerEntity.teamId`'s doc
 * comment in types.ts). Two players with no `teamId` are NOT allies — FFA
 * is everyone-for-themselves, not one big undeclared team. This is what
 * keeps solo FFA behavior identical to before team identity existed: every
 * `isAlly` call in an FFA match returns `false`, exactly as if the function
 * didn't exist.
 *
 * A player is trivially their own ally (`isAlly(a, a)` is `true` whenever
 * `a.teamId` is set) — callers that need to exclude self-targeting (e.g. a
 * "heal an ally" cast that shouldn't self-target through this check) filter
 * that separately; it's not this function's concern.
 */
export function isAlly(a: PlayerEntity, b: PlayerEntity): boolean {
  return a.teamId !== undefined && a.teamId === b.teamId;
}
