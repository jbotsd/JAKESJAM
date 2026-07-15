// Movement-augment behavior: double-jump + dash. Verifies the card-gated
// deep-movement logic in stepPlayer (mirrored bit-for-bit in player.zig; the
// wasm parity test proves the two agree — this proves the logic is correct).

import { describe, expect, test } from "bun:test";
import { buildStaticCache } from "../collision.js";
import { stepPlayer, freshPlayerMovementMemory, DASH_COOLDOWN_MS } from "../player.js";
import { PlayerId, type PlayerEntity, type InputSeq, type PlatformDefinition } from "../types.js";

const STEP = 1000 / 60;
const JUMP = 1 << 4;
const DASH = 1 << 9;

function miniMap() {
  const p = (id: string, kind: string, cx: number, cy: number, w: number, h: number): PlatformDefinition => ({
    id, kind: kind as PlatformDefinition["kind"], position: { x: cx, y: cy }, size: { x: w, y: h },
  });
  return {
    size: { x: 1280, y: 640 },
    platforms: [
      p("floor", "floor", 640, 624, 1280, 32),
      p("wall-left", "wall", 16, 320, 32, 640),
      p("wall-right", "wall", 1264, 320, 32, 640),
      p("ceiling", "wall", 640, 16, 1280, 32),
    ],
  };
}

function mkPlayer(): PlayerEntity {
  return {
    id: PlayerId("t"), characterId: "balanced", x: 400, y: 580, vx: 0, vy: 0,
    aimX: 600, aimY: 580, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 24, abilityCharge: 0, lastProcessedInputSeq: 0 as InputSeq,
  };
}

describe("movement augments", () => {
  test("double-jump: airJumps=1 grants a mid-air jump after coyote expires", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache, airJumps: 1 };
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    // Ground jump.
    let r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    player = r.player; mem = r.memory;
    expect(player.vy).toBeLessThan(0);
    // Coast airborne (jump released) long enough for coyote to expire.
    for (let i = 0; i < 12; i++) {
      r = stepPlayer(player, 0, 0, 600, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
    }
    expect(mem.groundedLastFrame).toBe(false);
    const vyBefore = player.vy;
    // Fresh jump press in the air → double-jump.
    r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    expect(r.player.vy).toBeLessThan(0);
    expect(r.player.vy).toBeLessThan(vyBefore);
    expect(r.memory.airJumpsUsed).toBe(1);
  });

  test("no double-jump without the card (airJumps=0)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache, airJumps: 0 };
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    let r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    player = r.player; mem = r.memory;
    for (let i = 0; i < 12; i++) {
      r = stepPlayer(player, 0, 0, 600, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
    }
    const vyBefore = player.vy; // falling (positive)
    r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    // No air jump: still falling, vy didn't flip strongly negative.
    expect(r.player.vy).toBeGreaterThan(vyBefore - 50);
    expect(r.memory.airJumpsUsed).toBe(0);
  });

  test("dash: dashCharges=1 bursts horizontally on the Dash bit", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    // Aim to the right (+x). Press Dash with no L/R → dash toward the aim side.
    const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 1,
    });
    expect(r.player.vx).toBeGreaterThan(600);
    expect(r.memory.dashCooldownMs).toBeGreaterThan(0);
  });

  test("dash bash: lunges toward AIM (up-right → vx>0 AND vy<0)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const player = mkPlayer(); // at (400, 580)
    const mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    // Aim up-and-right of the player → a diagonal lunge, not the old
    // horizontal-only burst.
    const r = stepPlayer(player, 0, DASH, 600, 380, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 1,
    });
    expect(r.player.vx).toBeGreaterThan(400);
    expect(r.player.vy).toBeLessThan(-400);
    expect(r.memory.dashActiveMs).toBeGreaterThan(0);
  });

  test("dash bash: straight-up lunge is possible (aim directly above)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const player = mkPlayer(); // at (400, 580)
    const mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    const r = stepPlayer(player, 0, DASH, 400, 300, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 1,
    });
    expect(Math.abs(r.player.vx)).toBeLessThan(30);
    expect(r.player.vy).toBeLessThan(-700); // near full DASH_SPEED upward
  });

  test("dash bash: gravity suspended during the burst (no vy sag)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const player = { ...mkPlayer(), y: 300 }; // airborne
    const mem = freshPlayerMovementMemory(); // groundedLastFrame = false
    const opts = { collisionCache: cache, dashCharges: 1 };
    // Air-dash horizontally (aim level, to the right).
    let r = stepPlayer(player, 0, DASH, 900, 300, mem, map.platforms, STEP, opts);
    expect(Math.abs(r.player.vy)).toBeLessThan(10); // flat lunge
    // Coast through the burst with no input — gravity must NOT accumulate vy.
    for (let i = 0; i < 4; i++) {
      r = stepPlayer(r.player, 0, 0, 900, 300, r.memory, map.platforms, STEP, opts);
    }
    expect(r.memory.dashActiveMs).toBeGreaterThan(0); // still dashing
    expect(Math.abs(r.player.vy)).toBeLessThan(10); // no sag
  });

  test("no dash without the card (dashCharges=0)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 0,
    });
    expect(Math.abs(r.player.vx)).toBeLessThan(50);
  });

  // Recovery endlag: the genre-standard anti-spam lever (Smash air-dodge
  // endlag, Rivals post-parry lockout, Brawlhalla dash lockout). A whiffed
  // slide must leave a real, punishable commitment window — sluggish
  // steering right after the burst ends.
  describe("dash recovery endlag", () => {
    test("steering accel is reduced immediately after the burst ends", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      const opts = { collisionCache: cache, dashCharges: 1 };
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      // Ground dash toward +x, then coast (no input) until the 210ms burst
      // fully elapses — recovery should now be active.
      let r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
      let ticks = 0;
      while (mem.dashActiveMs > 0 && ticks < 30) {
        r = stepPlayer(player, 0, 0, 900, 580, mem, map.platforms, STEP, opts);
        player = r.player; mem = r.memory;
        ticks += 1;
      }
      expect(mem.dashActiveMs).toBe(0);
      expect(mem.dashRecoveryMs).toBeGreaterThan(0);

      // Now hold LEFT (reverse of the dash direction) for one tick — a bare
      // steering reversal is the clearest signal of accel being throttled.
      const LEFT = 1 << 0;
      const recoveringVx = player.vx;
      r = stepPlayer(player, 0, LEFT, 900, 580, mem, map.platforms, STEP, opts);
      const deltaRecovering = Math.abs(r.player.vx - recoveringVx);

      // Compare against the SAME reversal once recovery has fully elapsed.
      let freeMem = { ...mem, dashRecoveryMs: 0 };
      const freePlayer = { ...player };
      const rFree = stepPlayer(freePlayer, 0, LEFT, 900, 580, freeMem, map.platforms, STEP, opts);
      const deltaFree = Math.abs(rFree.player.vx - freePlayer.vx);

      expect(deltaRecovering).toBeLessThan(deltaFree);
      // The mult is 0.4 — recovering steering should land close to that ratio.
      expect(deltaRecovering / deltaFree).toBeLessThan(0.6);
    });

    test("recovery expires and full steering returns", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      const opts = { collisionCache: cache, dashCharges: 1 };
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      let r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
      // Coast through burst (210ms) + recovery (200ms) + margin.
      for (let i = 0; i < 30; i++) {
        r = stepPlayer(player, 0, 0, 900, 580, mem, map.platforms, STEP, opts);
        player = r.player; mem = r.memory;
      }
      expect(mem.dashRecoveryMs).toBe(0);
    });

    test("a landed bash also opens recovery (World.ts sets it directly)", () => {
      // Bash-stop is wired in World.ts, not stepPlayer — this just locks in
      // that the memory field exists and defaults sanely so that wiring
      // compiles against the right shape (full bash-path coverage lives in
      // dashBash.test.ts).
      const mem = freshPlayerMovementMemory();
      expect(mem.dashRecoveryMs).toBe(0);
    });
  });

  // Quick Parry (repurposed): dashCooldownMultiplier shortens the cycle, but
  // a HARD floor (burst 210ms + recovery 200ms = 410ms) means stacking can
  // never squeeze the recovery-endlag punish window out of existence — the
  // Risk of Rain stacking lesson, enforced structurally rather than by card
  // balance alone.
  //
  // DASH_COOLDOWN_MS tripled 520ms -> 3000ms (2026-07-15). That moved the
  // floor out of reach of any REAL card stack: Quick Parry is maxStacks:2
  // (0.86^2 ~= 0.7396), and 3000*0.7396 ~= 2219ms is nowhere near the
  // 410ms floor (it was 384.6ms — below the floor — at the old 520ms
  // base). The floor-clamp code path itself is still covered below via an
  // explicitly synthetic multiplier, since real gameplay can no longer
  // reach it.
  describe("dash cooldown multiplier (Quick Parry) + hard floor", () => {
    test("a single stack (0.86x) shortens the cooldown, still above the floor", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
        collisionCache: cache, dashCharges: 1, dashCooldownMultiplier: 0.86,
      });
      // DASH_COOLDOWN_MS * 0.86 = 2580ms — above the 410ms floor, so the
      // multiplier actually applies (not just clamped).
      expect(r.memory.dashCooldownMs).toBeCloseTo(DASH_COOLDOWN_MS * 0.86, 0);
    });

    test("two real Quick Parry stacks (0.86^2) no longer reach the floor at the new base cooldown", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      const twoStacks = 0.86 * 0.86; // 0.7396 -> the real maxStacks:2 ceiling
      const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
        collisionCache: cache, dashCharges: 1, dashCooldownMultiplier: twoStacks,
      });
      // Multiplier applies fully now (no floor clamp) — a behavior change
      // from the old 520ms base, where this exact stack DID hit the floor.
      expect(r.memory.dashCooldownMs).toBeCloseTo(DASH_COOLDOWN_MS * twoStacks, 0);
    });

    test("even an absurd multiplier can't shrink the cycle below burst+recovery", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
        collisionCache: cache, dashCharges: 1, dashCooldownMultiplier: 0.01,
      });
      expect(r.memory.dashCooldownMs).toBe(410);
    });
  });

  // "Fair and well tested" pass (2026-07-13): the multiplier/floor math above
  // was already covered, but nothing exercised the actual base cycle a
  // no-card-stack player lives with tick-by-tick, and nothing proved a
  // player physically CANNOT out-dash the cooldown by mashing the button —
  // both real fairness properties, not just the math backing them.
  describe("dash cooldown — base cycle + spam resistance", () => {
    test("base cooldown is exactly DASH_COOLDOWN_MS with no card stack", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      const player = mkPlayer();
      const mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
        collisionCache: cache, dashCharges: 1,
      });
      expect(r.memory.dashCooldownMs).toBe(DASH_COOLDOWN_MS);
    });

    test("a second dash attempt (release + re-press) is refused while cooldown > 0, even mid-air with charges to spare", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      const opts = { collisionCache: cache, dashCharges: 3 }; // charges are plentiful; only cooldown should gate
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      // First dash.
      let r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
      expect(mem.dashCooldownMs).toBeGreaterThan(0);
      // Release the button for a tick (so a re-press is a genuine rising
      // edge, not just held-key suppression), then try again almost
      // immediately — cooldown is nowhere near elapsed.
      r = stepPlayer(player, DASH, 0, 900, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
      const activeBeforeRetry = mem.dashActiveMs;
      const cooldownBeforeRetry = mem.dashCooldownMs;
      r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      // Refused: a granted dash always sets dashActiveMs to the FULL burst
      // window (210) and dashCooldownMs to a fresh cycle (520, or shorter
      // under a multiplier) — neither happens here. Both fields instead
      // keep monotonically decreasing exactly as if this tick's input never
      // mattered, which is the actual fairness property: the game state
      // this tick is indistinguishable from one where Dash was never
      // pressed at all.
      expect(r.memory.dashActiveMs).toBeLessThanOrEqual(activeBeforeRetry);
      expect(r.memory.dashCooldownMs).toBeLessThan(cooldownBeforeRetry);
    });

    test("dash is allowed again the instant cooldown reaches exactly 0, not before", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      const opts = { collisionCache: cache, dashCharges: 2 };
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;
      let r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
      expect(mem.dashCooldownMs).toBe(DASH_COOLDOWN_MS);

      // Release the dash bit and coast (grounded, no other input) until the
      // cooldown ticks down to exactly 0 — release first is not itself
      // dashing, it's just returning to a neutral state a real player would
      // pass through between presses.
      let ticks = 0;
      while (mem.dashCooldownMs > 0 && ticks < 200) {
        r = stepPlayer(player, DASH, 0, 900, 580, mem, map.platforms, STEP, opts);
        player = r.player; mem = r.memory;
        ticks += 1;
      }
      expect(mem.dashCooldownMs).toBe(0);

      // One more tick with the dash bit freshly pressed (rising edge from
      // the neutral tick above) — this MUST be allowed now.
      r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, opts);
      expect(r.memory.dashActiveMs).toBeGreaterThan(0);
      expect(r.memory.dashCooldownMs).toBe(DASH_COOLDOWN_MS);
    });

    test("mashing the dash bit every tick for 3 real seconds cannot beat the cooldown — bursts land at the cooldown's own cadence, not once per press", () => {
      const map = miniMap();
      const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
      // Deliberately generous charges — if spam were possible, a generous
      // charge count would expose it; a stingy count would hide the bug
      // behind "ran out of charges" instead.
      const opts = { collisionCache: cache, dashCharges: 999 };
      let player = mkPlayer();
      let mem = freshPlayerMovementMemory();
      mem.groundedLastFrame = true;

      let burstsFired = 0;
      let wasActive = false;
      const totalTicks = Math.round(3000 / STEP); // ~3 real seconds
      for (let i = 0; i < totalTicks; i++) {
        // Toggle the Dash bit on/off every tick — the fastest a human
        // mashing a button could conceivably press it, and faster than any
        // legitimate play pattern.
        const keys = i % 2 === 0 ? DASH : 0;
        const r = stepPlayer(player, i % 2 === 0 ? 0 : DASH, keys, 900, 580, mem, map.platforms, STEP, opts);
        player = r.player;
        mem = r.memory;
        const isActive = mem.dashActiveMs > 0;
        if (isActive && !wasActive) burstsFired += 1;
        wasActive = isActive;
      }

      // Over a 3000ms window at DASH_COOLDOWN_MS's now-3000ms cadence, the
      // theoretical ceiling is floor(3000/DASH_COOLDOWN_MS)+1 = 2 bursts
      // (one at t≈0, maybe one more right at the window's edge). Keeping
      // the assertion at <=6 rather than tightening to <=2 — it's a looser
      // bound now than the cadence strictly requires, but still nowhere
      // near the ~750 rising edges the toggle pattern offers up, and it
      // stays correct regardless of future DASH_COOLDOWN_MS retuning
      // without needing to recompute an exact edge-of-window burst count.
      expect(burstsFired).toBeLessThanOrEqual(6);
      expect(burstsFired).toBeGreaterThan(0); // sanity: dashing is still possible at all
    });
  });
});
