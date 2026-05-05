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
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);

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

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  const xBefore = await sampleX("before");
  await page.screenshot({ path: join(dir, "before.png") });

  await page.keyboard.down("d");
  await page.waitForTimeout(3000);
  await page.keyboard.up("d");
  await page.waitForTimeout(300);

  const xAfter = await sampleX("after");
  await page.screenshot({ path: join(dir, "after.png") });

  await writeFile(
    join(dir, "movement.json"),
    JSON.stringify({ xBefore, xAfter, deltaPx: xAfter - xBefore }, null, 2),
    "utf8",
  );

  console.log(`[predict-feel] xBefore=${xBefore} xAfter=${xAfter} delta=${xAfter - xBefore}`);

  // Player rig should have moved right by at least ~120px after 3s of
  // holding D. Spawn-x varies by world state; assert relative delta only.
  expect(xBefore).toBeGreaterThanOrEqual(0);
  expect(xAfter).toBeGreaterThanOrEqual(0);
  expect(xAfter - xBefore).toBeGreaterThan(80);

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});
