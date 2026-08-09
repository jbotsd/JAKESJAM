// The E2 flip's last piece of evidence: on a host running ZIG AUTHORITY, a
// real browser client pressing Right moves THAT client's player.
//
// Why this spec exists rather than trusting the unit test: the input
// misrouting fixed in 5ad59c5 was invisible to every suite AND to a 2 h
// bot soak, because bots submit an input every tick — the input subset
// always equalled the full roster, so the buggy subset-relative index
// happened to be correct. Only a roster where someone lacks a frame on a
// tick exposes it, which is what real play looks like. So the flip gets
// checked the way it will actually be used.
//
// Needs a host on Zig authority (never the live one):
//   PORT=8388 OPS_PORT=8389 WORLD_BOTS=2 USE_WASM_STEP_WORLD=1 \
//     SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8388 bunx playwright test wasmAuthorityInput

import { test, expect } from "@playwright/test";

type ProbePlayer = { id: string; x: number; y: number; alive: boolean };

declare global {
  interface Window {
    __simPlayers?: () => ProbePlayer[] | null;
    __localPlayerId?: () => string | null;
    __simHasState?: () => boolean;
  }
}

const GAME_CANVAS = "canvas:not(.ident-shader)";

async function asReturningVisitor(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jakesjam.identSeen", "1");
      localStorage.setItem("jakesjam.playerName", "E2EPROBE");
    } catch {
      /* hardened browser */
    }
  });
}

async function localPlayer(
  page: import("@playwright/test").Page,
): Promise<ProbePlayer | null> {
  return await page.evaluate(() => {
    const id = window.__localPlayerId?.() ?? null;
    const players = window.__simPlayers?.() ?? null;
    if (!id || !players) return null;
    return players.find((p) => p.id === id) ?? null;
  });
}

test.describe("Zig authority — a client's input moves that client (gospel E2)", () => {
  test.setTimeout(180_000);

  test("holding D moves the local player, not a neighbour", async ({ page }) => {
    await asReturningVisitor(page);
    // `?venue=1`, deliberately NOT `?fight`: the fast lane queues you, and
    // the bell then admits you to the ARENA mid-measurement — a different
    // map with different spawn coordinates, which showed up as a -1800 px
    // "move" and told us nothing. The venue lobby is stepped by the same
    // Zig authority (the hangout pin was lifted in E1d), so measuring here
    // tests the same path with nothing to yank the player out of it.
    await page.goto("/?venue=1&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 60_000 });

    // Wait until a scene owns sim state AND we can see ourselves in it.
    await expect
      .poll(async () => (await localPlayer(page)) !== null, { timeout: 180_000, intervals: [1000] })
      .toBe(true);

    const before = await localPlayer(page);
    expect(before).not.toBeNull();

    // Hold Right. The binding is WASD, not arrows — pressing ArrowRight
    // cost this spec a run reporting moved=0, which looked exactly like the
    // routing bug it exists to rule out. Keyboard goes through the real
    // input path, no probe shortcut, so this is what a player does.
    await page.locator(GAME_CANVAS).click({ position: { x: 200, y: 200 } });
    await page.keyboard.down("d");
    await page.waitForTimeout(2500);
    await page.keyboard.up("d");
    await page.waitForTimeout(300);

    const after = await localPlayer(page);
    expect(after).not.toBeNull();

    const moved = (after!.x ?? 0) - (before!.x ?? 0);
    // Rightward, and by more than jitter. Before the routing fix this
    // would have been ~0 while some other entity did the moving.
    expect(moved).toBeGreaterThan(20);
  });
});
