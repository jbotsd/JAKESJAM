// A queued client must actually ARRIVE in the arena and stay there.
//
// Written as a repro for a suspected join bug, and it PASSED — which is the
// finding. Kept as a real regression test for the venue → bell → arena
// handoff, which nothing else covered end-to-end.
//
// The correction worth recording, because it nearly became a false report:
// these lines looked like proof that admitted entrants get dropped —
//
//   [venue] the bell — admitted 1 entrant(s) to the arena
//   [matchHost world] evicted player_2dccvdkc_wps0 after 10000ms reconnect grace
//   [worldHost] match complete with no humans — bots roll the next cycle
//
// — but they came from the tail of OTHER e2e runs, whose browsers closed at
// test end. An eviction 10 s after a client legitimately disconnects is the
// grace working, not failing. Log lines are not a repro; this test is. On
// :8388 under `USE_WASM_STEP_WORLD=1` the handoff holds: `/health` counts
// the human and still counts them 15 s after the bell, well past the grace.
//
// (The -1800 px x jump seen in wasmAuthorityInput.spec.ts across this same
// transition is therefore what it first appeared to be — the arena's own
// spawn coordinates — not a dropped client.)
//
//   PORT=8388 OPS_PORT=8389 WORLD_BOTS=2 USE_WASM_STEP_WORLD=1 \
//     SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8388 bunx playwright test arenaJoin

import { test, expect } from "@playwright/test";

const GAME_CANVAS = "canvas:not(.ident-shader)";

async function asReturningVisitor(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jakesjam.identSeen", "1");
      localStorage.setItem("jakesjam.playerName", "JOINPROBE");
    } catch {
      /* hardened browser */
    }
  });
}

/** The server's own count of live human sockets in the arena. */
async function arenaHumans(baseURL: string): Promise<number> {
  const res = await fetch(`${baseURL}/health`);
  const json = (await res.json()) as { world?: { humans?: number } | null };
  return json.world?.humans ?? 0;
}

test.describe("venue → bell → arena handoff", () => {
  test.setTimeout(240_000);

  test("a queued client is still in the arena 15 s after the bell", async ({ page, baseURL }) => {
    await asReturningVisitor(page);
    // ?fight queues on arrival (Doors 1.6), so the bell is the only wait.
    await page.goto("/?fight&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 60_000 });

    // Wait for the server to see us in the arena at all.
    await expect
      .poll(async () => await arenaHumans(baseURL!), {
        timeout: 180_000,
        intervals: [2000],
      })
      .toBeGreaterThan(0);

    // The eviction fires at the 10 s reconnect grace, so 15 s is past it:
    // if the arena still counts us, the handoff genuinely held.
    await page.waitForTimeout(15_000);
    expect(await arenaHumans(baseURL!)).toBeGreaterThan(0);
  });
});
