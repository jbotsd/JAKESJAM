// Lobby VFX parity evidence (docs/lobby-vfx-parity-goal.md Pillar 2/3) — a
// sibling to loadoutHarnessShots.ts/rigHarnessShots.ts, but screenshotting
// the REAL, live HangoutScene rig standing in the venue lobby (not the
// standalone constructHarness, and not just the loadout-station DOM panel)
// so the evidence proves the actual scene now drives ConstructVfxController,
// not just that the controller works in isolation.
//
// Reuses autoplay.ts's proven splash → venue-lobby navigation verbatim
// (same URL params, same #game-root canvas + HangoutScene-active wait) —
// intentionally does NOT walk to the bell or queue; idle-in-lobby is the
// whole point of Pillar 2.
//
//   bun scripts/lobbyVfxParityShots.ts [--url http://localhost:8088]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE_URL = opt("url", "http://localhost:8088");
const OUT_DIR = opt("out", "tests/e2e/.artifacts/lobby-vfx-parity");
const VIEW = { width: 1280, height: 720 };

const ALL_CLASSES = [
  { classId: "wizard", characterId: "balanced" }, // Geometrician
  { classId: "paladin", characterId: "heavy" }, // Kindled
  { classId: "ninja", characterId: "sprinter" }, // Interstice
  { classId: "priest", characterId: "shielded" }, // Syzygist
] as const;
const ONLY = opt("only", "");
const classes = ONLY ? ALL_CLASSES.filter((c) => c.classId === ONLY) : ALL_CLASSES;

type GameHandle = {
  __jakesjam_game__?: {
    scene: {
      isActive(k: string): boolean;
      getScene(k: string): {
        loop: { getRenderState(): { players: Record<string, unknown> } | null } | null;
        localPlayerId: string;
      } | null;
    };
  };
};

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });

for (const cls of classes) {
  const context = await browser.newContext({ viewport: VIEW });
  const page = await context.newPage();
  // Google Fonts is unreachable from this sandbox — the request hangs
  // rather than failing fast, which stalls Playwright's screenshot()
  // internally (it awaits document.fonts.ready). Abort it immediately so
  // font loading fails fast and the page falls back to its CSS fallback
  // stack instead of hanging. Cosmetic only — doesn't touch construct/VFX
  // rendering, which is what this evidence is actually verifying.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.name}: ${e.message}`));
  page.on("console", (m) => errors.push(`CONSOLE[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));

  await page.addInitScript(({ id, characterId }) => {
    localStorage.setItem("jakesjam.playerId", id);
    localStorage.setItem("jakesjam.playerName", "VFX_PARITY");
    localStorage.setItem("jakesjam.musicMuted", "true");
    localStorage.setItem("jakesjam.sfxMuted", "true");
    localStorage.setItem("jakesjam.clipsConsent", "0");
    localStorage.setItem("jakesjam.playerCharacter", characterId);
  }, { id: `parity_${cls.classId}_${Math.random().toString(36).slice(2, 8)}`, characterId: cls.characterId });

  const url = new URL(BASE_URL);
  url.searchParams.set("world", "1");
  url.searchParams.set("gate", "off");
  url.searchParams.set("quality", "standard");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  try {
    // This sandbox's headless chromium runs on software GL (repeated "GPU
    // stall due to ReadPixels" warnings observed) — boot + first venue-token
    // round-trip genuinely takes 30-90s here under load, not a script or
    // scene bug. `scene.isActive("HangoutScene")` alone is NOT enough —
    // Phaser marks a scene active the instant `.start()` runs, well before
    // its async `connect()` finishes the WS handshake (confirmed by an
    // earlier capture landing on the scene's own "Opening WebSocket..."
    // status text, zero rig on screen). Wait for the actual authoritative
    // snapshot instead — `state.players[localPlayerId]` existing — same
    // readiness signal autoplay.ts's own `probeArena()` reads.
    await page.waitForFunction(
      () => {
        const g = (window as unknown as GameHandle).__jakesjam_game__;
        if (!g?.scene.isActive("HangoutScene")) return false;
        const scene = g.scene.getScene("HangoutScene");
        const state = scene?.loop?.getRenderState();
        return !!state && !!scene && !!state.players[scene.localPlayerId];
      },
      undefined,
      { timeout: 120_000, polling: 500 },
    );
  } catch (e) {
    console.log(`[lobby-vfx-parity] ${cls.classId} FAILED to reach HangoutScene: ${(e as Error).message}`);
    console.log(errors.slice(-40).join("\n"));
    const diag = await page.evaluate(() => {
      const g = (window as unknown as { __jakesjam_game__?: { scene: { keys: Record<string, unknown>; isActive(k: string): boolean } } }).__jakesjam_game__;
      const keys = g ? Object.keys(g.scene.keys) : [];
      return { title: document.title, keys, active: keys.filter((k) => g!.scene.isActive(k)) };
    }).catch((err) => ({ error: String(err) }));
    console.log("DIAG", JSON.stringify(diag));
    await page.screenshot({ path: `${OUT_DIR}/${cls.classId}-FAILURE.png` }).catch(() => {});
    await context.close();
    continue;
  }
  // A never-moved headless pointer leaves player.aimX/aimY at their
  // degenerate spawn default (reads as "aim near world-origin", which from
  // floor height renders as the held weapon pointing straight up off the
  // top of the screen — confirmed via a first capture pass, NOT a wiring
  // bug: `aim = atan2(p.aimY - p.y, p.aimX - p.x)`, ConstructVfxController.ts:603).
  // A real player's mouse is always somewhere sane; move it to a natural
  // "looking ahead, roughly level" position so the idle read is honest.
  // A single move can race the snapshot that lands inside the settle
  // window (observed: some class captures still showed the degenerate
  // straight-up aim). Repeat it across the settle window so at least one
  // lands well before the final screenshot.
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(VIEW.width / 2 + 80 + i, VIEW.height / 2 + 40);
    await page.waitForTimeout(1500);
  }

  // page.screenshot() hangs indefinitely in this sandbox — confirmed via a
  // standalone repro that document.fonts.ready resolves instantly, so it's
  // Playwright's own internal frame-stability wait that never settles (the
  // live game canvas keeps animating — pulses/particles — so it likely
  // never sees two identical consecutive frames). Raw CDP
  // Page.captureScreenshot has no such wait and returns the current frame
  // immediately; confirmed identical live-lobby content in the repro.
  const cdp = await context.newCDPSession(page);
  const shoot = async (label: string) => {
    const path = `${OUT_DIR}/${cls.classId}-${label}.png`;
    try {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(shot.data, "base64"));
      console.log(`[lobby-vfx-parity] ${cls.classId}/${label} -> ${path}`);
    } catch (e) {
      console.log(`[lobby-vfx-parity] ${cls.classId}/${label} screenshot FAILED: ${(e as Error).message}`);
    }
  };

  await shoot("idle");

  // Combat-construct evidence (Pillar 3) — attack input fires the
  // slash-started / shot-fired SimEvents on the RISING EDGE of Fire
  // (World.ts:1955-1963: `meleeEdge = (currKeys & FireBit) !== 0 &&
  // (prevKeys & FireBit) === 0`), independent of whether anything is hit —
  // firing is live in hangout mode by design (venue-sprint2-goal S2.C), so
  // no practice-dummy contact is needed to prove the SWING/SHOT visual
  // itself renders. Burst-capture across the windup+active window
  // (Kindled: 200+110ms, Interstice: 120+90ms — World.ts EDGE_*/SLASH_*
  // constants) rather than guessing one exact frame.
  if (cls.classId === "paladin" || cls.classId === "ninja" || cls.classId === "wizard") {
    await page.mouse.down({ button: "left" });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(60);
      await shoot(`swing${i}`);
    }
    await page.mouse.up({ button: "left" });
  }

  // Kindled Ward (Pillar 3) — hold Shield (Shift, just wired into
  // HangoutScene's input assembly this session — the lobby previously had
  // no input path to Shield at all) and capture mid-hold; drop it after so
  // the class doesn't sit shielded for later captures.
  if (cls.classId === "paladin") {
    await page.keyboard.down("Shift");
    await page.waitForTimeout(400);
    await shoot("ward");
    await page.keyboard.up("Shift");
  }

  if (errors.length) console.log(`[lobby-vfx-parity] ${cls.classId} page errors: ${errors.slice(-10).join(" | ")}`);
  await context.close();
}

await browser.close();
console.log(`[lobby-vfx-parity] done — ${OUT_DIR}`);
