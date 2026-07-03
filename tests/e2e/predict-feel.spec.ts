// Predicted-movement evidence: holds D for 3s in ?world=1 (full Zig
// + OnlineMatchScene) and captures video. The first frame should show
// the player at spawn-X; the final frame should show them shifted
// noticeably right. If the prediction wiring is broken (the bug we
// just fixed), the player only moves at snapshot-rate (~30Hz) and the
// rig X delta is small/jagged. With prediction wired the rig moves
// every 16.67ms.

import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachConsole, waitForCanvas } from "./visualHarness";

test("predict-feel: hold D in world mode for 3s — player shifts right", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  // Pin the player id so the sim-state probe can identify OUR player even
  // when other players (bots, spectators) are in the world.
  await page.addInitScript(() => {
    localStorage.setItem("jakesjam.playerId", "player_predictfeel");
    sessionStorage.setItem("jakesjam.sessionSuffix", "e2e");
  });
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);

  // Wait for a live round — joining during round-over means a dead
  // (hidden) rig and a guaranteed false negative. Uses the __simPhase
  // debug hook (wasmStateProbe).
  await page.waitForFunction(
    () => (window as unknown as { __simPhase?: () => string | null }).__simPhase?.() === "fighting",
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);

  // Sample player rig color (mint cyan #50e3c2-ish) as a coarse
  // x-position locator. Scan a horizontal band at the typical foot Y.
  const sampleX = async (label: string): Promise<number> => {
    return await page.evaluate((bandY) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const w = canvas.width;
      const h = canvas.height;
      const y = Math.max(0, Math.min(h - 1, Math.floor(bandY * h)));
      const pixels = new Uint8Array(w * 4);
      if (ctx) {
        // WebGL: read a single row. Y is bottom-up.
        (ctx as WebGLRenderingContext).readPixels(
          0,
          h - 1 - y,
          w,
          1,
          (ctx as WebGLRenderingContext).RGBA,
          (ctx as WebGLRenderingContext).UNSIGNED_BYTE,
          pixels,
        );
      }
      // Find leftmost cyan-ish pixel: green > red and blue > 150.
      for (let x = 0; x < w; x++) {
        const r = pixels[x * 4]!;
        const g = pixels[x * 4 + 1]!;
        const b = pixels[x * 4 + 2]!;
        if (g > r + 30 && b > 130 && g > 130) return x;
      }
      return -1;
    }, 0.78); // ~78% down — just above floor
  };

  // Exact position from the render state (predicted + smoothed — the same
  // signal the rig draws from) via the __simPlayers debug hook. The pixel
  // scan stays as SECONDARY evidence: it can miss when the scan row only
  // crosses the rig's dark-teal legs (b<130), so it must not gate the test.
  const simX = async (): Promise<number> => {
    return await page.evaluate(() => {
      const ps = (window as unknown as {
        __simPlayers?: () => { id: string; x: number; alive: boolean }[] | null;
      }).__simPlayers?.();
      const me = ps?.find((p) => p.id.includes("predictfeel"));
      return me ? me.x : -1;
    });
  };

  // Renderer truth: the RIG must actually be drawn moving, not just the
  // sim state. __rigDebug reports each rig's last-drawn position.
  const rigX = async (): Promise<number> => {
    return await page.evaluate(() => {
      const rows = (window as unknown as {
        __rigDebug?: () => { pid: string; visible: boolean; x: number }[] | null;
      }).__rigDebug?.();
      const me = rows?.find((r) => r.pid.includes("predictfeel"));
      return me && me.visible ? me.x : -1;
    });
  };

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  const xBefore = await simX();
  const rigBefore = await rigX();
  const pxBefore = await sampleX("before");
  await page.screenshot({ path: join(dir, "before.png") });

  await page.keyboard.down("d");
  await page.waitForTimeout(3000);
  await page.keyboard.up("d");
  await page.waitForTimeout(300);

  const xAfter = await simX();
  const rigAfter = await rigX();
  const pxAfter = await sampleX("after");
  await page.screenshot({ path: join(dir, "after.png") });

  await writeFile(
    join(dir, "movement.json"),
    JSON.stringify(
      { xBefore, xAfter, deltaPx: xAfter - xBefore, pxBefore, pxAfter },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `[predict-feel] simX ${xBefore}→${xAfter} (Δ${Math.round(xAfter - xBefore)}) pixelX ${pxBefore}→${pxAfter}`,
  );

  // Player should have moved right by a lot more than snapshot-rate-only
  // motion would allow after 3s of holding D. Spawn-x varies by world
  // state; assert relative delta only. (May be capped by hitting the
  // right wall — 80px is comfortably below any spawn-to-wall distance.)
  expect(xBefore).toBeGreaterThanOrEqual(0);
  expect(xAfter).toBeGreaterThanOrEqual(0);
  expect(xAfter - xBefore).toBeGreaterThan(80);
  // The rig (what the player SEES) must track the sim movement.
  expect(rigBefore).toBeGreaterThanOrEqual(0);
  expect(rigAfter - rigBefore).toBeGreaterThan(80);

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});
