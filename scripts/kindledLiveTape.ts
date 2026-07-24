// Kindled LIVE victim-channel tape (slash-feel-ledger wave 2, K5) — joins a
// REAL server world as a Kindled, walks into melee contact with bots, and
// records the R1 rows 3-8 contact chord three ways at once:
//
//   1. numeric trace: an in-page rAF sampler reads __rigDebug()'s new
//      `impact` field every rendered frame (capture discipline —
//      __debugState over pixels; no screenshot latency in the numbers);
//   2. event log: ?evidence=1 presentation events (slash-hit / bash-landed /
//      player-killed) with performance.now stamps to segment the trace;
//   3. video + contact single-shots: visual amplitude read at game scale
//      (the whole reason for this tape — unit numbers may read wrong live).
//
// NEVER points at :8088 (production). Run against the worktree server:
//   BASE_URL=http://localhost:8090 bun run scripts/kindledLiveTape.ts
//
// The driver reuses the in-page bot autopilot (__setBotInput) — same input
// path as a human. Fire is TOGGLED (not held) so every swing is a fresh
// rising edge and the R1 row-1 buffer machinery gets exercised live.
// Sessions auto-rejoin: a world recycle (match complete) evicts us; the
// tape reloads and queues for the next bell instead of flatlining.

import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/d9fd0248-ff4f-49ff-85d4-ab426f99cd6a/scratchpad/kindled-feel";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:8090";
if (BASE.includes("8088")) {
  console.error("refusing to tape against :8088 — that is the production server");
  process.exit(1);
}
const TAG = process.env.TAG ?? "live1";
const CAP_MS = Number(process.env.CAP_MS ?? 300_000);

// Anti-throttling flags: a headless/backgrounded tab throttles timers and
// rAF, which drifts the client sim clock out of the server's input window
// ("dropping out-of-window input" — the player wedges mid-fight).
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
// Wall-clock anchor for the video timeline: recording starts at page
// creation, raw events carry `epoch` (Date.now() at batch arrival), so
// video_time_s ≈ (epoch - videoT0)/1000 — good to ~±100ms, enough to
// land frame extraction inside a kill chord (K10 on-camera-kill tape).
const videoT0 = Date.now();
// Pool-exhaustion sentinel (K10): ParticlePool.warnExhausted console.warns
// once per starved pool — a kill-tier spawn silently skipped is EXACTLY the
// failure mode that made rows 17/18 invisible live while harness strips
// (isolated, empty pool) showed them.
page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("ParticlePool")) console.log(`[page-console] ${text}`);
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));

// Persist collected evidence/trace ACROSS reloads on the Node side.
const allEvents: unknown[] = [];
const allTrace: unknown[] = [];
const allRaw: unknown[] = [];

await page.addInitScript(() => {
  localStorage.setItem("jakesjam.playerId", "player_feelK_live");
  localStorage.setItem("jakesjam.playerCharacter", "heavy"); // Kindled chassis
  // Pin the STANDARD quality tier: headless Chromium probes as SwiftShader
  // → potato → particleScale 0.25 quarters every pool (K10 finding), which
  // makes the tape's VFX density lie about Jake's desktop. The tape must
  // grade the presentation the real machine renders.
  localStorage.setItem("jj_quality_tier", "standard");
  const w = window as unknown as { __feelEvents: unknown[] };
  w.__feelEvents = [];
  window.addEventListener("jakesjam:presentation-event", (e) => {
    const d = (e as CustomEvent).detail as { kind?: string } | undefined;
    if (!d?.kind) return;
    if (
      ["slash-started", "slash-hit", "bash-landed", "player-killed", "hit-confirmed"].includes(
        d.kind,
      )
    ) {
      w.__feelEvents.push({ ...d });
      if (w.__feelEvents.length > 4000) w.__feelEvents.shift();
    }
  });
});

/** Full join flow: venue lobby → venue-admitted seam → arena scene →
 *  bell admission (no mid-fight spawns). Then installs the rAF trace
 *  collector + the pursuit driver. */
async function joinArena(p: Page): Promise<void> {
  await p.goto(`${BASE}/?world=1&evidence=1&gate=off`, { waitUntil: "load" });
  await p.waitForFunction(
    () =>
      (window as unknown as { __jakesjam_game__?: { scene: { isActive(k: string): boolean } } })
        .__jakesjam_game__?.scene.isActive("HangoutScene") ?? false,
    undefined,
    { timeout: 30_000 },
  );
  await p.waitForTimeout(1500);
  // Dispatch-and-retry: the hangout scene must be listening before the
  // admitted event lands; a single early dispatch can vanish into nothing.
  for (let attempt = 0; attempt < 6; attempt++) {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("jakesjam:venue-admitted")));
    const arrived = await p
      .waitForFunction(
        () =>
          (window as unknown as { __jakesjam_game__?: { scene: { isActive(k: string): boolean } } })
            .__jakesjam_game__?.scene.isActive("OnlineMatchScene") ?? false,
        undefined,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (arrived) break;
    if (attempt === 5) throw new Error("arena handoff never happened");
    console.log("[tape] arena handoff not yet — re-dispatching venue-admitted");
  }
  console.log("[tape] in arena scene — waiting for the bell to admit us");
  await p.waitForFunction(
    () => {
      const g = (window as unknown as {
        __jakesjam_game__?: {
          scene: {
            getScene(k: string): {
              loop?: { getRenderState(): { players: Record<string, { alive: boolean }> } | null } | null;
              localPlayerId?: string;
            } | null;
          };
        };
      }).__jakesjam_game__;
      const scene = g?.scene.getScene("OnlineMatchScene");
      const state = scene?.loop?.getRenderState?.();
      const me = scene?.localPlayerId ? state?.players[scene.localPlayerId] : undefined;
      return me?.alive === true;
    },
    undefined,
    { timeout: 200_000, polling: 500 },
  );
  console.log("[tape] admitted and alive — driving");

  // Strip the sim-pause-on-blur seam for the tape session: a headless page
  // can catch a Phaser BLUR with no FOCUS ever following, which STOPS the
  // client sim loop (renderHostStop) — zero inputs sent, player wedged at
  // spawn with no server-side drops to show for it. The tape must keep the
  // loop alive regardless of focus heuristics.
  await p.evaluate(() => {
    const g = (window as unknown as {
      __jakesjam_game__?: {
        events: { off: (k: string) => void };
        scene: { getScene(k: string): { renderHostStart?: () => void } | null };
      };
    }).__jakesjam_game__;
    g?.events.off("blur");
    g?.scene.getScene("OnlineMatchScene")?.renderHostStart?.();
  });

  // Raw authoritative event hook — the evidence bus strips ids, so wrap
  // the client loop's onEvents to capture full event objects (runtime
  // assignment; `private readonly` is TS-only).
  await p.evaluate(() => {
    const w = window as unknown as {
      __jakesjam_game__?: { scene: { getScene(k: string): unknown } };
      __rawEvents: unknown[];
      __rawHooked?: boolean;
    };
    w.__rawEvents = w.__rawEvents ?? [];
    const scene = w.__jakesjam_game__?.scene.getScene("OnlineMatchScene") as {
      loop?: { onEvents?: (evs: unknown[]) => void };
      localPlayerId?: string;
    } | null;
    const loop = scene?.loop;
    if (loop && !w.__rawHooked) {
      w.__rawHooked = true;
      const orig = loop.onEvents?.bind(loop);
      loop.onEvents = (evs: unknown[]) => {
        const t = performance.now();
        const epoch = Date.now();
        for (const e of evs) {
          w.__rawEvents.push({ t, epoch, me: scene?.localPlayerId, ...(e as object) });
          if (w.__rawEvents.length > 8000) w.__rawEvents.shift();
        }
        orig?.(evs);
      };
    }
  });

  // In-page rAF trace collector over __rigDebug().impact.
  await p.evaluate(() => {
    const w = window as unknown as {
      __rigDebug?: () => ({ pid: string; x: number; y: number; impact?: unknown | null } & Record<string, unknown>)[] | null;
      __feelTrace: Record<string, unknown>[];
    };
    w.__feelTrace = [];
    const loop = () => {
      const rows = w.__rigDebug?.();
      if (rows) {
        const t = performance.now();
        for (const r of rows) {
          if (r.impact) {
            w.__feelTrace.push({ t, pid: r.pid, x: r.x, y: r.y, ...(r.impact as object) });
            if (w.__feelTrace.length > 60_000) w.__feelTrace.shift();
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  // Drive: pursue the nearest bot into melee range; toggle Fire for fresh
  // rising edges (the buffer turns the mash into clean swing·swing·BASH).
  await p.evaluate(() => {
    let fire = false;
    window.setInterval(() => {
      fire = !fire;
      (window as unknown as { __setBotInput?: (g: Record<string, unknown> | null) => void })
        .__setBotInput?.({ moveTowardFoe: true, stopRangePx: 34, aimAtFoe: true, hopWhenStuck: true, fire });
    }, 170);
  });
}

// Auto-pick drafts so rounds keep flowing (probeKit's selector, inlined —
// this script drives one page, not the probe kit's two).
const autoPick = () =>
  page.evaluate(() => {
    const root = document.querySelector("[data-card-draft]");
    if (!root) return false;
    if (getComputedStyle(root).display === "none") return false;
    const rarities = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
    const tag = [...root.querySelectorAll("div")].find((d) =>
      rarities.includes((d.textContent ?? "").trim()),
    );
    const card = tag?.parentElement;
    const plate = root.querySelector("[data-card-plate]");
    const target = (plate ?? card) as HTMLElement | null;
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);

type Probe = {
  slashStarted: number;
  slashHit: number;
  bashLanded: number;
  killed: number;
  /** Melee-CHAIN kills by ME (the shock-ring gate condition: player-killed
   *  killerId===me with a same-batch slash-hit/bash-landed attackerId===me).
   *  THE wave-3 target — every one of these is on-camera by construction
   *  (the camera follows the local player). */
  myMeleeKills: number;
  trace: number;
  phase: string | null;
  meAlive: boolean | null;
  meHp: number | null;
  foeDist: number | null;
};
const probe = (): Promise<Probe> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __feelEvents?: { kind: string }[];
      __feelTrace?: unknown[];
      __jakesjam_game__?: {
        scene: {
          getScene(k: string): {
            loop?: {
              getRenderState():
                | { players: Record<string, { alive: boolean; health: number; x: number; y: number }>; round: { phase: string } }
                | null;
            } | null;
            localPlayerId?: string;
          } | null;
        };
      };
    };
    const ev = w.__feelEvents ?? [];
    const by = (k: string) => ev.filter((e) => e.kind === k).length;
    // NOTE the raw-hook wrapper spreads the event LAST, so the sim event's
    // own `t` (its TYPE tag, e.g. "player-killed") overwrites the wrapper's
    // perf stamp — `epoch` + `me` survive. Batch = same-epoch rows.
    let myMeleeKills = 0;
    const rows = ((window as unknown as { __rawEvents?: Record<string, unknown>[] }).__rawEvents ??
      []) as ({ t?: string; epoch?: number; me?: string } & Record<string, unknown>)[];
    for (const r of rows) {
      if (r.t !== "player-killed" || !r.me || r.killerId !== r.me) continue;
      const batch = rows.filter((o) => o.epoch === r.epoch);
      const meleeContact = batch.some(
        (o) => (o.t === "slash-hit" || o.t === "bash-landed") && o.attackerId === r.me,
      );
      if (meleeContact) myMeleeKills += 1;
    }
    const scene = w.__jakesjam_game__?.scene.getScene("OnlineMatchScene");
    const state = scene?.loop?.getRenderState?.() ?? null;
    const me = scene?.localPlayerId ? state?.players[scene.localPlayerId] : undefined;
    let foeDist: number | null = null;
    if (me && state) {
      for (const [pid, pl] of Object.entries(state.players)) {
        if (pid === scene?.localPlayerId || !pl.alive) continue;
        const d = Math.hypot(pl.x - me.x, pl.y - me.y);
        if (foeDist === null || d < foeDist) foeDist = d;
      }
    }
    return {
      slashStarted: by("slash-started"),
      slashHit: by("slash-hit"),
      bashLanded: by("bash-landed"),
      killed: by("player-killed"),
      myMeleeKills,
      trace: (w.__feelTrace ?? []).length,
      phase: state?.round.phase ?? null,
      meAlive: me?.alive ?? null,
      meHp: me ? Math.round(me.health) : null,
      foeDist: foeDist === null ? null : Math.round(foeDist),
    };
  });

/** Pull the page-side buffers into the Node-side accumulators (idempotent
 *  via drain — the page arrays are cleared after harvest). */
async function harvest(): Promise<void> {
  const dump = await page
    .evaluate(() => {
      const w = window as unknown as {
        __feelEvents?: unknown[];
        __feelTrace?: unknown[];
        __rawEvents?: unknown[];
      };
      const out = {
        events: w.__feelEvents ?? [],
        trace: w.__feelTrace ?? [],
        raw: w.__rawEvents ?? [],
      };
      if (w.__feelEvents) w.__feelEvents = [];
      if (w.__feelTrace) w.__feelTrace = [];
      if (w.__rawEvents) w.__rawEvents = [];
      return out;
    })
    .catch(() => ({ events: [], trace: [], raw: [] }));
  allEvents.push(...dump.events);
  allTrace.push(...dump.trace);
  allRaw.push(...dump.raw);
  // Roll the page-side melee-kill count into the cross-reload accumulator
  // (the page buffer is cleared by this drain; probe() restarts at 0).
  const rows = dump.raw as ({ t?: string; epoch?: number; me?: string } & Record<string, unknown>)[];
  for (const r of rows) {
    if (r.t !== "player-killed" || !r.me || r.killerId !== r.me) continue;
    const batch = rows.filter((o) => o.epoch === r.epoch);
    if (batch.some((o) => (o.t === "slash-hit" || o.t === "bash-landed") && o.attackerId === r.me)) {
      harvestedMyMeleeKills += 1;
    }
  }
  lastMyMeleeKills = 0;
}

await joinArena(page);

const started = Date.now();
let prev: Probe | null = null;
let shot = 0;
let meMissingSince: number | null = null;
let lastLogAt = 0;
let totalSlashHit = 0;
let totalBash = 0;
let totalKills = 0;
let lastMyMeleeKills = 0;
let harvestedMyMeleeKills = 0;
while (Date.now() - started < CAP_MS) {
  await page.waitForTimeout(400);
  await autoPick();
  // Keep the sim loop alive every cycle (idempotent when already running —
  // belt-and-braces against any blur that slipped in before the strip).
  await page
    .evaluate(() => {
      (window as unknown as {
        __jakesjam_game__?: { scene: { getScene(k: string): { renderHostStart?: () => void } | null } };
      }).__jakesjam_game__?.scene.getScene("OnlineMatchScene")?.renderHostStart?.();
    })
    .catch(() => {});
  const c = await probe().catch(() => null);
  if (!c) continue;
  // World recycle detection: our player gone for >25s → rejoin fresh.
  if (c.meAlive === null) {
    meMissingSince ??= Date.now();
    if (Date.now() - meMissingSince > 25_000) {
      console.log("[tape] player gone >25s (world recycled?) — rejoining");
      await harvest();
      meMissingSince = null;
      try {
        await joinArena(page);
      } catch (e) {
        console.log(`[tape] rejoin failed: ${String(e).slice(0, 120)}`);
      }
      continue;
    }
  } else {
    meMissingSince = null;
  }
  if (Date.now() - lastLogAt > 4000) {
    lastLogAt = Date.now();
    console.log(
      `[probe] phase=${c.phase} alive=${c.meAlive} hp=${c.meHp} foeDist=${c.foeDist} ` +
        `swings=${c.slashStarted} hits=${c.slashHit} bash=${c.bashLanded} kills=${c.killed} ` +
        `MYMELEEKILLS=${c.myMeleeKills} trace=${c.trace}`,
    );
  }
  if (c.myMeleeKills > lastMyMeleeKills) {
    lastMyMeleeKills = c.myMeleeKills;
    console.log(`[tape] *** MELEE-CHAIN KILL BY ME #${c.myMeleeKills} — on camera ***`);
    await page.screenshot({
      path: `${OUT}/${TAG}-mykill-${String(c.myMeleeKills).padStart(2, "0")}.png`,
    }).catch(() => {});
  }
  if (
    prev &&
    (c.slashHit > prev.slashHit || c.bashLanded > prev.bashLanded || c.killed > prev.killed)
  ) {
    const kind =
      c.killed > (prev?.killed ?? 0) ? "kill" : c.bashLanded > (prev?.bashLanded ?? 0) ? "bash" : "hit";
    await page.screenshot({
      path: `${OUT}/${TAG}-contact-${String(shot++).padStart(2, "0")}-${kind}.png`,
    }).catch(() => {});
    console.log(
      `[tape] contact ${kind} — hits=${c.slashHit} bash=${c.bashLanded} kills=${c.killed} trace=${c.trace}`,
    );
  }
  prev = c;
  totalSlashHit = allEventsCount("slash-hit") + c.slashHit;
  totalBash = allEventsCount("bash-landed") + c.bashLanded;
  totalKills = allEventsCount("player-killed") + c.killed;
  // Wave-3 exit: at least ONE on-camera melee-chain kill by me (rows 17/18
  // verdict needs it) + the wave-2 contact floor. Linger 2s past the last
  // kill so the full 225ms corpse chord + ring/debris tail are on tape.
  if (
    harvestedMyMeleeKills + c.myMeleeKills >= 1 &&
    totalBash >= 3 &&
    totalSlashHit >= 6 &&
    Date.now() - started > 60_000
  ) {
    await page.waitForTimeout(2000);
    break;
  }
}
function allEventsCount(kind: string): number {
  return (allEvents as { kind?: string }[]).filter((e) => e.kind === kind).length;
}

await harvest();
writeFileSync(`${OUT}/${TAG}-events.json`, JSON.stringify(allEvents, null, 1));
writeFileSync(`${OUT}/${TAG}-trace.json`, JSON.stringify(allTrace));
writeFileSync(`${OUT}/${TAG}-raw.json`, JSON.stringify(allRaw, null, 1));
writeFileSync(
  `${OUT}/${TAG}-meta.json`,
  JSON.stringify({ videoT0, myMeleeKills: harvestedMyMeleeKills }, null, 1),
);
console.log(
  `[tape] events=${allEvents.length} traceSamples=${allTrace.length} → ${OUT}/${TAG}-{events,trace}.json`,
);

const video = page.video();
await ctx.close(); // flushes the webm
if (video) console.log(`[tape] video: ${await video.path()}`);
await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS:\n" + errors.slice(0, 10).join("\n"));
}
console.log(`ok — ${TAG} tape complete`);
