// Phase C2b follow-up — contract tests for SimEventRouter.
//
// Stubs all 12+ deps and asserts: each event type fires the right
// audio cue + screen-shake + overlay state mutation. One-for-one
// with the OnlineMatchScene.handleSimEvents switch behaviour
// pre-extraction.

import { describe, expect, test, beforeEach } from "bun:test";
import { SimEventRouter } from "../SimEventRouter";
import type { SimEventRouterDeps } from "../SimEventRouter";
import type { ProceduralPlayerRig } from "../../rendering/ProceduralPlayerRig";
import type { ParticlePool } from "../../systems/ParticlePool";
import { EntityId, PlayerId, type SimEvent } from "../../../sim/types";
import type { AbilityKind } from "../../../sim/data/cardTypes.js";
import { presentationBudget } from "../presentationBudgets.js";

function makeDeps(): {
  deps: SimEventRouterDeps;
  audioCalls: string[];
  shakeCalls: Array<[number, number]>;
  damageNumbers: Array<[string, number]>;
  damageNumbersAt: Array<[number, number, number]>;
  blasts: Array<[string, number, number]>;
  killCinematics: string[];
  blastTints: Array<{ x: number; y: number }>;
  shownCardOffers: string[][];
  hideCardCalls: number;
  drainActiveCalls: number;
  explosionBlasts: Array<{ x: number; y: number; r: number; d: number }>;
  wardAbsorbFlashes: Array<{ pid: string; isPeel: boolean }>;
  syzygistWardFlashes: Array<{ pid: string; casterId: string; wardBroke: boolean }>;
  rigHits: Array<{ pid: string; dirX: number; dirY: number }>;
  pairImpacts: Array<{
    pid: string;
    role: string;
    dirX: number;
    dirY: number;
    chassis: string;
    kill: boolean;
  }>;
  rigFires: string[];
  rigParryFlashes: string[];
  rigKillPulses: string[];
  rigAbilities: Array<{ pid: string; kind: string }>;
  killStreaks: Map<string, number>;
  prevAlive: Set<string>;
  tweens: { timeScale: number };
  delayedCalls: Array<() => void>;
} {
  const audioCalls: string[] = [];
  const shakeCalls: Array<[number, number]> = [];
  const damageNumbers: Array<[string, number]> = [];
  const damageNumbersAt: Array<[number, number, number]> = [];
  const blasts: Array<[string, number, number]> = [];
  const killCinematics: string[] = [];
  const blastTints: Array<{ x: number; y: number }> = [];
  const shownCardOffers: string[][] = [];
  let hideCardCalls = 0;
  let drainActiveCalls = 0;
  const explosionBlasts: Array<{ x: number; y: number; r: number; d: number }> = [];
  const wardAbsorbFlashes: Array<{ pid: string; isPeel: boolean }> = [];
  const syzygistWardFlashes: Array<{
    pid: string;
    casterId: string;
    wardBroke: boolean;
  }> = [];
  const rigHits: Array<{ pid: string; dirX: number; dirY: number }> = [];
  const rigFires: string[] = [];
  const rigParryFlashes: string[] = [];
  const rigKillPulses: string[] = [];
  const rigAbilities: Array<{ pid: string; kind: string }> = [];
  const killStreaks = new Map<string, number>();
  const prevAlive = new Set<string>();
  const tweens = { timeScale: 1 };
  const delayedCalls: Array<() => void> = [];

  const pairImpacts: Array<{
    pid: string;
    role: string;
    dirX: number;
    dirY: number;
    chassis: string;
    kill: boolean;
  }> = [];
  const fakeRig = (pid: string, classId = "wizard"): ProceduralPlayerRig =>
    ({
      triggerHit(dx: number, dy: number) {
        rigHits.push({ pid, dirX: dx, dirY: dy });
      },
      getClassId() {
        return classId;
      },
      applyPairImpact(role: string, dirX: number, dirY: number, chassis: string, kill = false) {
        pairImpacts.push({ pid, role, dirX, dirY, chassis, kill });
      },
      triggerFire() {
        rigFires.push(pid);
      },
      triggerParryFlash() {
        rigParryFlashes.push(pid);
      },
      triggerKillPulse() {
        rigKillPulses.push(pid);
      },
      triggerAbility(kind: AbilityKind) {
        rigAbilities.push({ pid, kind });
      },
    }) as unknown as ProceduralPlayerRig;

  const playerRigs = new Map<string, ProceduralPlayerRig>();
  playerRigs.set("local", fakeRig("local", "ninja"));
  playerRigs.set("remote", fakeRig("remote", "paladin"));

  const fakePool: ParticlePool = {
    drainActive() {
      drainActiveCalls += 1;
    },
  } as unknown as ParticlePool;

  const renderLayer = {
    spawnExplosionBlast(pos: { x: number; y: number }, r: number, d: number) {
      explosionBlasts.push({ x: pos.x, y: pos.y, r, d });
    },
  } as unknown as SimEventRouterDeps["renderLayer"];

  const fakeScene = {
    tweens,
    time: {
      delayedCall: (_ms: number, cb: () => void) => {
        delayedCalls.push(cb);
      },
    },
  } as unknown as SimEventRouterDeps["scene"];

  const deps: SimEventRouterDeps = {
    scene: fakeScene,
    audio: {
      play(cue) {
        audioCalls.push(cue);
      },
    },
    localPlayerId: PlayerId("local"),
    safeShake(durationMs, intensity) {
      shakeCalls.push([durationMs, intensity]);
    },
    spawnDamageNumber(victimId, damage) {
      damageNumbers.push([String(victimId), damage]);
    },
    spawnDamageNumberAt(x, y, damage) {
      damageNumbersAt.push([x, y, damage]);
    },
    spawnBlastAtPlayer(pid, r, d) {
      blasts.push([String(pid), r, d]);
    },
    spawnWardAbsorbFlash(pid, isPeel) {
      wardAbsorbFlashes.push({ pid: String(pid), isPeel });
    },
    spawnSyzygistWardAbsorbFlash(pid, casterId, wardBroke) {
      syzygistWardFlashes.push({
        pid: String(pid),
        casterId: String(casterId),
        wardBroke,
      });
    },
    killCinematic(vid) {
      killCinematics.push(String(vid));
    },
    spawnPlatformBlastTint(pos) {
      blastTints.push(pos);
    },
    showCardDraft(cardIds) {
      shownCardOffers.push(cardIds);
    },
    hideCardDraft() {
      hideCardCalls += 1;
    },
    playerRigs,
    particlePool: fakePool,
    renderLayer,
    killStreakCount: killStreaks,
    prevAlive,
  };

  return {
    deps,
    audioCalls,
    shakeCalls,
    damageNumbers,
    damageNumbersAt,
    blasts,
    killCinematics,
    blastTints,
    shownCardOffers,
    get hideCardCalls() {
      return hideCardCalls;
    },
    get drainActiveCalls() {
      return drainActiveCalls;
    },
    explosionBlasts,
    wardAbsorbFlashes,
    syzygistWardFlashes,
    rigHits,
    pairImpacts,
    rigFires,
    rigParryFlashes,
    rigKillPulses,
    rigAbilities,
    killStreaks,
    prevAlive,
    tweens,
    delayedCalls,
  };
}

describe("SimEventRouter — C2b contract", () => {
  let env: ReturnType<typeof makeDeps>;
  let router: SimEventRouter;

  beforeEach(() => {
    env = makeDeps();
    router = new SimEventRouter(env.deps);
  });

  test("shot-fired by local player → shoot SFX + tiny shake + rig fire recoil", () => {
    const ev: SimEvent = { t: "shot-fired", playerId: PlayerId("local"), x: 0, y: 0 };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["shoot"]);
    expect(env.shakeCalls).toEqual([[40, 0.0015]]);
    expect(env.rigFires).toEqual(["local"]);
  });

  test("shot-fired by remote player → shoot SFX, NO shake, but rig still recoils", () => {
    const ev: SimEvent = { t: "shot-fired", playerId: PlayerId("remote"), x: 0, y: 0 };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["shoot"]);
    expect(env.shakeCalls).toEqual([]);
    // Every shooter's rig throws — a remote firing visibly recoils too.
    expect(env.rigFires).toEqual(["remote"]);
  });

  test("parry-deflected (local) → parry SFX + rig flash + micro hit-stop + shake", () => {
    const ev: SimEvent = {
      t: "parry-deflected",
      playerId: PlayerId("local"),
      projectileId: null,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["parry"]);
    expect(env.rigParryFlashes).toEqual(["local"]);
    expect(env.tweens.timeScale).toBe(0); // hit-stop engaged...
    env.delayedCalls.forEach((fn) => fn());
    expect(env.tweens.timeScale).toBe(1); // ...and released
    // Registered as "heavy" tier (eventPresentationRegistry.ts) — a clean
    // parry is a real skill moment, should hit at least as hard as a landed
    // attack (2026-07-19 juice pass: was shipping below its own tier).
    const heavy = presentationBudget("heavy");
    expect(env.shakeCalls).toEqual([[heavy.shakeDurationMs, heavy.shakeIntensity]]);
  });

  test("parry-deflected (remote) → flash + SFX but NO local shake", () => {
    const ev: SimEvent = {
      t: "parry-deflected",
      playerId: PlayerId("remote"),
      projectileId: null,
    };
    router.dispatch(ev);
    expect(env.rigParryFlashes).toEqual(["remote"]);
    expect(env.shakeCalls).toEqual([]);
  });

  test("hit-confirmed: heavy hit (>=30 dmg) triggers 50ms hit-stop", () => {
    const ev: SimEvent = {
      t: "hit-confirmed",
      victimId: PlayerId("remote"),
      damage: 35,
      sourceProjectileId: null,
    };
    router.dispatch(ev);
    expect(env.tweens.timeScale).toBe(0);
    expect(env.delayedCalls.length).toBe(1);
    env.delayedCalls[0]!();
    expect(env.tweens.timeScale).toBe(1);
    expect(env.audioCalls).toEqual(["hit"]);
    expect(env.damageNumbers).toEqual([["remote", 35]]);
    expect(env.blasts).toEqual([["remote", 22, 35]]);
    expect(env.rigHits.length).toBe(1);
    expect(env.rigHits[0]!.pid).toBe("remote");
  });

  test("hit-confirmed: light hit (<30 dmg) triggers 35ms hit-stop", () => {
    const ev: SimEvent = {
      t: "hit-confirmed",
      victimId: PlayerId("remote"),
      damage: 12,
      sourceProjectileId: null,
    };
    router.dispatch(ev);
    expect(env.tweens.timeScale).toBe(0);
    expect(env.shakeCalls).toEqual([]);
  });

  test("hit-confirmed on LOCAL player: extra shake fires", () => {
    const ev: SimEvent = {
      t: "hit-confirmed",
      victimId: PlayerId("local"),
      damage: 20,
      sourceProjectileId: null,
    };
    router.dispatch(ev);
    expect(env.shakeCalls).toEqual([[80, 0.008]]);
  });

  test("player-killed: kill-stack stack fires (timeScale=0, big shake, blast, 2 SFX)", () => {
    const ev: SimEvent = {
      t: "player-killed",
      victimId: PlayerId("remote"),
      killerId: PlayerId("local"),
      cause: "projectile",
    };
    router.dispatch(ev);
    expect(env.tweens.timeScale).toBe(0);
    expect(env.audioCalls).toEqual(["explosion", "hit"]);
    expect(env.blasts).toEqual([["remote", 36, 50]]);
    expect(env.killCinematics).toEqual(["remote"]); // P3 kill moment fired
    // Big shake (180/0.012) + killer kick (120/0.006) since LOCAL got the kill.
    expect(env.shakeCalls).toEqual([
      [180, 0.012],
      [120, 0.006],
    ]);
    expect(env.rigKillPulses).toEqual(["local"]);
  });

  test("player-killed by remote: no killer kick for local, but killer's own rig still pulses", () => {
    const ev: SimEvent = {
      t: "player-killed",
      victimId: PlayerId("local"),
      killerId: PlayerId("remote"),
      cause: "projectile",
    };
    router.dispatch(ev);
    expect(env.shakeCalls).toEqual([[180, 0.012]]);
    expect(env.rigKillPulses).toEqual(["remote"]);
  });

  test("destructible-broken: explosion SFX + blast tint + render layer blast", () => {
    const ev: SimEvent = {
      t: "destructible-broken",
      entityId: EntityId(1),
      x: 100,
      y: 200,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["explosion"]);
    expect(env.shakeCalls).toEqual([[60, 0.0025]]);
    expect(env.blastTints).toEqual([{ x: 100, y: 200 }]);
    expect(env.explosionBlasts).toEqual([{ x: 100, y: 200, r: 48, d: 30 }]);
  });

  test("destructible-hit: hit SFX + damage number AT the entity's position, no shake/hit-stop", () => {
    const ev: SimEvent = {
      t: "destructible-hit",
      entityId: EntityId(1),
      damage: 20,
      x: 300,
      y: 150,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["hit"]);
    expect(env.damageNumbersAt).toEqual([[300, 150, 20]]);
    // Deliberately no camera shake / hit-stop — a struck object shouldn't
    // jolt the camera the way a player hit does (SimEventRouter.ts's own
    // doc on the case).
    expect(env.shakeCalls).toEqual([]);
  });

  test("ward-absorbed: gold flash at the BLOCKER, no audio (no ripped asset — hard rule), heavy-tier shake + hit-stop", () => {
    const ev: SimEvent = {
      t: "ward-absorbed",
      playerId: PlayerId("local"),
      damageBlocked: 12,
      kindlingGranted: 12,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual([]);
    expect(env.wardAbsorbFlashes).toEqual([{ pid: "local", isPeel: false }]);
    // Registered as "heavy" tier — was shipping well below it with zero
    // hit-stop (2026-07-19 juice pass: "way not enough juice and impact").
    expect(env.tweens.timeScale).toBe(0);
    env.delayedCalls.forEach((fn) => fn());
    expect(env.tweens.timeScale).toBe(1);
    const heavy = presentationBudget("heavy");
    expect(env.shakeCalls).toEqual([[heavy.shakeDurationMs, heavy.shakeIntensity]]);
  });

  test("ward-absorbed on a REMOTE player: flash still fires (world-space read), but no LOCAL shake", () => {
    const ev: SimEvent = {
      t: "ward-absorbed",
      playerId: PlayerId("remote"),
      damageBlocked: 12,
      kindlingGranted: 12,
    };
    router.dispatch(ev);
    expect(env.wardAbsorbFlashes).toEqual([{ pid: "remote", isPeel: false }]);
    expect(env.shakeCalls).toEqual([]);
  });

  test("team-peel-absorbed: gold flash at the WARDER (not the victim) — distinct read from self-ward", () => {
    const ev: SimEvent = {
      t: "team-peel-absorbed",
      victimId: PlayerId("local"),
      warderId: PlayerId("remote"),
      damageBlocked: 8,
      kindlingGranted: 8,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual([]);
    expect(env.wardAbsorbFlashes).toEqual([{ pid: "remote", isPeel: true }]);
    // Registered as "heavy" tier, same 2026-07-19 juice-pass fix as
    // ward-absorbed above. Victim is local even though the warder isn't —
    // shake still fires.
    expect(env.tweens.timeScale).toBe(0);
    env.delayedCalls.forEach((fn) => fn());
    expect(env.tweens.timeScale).toBe(1);
    const heavy = presentationBudget("heavy");
    expect(env.shakeCalls).toEqual([[heavy.shakeDurationMs, heavy.shakeIntensity]]);
  });

  test("pickup-taken: just pickup SFX", () => {
    const ev: SimEvent = {
      t: "pickup-taken",
      entityId: EntityId(1),
      playerId: PlayerId("local"),
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["pickup"]);
  });

  test("round-end: drains pool, clears killStreakCount + prevAlive", () => {
    env.killStreaks.set("a", 3);
    env.prevAlive.add("a").add("b");
    const ev: SimEvent = { t: "round-end", winnerId: null };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["card"]);
    expect(env.drainActiveCalls).toBe(1);
    expect(env.killStreaks.size).toBe(0);
    expect(env.prevAlive.size).toBe(0);
  });

  test("card-offered to LOCAL: showCardDraft fires", () => {
    const ev: SimEvent = {
      t: "card-offered",
      playerId: PlayerId("local"),
      cardIds: ["c1", "c2", "c3"],
    };
    router.dispatch(ev);
    expect(env.shownCardOffers).toEqual([["c1", "c2", "c3"]]);
  });

  test("card-offered to REMOTE: showCardDraft does NOT fire", () => {
    const ev: SimEvent = {
      t: "card-offered",
      playerId: PlayerId("remote"),
      cardIds: ["c1"],
    };
    router.dispatch(ev);
    expect(env.shownCardOffers).toEqual([]);
  });

  test("draft-resolved by LOCAL: hideCardDraft fires + card SFX", () => {
    const ev: SimEvent = {
      t: "draft-resolved",
      playerId: PlayerId("local"),
      cardId: "c1",
      autoPicked: false,
    };
    router.dispatch(ev);
    expect(env.hideCardCalls).toBe(1);
    expect(env.audioCalls).toEqual(["card"]);
  });

  test("chain-hit: hit SFX, shake fires only when local is involved", () => {
    const ev: SimEvent = {
      t: "chain-hit",
      victimId: PlayerId("local"),
      chainTargetId: PlayerId("remote"),
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 100,
      damage: 5,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual(["hit"]);
    // Registered as "hit" tier — was shipping below it with zero hit-stop
    // even though a lightning chain landing is a real damage event just like
    // hit-confirmed (2026-07-19 juice pass).
    expect(env.tweens.timeScale).toBe(0);
    env.delayedCalls.forEach((fn) => fn());
    expect(env.tweens.timeScale).toBe(1);
    const hit = presentationBudget("hit");
    expect(env.shakeCalls).toEqual([[hit.shakeDurationMs, hit.shakeIntensity]]);
  });

  test("chain-hit between two non-local players: NO shake", () => {
    const ev: SimEvent = {
      t: "chain-hit",
      victimId: PlayerId("remote"),
      chainTargetId: PlayerId("remote"),
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      damage: 5,
    };
    router.dispatch(ev);
    expect(env.shakeCalls).toEqual([]);
  });

  test("audio=null degrades only sound; visual reaction still dispatches", () => {
    env.deps.audio = null;
    const ev: SimEvent = {
      t: "hit-confirmed",
      victimId: PlayerId("remote"),
      damage: 99,
      sourceProjectileId: null,
    };
    router.dispatch(ev);
    expect(env.tweens.timeScale).toBe(0);
    expect(env.damageNumbers).toEqual([["remote", 99]]);
    expect(env.blasts).toEqual([["remote", 22, 99]]);
    expect(env.shakeCalls).toEqual([]);
  });

  test("player-slowed: visual-only, no audio + no shake", () => {
    const ev: SimEvent = {
      t: "player-slowed",
      victimId: PlayerId("remote"),
      multiplier: 0.5,
      durationMs: 1000,
    };
    router.dispatch(ev);
    expect(env.audioCalls).toEqual([]);
    expect(env.shakeCalls).toEqual([]);
  });

  test("ability-activated drives the caster's authored render-only gesture", () => {
    router.dispatch({
      t: "ability-activated",
      playerId: PlayerId("remote"),
      slot: 1,
      kind: "sunlance",
      x: 10,
      y: 20,
    });
    expect(env.rigAbilities).toEqual([{ pid: "remote", kind: "sunlance" }]);
    expect(env.audioCalls).toEqual(["card"]);
    expect(env.shakeCalls).toEqual([]);
  });

  test("unknown future ability kind does not invent a gesture", () => {
    router.dispatch({
      t: "ability-activated",
      playerId: PlayerId("remote"),
      slot: 1,
      kind: "future-wire-kind",
      x: 10,
      y: 20,
    });
    expect(env.rigAbilities).toEqual([]);
  });

  test("syz-ward-absorbed: attributes ally ward and scales a local break", () => {
    const ev: SimEvent = {
      t: "syz-ward-absorbed",
      playerId: PlayerId("remote"),
      casterId: PlayerId("local"),
      damageBlocked: 18,
      wardBroke: true,
    };
    router.dispatch(ev);
    expect(env.syzygistWardFlashes).toEqual([
      { pid: "remote", casterId: "local", wardBroke: true },
    ]);
    // Registered as "heavy" tier, same 2026-07-19 juice-pass fix as the
    // Kindled ward cases — a BROKEN ward (pool fully depleted) escalates
    // further still (×1.3 shake, ×1.4 hit-stop over the plain-absorb case).
    expect(env.tweens.timeScale).toBe(0);
    env.delayedCalls.forEach((fn) => fn());
    expect(env.tweens.timeScale).toBe(1);
    const heavy = presentationBudget("heavy");
    expect(env.shakeCalls).toEqual([
      [heavy.shakeDurationMs * 1.3, heavy.shakeIntensity * 1.3],
    ]);
  });
});

describe("SimEventRouter — melee pair-scoped contact chord (R1 rows 3-5, 2026-07-24)", () => {
  test("slash-hit applies pair impacts to BOTH rigs with the attacker's chassis; the paired hit-confirmed skips world stop + random flinch but keeps the damage number", () => {
    const h = makeDeps();
    const router = new SimEventRouter(h.deps);
    router.dispatch({
      t: "slash-hit",
      attackerId: PlayerId("remote"), // paladin rig -> kindled params
      victimId: PlayerId("local"),
      damage: 32,
      dirX: 0.6,
      dirY: -0.8,
    } as SimEvent);
    expect(h.pairImpacts).toEqual([
      { pid: "local", role: "victim", dirX: 0.6, dirY: -0.8, chassis: "kindled", kill: false },
      { pid: "remote", role: "attacker", dirX: 0.6, dirY: -0.8, chassis: "kindled", kill: false },
    ]);
    // World tween clock untouched by the melee event itself.
    expect(h.tweens.timeScale).toBe(1);

    router.dispatch({
      t: "hit-confirmed",
      victimId: PlayerId("local"),
      damage: 32,
      sourceProjectileId: null,
      attackerId: PlayerId("remote"),
    } as SimEvent);
    // Pair-scoped: NO world hold, NO random-direction rig flinch...
    expect(h.tweens.timeScale).toBe(1);
    expect(h.rigHits.filter((r) => r.pid === "local")).toEqual([]);
    // ...but the damage number and generic hit audio still speak.
    expect(h.damageNumbers).toEqual([["local", 32]]);
    expect(h.audioCalls).toContain("hit");
  });

  test("a SECOND hit-confirmed (ranged, null-source suppression already consumed) gets the normal world stop again", () => {
    const h = makeDeps();
    const router = new SimEventRouter(h.deps);
    router.dispatch({
      t: "slash-hit",
      attackerId: PlayerId("remote"),
      victimId: PlayerId("local"),
      damage: 11,
      dirX: 1,
      dirY: 0,
    } as SimEvent);
    router.dispatch({
      t: "hit-confirmed",
      victimId: PlayerId("local"),
      damage: 11,
      sourceProjectileId: null,
      attackerId: PlayerId("remote"),
    } as SimEvent);
    expect(h.tweens.timeScale).toBe(1); // pair consumed the first
    router.dispatch({
      t: "hit-confirmed",
      victimId: PlayerId("local"),
      damage: 11,
      sourceProjectileId: EntityId(7),
      attackerId: PlayerId("remote"),
    } as SimEvent);
    expect(h.tweens.timeScale).toBe(0); // ranged hit: world stop as before
  });

  test("bash-landed: heavy hit cue + pair impacts, world clock untouched; paired confirm ALSO skips the generic cue (no phasing)", () => {
    const h = makeDeps();
    const router = new SimEventRouter(h.deps);
    router.dispatch({
      t: "bash-landed",
      attackerId: PlayerId("remote"),
      victimId: PlayerId("local"),
      damage: 14,
      dirX: 1,
      dirY: 0,
    } as SimEvent);
    expect(h.audioCalls).toEqual(["hit"]); // the bass-voiced THUD
    expect(h.tweens.timeScale).toBe(1);
    expect(h.pairImpacts.map((i) => `${i.pid}:${i.role}:${i.chassis}`)).toEqual([
      "local:victim:kindled",
      "remote:attacker:kindled",
    ]);
    router.dispatch({
      t: "hit-confirmed",
      victimId: PlayerId("local"),
      damage: 14,
      sourceProjectileId: null,
      attackerId: PlayerId("remote"),
    } as SimEvent);
    // No second "hit" cue — the THUD already spoke.
    expect(h.audioCalls).toEqual(["hit"]);
    expect(h.damageNumbers).toEqual([["local", 14]]);
  });

  test("melee kill: kill-tier pair holds (victim 1.5x lives in the rig), NO world kill stop, cinematic still fires", () => {
    const h = makeDeps();
    const router = new SimEventRouter(h.deps);
    router.dispatch({
      t: "bash-landed",
      attackerId: PlayerId("remote"),
      victimId: PlayerId("local"),
      damage: 14,
      dirX: 0,
      dirY: 1,
    } as SimEvent);
    h.pairImpacts.length = 0;
    router.dispatch({
      t: "player-killed",
      victimId: PlayerId("local"),
      killerId: PlayerId("remote"),
      cause: "bash",
    } as SimEvent);
    expect(h.pairImpacts).toEqual([
      { pid: "local", role: "victim", dirX: 0, dirY: 1, chassis: "kindled", kill: true },
      { pid: "remote", role: "attacker", dirX: 0, dirY: 1, chassis: "kindled", kill: true },
    ]);
    expect(h.tweens.timeScale).toBe(1); // pair-scoped, not world-scoped
    expect(h.killCinematics).toEqual(["local"]); // zoom stays kill-exclusive and alive
  });

  test("non-melee kill keeps the world-tier kill stop unchanged", () => {
    const h = makeDeps();
    const router = new SimEventRouter(h.deps);
    router.dispatch({
      t: "player-killed",
      victimId: PlayerId("local"),
      killerId: PlayerId("remote"),
      cause: "projectile",
    } as SimEvent);
    expect(h.tweens.timeScale).toBe(0);
    expect(h.pairImpacts).toEqual([]);
  });
});
