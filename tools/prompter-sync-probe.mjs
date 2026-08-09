// Does a follower page actually track the leader's scroll?
// Opens both roles, runs the leader, and compares the rendered translateY.
//
// Lives in this repo rather than ~/Projects/teleprompter because that project
// has no node_modules — this is the nearest checkout where @playwright/test
// resolves. It talks to the prompter purely over HTTP, so it does not care.
//
//   bun tools/prompter-sync-probe.mjs
//   PROMPT_BASE=http://localhost:7777 bun tools/prompter-sync-probe.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.PROMPT_BASE ?? "http://localhost:7777";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

const lead = await ctx.newPage();
const follow = await ctx.newPage();
await lead.goto(BASE);
await follow.goto(`${BASE}/?role=follow`);
await lead.waitForTimeout(1200);

const readY = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[style*="translateY"]');
    if (!el) return null;
    const m = /translateY\((-?[\d.]+)px\)/.exec(el.getAttribute("style") || "");
    return m ? parseFloat(m[1]) : null;
  });

console.log("before run: lead=%s follow=%s", await readY(lead), await readY(follow));

await lead.bringToFront();
await lead.keyboard.press(" ");           // leader starts scrolling
await lead.waitForTimeout(3500);
await lead.keyboard.press(" ");           // pause so both settle
await lead.waitForTimeout(600);

const l = await readY(lead);
const f = await readY(follow);
const delta = (l === null || f === null) ? null : Math.abs(l - f);
console.log("after run : lead=%s follow=%s delta=%s", l, f, delta);

const moved = l !== null && Math.abs(l) > 5;
const tracked = delta !== null && delta < 2;
console.log(moved ? "leader scrolled: yes" : "leader scrolled: NO");
console.log(tracked ? "follower tracked: yes" : "follower tracked: NO");
console.log(moved && tracked ? "PROMPTER SYNC: PASS" : "PROMPTER SYNC: FAIL");
await browser.close();
process.exitCode = moved && tracked ? 0 : 1;
