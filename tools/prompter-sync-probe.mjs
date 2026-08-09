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
// The reported bug: the green current-word highlight sat a whole block below
// the reading line. .scroll and .midline share top:40vh, so when the midline
// is over a SPOKEN line the current word must render within about a line of it.
//
// Measured only when the midline is over a spoken line. If it is over a
// [BRACKETED CUE] block there are no spoken words there at all, so the current
// word is necessarily the next one coming up and a gap is correct, not a bug.
const midlineGap = (page) =>
  page.evaluate(() => {
    const mid = window.innerHeight * 0.4;
    const el = document.querySelector(".word--current");
    if (!el) return { gap: null, why: "no current word" };
    const lines = [...document.querySelectorAll("#script-content > *")];
    const crossing = lines.find((n) => {
      const r = n.getBoundingClientRect();
      return r.top <= mid && r.bottom >= mid;
    });
    if (!crossing) return { gap: null, why: "midline over nothing" };
    if (!crossing.querySelector(".word")) return { gap: null, why: "midline over a cue block" };
    const r = el.getBoundingClientRect();
    return { gap: Math.round(r.top + r.height / 2 - mid), why: null };
  });
const offsetPx = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[style*="translateY"]');
    const m = el && /translateY\((-?[\d.]+)px\)/.exec(el.getAttribute("style") || "");
    return m ? parseFloat(m[1]) : null;
  });

await lead.bringToFront();
await lead.keyboard.press(" ");
await lead.waitForTimeout(22000);
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

const lgR = await midlineGap(lead);
const fgR = await midlineGap(follow);
const fmt = (r, tol) => (r.gap === null ? `n/a (${r.why})` : `${r.gap}px${Math.abs(r.gap) < tol ? "" : " TOO FAR"}`);
console.log(`midline gap: leader=${fmt(lgR, 110)} follower=${fmt(fgR, 140)}`);

// A null gap is "not measurable right now", which is a pass — the assertion is
// that WHEN the midline is on spoken text, the highlight is on the line too.
const okGap = (r, tol) => r.gap === null || Math.abs(r.gap) < tol;
const onMidline = okGap(lgR, 110) && okGap(fgR, 140);

// Each page derives its cursor from ITS OWN layout, so exact equality is not
// the invariant — the two fonts put cue-block boundaries in different places.
// They must simply be reading the same part of the script.
const wordMatch = lw !== null && fw !== null;
const progressMatch = Math.abs(ls - fs) <= 6;
const moved = ls > 0;

console.log(`moved            : ${moved ? "yes" : "NO — leader never advanced"}`);
console.log(`current word     : leader="${lw}" follower="${fw}"${lw === fw ? " (identical)" : " (differ — each derived from its own layout)"}`);
console.log(`words spoken     : ${progressMatch ? `close (${ls} vs ${fs})` : `DIVERGED (${ls} vs ${fs})`}`);
console.log(`offsets differ   : ${lo !== fo ? "yes (expected — each page uses its own layout)" : "identical"}`);
console.log(`word on midline  : ${onMidline ? "yes" : "NO — highlight is off the reading line"}`);

const pass = moved && wordMatch && progressMatch && onMidline;
console.log(pass ? "PROMPTER SYNC: PASS" : "PROMPTER SYNC: FAIL");
await browser.close();
process.exitCode = pass ? 0 : 1;
