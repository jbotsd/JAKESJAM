#!/usr/bin/env bun
// Bake stream-kit HTML → OBS PNG assets (export-static, 2× supersample).
// Full cards: 1920×1080. Brand + lower-third: cropped tight + meta.json.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVER = path.join(__dirname, "overlays");
const OUT = path.join(__dirname, "assets", "png");

const FULL = [
  ["starting-soon.html", "starting-soon.png"],
  ["brb.html", "brb.png"],
  ["ending.html", "ending.png"],
];
// brand-corner: full 1920×1080 transparent plate (mark TL + link BR)
// lower-third: cropped tight for bottom-left placement
const HUD_FULL = [["brand-corner.html", "brand-corner.png"]];
const HUD_CROP = [["lower-third.html", "lower-third.png"]];

function downscale2x(buf) {
  const png = PNG.sync.read(Buffer.from(buf));
  if (png.width % 2 !== 0 || png.height % 2 !== 0) return Buffer.from(buf);
  const tw = png.width / 2;
  const th = png.height / 2;
  const out = new PNG({ width: tw, height: th });
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const i = ((y * 2 + oy) * png.width + (x * 2 + ox)) * 4;
          r += png.data[i];
          g += png.data[i + 1];
          b += png.data[i + 2];
          a += png.data[i + 3];
        }
      }
      const j = (y * tw + x) * 4;
      out.data[j] = (r / 4) | 0;
      out.data[j + 1] = (g / 4) | 0;
      out.data[j + 2] = (b / 4) | 0;
      out.data[j + 3] = (a / 4) | 0;
    }
  }
  return PNG.sync.write(out);
}

function cropOpaque(buf, pad = 10) {
  const png = PNG.sync.read(Buffer.from(buf));
  const { width: w, height: h, data } = png;
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) {
    return { buf: PNG.sync.write(new PNG({ width: 64, height: 64 })), meta: { x: 0, y: 0, w: 64, h: 64, canvas: { w, h } } };
  }
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((minY + y) * w + (minX + x)) * 4;
      const di = (y * cw + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return {
    buf: PNG.sync.write(out),
    meta: { x: minX, y: minY, w: cw, h: ch, canvas: { w, h } },
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });

  for (const [html, png] of FULL) {
    await page.goto(`file://${path.join(OVER, html)}`, { waitUntil: "load" });
    await page.evaluate(() => document.documentElement.classList.add("export-static"));
    await page.waitForTimeout(200);
    const shot = await page.screenshot({ type: "png", omitBackground: false });
    const out = downscale2x(shot);
    await writeFile(path.join(OUT, png), out);
    console.log("full", png, out.byteLength);
  }

  for (const [html, png] of HUD_FULL) {
    await page.goto(`file://${path.join(OVER, html)}`, { waitUntil: "load" });
    await page.evaluate(() => document.documentElement.classList.add("export-static"));
    await page.waitForTimeout(200);
    const shot = await page.screenshot({ type: "png", omitBackground: true });
    const out = downscale2x(shot);
    await writeFile(path.join(OUT, png), out);
    await writeFile(
      path.join(OUT, png.replace(/\.png$/, ".meta.json")),
      JSON.stringify({ x: 0, y: 0, w: 1920, h: 1080, canvas: { w: 1920, h: 1080 }, full: true }, null, 2),
    );
    console.log("hud-full", png, out.byteLength);
  }

  for (const [html, png] of HUD_CROP) {
    await page.goto(`file://${path.join(OVER, html)}`, { waitUntil: "load" });
    await page.evaluate(() => document.documentElement.classList.add("export-static"));
    await page.waitForTimeout(200);
    const shot = await page.screenshot({ type: "png", omitBackground: true });
    const half = downscale2x(shot);
    const { buf, meta } = cropOpaque(half, 12);
    await writeFile(path.join(OUT, png), buf);
    await writeFile(path.join(OUT, png.replace(/\.png$/, ".meta.json")), JSON.stringify(meta, null, 2));
    console.log("hud-crop", png, buf.byteLength, meta);
  }

  await browser.close();
  console.log("baked →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
