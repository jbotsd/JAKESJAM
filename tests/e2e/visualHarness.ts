// Shared helpers for visual regression specs.
//
// Why this module exists:
//   - Pixel sampling against rendered Phaser canvas is the only reliable
//     way to confirm what's actually on screen. WebGL preserveDrawingBuffer
//     defaults to false, so drawImage(canvas) returns black; we screenshot
//     instead.
//   - "Run twice" QA pattern: every spec runs once for invariants, then
//     again for stability. Use Playwright's --repeat-each=2 or rely on the
//     `runTwice()` helper here that does it inline (better artifact names).
//   - Per-surface invariants are declarative: see VisualSurface below.

import type { ConsoleMessage, Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Console capture
// ---------------------------------------------------------------------------

export type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

export function attachConsole(page: Page): { get: () => ConsoleEntry[] } {
  const entries: ConsoleEntry[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    entries.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location().url
        ? `${msg.location().url}:${msg.location().lineNumber}`
        : undefined,
    });
  });
  page.on("pageerror", (err) => {
    entries.push({ type: "pageerror", text: `${err.name}: ${err.message}` });
  });
  return { get: () => entries };
}

/**
 * Filter console log to "real" errors. Drops:
 *  - Vercel CDN 4xx/5xx noise (favicon, font, etc.)
 *  - net::ERR_ blips during reconnect storms
 */
export function realErrors(entries: readonly ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter(
    (e) =>
      e.type === "pageerror" ||
      (e.type === "error" &&
        !e.text.includes("Failed to load resource") &&
        !e.text.includes("net::ERR_") &&
        !e.text.includes("favicon")),
  );
}

// ---------------------------------------------------------------------------
// Pixel probing
// ---------------------------------------------------------------------------

export type RGB = { r: number; g: number; b: number };

export type PixelProbe = {
  /** Pixels matching `target` within `tolerance`. */
  matchPixels: number;
  /** Total pixels considered (skips fully-transparent). */
  sampledPixels: number;
  /** Top 8 non-near-black colors as `rgb(r,g,b) × count`. */
  topColors: string[];
  /** Mean luminance of sampled pixels (0–255). Useful for blackness checks. */
  meanLuma: number;
};

/**
 * Sample a screenshot for `target` color presence. Strides every 2nd pixel
 * for speed (still ~150k samples on 1280×800).
 */
export async function probeColor(
  page: Page,
  target: RGB,
  tolerance: number,
): Promise<PixelProbe> {
  const buf = await page.screenshot({ type: "png", fullPage: false });
  const png = PNG.sync.read(buf);
  const data = png.data;
  const w = png.width;
  const h = png.height;
  let match = 0;
  let sampled = 0;
  let lumaSum = 0;
  const buckets = new Map<string, number>();
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 200) continue;
      sampled++;
      lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (
        Math.abs(r - target.r) <= tolerance &&
        Math.abs(g - target.g) <= tolerance &&
        Math.abs(b - target.b) <= tolerance
      ) {
        match++;
      }
      if (r + g + b < 60) continue;
      const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return {
    matchPixels: match,
    sampledPixels: sampled,
    topColors: [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `rgb(${k}) × ${v}`),
    meanLuma: sampled > 0 ? lumaSum / sampled : 0,
  };
}

/**
 * Compare two screenshots — bytes-different ratio. Detects "frozen" scenes
 * where T+0 and T+3s are identical (timer not advancing, sim halted).
 */
export async function compareScreenshots(
  bufA: Buffer,
  bufB: Buffer,
): Promise<{ diffPixels: number; diffRatio: number }> {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    return { diffPixels: a.width * a.height, diffRatio: 1 };
  }
  let diff = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    ) {
      diff++;
    }
  }
  return { diffPixels: diff, diffRatio: diff / total };
}

// ---------------------------------------------------------------------------
// Pair shots — capture twice with N ms gap
// ---------------------------------------------------------------------------

export type PairResult = {
  bufA: Buffer;
  bufB: Buffer;
  diff: { diffPixels: number; diffRatio: number };
};

export async function pairShots(
  testInfo: TestInfo,
  page: Page,
  log: readonly ConsoleEntry[],
  label: string,
  gapMs = 3000,
): Promise<PairResult> {
  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });
  const bufA = await page.screenshot({ type: "png", fullPage: false });
  await writeFile(join(dir, `${label}-a.png`), bufA);
  await page.waitForTimeout(gapMs);
  const bufB = await page.screenshot({ type: "png", fullPage: false });
  await writeFile(join(dir, `${label}-b.png`), bufB);
  await writeFile(
    join(dir, `${label}.console.json`),
    JSON.stringify(log, null, 2),
    "utf8",
  );
  const diff = await compareScreenshots(bufA, bufB);
  await writeFile(
    join(dir, `${label}.diff.json`),
    JSON.stringify(diff, null, 2),
    "utf8",
  );
  return { bufA, bufB, diff };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export async function clickButton(page: Page, label: string): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
  await btn.first().waitFor({ state: "visible", timeout: 10_000 });
  await btn.first().click();
}

export async function waitForCanvas(page: Page): Promise<void> {
  await page.waitForSelector("canvas", { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Common color targets (mirrored from client/src/game/ui/palette.ts)
// ---------------------------------------------------------------------------

export const COLORS = {
  // Platform lime — present whenever an arena renders (jadeIsles theme.hi).
  platformLime: { r: 0x9d, g: 0xe6, b: 0x42 } as RGB,
  // Crystal cyan — splash CTAs + bright accents.
  crystalCyan: { r: 0x8f, g: 0xf8, b: 0xff } as RGB,
  // HP lime — HUD bar fill.
  hpLime: { r: 0xb6, g: 0xf2, b: 0x5a } as RGB,
  // Player blue — local player rig fill.
  playerBlue: { r: 0x3a, g: 0xa0, b: 0xf2 } as RGB,
  // Pure black — background-dominant fail signal.
  black: { r: 0x00, g: 0x00, b: 0x00 } as RGB,
};

// ---------------------------------------------------------------------------
// Assertions used by specs — wrapped so failure messages are human-readable.
// ---------------------------------------------------------------------------

import { expect } from "@playwright/test";

export function assertNoErrors(log: readonly ConsoleEntry[], label: string): void {
  const errs = realErrors(log);
  expect(
    errs,
    `${label} console errors:\n${errs
      .map((e) => `  [${e.type}] ${e.text}${e.location ? " @ " + e.location : ""}`)
      .join("\n")}`,
  ).toEqual([]);
}

export function assertColorPresent(
  probe: PixelProbe,
  target: RGB,
  minPixels: number,
  label: string,
): void {
  expect(
    probe.matchPixels,
    `${label}: expected ≥ ${minPixels} pixels matching rgb(${target.r},${target.g},${target.b}) ±30. Got ${probe.matchPixels}/${probe.sampledPixels}.\nTop colors:\n${probe.topColors.join("\n")}`,
  ).toBeGreaterThanOrEqual(minPixels);
}

export function assertNotFrozen(
  diff: { diffRatio: number },
  label: string,
  minDiffRatio = 0.005,
): void {
  // 0.5% is generous: even an idle scene with light-beam tweens should clear
  // 1-2% pixel differences over 3 seconds. Static-ass shots fail this.
  expect(
    diff.diffRatio,
    `${label}: T+0 and T+3s are too similar (diff=${(diff.diffRatio * 100).toFixed(2)}%). Scene appears frozen.`,
  ).toBeGreaterThanOrEqual(minDiffRatio);
}

export function assertNotBlackVoid(probe: PixelProbe, label: string): void {
  expect(
    probe.meanLuma,
    `${label}: mean luma is ${probe.meanLuma.toFixed(1)} — scene is essentially black.`,
  ).toBeGreaterThan(15);
}
