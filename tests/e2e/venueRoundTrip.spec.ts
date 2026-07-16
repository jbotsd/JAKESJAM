// The venue round trip (venue-sprint2-goal S2.F.1/S2.F.2), one unbroken
// session with NO page reload:
//
//   splash-less ?world=1 entry → VENUE LOBBY (HangoutScene mode:"venue")
//   → walk right to the bell totem → queued (starter draft overlay appears)
//   → pick a card → wait for the bell (arena countdown edge)
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

  // 2. Walk to the bell (x=2250 on vessel-nexus). Spawns come from the
  //    map's lattice picked FARTHEST from occupied players, so we can land
  //    anywhere — steer toward the totem by reading our own render-state x
  //    each step. Queue confirmation = the starter draft overlay showing
  //    (the venue-draft frame is pushed the moment the totem toggles us in).
  await page.waitForTimeout(2000); // land + settle on the floor
  const BELL_X = 2250;
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
  let queued = false;
  let prevX: number | null = null;
  for (let i = 0; i < 80 && !queued; i += 1) {
    const x = await myX();
    if (x === null) {
      await page.waitForTimeout(500);
      continue;
    }
    const stalled = prevX !== null && Math.abs(x - prevX) < 12;
    prevX = x;
    const key = x < BELL_X ? "d" : "a";
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
    if (Math.abs(x - BELL_X) < 60) await page.waitForTimeout(600); // linger in the ring
    queued = await overlayVisible();
  }
  expect(queued).toBe(true);

  // 3. Pick the middle card.
  const plates = page.locator("[data-card-draft] [data-card-plate]");
  await expect(plates).toHaveCount(3);
  const pickedId = await plates.nth(1).getAttribute("data-card-plate");
  await plates.nth(1).click();

  // 4. The bell: admission hands off to the arena scene (may take a full
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

  // 5. Leave via the pause menu — the arena exit must return to the VENUE.
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

  // 6. Still the same page — the whole loop ran without a reload.
  expect(
    await page.evaluate(
      () => (window as unknown as { __e2e_no_reload__?: boolean }).__e2e_no_reload__ ?? false,
    ),
  ).toBe(true);
});
