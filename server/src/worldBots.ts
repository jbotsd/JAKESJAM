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
  /** Stuck detection — bots have no terrain map, so we detect "intended to
   *  move horizontally but didn't" and jump/reverse to unstick (fixes bots
   *  pinning themselves against walls and ledges). */
  lastX: number;
  stuckTicks: number;
  /** Was Jump pressed last tick? The sim buffers a jump only on the RISING
   *  edge, so a held Jump wall-jumps once; we force a one-tick release between
   *  presses so bots can CHAIN wall-jumps up a shaft. */
  jumpHeldPrev: boolean;
  /** Wall-clock ms the bot first became FAR from its foe (0 = not far).
   *  Drives anti-standoff commit mode so two bots never freeze apart. */
  farSince: number;
  /** Aegis-slide aggression tier (balance audit: bots must exhibit the
   *  live meta or players never learn to punish it). 0 = never dashes
   *  offensively (telegraphs — new players don't get blindsided into
   *  learning "spam is correct"). 1 = occasional. 2 = presses it
   *  aggressively whenever in bash range, matching a committed human
   *  opponent. ALL tiers still react defensively to an inbound dash. */
  slideTier: 0 | 1 | 2;
  /** Wall-clock ms an inbound dashing-body threat was first noticed (0 =
   *  none tracked). Drives a ~250ms human-plausible reaction delay before
   *  the defensive response fires, same shape as `farSince`. */
  bodyThreatSince: number;
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
  /** How close (px) an enemy actively sliding (dashing) triggers a
   *  defensive reaction. Bigger than threatRadius — a 940px/s dash covers
   *  ground fast, so the reaction window has to open sooner. */
  bodyThreatRadius: 260,
  /** Reaction delay before a noticed body-threat gets a response (ms) —
   *  standard fighting-game-AI practice (~15 frames / 250ms) so bots stay
   *  plausibly human rather than reading inputs instantly. */
  bodyThreatReactionMs: 250,
  /** Range (px) a tier>=1 bot will offensively press Dash toward its foe —
   *  inside the ~197px lunge distance plus approach margin, so the burst
   *  actually connects instead of firing into empty air. */
  dashBashRange: 230,
  /** Per-tick probability an in-range bot presses Dash offensively, by
   *  slideTier. Tier 0 never initiates (see BotState.slideTier); tier 2 is
   *  close to "every opportunity" — a committed opponent, not a coinflip. */
  dashOffenseChance: [0, 0.05, 0.22] as readonly [number, number, number],
  /** FTUE grace window (ms): a HUMAN's first N seconds in the world after
   *  joining. The onboarding-ftue skill's "first-session bot warmup" adapted
   *  to the always-on world (there is no matchmaker to quarantine new
   *  players behind, and no accounts to detect first-EVER sessions with) —
   *  instead, bots go gentle on every fresh human arrival: doubled aim
   *  error, no offensive dash-bash, and they prefer any non-fresh target
   *  when one exists. Applies on every join, which is fine: 60s of "the
   *  bots aren't bullying me yet" is good arrival feel for veterans too,
   *  and irrelevant once real players outnumber bots. */
  freshPlayerGraceMs: 60_000,
} as const;

export class WorldBots {
  private readonly bots = new Map<PlayerId, BotState>();
  private nameCursor = 0;
  /** Wall-clock ms each HUMAN player id was first seen in the world state —
   *  drives the FTUE grace window (BOT_TUNING.freshPlayerGraceMs). Pruned
   *  when a player leaves; ids are per-session so a rejoin is a new entry
   *  (and correctly gets a fresh grace window). */
  private readonly humanFirstSeenAtMs = new Map<string, number>();

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
        lastX: 0,
        stuckTicks: 0,
        jumpHeldPrev: false,
        farSince: 0,
        // Deterministic spread across the roster (not random) so a given
        // bot slot's aggression is stable across recycles — 0,1,2,0,1,2,…
        // (nameCursor already incremented above, so subtract 1 to key off
        // THIS bot's own index, not the next one's).
        slideTier: ((this.nameCursor - 1) % 3) as 0 | 1 | 2,
        bodyThreatSince: 0,
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
    this.trackHumanArrivals(state, nowMs);
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
    const foe = this.nearestFoe(state, me, nowMs);
    let keys = 0;

    if (!foe) {
      // Nobody to fight: idle wander so the world looks alive.
      if (nowMs > bot.strafeUntil) {
        bot.strafeDir = ([-1, 0, 1] as const)[Math.floor(bot.rand() * 3)]!;
        bot.strafeUntil = nowMs + 900 + bot.rand() * 1400;
      }
      if (bot.strafeDir < 0) keys |= InputBit.Left;
      if (bot.strafeDir > 0) keys |= InputBit.Right;
      bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
      return { keys, aimX: me.x + (bot.strafeDir || 1) * 200, aimY: me.y };
    }

    const dx = foe.x - me.x;
    const dist = Math.hypot(dx, foe.y - me.y);
    const retreating = me.health <= BOT_TUNING.retreatHp;
    const towardFoe = (Math.sign(dx) || 1) as -1 | 1;
    // FTUE grace: fresh humans get a gentler bot — no dash-bash, doubled
    // aim error. They still get shot at (the world must feel alive), just
    // survivably, while they find the controls.
    const foeIsFresh = this.isFreshHuman(foe.id as string, nowMs);

    // Anti-standoff: track how long we've been beyond fire range. After a
    // short while, COMMIT — sprint straight at the foe and jump over
    // obstacles, ignoring range-holding/strafe. Guarantees two bots at
    // opposite ends close in instead of freezing in a standoff.
    const FAR = 560;
    if (dist > FAR) {
      if (bot.farSince === 0) bot.farSince = nowMs;
    } else {
      bot.farSince = 0;
    }
    const committing = bot.farSince !== 0 && nowMs - bot.farSince > 1200;

    // Movement intent (`moveDir`, -1/0/1). Far → always close distance;
    // near → hold engage range with strafe jitter.
    let moveDir: -1 | 0 | 1;
    if (committing || dist > FAR) {
      moveDir = towardFoe; // close the gap
    } else {
      const targetRange = retreating ? 460 : BOT_TUNING.engageRange;
      if (Math.abs(dist - targetRange) > 60) {
        moveDir = (dist > targetRange ? towardFoe : -towardFoe) as -1 | 0 | 1;
      } else {
        if (nowMs > bot.strafeUntil) {
          bot.strafeDir = bot.rand() < 0.5 ? -1 : 1;
          bot.strafeUntil = nowMs + 350 + bot.rand() * 650;
        }
        moveDir = bot.strafeDir;
      }
    }

    // Unstick (bots have no terrain map): if a horizontal intent produced no
    // horizontal movement, JUMP FIRST while still heading toward the foe —
    // that clears steps/ledges/cover pillars without abandoning the chase
    // (the old "reverse away" could push a bot into a wall or away from its
    // foe, causing the standoff). Only after prolonged sticking do we briefly
    // sidestep to unwedge a true corner, then reset the cycle.
    const moved = Math.abs(me.x - bot.lastX);
    if (moveDir !== 0 && moved < 0.6) bot.stuckTicks += 1;
    else bot.stuckTicks = 0;
    bot.lastX = me.x;

    const grounded = me.grounded === true;
    const wantUp = foe.y < me.y - 60;
    // Reuse stuck detection as "pressed against a wall/column": a horizontal
    // intent that produced ~no movement means something is blocking us.
    const onWall = bot.stuckTicks >= 3;
    let wantJump = false;

    // WALL-CLIMB / climb-over. Whenever a wall blocks us, JUMP: on the ground
    // it's the hop that starts the climb; airborne it's a wall-jump (up + away).
    // Chained via the pulse below, bots alternate up a shaft OR climb over a
    // column standing between them and the foe — instead of grinding into it
    // forever. Safe now the jetpack is gone: an airborne Jump is a NO-OP unless
    // touching a wall (and a wall-jump clears the contact), so bots can't fly
    // out of the map.
    if (onWall) wantJump = true;

    // Only a PROLONGED stick (a true dead corner, not a climbable wall) forces
    // a sidestep — give the climb plenty of ticks to work first.
    if (bot.stuckTicks >= 48) {
      moveDir = -moveDir as -1 | 0 | 1;
      if (bot.stuckTicks >= 54) bot.stuckTicks = 0;
    }

    // Commit mode also hops periodically to cross floor gaps between platforms.
    if (committing && grounded && bot.rand() < 0.04) wantJump = true;

    // Seek a wall to climb when we want height but aren't already driving into
    // one (e.g. the foe is directly overhead) — drift toward the foe's side.
    if (wantUp && moveDir === 0) moveDir = towardFoe;

    if (moveDir < 0) keys |= InputBit.Left;
    if (moveDir > 0) keys |= InputBit.Right;

    // Grounded hop to START a climb toward a higher foe (get airborne and into
    // the wall); the wall-climb branch above takes over once we're up on it.
    if (grounded && foe.y < me.y - 90 && bot.rand() < 0.12) wantJump = true;

    // Pulse: force a one-tick release between presses so the sim re-arms its
    // jump buffer and bots can CHAIN wall-jumps (a HELD Jump fires only once).
    if (wantJump && !bot.jumpHeldPrev) keys |= InputBit.Jump;

    // Body threat: an enemy actively SLIDING (aegis dash) toward us. Every
    // tier reacts (only the OFFENSIVE use of the slide is tier-gated below)
    // — this is the balance-audit fix: bots that never perceive a charging
    // body as a threat made the mechanic invisible/uncounterable in the
    // world people actually play in. Reaction-delayed like a human (~250ms)
    // via bodyThreatSince, mirroring the farSince commit-mode pattern.
    const bodyThreat =
      foe.dashing === true &&
      dist <= BOT_TUNING.bodyThreatRadius &&
      this.headingTowardMe(me, foe);
    if (bodyThreat) {
      if (bot.bodyThreatSince === 0) bot.bodyThreatSince = nowMs;
    } else {
      bot.bodyThreatSince = 0;
    }
    if (bodyThreat && nowMs - bot.bodyThreatSince >= BOT_TUNING.bodyThreatReactionMs) {
      const roll = bot.rand();
      if (roll < 0.4 && me.shieldCharge !== undefined && me.shieldCharge > 25) {
        // Hold shield — absorbs the bash outright (no directional-arc gate
        // on a plain held shield), the passive-safe answer.
        keys |= InputBit.Shield;
      } else if (roll < 0.75) {
        // Dash AWAY — aim opposite the attacker so the lunge (and its own
        // front-arc block) launches clear of them instead of into them.
        const awayX = me.x - dx;
        const awayY = me.y - (foe.y - me.y);
        keys |= InputBit.Dash;
        bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
        return { keys, aimX: awayX, aimY: awayY };
      } else if (grounded) {
        keys |= InputBit.Jump; // a bare hop still breaks the lunge's lane
      }
    }

    // Offensive slide: tier-gated (see BotState.slideTier) — only when
    // already closing distance and inside bash range, so it reads as a
    // deliberate engage, not a random twitch. Never against a fresh human
    // (FTUE grace): a 34-damage bash in your first minute teaches "this
    // game kills you before you learn the controls".
    if (
      bot.slideTier > 0 &&
      !foeIsFresh &&
      moveDir === towardFoe &&
      dist <= BOT_TUNING.dashBashRange &&
      bot.rand() < BOT_TUNING.dashOffenseChance[bot.slideTier]
    ) {
      keys |= InputBit.Dash;
    }

    // Threat response: inbound projectile → parry (facing it) or hop.
    const threat = this.inboundThreat(state, me);
    if (threat) {
      if (nowMs >= bot.parryReadyAt && bot.rand() < 0.55) {
        keys |= InputBit.Ability; // parry toward current aim (set below)
        bot.parryReadyAt = nowMs + BOT_TUNING.parryEveryMs + bot.rand() * 1200;
        bot.aimX = threat.x;
        bot.aimY = threat.y;
        bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
        return { keys, aimX: threat.x, aimY: threat.y };
      }
      if (grounded && bot.rand() < 0.35) keys |= InputBit.Jump;
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
    // Doubled wobble against a fresh human (FTUE grace) — they get shot AT,
    // survivably, while they find the controls.
    const err = BOT_TUNING.aimErrorPx * (foeIsFresh ? 2 : 1);
    const aimX = bot.aimX + (bot.rand() - 0.5) * err;
    const aimY = bot.aimY + (bot.rand() - 0.5) * err;

    // Fire when roughly on target and in range (never while retreating
    // and hurt — bots that spray while fleeing feel unfair).
    const inRange = dist < 620;
    if (inRange && !retreating) keys |= InputBit.Fire;
    if (retreating && me.shieldCharge !== undefined && me.shieldCharge > 20) {
      keys |= InputBit.Shield;
    }

    bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
    return { keys, aimX, aimY };
  }

  /** Record first-seen timestamps for humans and prune departures. */
  private trackHumanArrivals(state: WorldState, nowMs: number): void {
    const present = new Set<string>();
    for (const p of Object.values(state.players)) {
      const id = p.id as string;
      if (id.startsWith(BOT_ID_PREFIX)) continue;
      present.add(id);
      if (!this.humanFirstSeenAtMs.has(id)) this.humanFirstSeenAtMs.set(id, nowMs);
    }
    for (const id of [...this.humanFirstSeenAtMs.keys()]) {
      if (!present.has(id)) this.humanFirstSeenAtMs.delete(id);
    }
  }

  /** FTUE grace: a human inside their first freshPlayerGraceMs in the world.
   *  Bots go easy on them (see BOT_TUNING.freshPlayerGraceMs). */
  private isFreshHuman(id: string, nowMs: number): boolean {
    const firstSeen = this.humanFirstSeenAtMs.get(id);
    if (firstSeen === undefined) return false;
    return nowMs - firstSeen < BOT_TUNING.freshPlayerGraceMs;
  }

  /** Is `foe`'s velocity roughly aligned toward `me`? Same dot-product
   *  shape as the projectile threat check, applied to a player body —
   *  used to tell "sliding toward us" from "sliding somewhere else". */
  private headingTowardMe(me: PlayerEntity, foe: PlayerEntity): boolean {
    const dx = me.x - foe.x;
    const dy = me.y - foe.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = Math.hypot(foe.vx, foe.vy) || 1;
    const align = (foe.vx * dx + foe.vy * dy) / (speed * d);
    return align > 0.5;
  }

  private nearestFoe(state: WorldState, me: PlayerEntity, nowMs: number): PlayerEntity | null {
    // FTUE grace: prefer the nearest NON-fresh target when one exists, so a
    // just-joined human isn't immediately dogpiled — bots fight each other
    // (or veterans) instead. A fresh human is still a valid LAST-resort foe
    // (an empty-feeling world is worse than gentle pressure; the gentleness
    // itself comes from the aim/dash handicaps in decide()).
    let best: PlayerEntity | null = null;
    let bestD = Infinity;
    let bestSeasoned: PlayerEntity | null = null;
    let bestSeasonedD = Infinity;
    for (const p of Object.values(state.players)) {
      if (p.id === me.id || !p.alive) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
      if (!this.isFreshHuman(p.id as string, nowMs) && d < bestSeasonedD) {
        bestSeasonedD = d;
        bestSeasoned = p;
      }
    }
    return bestSeasoned ?? best;
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
