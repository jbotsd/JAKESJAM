// Diagnostic spec: dumps the Phaser scene's display list to find the
// source of long-lived diagonal lines accumulating in world mode.
// Joins ?world=1, lets a few rounds pass, then walks scene.children.list
// dumping each object's type/position/bounds/depth.
//
// Run: bunx playwright test tests/e2e/scene-inventory.spec.ts --reporter=list

import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachConsole, waitForCanvas } from "./visualHarness";

test("scene-inventory: dump all renderables after 30s in world mode", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  // Let the world boot, a round play, and round-end transitions occur.
  await page.waitForTimeout(30_000);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, "after-30s.png") });

  const inventory = await page.evaluate(() => {
    type Phaser = {
      game: {
        scene: {
          scenes: Array<{
            scene: { key: string; settings: { active: boolean } };
            children: { list: unknown[] };
          }>;
        };
      };
    };
    const w = window as unknown as { __jakesjam_game__?: Phaser["game"] };
    const g = w.__jakesjam_game__;
    if (!g) return { error: "no __jakesjam_game__ — diagnostic hook missing" };
    const scenes = g.scene.scenes;
    const out: Array<Record<string, unknown>> = [];
    for (const s of scenes) {
      const settings = s.scene.settings;
      if (!settings.active) continue;
      const list = s.children.list as Array<Record<string, unknown>>;
      for (const obj of list) {
        const o = obj as {
          type: string;
          x?: number;
          y?: number;
          alpha?: number;
          visible?: boolean;
          depth?: number;
          width?: number;
          height?: number;
          getBounds?: () => { x: number; y: number; width: number; height: number };
          commandBuffer?: unknown[];
        };
        const bounds = o.getBounds?.();
        out.push({
          scene: s.scene.key,
          type: o.type,
          x: o.x,
          y: o.y,
          alpha: o.alpha,
          visible: o.visible,
          depth: o.depth,
          width: o.width,
          height: o.height,
          boundsW: bounds?.width,
          boundsH: bounds?.height,
          gfxCmdLen: o.type === "Graphics" && o.commandBuffer
            ? (o.commandBuffer as unknown[]).length
            : undefined,
        });
      }
    }
    return { count: out.length, items: out };
  });

  await writeFile(
    join(dir, "scene-inventory.json"),
    JSON.stringify(inventory, null, 2),
    "utf8",
  );
  console.log(`[inventory] ${(inventory as { count?: number }).count} renderables`);

  expect((inventory as { error?: string }).error).toBeUndefined();
  // Surface any console errors but don't fail on them — diagnostic only.
  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  if (errs.length > 0) {
    console.log("[inventory] console errors:", errs.length);
  }
});
