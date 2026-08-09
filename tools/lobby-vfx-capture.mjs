// Lobby VFX parity capture — Doors 4.5.
//
// The open rows were "Geometrician lance attempted and inconclusive;
// Syzygist tether and cast-tells not attempted", blocked on "the
// loadout-station equip flow, a real prerequisite". That prerequisite is
// gone: Doors 1.8 made class ONE selection stored at
// `jakesjam.playerCharacter`, so a capture can pick a chassis directly
// instead of walking a rig across the venue to a station.
//
// For each chassis: land in the venue, hold fire, and capture frames
// through the cast. Verification is by LOOKING at the frames — this tool
// only guarantees they exist and that the page did not error.
//
//   bun tools/lobby-vfx-capture.mjs --url http://localhost:8288
//
// Output: tests/e2e/.artifacts/lobby-vfx/<chassis>-{idle,fire1,fire2}.png

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = opt("url", "http://localhost:8288");
const OUT = "tests/e2e/.artifacts/lobby-vfx";

/** archetype (the wire id) → chassis (the name in the docs). See
 *  client/src/game/data/characters.ts, the authoritative table. */
const CHASSIS = [
  { archetype: "balanced", name: "geometrician", note: "lance — ALWAYS raycast, never a projectile" },
  { archetype: "heavy", name: "kindled", note: "sword + ward" },
  { archetype: "sprinter", name: "interstice", note: "tether-class VFX" },
  { archetype: "shielded", name: "syzygist", note: "tether" },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

for (const c of CHASSIS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.addInitScript((arch) => {
    localStorage.setItem("jakesjam.playerCharacter", arch);
    localStorage.setItem("jakesjam.identSeen", "1");
  }, c.archetype);

  await page.goto(`${BASE}/?gate=off`, { waitUntil: "load" });
  await page.waitForSelector("canvas:not(.ident-shader)", { timeout: 30_000 });
  await page.waitForTimeout(11_000); // land + connect + settle

  const active = await page.evaluate(
    () => localStorage.getItem("jakesjam.playerCharacter"),
  );
  await page.screenshot({ path: `${OUT}/${c.name}-idle.png` });

  // Aim off to the side so a raycast has somewhere to go and a
  // projectile has travel.
  //
  // Capture AFTER the release, not during the hold. The first version of
  // this took both frames while the button was still down and caught
  // nothing: the HUD reads "Vector Charge", i.e. M1 charges on hold and
  // the shot leaves on RELEASE — so every frame was of a rig winding up,
  // and "no lance visible" would have been a false finding about the
  // game rather than a true one about the capture.
  // Aim AT the practice dummy, not into the void. The venue spawns the
  // player on the right and the ALLY dummy on the left, so firing
  // up-and-right (the first attempt) sent a raycast into empty space
  // where there is nothing to hit and little to draw — "no lance
  // visible" would again have been a fact about the aim, not the game.
  await page.mouse.move(150, 510);
  await page.mouse.down();
  await page.waitForTimeout(700); // charge
  await page.screenshot({ path: `${OUT}/${c.name}-charge.png` });
  await page.mouse.up();

  // BURST, not two samples. A hitscan beam lives a frame or two, so
  // sampling at +90ms and +260ms straddles it and reports "no lance"
  // when the lance was simply gone by the first frame. Ten frames at
  // ~45ms covers ~450ms of the cast at better than 20fps.
  for (let f = 0; f < 10; f += 1) {
    await page.screenshot({ path: `${OUT}/${c.name}-b${String(f).padStart(2, "0")}.png` });
    await page.waitForTimeout(45);
  }

  console.log(
    `${c.name.padEnd(14)} archetype=${String(active).padEnd(9)} errors=${errs.length}` +
      (errs.length ? ` :: ${errs[0]}` : "") + `  (${c.note})`,
  );
  await page.close();
}

await browser.close();
console.log(`\n[vfx] frames in ${OUT}/ — verification is by LOOKING at them.`);
