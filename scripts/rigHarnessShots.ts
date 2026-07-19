// Deterministic full-body semantic frames for melee and every drafted active.
// The harness rebuilds a fresh rig and advances it at fixed 120 Hz for every
// requested frame, so screenshot latency cannot alter the pose.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  ABILITY_ANIMATIONS,
  type AbilityGesture,
} from "../client/src/game/render/abilityAnimation.js";
import type { AbilityKind, ClassId } from "../client/src/sim/data/cardTypes.js";

const OUT = process.env.OUT ?? "/tmp/jakesjam-rig-evidence";
const BASE = process.env.BASE_URL ?? "http://192.168.4.58:5176";
const scope = process.env.SCOPE ?? "representative";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 405 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/harness.html`, { waitUntil: "load" });
await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
const canvas = page.locator("#harness-root canvas");
const frame = async (classId: ClassId, action: AbilityKind | "melee", t: number, path: string): Promise<void> => {
  await page.evaluate(
    ({ classId, action, t }) => (window as unknown as {
      harnessRigFrame: (c: ClassId, a: AbilityKind | "melee", p: number) => void;
    }).harnessRigFrame(classId, action, t),
    { classId, action, t },
  );
  await page.waitForTimeout(20);
  await canvas.screenshot({ path });
};

for (const [classId, count] of [["ninja", 18], ["paladin", 22]] as const) {
  for (let i = 0; i < count; i++) {
    await frame(classId, "melee", i / (count - 1), `${OUT}/${classId}-melee-${String(i).padStart(2, "0")}.png`);
  }
}

let rows = Object.entries(ABILITY_ANIMATIONS) as Array<[AbilityKind, (typeof ABILITY_ANIMATIONS)[AbilityKind]]>;
if (scope === "melee") {
  rows = [];
} else if (scope !== "all") {
  const seen = new Set<string>();
  rows = rows.filter(([, a]) => {
    const key = `${a.classId}:${a.gesture satisfies AbilityGesture}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

for (const [kind, a] of rows) {
  const times = [
    a.anticipationEnd * 0.68,
    a.anticipationEnd + (a.actionEnd - a.anticipationEnd) * 0.62,
    a.actionEnd + (0.86 - a.actionEnd) * 0.58,
    0.94,
  ];
  for (let i = 0; i < times.length; i++) {
    await frame(a.classId, kind, times[i]!, `${OUT}/ability-${a.classId}-${kind}-${i}.png`);
  }
}

await browser.close();
if (errors.length) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}
console.log(`ok — ${rows.length} ability contracts + both melee streams → ${OUT}`);
