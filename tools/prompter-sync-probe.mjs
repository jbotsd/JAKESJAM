// Does a follower page show the SAME PLACE IN THE SCRIPT as the leader?
//
// Lives in this repo rather than ~/Projects/teleprompter because that project
// has no node_modules — this is the nearest checkout where @playwright/test
// resolves. It talks to the prompter purely over HTTP, so it does not care.
//
//   bun tools/prompter-sync-probe.mjs
//   PROMPT_BASE=http://localhost:7777 bun tools/prompter-sync-probe.mjs
//
// The two pages are deliberately given DIFFERENT viewports and DIFFERENT font
// sizes. An earlier version of this probe ran both at 1280x720, matched pixel
// offsets exactly, and passed — while the real two-machine setup was visibly
// out of sync. Line positions are measured from each page's own DOM, so a
// different width wraps the script differently and the same pixel offset lands
// on a different line. Equal pixels is therefore the WRONG assertion.
//
// What must match is the logical position: the highlighted word. What must NOT
// be assumed equal is the pixel offset.
import { chromium } from "@playwright/test";

const BASE = process.env.PROMPT_BASE ?? "http://localhost:7777";
const browser = await chromium.launch({ headless: true });

const leadCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const followCtx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
const lead = await leadCtx.newPage();
const follow = await followCtx.newPage();

await lead.goto(BASE);
await follow.goto(`${BASE}/?role=follow`);
await lead.waitForTimeout(1200);

// Make the follower's layout differ further: bigger type => different wrapping.
await follow.bringToFront();
for (let i = 0; i < 3; i++) await follow.keyboard.press("+");
await follow.waitForTimeout(400);

const currentWord = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".word--current");
    return el ? el.textContent.trim() : null;
  });
const saidCount = (page) =>
  page.evaluate(() => document.querySelectorAll(".word--said").length);
const offsetPx = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[style*="translateY"]');
    const m = el && /translateY\((-?[\d.]+)px\)/.exec(el.getAttribute("style") || "");
    return m ? parseFloat(m[1]) : null;
  });

await lead.bringToFront();
await lead.keyboard.press(" ");
await lead.waitForTimeout(4000);
await lead.keyboard.press(" ");
await lead.waitForTimeout(700);

const lw = await currentWord(lead);
const fw = await currentWord(follow);
const ls = await saidCount(lead);
const fs = await saidCount(follow);
const lo = await offsetPx(lead);
const fo = await offsetPx(follow);

console.log(`leader   word="${lw}" said=${ls} offset=${lo}`);
console.log(`follower word="${fw}" said=${fs} offset=${fo}`);

const wordMatch = lw !== null && lw === fw;
const progressMatch = Math.abs(ls - fs) <= 1;
const moved = ls > 0;

console.log(`moved            : ${moved ? "yes" : "NO — leader never advanced"}`);
console.log(`current word     : ${wordMatch ? "match" : "MISMATCH"}`);
console.log(`words spoken     : ${progressMatch ? "match" : `MISMATCH (${ls} vs ${fs})`}`);
console.log(`offsets differ   : ${lo !== fo ? "yes (expected — each page uses its own layout)" : "identical"}`);

const pass = moved && wordMatch && progressMatch;
console.log(pass ? "PROMPTER SYNC: PASS" : "PROMPTER SYNC: FAIL");
await browser.close();
process.exitCode = pass ? 0 : 1;
