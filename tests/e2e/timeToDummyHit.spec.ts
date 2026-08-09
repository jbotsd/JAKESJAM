// venue-goal Pillar 2.5 — "load → dummy-hit-possible < 8 s on the venue
// path (scripted input; generous CI variance margin, asserted <10s)".
//
// The Evidence Ledger has this row half-verified and honest about it: the
// load→lobby-scene half is measured at 1770 ms, but "re-reading the spec
// 2026-07-26 finds no assertion anywhere for load→dummy-hit-possible <8s/10s
// — no dummy/hit timing metric is captured at all. Left OPEN rather than
// claimed PASSED on a metric that was never measured."
//
// This measures it. A hit is only observable as a destructible's health
// falling, so it needs the `__simDestructibles` probe added alongside this
// spec — there was no way to see a hit land from outside before.
//
// What it deliberately does NOT do: fake the input. It walks with the real
// movement keys and fires with the real fire input, because the claim is
// about what a VISITOR can do, not what the sim can be driven to do.
//
//   PORT=8388 OPS_PORT=8389 WORLD_BOTS=2 \
//     SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8388 bunx playwright test timeToDummyHit

import { test, expect } from "@playwright/test";

type ProbeDestructible = { id: string; kind: string; x: number; y: number; health: number };
type ProbePlayer = { id: string; x: number; y: number };

declare global {
  interface Window {
    __simDestructibles?: () => ProbeDestructible[] | null;
    __simPlayers?: () => ProbePlayer[] | null;
    __localPlayerId?: () => string | null;
  }
}

const GAME_CANVAS = "canvas:not(.ident-shader)";
/** The bar is 8 s; the ledger's own wording allows a CI-variance margin and
 *  asserts 10 s. Kept exactly as written rather than quietly loosened. */
const DUMMY_HIT_BUDGET_MS = 10_000;

async function asReturningVisitor(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jakesjam.identSeen", "1");
      localStorage.setItem("jakesjam.playerName", "TIMER");
    } catch {
      /* hardened browser */
    }
  });
}

/** Nearest practice dummy to the local player, with the player's own x. */
async function nearestDummy(page: import("@playwright/test").Page): Promise<{
  dummyX: number;
  dummyId: string;
  meX: number;
  health: number;
} | null> {
  return await page.evaluate(() => {
    const id = window.__localPlayerId?.() ?? null;
    const players = window.__simPlayers?.() ?? null;
    const destructibles = window.__simDestructibles?.() ?? null;
    if (!id || !players || !destructibles || destructibles.length === 0) return null;
    const me = players.find((p) => p.id === id);
    if (!me) return null;
    let best = destructibles[0]!;
    for (const d of destructibles) {
      if (Math.abs(d.x - me.x) < Math.abs(best.x - me.x)) best = d;
    }
    return { dummyX: best.x, dummyId: best.id, meX: me.x, health: best.health };
  });
}

test.describe("venue-goal 2.5 — time to first dummy hit", () => {
  test.setTimeout(120_000);

  // EXPECTED-FAIL as of 2026-08-09. Not flaky, and not a harness defect —
  // it measures something real that does not work. `test.fail` is
  // deliberate: the run stays green while the bug exists, and the moment
  // someone fixes it this spec goes RED to say so. A `skip` would go quiet
  // forever instead.
  //
  // Measured by a SECOND harness driving the same probe, so that a bug in
  // one would not quietly confirm the other:
  //   - the visitor IS in the venue — /venue/summary reports
  //     lobby.present=1 for the whole session (an earlier present=0 was an
  //     artefact of sampling after the browser had closed);
  //   - the shots ARE firing — fireCooldownMs is non-zero on 133/162
  //     samples while fire is held;
  //   - range is not the problem — the player closes to 18px horizontally
  //     and both sit on the same floor (player y=1036, dummy y=1042);
  //   - the weapon is TRUE hitscan (starter-pistol, delivery "raycast",
  //     880px trace), so maxProjectiles=0 is expected, and ammo=0 is
  //     irrelevant: weapon.ts:623 states ammo gates nothing;
  //   - this is SUPPOSED to work — World.ts:3018, "Destructibles remain
  //     hittable" in hangout mode.
  //
  // NARROWED 2026-08-09, later the same evening. An earlier version of this
  // comment blamed the SERVER lobby not being in hangout mode. That was
  // wrong, and is recorded here rather than quietly deleted:
  //   - the server DOES create the lobby as hangout — venueHost.ts:429
  //     passes mode:"hangout" through matchHost.ts:464 into World.create;
  //   - the "seven missing dummies" was interest culling, not loss.
  //     InterestGrid.ts:117 culls destructibles by proximity and
  //     matchHost's respawnDestructibles() rebuilds all eight, so a client
  //     seeing one nearby dummy is correct behaviour;
  //   - the SIM is not at fault either. hangoutDestructibleTargets.test.ts
  //     now covers the hitscan path that nothing covered before: the
  //     starter pistol damages a dummy in hangout mode, and a dummy behind
  //     the shooter correctly stays untouched.
  //
  // So the break is at the INTEGRATION level, and the surviving lead is the
  // CLIENT-side world: __simPhase reports "round-over" continuously in the
  // venue, where hangout mode should pin it to "fighting" (World.ts:1676)
  // and the round machine should never run at all. Worth checking first
  // whether the client gates sending fire on its local phase, and whether
  // the mode reaches the client's createRuntime (clientLoop.ts:956 does
  // accept one) for the LOBBY connection specifically.
  test.fail();
  test("a visitor can damage a practice dummy inside the budget", async ({ page }) => {
    await asReturningVisitor(page);
    const t0 = Date.now();
    // The bare URL is the venue since Doors 1.1 — measure the path a real
    // visitor takes, not a deep link.
    await page.goto("/?gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 60_000 });

    // Wait for sim state AND a dummy to exist.
    await expect
      .poll(async () => (await nearestDummy(page)) !== null, {
        timeout: 60_000,
        intervals: [250],
      })
      .toBe(true);

    const start = (await nearestDummy(page))!;
    // Compare CONSECUTIVE samples, not against a baseline captured once.
    // The lobby respawns destructibles, and a respawned dummy gets a fresh
    // numeric entity id (the map's "dummy_0" string never survives
    // World.create — see venueLobbyMap's own comment), so an id-keyed
    // baseline silently stops matching and a real 60 -> 48 hit reads as
    // "no damage". That is exactly what the first run of this spec reported.
    let prevHealth = new Map<string, number>();
    for (const d of (await page.evaluate(() => window.__simDestructibles?.() ?? [])) ?? []) {
      prevHealth.set(d.id, d.health);
    }

    // Face and walk toward the nearest dummy with the REAL keys (WASD), and
    // hold fire. Firing while closing means the shot lands the moment range
    // allows, which is what "hit-possible" means.
    await page.locator(GAME_CANVAS).click({ position: { x: 400, y: 300 } });
    const box = (await page.locator(GAME_CANVAS).boundingBox())!;
    await page.mouse.down(); // hold fire for the whole approach

    // STEER each sample instead of committing to one direction. A blind
    // one-way walk measured 9120 ms, then NEVER, then 7024 ms across three
    // runs — it was overshooting the practice band and walking to the far
    // wall. A visitor turns around; so does this.
    let heldKey: "a" | "d" | null = null;
    const steer = async (meX: number, dummyX: number): Promise<void> => {
      const want: "a" | "d" = dummyX > meX ? "d" : "a";
      if (heldKey === want) return;
      if (heldKey) await page.keyboard.up(heldKey);
      await page.keyboard.down(want);
      heldKey = want;
      // Aim to the side we are walking, slightly below the horizon so the
      // shot meets a ground-standing dummy.
      await page.mouse.move(
        box.x + (want === "d" ? box.width * 0.78 : box.width * 0.22),
        box.y + box.height * 0.56,
      );
    };
    await steer(start.meX, start.dummyX);

    let hitAtMs: number | null = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && hitAtMs === null) {
      const now = (await page.evaluate(() => window.__simDestructibles?.() ?? [])) ?? [];
      const next = new Map<string, number>();
      for (const d of now) {
        next.set(d.id, d.health);
        const before = prevHealth.get(d.id);
        if (before !== undefined && d.health < before) {
          hitAtMs = Date.now() - t0;
        }
      }
      prevHealth = next;
      if (hitAtMs === null) {
        const d = await nearestDummy(page);
        if (d) await steer(d.meX, d.dummyX);
        await page.waitForTimeout(120);
      }
    }

    await page.mouse.up();
    if (heldKey) await page.keyboard.up(heldKey);

    // Report the measurement whether it passes or fails — the ledger wants a
    // NUMBER, and a bare pass/fail would leave the row still unmeasured.
    console.log(
      `[venue-2.5] load -> first dummy hit: ${hitAtMs ?? "NEVER"} ms` +
        ` (spawn was ${Math.abs(start.dummyX - start.meX).toFixed(0)}px from the nearest dummy)`,
    );
    expect(hitAtMs, "no dummy took damage — hit path or reach may be broken").not.toBeNull();
    expect(hitAtMs!).toBeLessThan(DUMMY_HIT_BUDGET_MS);
  });
});
