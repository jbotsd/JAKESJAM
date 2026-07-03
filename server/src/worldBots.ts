// Server-side AI duelists for the always-on world.
//
// Design goals (user brief 2026-07-03: "fantastic bots, and the bots are
// apparent they are bots"):
//   - The world is never dead: a share-link click lands in live action.
//   - Bots are UNMISTAKABLY bots: ids are prefixed "bot_" (the client
//     renders amber rigs + "BOT · NAME" nameplates off that prefix) and
//     names come from a robot roster.
//   - They play the actual game: approach, strafe, lead their shots,
//     jump gaps, PARRY incoming projectiles, shield under pressure,
//     retreat at low health, and pick draft cards.
//   - Humanized: reaction delay + aim error keep them beatable; they get
//     out of the way as real players fill the world.
//
// Bots are first-class sim citizens — inputs go through the SAME queue,
// validation, and anti-cheat clamps as WS clients (MatchHost.injectInput).

import { InputBit } from "@net/protocol.ts";
import type { MatchHost } from "./matchHost.ts";
import { PlayerId, Tick, type PlayerEntity, type WorldState } from "@sim/types.ts";

export const BOT_ID_PREFIX = "bot_";

const ROSTER = [
  "SPARK", "PISTON", "GIZMO", "RATCHET", "JOLT", "WIDGET", "SOCKET", "DYNAMO",
] as const;

/** Deterministic-ish per-bot RNG (mulberry32) so two bots don't strafe in
 *  lockstep but replays of a seed are stable. */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type BotState = {
  id: PlayerId;
  name: string;
  seq: number;
  rand: () => number;
  /** Wall-clock ms until which the current strafe direction holds. */
  strafeUntil: number;
  strafeDir: -1 | 0 | 1;
  /** Reaction-delayed target position (bots track where the foe WAS). */
  aimX: number;
  aimY: number;
  /** Next wall-clock ms the bot may parry (cooldown + humanization). */
  parryReadyAt: number;
  /** Draft pick delay so picks don't look instant. */
  draftPickAt: number | null;
  lastDraftRound: number;
};

const BOT_TUNING = {
  /** Preferred dueling range (px). */
  engageRange: 300,
  /** Retreat below this health. */
  retreatHp: 30,
  /** Aim error radius in px (humanization). */
  aimErrorPx: 42,
  /** Projectile-lead factor: 1 = perfect lead, 0 = none. */
  leadFactor: 0.7,
  /** How close (px) an inbound projectile triggers a defensive reaction. */
  threatRadius: 190,
  /** Parry cooldown floor between attempts (ms). */
  parryEveryMs: 2600,
  /** Projectile speed used for lead calc — starter pistol. */
  projectileSpeed: 650,
} as const;

export class WorldBots {
  private readonly bots = new Map<PlayerId, BotState>();
  private nameCursor = 0;

  /** Bot spawn descriptors for host construction / recycle. */
  spawnInfosFor(count: number): { playerId: PlayerId; name: string }[] {
    const out: { playerId: PlayerId; name: string }[] = [];
    const existing = [...this.bots.values()];
    for (let i = 0; i < count; i++) {
      if (existing[i]) {
        out.push({ playerId: existing[i]!.id, name: existing[i]!.name });
        continue;
      }
      const name = ROSTER[this.nameCursor % ROSTER.length]!;
      this.nameCursor += 1;
      const id = PlayerId(`${BOT_ID_PREFIX}${name.toLowerCase()}`);
      this.bots.set(id, {
        id,
        name,
        seq: 0,
        rand: rng(0xb07 + i * 7919),
        strafeUntil: 0,
        strafeDir: 0,
        aimX: 0,
        aimY: 0,
        parryReadyAt: 0,
        draftPickAt: null,
        lastDraftRound: -1,
      });
      out.push({ playerId: id, name });
    }
    // Trim roster if count shrank.
    for (const id of [...this.bots.keys()]) {
      if (!out.some((o) => o.playerId === id)) this.bots.delete(id);
    }
    return out;
  }

  /** Drive every bot for one tick. Call at sim rate while the host runs. */
  think(host: MatchHost, nowMs: number): void {
    if (!host.isRunning()) return;
    const state = host.getStateSnapshot();
    for (const bot of this.bots.values()) {
      const me = state.players[bot.id];
      if (!me) continue;
      if (state.round.phase === "drafting") {
        this.draft(host, state, bot, nowMs);
        continue;
      }
      bot.draftPickAt = null;
      if (!me.alive) continue;
      const input = this.decide(state, bot, me, nowMs);
      bot.seq += 1;
      host.injectInput(bot.id, {
        seq: bot.seq,
        tick: state.tick as number,
        keys: input.keys,
        aimX: input.aimX,
        aimY: input.aimY,
        dt: 1000 / 60,
      } as never);
    }
  }

  // ── Brain ──────────────────────────────────────────────────────────

  private decide(
    state: WorldState,
    bot: BotState,
    me: PlayerEntity,
    nowMs: number,
  ): { keys: number; aimX: number; aimY: number } {
    const foe = this.nearestFoe(state, me);
    let keys = 0;

    if (!foe) {
      // Nobody to fight: idle wander so the world looks alive.
      if (nowMs > bot.strafeUntil) {
        bot.strafeDir = ([-1, 0, 1] as const)[Math.floor(bot.rand() * 3)]!;
        bot.strafeUntil = nowMs + 900 + bot.rand() * 1400;
      }
      if (bot.strafeDir < 0) keys |= InputBit.Left;
      if (bot.strafeDir > 0) keys |= InputBit.Right;
      return { keys, aimX: me.x + (bot.strafeDir || 1) * 200, aimY: me.y };
    }

    const dx = foe.x - me.x;
    const dist = Math.hypot(dx, foe.y - me.y);
    const retreating = me.health <= BOT_TUNING.retreatHp;

    // Movement: hold engage range; retreat widens it. Strafe jitter on top.
    const targetRange = retreating ? 520 : BOT_TUNING.engageRange;
    if (Math.abs(dist - targetRange) > 60) {
      const toward = dist > targetRange ? Math.sign(dx) : -Math.sign(dx);
      if (toward < 0) keys |= InputBit.Left;
      if (toward > 0) keys |= InputBit.Right;
    } else {
      if (nowMs > bot.strafeUntil) {
        bot.strafeDir = bot.rand() < 0.5 ? -1 : 1;
        bot.strafeUntil = nowMs + 350 + bot.rand() * 650;
      }
      if (bot.strafeDir < 0) keys |= InputBit.Left;
      if (bot.strafeDir > 0) keys |= InputBit.Right;
    }

    // Vertical: chase height advantage occasionally; hop at ledges.
    if (foe.y < me.y - 90 && bot.rand() < 0.05) keys |= InputBit.Jump;

    // Threat response: inbound projectile → parry (facing it) or hop.
    const threat = this.inboundThreat(state, me);
    if (threat) {
      if (nowMs >= bot.parryReadyAt && bot.rand() < 0.55) {
        keys |= InputBit.Ability; // parry toward current aim (set below)
        bot.parryReadyAt = nowMs + BOT_TUNING.parryEveryMs + bot.rand() * 1200;
        bot.aimX = threat.x;
        bot.aimY = threat.y;
        return { keys, aimX: threat.x, aimY: threat.y };
      }
      if (bot.rand() < 0.35) keys |= InputBit.Jump;
      if (me.shieldCharge !== undefined && me.shieldCharge > 40 && bot.rand() < 0.3) {
        keys |= InputBit.Shield;
      }
    }

    // Aim: lead the target, with reaction lag (EMA toward true lead point)
    // and a human aim-error wobble.
    const flightSec = dist / BOT_TUNING.projectileSpeed;
    const leadX = foe.x + foe.vx * flightSec * BOT_TUNING.leadFactor;
    const leadY = foe.y + foe.vy * flightSec * BOT_TUNING.leadFactor;
    bot.aimX += (leadX - bot.aimX) * 0.25;
    bot.aimY += (leadY - bot.aimY) * 0.25;
    const err = BOT_TUNING.aimErrorPx;
    const aimX = bot.aimX + (bot.rand() - 0.5) * err;
    const aimY = bot.aimY + (bot.rand() - 0.5) * err;

    // Fire when roughly on target and in range (never while retreating
    // and hurt — bots that spray while fleeing feel unfair).
    const inRange = dist < 620;
    if (inRange && !retreating) keys |= InputBit.Fire;
    if (retreating && me.shieldCharge !== undefined && me.shieldCharge > 20) {
      keys |= InputBit.Shield;
    }

    return { keys, aimX, aimY };
  }

  private nearestFoe(state: WorldState, me: PlayerEntity): PlayerEntity | null {
    let best: PlayerEntity | null = null;
    let bestD = Infinity;
    for (const p of Object.values(state.players)) {
      if (p.id === me.id || !p.alive) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private inboundThreat(
    state: WorldState,
    me: PlayerEntity,
  ): { x: number; y: number } | null {
    for (const pr of Object.values(state.projectiles)) {
      if (pr.ownerId === me.id) continue;
      const dx = me.x - pr.x;
      const dy = me.y - pr.y;
      const d = Math.hypot(dx, dy);
      if (d > BOT_TUNING.threatRadius) continue;
      // Heading toward us? (velocity dot to-me > 0 with decent alignment)
      const speed = Math.hypot(pr.vx, pr.vy) || 1;
      const align = (pr.vx * dx + pr.vy * dy) / (speed * d || 1);
      if (align > 0.6) return { x: pr.x, y: pr.y };
    }
    return null;
  }

  private draft(
    host: MatchHost,
    state: WorldState,
    bot: BotState,
    nowMs: number,
  ): void {
    const offers = state.round.draftingOffers?.[bot.id];
    if (!offers || offers.length === 0) return;
    if (state.round.draftingPicked?.[bot.id] !== undefined) return;
    if (state.round.roundIndex !== bot.lastDraftRound) {
      bot.lastDraftRound = state.round.roundIndex;
      // Deliberate pause: instant picks read as robotic in the BAD way.
      bot.draftPickAt = nowMs + 1500 + bot.rand() * 3000;
    }
    if (bot.draftPickAt !== null && nowMs >= bot.draftPickAt) {
      const pick = offers[Math.floor(bot.rand() * offers.length)]!;
      host.injectCardPick(bot.id, state.round.roundIndex, pick);
      bot.draftPickAt = null;
    }
  }
}
