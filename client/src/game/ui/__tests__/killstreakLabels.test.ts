// Kill-streak ladder + damage-text single-spawn (clip-goal CL.F).

import { describe, test, expect } from "bun:test";
import { KILLSTREAK_LABELS, killstreakLabel, killstreakRank } from "../killstreakLabels.js";
import { SimEventRouter } from "../../render/SimEventRouter.js";
import type { SimEvent } from "../../../sim/types.js";

describe("killstreak ladder (CL.F.3)", () => {
  test("monotone: the label rank never decreases as the streak grows", () => {
    let prev = -1;
    for (let n = 1; n <= 12; n++) {
      const rank = killstreakRank(killstreakLabel(n));
      expect(rank).toBeGreaterThanOrEqual(prev);
      prev = rank;
    }
  });

  test("ladder order pinned: KILL → DOUBLE → TRIPLE → MULTI", () => {
    expect([...KILLSTREAK_LABELS]).toEqual(["KILL", "DOUBLE KILL", "TRIPLE KILL", "MULTI KILL"]);
    expect(killstreakLabel(1)).toBe("KILL");
    expect(killstreakLabel(4)).toBe("MULTI KILL");
    expect(killstreakLabel(9)).toBe("MULTI KILL"); // clamps, never wraps
  });
});

describe("damage-text single-spawn (CL.F.1 / B8)", () => {
  function makeRouter() {
    const spawns: Array<{ victimId: string; damage: number; headshot?: boolean }> = [];
    const scene = {
      tweens: { timeScale: 1 },
      time: { delayedCall: (_ms: number, fn: () => void) => fn() },
    } as unknown as Phaser.Scene;
    // dispatch() no-ops entirely on null audio — stub the player interface.
    const audioStub = { play: () => {}, setShieldHum: () => {} };
    const router = new SimEventRouter({
      scene,
      audio: audioStub as never,
      localPlayerId: "p_local" as never,
      safeShake: () => {},
      spawnDamageNumber: (victimId, damage, headshot) =>
        spawns.push({ victimId: victimId as string, damage, headshot }),
      spawnBlastAtPlayer: () => {},
      killCinematic: () => {},
      spawnPlatformBlastTint: () => {},
      showCardDraft: () => {},
      hideCardDraft: () => {},
      playerRigs: { get: () => undefined },
      particlePool: null,
      renderLayer: null,
      killStreakCount: new Map(),
      prevAlive: new Set(),
    });
    return { router, spawns };
  }

  test("one hit-confirmed event → exactly one damage text (headshot included)", () => {
    const { router, spawns } = makeRouter();
    const hit: SimEvent = {
      t: "hit-confirmed",
      victimId: "p_victim",
      attackerId: "p_local",
      damage: 14,
      headshot: true,
    } as unknown as SimEvent;
    router.dispatch(hit);
    expect(spawns.length).toBe(1);
    expect(spawns[0]).toEqual({ victimId: "p_victim", damage: 14, headshot: true });
  });

  test("shot-fired drives the rig's muzzle beat + combat stance (CL.G wiring)", () => {
    const fired: Array<0 | 1 | undefined> = [];
    const scene = {
      tweens: { timeScale: 1 },
      time: { delayedCall: (_ms: number, fn: () => void) => fn() },
    } as unknown as Phaser.Scene;
    const router = new SimEventRouter({
      scene,
      audio: { play: () => {}, setShieldHum: () => {} } as never,
      localPlayerId: "p_local" as never,
      safeShake: () => {},
      spawnDamageNumber: () => {},
      spawnBlastAtPlayer: () => {},
      killCinematic: () => {},
      spawnPlatformBlastTint: () => {},
      showCardDraft: () => {},
      hideCardDraft: () => {},
      playerRigs: {
        get: (id: string) =>
          id === "p_star"
            ? ({ triggerFire: (hand?: 0 | 1) => fired.push(hand) } as never)
            : undefined,
      },
      particlePool: null,
      renderLayer: null,
      killStreakCount: new Map(),
      prevAlive: new Set(),
    });
    router.dispatch({ t: "shot-fired", playerId: "p_star", hand: 1 } as unknown as SimEvent);
    expect(fired).toEqual([1]);
  });

  test("N distinct hits → exactly N texts (the B8 'stack' is sequential hits, not dup spawns)", () => {
    const { router, spawns } = makeRouter();
    for (let i = 0; i < 3; i++) {
      router.dispatch({
        t: "hit-confirmed",
        victimId: "p_victim",
        attackerId: "p_local",
        damage: 14,
        headshot: true,
      } as unknown as SimEvent);
    }
    expect(spawns.length).toBe(3);
  });
});
