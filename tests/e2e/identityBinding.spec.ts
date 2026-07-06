// Identity-binding regression gate. Prompted by a live user report ("I don't
// think I'm even controlling the right character") that traced to a
// long-running world's connection state degrading (see matchHostLiveness
// fix) — but a MISBOUND local-player/camera/rig identity would be a distinct,
// more severe bug class the sim-state-only tests elsewhere don't cover: they
// query `state.players[id]` abstractly, never verifying that `id` is actually
// the entity responding to THIS page's own input, nor that the renderer's own
// rig-truth (window.__rigDebug — screen position, not sim position) agrees.
//
// This is the one test file allowed to depend on window.__localPlayerId /
// __rigDebug specifically for that reason: it's the only guard that would
// catch "the camera/HUD/rig is bound to someone else's entity" even though
// every other number in the sim looks internally consistent.

import { test, expect } from "@playwright/test";

test("local player id is the entity that actually moves in response to my own input", async ({ page }) => {
  test.setTimeout(30_000);
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e}`));

  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.locator("canvas").first().click({ position: { x: 640, y: 400 } });
  await page.waitForTimeout(200);

  const localId: string | null = await page.evaluate(() => (window as any).__localPlayerId?.() ?? null);
  expect(localId, "window.__localPlayerId did not resolve").toBeTruthy();

  const before = await page.evaluate((id) => {
    const ps = (window as any).__simPlayers?.() ?? [];
    return Object.fromEntries(ps.map((p: any) => [p.id, p.x]));
  }, localId);

  await page.keyboard.down("d");
  await page.waitForTimeout(1000);
  await page.keyboard.up("d");

  const after = await page.evaluate((id) => {
    const ps = (window as any).__simPlayers?.() ?? [];
    return Object.fromEntries(ps.map((p: any) => [p.id, p.x]));
  }, localId);

  // The entity whose id matches window.__localPlayerId must be the one that
  // moved — not merely "some entity moved while I held a key."
  const localDelta = (after[localId as string] ?? 0) - (before[localId as string] ?? 0);
  expect(localDelta, `local id ${localId} did not move under my own input (before=${before[localId as string]}, after=${after[localId as string]})`).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});

test("the renderer's own rig-truth (screen position) agrees with the sim's local-player entity", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20000 });
  await page.waitForTimeout(2500);

  const localId: string | null = await page.evaluate(() => (window as any).__localPlayerId?.() ?? null);
  expect(localId).toBeTruthy();

  const check = await page.evaluate((id) => {
    const ps = (window as any).__simPlayers?.() ?? [];
    const rigs = (window as any).__rigDebug?.() ?? [];
    const sim = ps.find((p: any) => p.id === id);
    const rig = rigs.find((r: any) => r.pid === id);
    return { sim, rig };
  }, localId);

  expect(check.sim, `no sim entity for local id ${localId}`).toBeTruthy();
  expect(check.rig, `no rendered rig for local id ${localId} — window.__rigDebug never saw it`).toBeTruthy();
  expect(check.rig.visible, "local player's own rig is not visible on screen").toBe(true);
  // Rig x/y is the RENDERED (interpolated) position; stateX/Y is the raw sim
  // position that same rig is tracking. They should be close (interpolation
  // lag, not a different entity's coordinates entirely).
  expect(Math.abs(check.rig.stateX - check.sim.x), "rig's tracked sim x diverges from the actual sim state — bound to stale/wrong data").toBeLessThan(5);
});
