// Server-side AI duelists for the always-on Hot Lobby world.
//
// Design goals:
//   - The world is never dead: a share-link click lands in live action.
//   - Bots are UNMISTAKABLY bots: ids prefixed "bot_" (amber rigs + "BOT · NAME").
//   - They play the CURRENT maps: full floor, cover pylons, hop plates
//     (map-aware via botArenaNav — not blind stuck-jump only).
//   - Combat: approach, cover peek, lead shots, LOS-gated fire, parry,
//     shield, retreat, draft picks, tiered dash-bash slide.
//   - Humanized: reaction delay + aim error; FTUE grace on fresh humans.
//
// Inputs go through MatchHost.injectInput (same queue as WS clients).

import { InputBit } from "@net/protocol.ts";
import type { MatchHost } from "./matchHost.ts";
import { BOT_ID_PREFIX } from "@sim/botId.ts";
import { EMISSION_CHARGE_MAX } from "@sim/constants.ts";
import { resolvePlayerBuild } from "@sim/weapon.ts";
import { MAX_ABILITY_SLOTS } from "@sim/data/cardTypes.ts";
import {
  PlayerId,
  type CharacterArchetype,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "@sim/types.ts";
import {
  buildArenaNav,
  dirTowardX,
  hasLineOfSight,
  hopTargetToward,
  megaScale,
  nearestCoverFlank,
  type ArenaNav,
} from "./botArenaNav.ts";

export { BOT_ID_PREFIX };

const ROSTER = [
  "SPARK", "PISTON", "GIZMO", "RATCHET", "JOLT", "WIDGET", "SOCKET", "DYNAMO",
  "COG", "FLUX", "BOLT", "GEAR",
] as const;

// Class variety (2026-07-20, "make it feel like real players" — a lobby of
// bots that are all secretly Geometrician reads as one reskinned dummy, not
// four different opponents). Cycled by creation order, same fixed-rotation
// shape as `slideTier` below, so any bell with 4+ bots shows every class
// rather than leaving it to chance. classes-goal.md confirms all four ship
// into FFA/solo at this point ("FFA/solo always admit" — Priest is tuned to
// be solo-viable, not duos-gated), so nothing here is held back.
const CLASS_ROTATION: readonly CharacterArchetype[] = ["balanced", "heavy", "sprinter", "shielded"];
/** Paladin/Ninja chassis verb is a melee arc (World.ts's Fire-is-the-same-
 *  button-different-FSM branch), not stepWeapon's ranged shot — the generic
 *  brain below must close to blade range before it means anything to press
 *  Fire, instead of holding the ranged-tuned `engageRange` and swinging air
 *  from 380px out. */
function isMeleeClass(characterId: CharacterArchetype): boolean {
  return characterId === "heavy" || characterId === "sprinter";
}

/** Deterministic-ish per-bot RNG (mulberry32). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type BotMode = "chase" | "hold" | "cover" | "commit" | "retreat";

type BotState = {
  id: PlayerId;
  name: string;
  /** Assigned once at creation (CLASS_ROTATION), stable for the bot's
   *  lifetime — this bot IS "a Kindled", not a random reskin every recycle. */
  characterId: CharacterArchetype;
  seq: number;
  rand: () => number;
  strafeUntil: number;
  strafeDir: -1 | 0 | 1;
  aimX: number;
  aimY: number;
  parryReadyAt: number;
  draftPickAt: number | null;
  /** Pending Emission cast time (null = not armed). Same humanized-delay
   *  shape as draftPickAt — armed when charge fills with a target in
   *  range, fired on expiry (docs/emission-engine-goal.md bot policy). */
  castAt: number | null;
  /** Pending drafted-active presses per slot (six-axes Layer 2) — same
   *  humanized-delay shape as castAt, one timer per action-bar slot. */
  slotPressAt: (number | null)[];
  lastDraftRound: number;
  lastX: number;
  lastY: number;
  stuckTicks: number;
  jumpHeldPrev: boolean;
  farSince: number;
  slideTier: 0 | 1 | 2;
  bodyThreatSince: number;
  /** Cover-hold until wall-clock ms (0 = not holding). */
  coverUntil: number;
  mode: BotMode;
};

const BOT_TUNING = {
  /** Preferred dueling range at 1280-wide cells (scaled by megaScale).
   *  Wider = hang back more, less face-tank pressure. */
  engageRange: 380,
  /** Paladin/Ninja's own engage+fire range (replaces the two above for a
   *  melee bot) — blade reach is ~82-88px (ConstructVfxController.ts's
   *  BLADE_REACH/EDGE_REACH), so holding the ranged `engageRange` (380)
   *  would have a melee bot happily swinging at air from four screen-
   *  widths out. A small buffer over the real reach absorbs a tick or two
   *  of closing-speed/aim jitter without missing every swing. */
  meleeEngageRange: 95,
  meleeFireRange: 110,
  retreatHp: 40,
  /** Base aim wobble — deliberately sloppy so humans can out-aim them. */
  aimErrorPx: 78,
  /** Lead quality 0–1; lower = shoot where you were, not where you're going. */
  leadFactor: 0.4,
  threatRadius: 170,
  parryEveryMs: 3400,
  projectileSpeed: 650,
  bodyThreatRadius: 240,
  bodyThreatReactionMs: 320,
  dashBashRange: 200,
  /** Offensive slide rates — tier 2 used to be nearly free-bash. */
  dashOffenseChance: [0, 0.02, 0.07] as readonly [number, number, number],
  /** First minutes after a human joins — doubled aim error, no dash-bash. */
  freshPlayerGraceMs: 90_000,
  /** Beyond this (× megaScale) → commit chase (higher = less sticky chase). */
  farRange: 720,
  /** Max fire range (× megaScale). */
  fireRange: 640,
  /** Seek cover when under projectile pressure or mid-range duel. */
  coverSeekRange: 520,
  /** Hold a cover flank for this long before re-peeking. */
  coverHoldMs: 1100,
  /** Per-tick chance to hold Fire when lined up (was always-on → laser bots). */
  fireChanceLos: 0.55,
  fireChanceBlind: 0.08,
  /** Prefer bot-on-bot: if a bot is within this × nearest-human dist, pick bot. */
  preferBotDistFactor: 1.55,
  /** Extra aim error multiplier against ANY human (not only fresh). */
  humanAimErrorMul: 1.45,
  /** Fresh humans get this × aimError on top of humanAimErrorMul. */
  freshAimErrorMul: 2.2,
  /** Delay before bots start hard-commit chasing a human (ms of farSince). */
  humanCommitMs: 2000,
  botCommitMs: 1100,
} as const;

export class WorldBots {
  private readonly bots = new Map<PlayerId, BotState>();
  private nameCursor = 0;
  private readonly humanFirstSeenAtMs = new Map<string, number>();
  /** Compiled map geometry for cover / hop / LOS. Null = map-blind fallback. */
  private nav: ArenaNav | null = null;
  private readonly playersScratch: PlayerEntity[] = [];

  /**
   * Bind bots to the active arena (call on host build / recycle).
   * Without this, bots only have stuck-jump heuristics.
   */
  bindMap(map: MapDefinition | null | undefined): void {
    this.nav = map ? buildArenaNav(map) : null;
  }

  /** Bot spawn descriptors for host construction / recycle. */
  spawnInfosFor(count: number): { playerId: PlayerId; name: string; characterId: CharacterArchetype }[] {
    const out: { playerId: PlayerId; name: string; characterId: CharacterArchetype }[] = [];
    const existing = [...this.bots.values()];
    // Class tally for whichever existing bots are about to be reused below —
    // seeds the scarcest-class picker so a NEW bot fills the gap in the
    // LIVE roster, not the next slot in an ever-advancing global sequence.
    // A raw `nameCursor`-driven rotation (the first cut of this feature)
    // only guarantees variety across every bot ever created — individual
    // bots recycle independently (elastic bot floor tracks human count), so
    // the CURRENTLY LIVE set can drift to 1-2 classes for a long stretch
    // after uneven churn even though the abstract sequence is correct
    // (observed live 2026-07-20: 4 live bots read GEO/GEO/GEO/KIN, zero
    // Syzygist — "i havent seen a syzergist yet"). This keeps each bot's
    // OWN class stable for its lifetime (still assigned once, at creation)
    // while making the live set self-balancing regardless of history.
    const classTally = new Map<CharacterArchetype, number>(CLASS_ROTATION.map((c) => [c, 0]));
    for (let j = 0; j < Math.min(count, existing.length); j++) {
      const c = existing[j]!.characterId;
      classTally.set(c, (classTally.get(c) ?? 0) + 1);
    }
    const pickScarcestClass = (): CharacterArchetype => {
      let best = CLASS_ROTATION[0]!;
      let bestCount = Infinity;
      for (const c of CLASS_ROTATION) {
        const n = classTally.get(c) ?? 0;
        if (n < bestCount) {
          bestCount = n;
          best = c;
        }
      }
      classTally.set(best, bestCount + 1);
      return best;
    };
    for (let i = 0; i < count; i++) {
      if (existing[i]) {
        out.push({
          playerId: existing[i]!.id,
          name: existing[i]!.name,
          characterId: existing[i]!.characterId,
        });
        continue;
      }
      const name = ROSTER[this.nameCursor % ROSTER.length]!;
      const characterId = pickScarcestClass();
      this.nameCursor += 1;
      const id = PlayerId(`${BOT_ID_PREFIX}${name.toLowerCase()}`);
      this.bots.set(id, {
        id,
        name,
        characterId,
        seq: 0,
        rand: rng(0xb07 + i * 7919),
        strafeUntil: 0,
        strafeDir: 0,
        aimX: 0,
        aimY: 0,
        parryReadyAt: 0,
        draftPickAt: null,
        castAt: null,
        slotPressAt: new Array<number | null>(MAX_ABILITY_SLOTS).fill(null),
        lastDraftRound: -1,
        lastX: 0,
        lastY: 0,
        stuckTicks: 0,
        jumpHeldPrev: false,
        farSince: 0,
        slideTier: ((this.nameCursor - 1) % 3) as 0 | 1 | 2,
        bodyThreatSince: 0,
        coverUntil: 0,
        mode: "chase",
      });
      out.push({ playerId: id, name, characterId });
    }
    for (const id of [...this.bots.keys()]) {
      if (!out.some((o) => o.playerId === id)) this.bots.delete(id);
    }
    return out;
  }

  /** Drive every bot for one tick. Call at sim rate while the host runs. */
  think(host: MatchHost, nowMs: number): void {
    if (!host.isRunning()) return;
    const state = host.getStateSnapshot();
    this.playersScratch.length = 0;
    for (const pid in state.players) this.playersScratch.push(state.players[pid as PlayerId]!);
    this.trackHumanArrivals(this.playersScratch, nowMs);
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
    const foe = this.nearestFoe(this.playersScratch, me, nowMs);
    let keys = 0;
    const scale = megaScale(this.nav);
    const farRange = BOT_TUNING.farRange * scale;
    // Melee (Paladin/Ninja): hold at blade range, not the ranged-tuned
    // standoff distance — everything downstream (mode selection, chase-
    // vs-hold, the Fire gate) already reads off these two locals, so
    // swapping them here is the whole fix (see isMeleeClass's own comment).
    const melee = isMeleeClass(bot.characterId);
    const engageRange = melee
      ? BOT_TUNING.meleeEngageRange * scale
      : BOT_TUNING.engageRange * Math.min(1.35, scale);
    const fireRange = melee ? BOT_TUNING.meleeFireRange * scale : BOT_TUNING.fireRange * scale;

    if (!foe) {
      if (nowMs > bot.strafeUntil) {
        bot.strafeDir = ([-1, 0, 1] as const)[Math.floor(bot.rand() * 3)]!;
        bot.strafeUntil = nowMs + 900 + bot.rand() * 1400;
      }
      if (bot.strafeDir < 0) keys |= InputBit.Left;
      if (bot.strafeDir > 0) keys |= InputBit.Right;
      bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
      bot.mode = "chase";
      return { keys, aimX: me.x + (bot.strafeDir || 1) * 200, aimY: me.y };
    }

    const dx = foe.x - me.x;
    const dy = foe.y - me.y;
    const dist = Math.hypot(dx, dy);
    const retreating = me.health <= BOT_TUNING.retreatHp;
    const towardFoe = (Math.sign(dx) || 1) as -1 | 1;
    const foeIsFresh = this.isFreshHuman(foe.id as string, nowMs);
    const foeIsHuman = !(foe.id as string).startsWith(BOT_ID_PREFIX);
    const grounded = me.grounded === true;
    const los =
      !this.nav || hasLineOfSight(this.nav, me.x, me.y, foe.x, foe.y);

    // Anti-standoff commit — slower to hard-chase humans (less sticky bullying).
    if (dist > farRange) {
      if (bot.farSince === 0) bot.farSince = nowMs;
    } else {
      bot.farSince = 0;
    }
    const commitDelay = foeIsHuman ? BOT_TUNING.humanCommitMs : BOT_TUNING.botCommitMs;
    const committing = bot.farSince !== 0 && nowMs - bot.farSince > commitDelay;

    // ── Mode selection ─────────────────────────────────────────────
    let mode: BotMode = "hold";
    if (retreating) mode = "retreat";
    else if (committing || dist > farRange) mode = "commit";
    else if (
      this.nav &&
      (nowMs < bot.coverUntil ||
        (!los && dist < BOT_TUNING.coverSeekRange * scale) ||
        (dist < engageRange + 80 && bot.rand() < 0.012 && nowMs > bot.coverUntil))
    ) {
      mode = "cover";
    } else if (Math.abs(dist - engageRange) > 70) {
      mode = "chase";
    } else {
      mode = "hold";
    }
    bot.mode = mode;

    // ── Movement intent ────────────────────────────────────────────
    let moveDir: -1 | 0 | 1 = 0;
    let runToX: number | null = null;
    let wantJump = false;

    // Vertical hop: foe above → aim for a hop ledge under them.
    const meTop = me.y; // entity y is roughly body centre; good enough for rise
    if (this.nav && foe.y < me.y - 70 && mode !== "retreat") {
      const hop = hopTargetToward(this.nav, me.x, me.y + 28, foe.x, foe.y);
      if (hop) {
        runToX = hop.cx;
        if (grounded && Math.abs(me.x - hop.cx) < 100 && bot.rand() < 0.28) {
          wantJump = true;
        } else if (grounded && Math.abs(me.x - hop.cx) < 160 && bot.rand() < 0.08) {
          wantJump = true;
        }
      } else if (grounded && bot.rand() < 0.1) {
        wantJump = true; // blind hop toward height
        moveDir = towardFoe;
      }
    }

    if (mode === "retreat") {
      runToX = me.x - towardFoe * 200;
      if (this.nav) {
        const flank = nearestCoverFlank(this.nav, me.x, me.y, foe.x, 500);
        if (flank) runToX = flank.x;
      }
    } else if (mode === "cover" && this.nav) {
      const flank = nearestCoverFlank(this.nav, me.x, me.y, foe.x, 480 * scale);
      if (flank) {
        runToX = flank.x;
        if (Math.abs(me.x - flank.x) < 28) {
          // At cover: hold briefly, then re-peek toward foe.
          if (bot.coverUntil < nowMs) {
            bot.coverUntil = nowMs + BOT_TUNING.coverHoldMs * (0.7 + bot.rand() * 0.6);
          }
          if (nowMs + 200 > bot.coverUntil) {
            // Peek: step toward foe for a beat.
            runToX = me.x + towardFoe * 50;
          } else {
            runToX = flank.x;
          }
        } else {
          bot.coverUntil = Math.max(bot.coverUntil, nowMs + 200);
        }
      } else {
        mode = "chase";
        bot.mode = "chase";
      }
    }

    if (mode === "commit" || mode === "chase") {
      if (runToX === null) runToX = foe.x;
    } else if (mode === "hold") {
      if (nowMs > bot.strafeUntil) {
        bot.strafeDir = bot.rand() < 0.5 ? -1 : 1;
        bot.strafeUntil = nowMs + 350 + bot.rand() * 650;
      }
      moveDir = bot.strafeDir;
      // Micro-adjust range while strafing.
      if (dist > engageRange + 40) moveDir = towardFoe;
      if (dist < engageRange - 50) moveDir = -towardFoe as -1 | 0 | 1;
    }

    if (runToX !== null) {
      moveDir = dirTowardX(me.x, runToX);
    }

    // Unstick: no map path → jump while still heading toward foe; prolonged
    // stick briefly reverse (true corner). Prefer hop over reverse on mega.
    const moved = Math.abs(me.x - bot.lastX) + Math.abs(me.y - bot.lastY) * 0.35;
    if (moveDir !== 0 && moved < 0.7) bot.stuckTicks += 1;
    else bot.stuckTicks = 0;
    bot.lastX = me.x;
    bot.lastY = me.y;

    const onWall = bot.stuckTicks >= 3;
    if (onWall) wantJump = true;
    if (bot.stuckTicks >= 48) {
      moveDir = -moveDir as -1 | 0 | 1;
      if (bot.stuckTicks >= 54) bot.stuckTicks = 0;
    }
    if (committing && grounded && bot.rand() < 0.05) wantJump = true;
    // Cover columns are hop-overable: if stuck mid-commit, keep jumping.
    if (onWall && mode === "commit" && grounded) wantJump = true;

    if (moveDir < 0) keys |= InputBit.Left;
    if (moveDir > 0) keys |= InputBit.Right;
    if (wantJump && !bot.jumpHeldPrev) keys |= InputBit.Jump;

    // Body threat defense (universal).
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
        keys |= InputBit.Shield;
      } else if (roll < 0.75) {
        const awayX = me.x - dx;
        const awayY = me.y - dy;
        keys |= InputBit.Dash;
        bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
        return { keys, aimX: awayX, aimY: awayY };
      } else if (grounded) {
        keys |= InputBit.Jump;
      }
    }

    // Offensive slide (tiered, FTUE-gated).
    if (
      bot.slideTier > 0 &&
      !foeIsFresh &&
      moveDir === towardFoe &&
      dist <= BOT_TUNING.dashBashRange &&
      bot.rand() < BOT_TUNING.dashOffenseChance[bot.slideTier]
    ) {
      keys |= InputBit.Dash;
    }

    // Emission cast (docs/emission-engine-goal.md bot policy): at full
    // charge with a live target in range, press Ability after a humanizing
    // delay — bots must not be the only ones NOT testing the cast path.
    // The same bit doubles as the legacy defensive parry below full charge
    // (World.ts's cast-then-parry fall-through), so nothing was removed.
    if (me.abilityCharge >= EMISSION_CHARGE_MAX && dist <= 600) {
      if (bot.castAt === null) {
        bot.castAt = nowMs + 1000 + bot.rand() * 2000;
      } else if (nowMs >= bot.castAt) {
        keys |= InputBit.Ability;
        bot.castAt = null;
        bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
        return { keys, aimX: foe.x, aimY: foe.y };
      }
    } else if (me.abilityCharge < EMISSION_CHARGE_MAX) {
      bot.castAt = null;
    }

    // Drafted actives (six-axes Layer 2 + class-ability-catalogs-v1 bot
    // policy, chunk 0.4 "Bot loadout tables"): press a ready slot with a
    // humanizing delay, class-agnostic — this drives whatever ability cards
    // are actually equipped in ResolvedWeaponBuild.actives, the SAME
    // resolution a human's action bar reads (client/src/game/ui/
    // ActionBarSystem.ts), and presses via the SAME input bits World.ts's
    // ability-activation loop reads (1 << (10 + slot)), so bots exercise the
    // exact human press path — no bot-only shortcut into sim effects.
    //
    // Role-aware target gate: reading every catalog case in World.ts's
    // ability switch shows only the "single" role (Facet Break — marks the
    // nearest foe in the aim cone) actually requires a live target nearby to
    // do anything; every other role today (offense/aoe/defense/buff/
    // movement) is self-centered or self-aimed and fires unconditionally
    // once off cooldown (Sunlance/Prism Fan/Lattice/Return Glass/Hard
    // Aperture/Overclock/Measure/Slip Node/Recoil Step). So "single" is
    // range-gated on the nearest foe; everything else presses on cooldown
    // alone. The five pre-catalog six-axes actives (crimson-tithe,
    // shelter-seal, shadow-step, veil-of-nought, severing-answer) predate
    // the role tag (`role` is undefined for them) — conservatively treated
    // as target-required here too, matching this heuristic's pre-existing
    // behavior for them (no behavior change to already-tuned bots).
    // v1 is deliberately basic: no priority/rotation ordering between
    // slots, no synergy/resonance awareness, no "save the defensive one"
    // logic — every ready+valid slot gets the same humanized roll.
    // Rack is locked at MAX_ABILITY_SLOTS (3, docs/classes-goal.md
    // "Rotation system") — never 4.
    // cards-array guard: minimal test fixtures omit it; no cards, no actives.
    const actives = Array.isArray(me.cards) ? resolvePlayerBuild(me).actives : [];
    // Lazy-init keeps hand-built BotState fixtures (tests) valid.
    const slotPressAt = (bot.slotPressAt ??= new Array<number | null>(MAX_ABILITY_SLOTS).fill(null));
    for (let slot = 0; slot < actives.length && slot < MAX_ABILITY_SLOTS; slot++) {
      const active = actives[slot]!;
      const cdUntil =
        slot === 0
          ? me.slot1CooldownUntilTick
          : slot === 1
            ? me.slot2CooldownUntilTick
            : slot === 2
              ? me.slot3CooldownUntilTick
              : me.slot4CooldownUntilTick;
      const ready = cdUntil === undefined || cdUntil <= state.tick;
      const needsTarget = active.role === undefined || active.role === "single";
      if (!ready || (needsTarget && dist > 520)) {
        slotPressAt[slot] = null;
        continue;
      }
      if (slotPressAt[slot] == null) {
        slotPressAt[slot] = nowMs + 600 + bot.rand() * 1800;
      } else if (nowMs >= slotPressAt[slot]!) {
        keys |= 1 << (10 + slot);
        slotPressAt[slot] = null;
      }
    }

    // Projectile threat → parry / hop / shield (parry less often = more open).
    const threat = this.inboundThreat(state, me);
    if (threat) {
      if (nowMs >= bot.parryReadyAt && bot.rand() < 0.38) {
        keys |= InputBit.Ability;
        bot.parryReadyAt = nowMs + BOT_TUNING.parryEveryMs + bot.rand() * 1200;
        bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
        return { keys, aimX: threat.x, aimY: threat.y };
      }
      if (grounded && bot.rand() < 0.35) keys |= InputBit.Jump;
      if (me.shieldCharge !== undefined && me.shieldCharge > 40 && bot.rand() < 0.3) {
        keys |= InputBit.Shield;
      }
      if (this.nav && bot.coverUntil < nowMs) {
        bot.coverUntil = nowMs + BOT_TUNING.coverHoldMs;
      }
    }

    // Aim: weak lead + slow EMA + human/fresh error multipliers.
    const flightSec = dist / BOT_TUNING.projectileSpeed;
    const leadX = foe.x + foe.vx * flightSec * BOT_TUNING.leadFactor;
    const leadY = foe.y + foe.vy * flightSec * BOT_TUNING.leadFactor;
    bot.aimX += (leadX - bot.aimX) * 0.16; // slower track = more miss
    bot.aimY += (leadY - bot.aimY) * 0.16;
    let errMul = 1;
    if (foeIsHuman) errMul *= BOT_TUNING.humanAimErrorMul;
    if (foeIsFresh) errMul *= BOT_TUNING.freshAimErrorMul;
    const err = BOT_TUNING.aimErrorPx * errMul;
    const aimX = bot.aimX + (bot.rand() - 0.5) * err;
    const aimY = bot.aimY + (bot.rand() - 0.5) * err;

    // Fire: bursty, not permanent trigger-hold (was "hard as nails").
    const inRange = dist < fireRange;
    if (inRange && !retreating) {
      if (los) {
        if (bot.rand() < BOT_TUNING.fireChanceLos) keys |= InputBit.Fire;
      } else if (mode === "cover" && bot.rand() < BOT_TUNING.fireChanceBlind) {
        keys |= InputBit.Fire;
      }
    }
    if (retreating && me.shieldCharge !== undefined && me.shieldCharge > 20) {
      keys |= InputBit.Shield;
    }

    bot.jumpHeldPrev = (keys & InputBit.Jump) !== 0;
    return { keys, aimX, aimY };
  }

  private trackHumanArrivals(players: readonly PlayerEntity[], nowMs: number): void {
    const present = new Set<string>();
    for (const p of players) {
      const id = p.id as string;
      if (id.startsWith(BOT_ID_PREFIX)) continue;
      present.add(id);
      if (!this.humanFirstSeenAtMs.has(id)) this.humanFirstSeenAtMs.set(id, nowMs);
    }
    for (const id of [...this.humanFirstSeenAtMs.keys()]) {
      if (!present.has(id)) this.humanFirstSeenAtMs.delete(id);
    }
  }

  private isFreshHuman(id: string, nowMs: number): boolean {
    const firstSeen = this.humanFirstSeenAtMs.get(id);
    if (firstSeen === undefined) return false;
    return nowMs - firstSeen < BOT_TUNING.freshPlayerGraceMs;
  }

  private headingTowardMe(me: PlayerEntity, foe: PlayerEntity): boolean {
    const dx = me.x - foe.x;
    const dy = me.y - foe.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = Math.hypot(foe.vx, foe.vy) || 1;
    const align = (foe.vx * dx + foe.vy * dy) / (speed * d);
    return align > 0.5;
  }

  private nearestFoe(players: readonly PlayerEntity[], me: PlayerEntity, nowMs: number): PlayerEntity | null {
    // Prefer bot-on-bot + skip fresh humans when any non-fresh target exists.
    // Humans still get pressure, but the gang piles on each other first.
    let best: PlayerEntity | null = null;
    let bestD = Infinity;
    let bestBot: PlayerEntity | null = null;
    let bestBotD = Infinity;
    let bestSeasoned: PlayerEntity | null = null;
    let bestSeasonedD = Infinity;
    let bestHuman: PlayerEntity | null = null;
    let bestHumanD = Infinity;
    for (const p of players) {
      if (p.id === me.id || !p.alive) continue;
      const id = p.id as string;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
      if (id.startsWith(BOT_ID_PREFIX) && d < bestBotD) {
        bestBotD = d;
        bestBot = p;
      }
      if (!this.isFreshHuman(id, nowMs) && d < bestSeasonedD) {
        bestSeasonedD = d;
        bestSeasoned = p;
      }
      if (!id.startsWith(BOT_ID_PREFIX) && d < bestHumanD) {
        bestHumanD = d;
        bestHuman = p;
      }
    }
    // Bot within preferBotDistFactor of nearest human → pick bot (bot-on-bot).
    if (bestBot && bestHuman) {
      if (bestBotD <= bestHumanD * BOT_TUNING.preferBotDistFactor) return bestBot;
    }
    if (bestBot && !bestHuman) return bestBot;
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
      bot.draftPickAt = nowMs + 1500 + bot.rand() * 3000;
    }
    if (bot.draftPickAt !== null && nowMs >= bot.draftPickAt) {
      const pick = offers[Math.floor(bot.rand() * offers.length)]!;
      host.injectCardPick(bot.id, state.round.roundIndex, pick);
      bot.draftPickAt = null;
    }
  }
}
