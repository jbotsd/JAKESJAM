// Critical-path payload probe — the north-star row's instrument.
//
// Sums content-length across a real page load, so "what does a visitor
// download" is measured rather than inferred from bundle size. Reports
// the >300KB offenders by name because that is where the answer always
// is. Caveat worth keeping in view: headless media preload may differ
// from a headful browser, so treat media numbers as an upper bound.
import { chromium } from "@playwright/test";
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i+1] ? args[i+1] : d; };
const BASE = opt("url", "http://localhost:8288");
const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
for (const [label, url] of [["lobby-first", `${BASE}/?gate=off`], ["splash", `${BASE}/?splash=1&gate=off`]]) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("jakesjam.identSeen", "1"));
  let total = 0; const big = [];
  p.on("response", async (r) => {
    try { const l = Number((await r.allHeaders())["content-length"] ?? 0); total += l;
      if (l > 300_000) big.push(`${(l/1024/1024).toFixed(2)}MB ${r.url().split("/").pop()}`); } catch {}
  });
  await p.goto(url, { waitUntil: "load" });
  await p.waitForSelector("canvas:not(.ident-shader)", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(9000);
  console.log(`${label.padEnd(12)} ${(total/1024/1024).toFixed(2)} MB  ${big.join(" | ")}`);
  await ctx.close();
}
await b.close();
