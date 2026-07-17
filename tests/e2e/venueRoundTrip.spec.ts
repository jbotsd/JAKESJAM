// The venue round trip (venue-sprint2-goal S2.F.1/S2.F.2; stations
// separated 2026-07-17 per Jake — "seperate the card selector test room
// thing with the bell queue"), one unbroken session with NO page reload:
//
//   splash-less ?world=1 entry → VENUE LOBBY (HangoutScene mode:"venue")
//   → walk to the LOADOUT STATION (card selector opens on arrival)
//   → pick a card (overlay closes; pick armed for admission)
//   → walk to the bell totem → queued (clean countdown — NO draft overlay)
//   → wait for the bell (arena countdown edge)
//   → ADMITTED → OnlineMatchScene (world) → pause → Leave
//   → BACK in the venue lobby.
//
// Run against the game server origin (it serves client/dist):
//   E2E_BASE_URL=http://localhost:8088 bunx playwright test venueRoundTrip
//
// The bell can be a full round away (~110s worst case) — generous timeout.

import { test, expect } from "@playwright/test";
import { attachConsole } from "./visualHarness";

type GameWindow = {
  __jakesjam_game__?: {
    scene: { isActive(key: string): boolean };
  };
};

function sceneActive(page: import("@playwright/test").Page, key: string) {
  return page.evaluate(
    (k) => (window as unknown as GameWindow).__jakesjam_game__?.scene.isActive(k) ?? false,
    key,
  );
}

test("venue round trip: lobby → queue → bell → arena → leave → lobby, no reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  attachConsole(page);
  await page.addInitScript(() => {
    localStorage.setItem("jakesjam.playerId", "player_e2e_roundtrip");
    localStorage.setItem("jakesjam.playerName", "ROUNDTRIP");
    localStorage.setItem("jakesjam-ftue-first-draft-shown", "1");
    sessionStorage.setItem("jakesjam.sessionSuffix", "e2e");
  });

  const loadStartedAt = Date.now();
  await page.goto("/?world=1&gate=off");
  // The bare `canvas` harness helper now matches the ident-shader canvas
  // (aria-hidden) first — wait for the GAME canvas specifically.
  await page.waitForSelector("#game-root canvas", { timeout: 20_000 });

  // 1. The flow flip: ?world=1 lands in the VENUE LOBBY, not the arena.
  await page.waitForFunction(
    () =>
      (window as unknown as GameWindow).__jakesjam_game__?.scene.isActive("HangoutScene") ??
      false,
    undefined,
    { timeout: 30_000 },
  );
  expect(await sceneActive(page, "OnlineMatchScene")).toBe(false);
  // S2.A.3 (deferred to S2.F when this became the real flow): time-to-play
  // = load → standing in the walkable lobby.
  console.log(`time-to-play (load → venue lobby scene): ${Date.now() - loadStartedAt}ms`);

  // Reload sentinel: set AFTER load (addInitScript would re-arm it on a
  // reload; a plain evaluate marker vanishes if the page ever navigates).
  await page.evaluate(() => {
    (window as unknown as { __e2e_no_reload__?: boolean }).__e2e_no_reload__ = true;
  });

  // Steering helper: spawns come from the map's lattice picked FARTHEST
  // from occupied players, so we can land anywhere — steer toward a target
  // x by reading our own render-state x each step, until `done()` is true.
  await page.waitForTimeout(2000); // land + settle on the floor
  const myX = () =>
    page.evaluate(() => {
      type Loop = { getRenderState(): { players: Record<string, { x: number }> } | null };
      type Scene = { loop: Loop | null; localPlayerId: string };
      const g = (window as unknown as { __jakesjam_game__?: { scene: { getScene(k: string): unknown } } })
        .__jakesjam_game__;
      const scene = g?.scene.getScene("HangoutScene") as Scene | undefined;
      const state = scene?.loop?.getRenderState();
      return state?.players[scene!.localPlayerId]?.x ?? null;
    });
  const overlayVisible = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-card-draft]") as HTMLElement | null;
      return el !== null && el.style.display !== "none";
    });
  const localQueued = () =>
    page.evaluate(() => {
      type Scene = { venueStatus: { queued: string[] } | null; localPlayerId: string };
      const g = (window as unknown as { __jakesjam_game__?: { scene: { getScene(k: string): unknown } } })
        .__jakesjam_game__;
      const scene = g?.scene.getScene("HangoutScene") as Scene | undefined;
      return scene?.venueStatus?.queued.includes(scene.localPlayerId) ?? false;
    });
  const walkUntil = async (targetX: number, done: () => Promise<boolean>): Promise<boolean> => {
    let prevX: number | null = null;
    for (let i = 0; i < 80; i += 1) {
      if (await done()) return true;
      const x = await myX();
      if (x === null) {
        await page.waitForTimeout(500);
        continue;
      }
      const stalled = prevX !== null && Math.abs(x - prevX) < 12;
      prevX = x;
      const key = x < targetX ? "d" : "a";
      await page.keyboard.down(key);
      if (stalled) {
        // Cover pylons block the ground path — jump WHILE holding the
        // direction so the arc actually clears the obstacle. Held, not
        // tapped: a press() can fall between input-sampling frames.
        await page.keyboard.down("w");
        await page.waitForTimeout(220);
        await page.keyboard.up("w");
        await page.waitForTimeout(280);
        await page.keyboard.down("w"); // wall-hop assist if still pinned
        await page.waitForTimeout(220);
        await page.keyboard.up("w");
      }
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      if (Math.abs(x - targetX) < 60) await page.waitForTimeout(600); // linger in the ring
    }
    return done();
  };

  // 2. Walk to the LOADOUT STATION (x=750 on vessel-nexus, by the practice
  //    dummies). Arrival opens the card selector — the walk-up station that
  //    replaced the modal-on-queue (2026-07-17 separation).
  const LOADOUT_X = 750;
  const BELL_X = 2250;
  // The station only opens on a real WALK-IN (modal-on-spawn is
  // structurally prevented client-side) — if the lattice dropped us inside
  // the ring, step out first so the entry edge exists.
  {
    const x0 = await myX();
    if (x0 !== null && Math.abs(x0 - LOADOUT_X) < 160) {
      await walkUntil(LOADOUT_X + 500, async () => {
        const x = await myX();
        return x !== null && x > LOADOUT_X + 300;
      });
    }
  }
  expect(await walkUntil(LOADOUT_X, overlayVisible)).toBe(true);
  // Not queued — the station must never touch the bell queue.
  expect(await localQueued()).toBe(false);

  // 3. Pick the middle card. Overlay closes on pick; the pick is armed
  //    server-side for the next admission.
  const plates = page.locator("[data-card-draft] [data-card-plate]");
  await expect(plates).toHaveCount(3);
  const pickedId = await plates.nth(1).getAttribute("data-card-plate");
  await plates.nth(1).click();

  // 4. Walk to the bell and queue — a clean countdown, NO draft overlay.
  expect(await walkUntil(BELL_X, localQueued)).toBe(true);
  expect(await overlayVisible()).toBe(false);

  // 5. The bell: admission hands off to the arena scene (may take a full
  //    round). No reload — the same JS heap crosses the membrane.
  await page.waitForFunction(
    () =>
      (window as unknown as GameWindow).__jakesjam_game__?.scene.isActive("OnlineMatchScene") ??
      false,
    undefined,
    { timeout: 180_000 },
  );
  expect(await sceneActive(page, "HangoutScene")).toBe(false);
  expect(
    await page.evaluate(
      () => (window as unknown as { __e2e_no_reload__?: boolean }).__e2e_no_reload__ ?? false,
    ),
  ).toBe(true);
  console.log(`admitted to arena carrying starter pick: ${pickedId}`);

  // Let the arena run a moment (spawned, snapshots flowing).
  await page.waitForTimeout(4000);

  // 6. Leave via the pause menu — the arena exit must return to the VENUE.
  await page.click("[data-match-menu]");
  await page.click("[data-pause-leave]");
  await page.click("[data-pause-leave-confirm-yes]");

  await page.waitForFunction(
    () =>
      (window as unknown as GameWindow).__jakesjam_game__?.scene.isActive("HangoutScene") ??
      false,
    undefined,
    { timeout: 30_000 },
  );
  expect(await sceneActive(page, "OnlineMatchScene")).toBe(false);

  // 7. Still the same page — the whole loop ran without a reload.
  expect(
    await page.evaluate(
      () => (window as unknown as { __e2e_no_reload__?: boolean }).__e2e_no_reload__ ?? false,
    ),
  ).toBe(true);
});
