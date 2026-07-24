// Interstice LIVE victim-channel + contact-clock tape (slash-feel-ledger
// wave 2, I5) — mirrors kindledLiveTape.ts's K10 approach exactly (own
// :8090 server, boxworks-mini flat map so pursuit needs no pathing, unique
// per-run playerId, blur-strip, raw event hook, __rigDebug rAF sampler,
// on-camera melee-chain kill detector) but drives an INTERSTICE (sprinter
// chassis) instead of Kindled. Records:
//
//   1. numeric trace: __rigDebug().impact + the new getMeleePose() clock
//      exposure (I4) every rendered frame — the contact-frame alignment
//      verification (R1 row 2) needs "where was the render clock when the
//      sim's slash-hit arrived", which the trace's meleePose fields answer
//      without frame-counting video.
//   2. event log + raw authoritative events (epoch-stamped).
//   3. video + on-camera-kill screenshots.
//
// NEVER points at :8088 (production / the other worktree's server). Run
// against THIS worktree's server:
//   BASE_URL=http://localhost:8090 bun run scripts/intersticeLiveTape.ts

import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/d9fd0248-ff4f-49ff-85d4-ab426f99cd6a/scratchpad/interstice-feel";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:8090";
if (BASE.includes("8088")) {
  console.error("refusing to tape against :8088 — that is the other worktree's server");
  process.exit(1);
}
const TAG = process.env.TAG ?? "live-i1";
const CAP_MS = Number(process.env.CAP_MS ?? 300_000);

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
const videoT0 = Date.now();
page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("ParticlePool")) console.log(`[page-console] ${text}`);
});
const errors: string[] = [];
page.on("pageerror", (e) => {
  errors.push(`${e.name}: ${e.message}`);
  console.log(`[pageerror] ${e.name}: ${e.message.slice(0, 300)}`);
});

const allEvents: unknown[] = [];
const allTrace: unknown[] = [];
const allRaw: unknown[] = [];
const allContactClock: unknown[] = [];

const RUN_ID = Math.random().toString(36).slice(2, 8);
const TIER = process.env.QUALITY_TIER ?? "";
await page.addInitScript(({ runId, tier }) => {
  localStorage.setItem("jakesjam.playerId", `player_feelI_${runId}`);
  localStorage.setItem("jakesjam.playerCharacter", "sprinter"); // Interstice chassis
  if (tier) localStorage.setItem("jj_quality_tier", tier);
  else localStorage.removeItem("jj_quality_tier");
  const w = window as unknown as {
    __feelEvents: unknown[];
    __contactClockSamples: unknown[];
    __rigDebug?: () => ({
      pid: string;
      melee?: { style: string; verb: string; elapsedMs: number; durationMs: number } | null;
    } & Record<string, unknown>)[] | null;
    __jakesjam_game__?: { scene: { getScene(k: string): { localPlayerId?: string } | null } };
  };
  w.__feelEvents = [];
  w.__contactClockSamples = [];
  // R1 row 2 (contact-frame alignment) precision fix: `dispatchEvent` is
  // SYNCHRONOUS, and SimEventRouter.dispatch() emits this evidence event as
  // the FIRST line of each per-event dispatch (before that event's own
  // switch-case mutations, but AFTER every earlier event in the same
  // network batch has already been fully dispatched) — so listening here
  // gives same-JS-tick, correctly-ordered access to `__rigDebug()`'s melee
  // clock at the exact instant the client learned of a slash-hit, with a
  // clean, uncorrupted `atMs` (performance.now()) on the event detail
  // itself. This supersedes the raw onEvents batch-hook approach (that
  // wrapper spreads the sim event LAST, so its own `t` TYPE TAG clobbers a
  // perf-now stamp, and even the surviving epoch/Date.now() is only good to
  // ~100ms — useless against a +-16.67ms/1-tick contract).
  window.addEventListener("jakesjam:presentation-event", (e) => {
    const d = (e as CustomEvent).detail as
      | { kind?: string; atMs?: number; localActor?: boolean }
      | undefined;
    if (!d?.kind) return;
    if (
      ["slash-started", "slash-hit", "bash-landed", "player-killed", "hit-confirmed"].includes(
        d.kind,
      )
    ) {
      w.__feelEvents.push({ ...d });
      if (w.__feelEvents.length > 4000) w.__feelEvents.shift();
    }
    if ((d.kind === "slash-hit" || d.kind === "player-killed") && d.localActor) {
      const me = w.__jakesjam_game__?.scene.getScene("OnlineMatchScene")?.localPlayerId;
      const rows = w.__rigDebug?.() ?? [];
      const myRow = rows.find((r) => r.pid === me);
      w.__contactClockSamples.push({ kind: d.kind, atMs: d.atMs, melee: myRow?.melee ?? null });
      if (w.__contactClockSamples.length > 2000) w.__contactClockSamples.shift();
    }
  });
}, { runId: RUN_ID, tier: TIER });

async function joinArena(p: Page): Promise<void> {
  await p.goto(`${BASE}/?world=1&evidence=1&gate=off`, { waitUntil: "load" });
  await p.waitForFunction(
    () => {
      const g = (window as unknown as { __jakesjam_game__?: { scene: { isActive(k: string): boolean } } })
        .__jakesjam_game__;
      return (g?.scene.isActive("HangoutScene") || g?.scene.isActive("OnlineMatchScene")) ?? false;
    },
    undefined,
    { timeout: 30_000 },
  );
  await p.waitForTimeout(1500);
  for (let attempt = 0; attempt < 6; attempt++) {
    const alreadyInArena = await p.evaluate(
      () =>
        (window as unknown as { __jakesjam_game__?: { scene: { isActive(k: string): boolean } } })
          .__jakesjam_game__?.scene.isActive("OnlineMatchScene") ?? false,
    );
    if (alreadyInArena) break;
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
  // assignment; `private readonly` is TS-only). Used ONLY for the
  // on-camera melee-chain-kill detector (needs attackerId/killerId) — the
  // R1 row 2 contact-clock measurement itself is captured by the evidence
  // listener above (same-tick, correctly batch-ordered, clean atMs).
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

  // In-page rAF trace collector over __rigDebug().impact AND the I4
  // meleePose clock exposure (getMeleePose() -> {style, verb, elapsedMs,
  // durationMs}) threaded onto the debug row — R1 row 2 verification needs
  // the render clock's own idea of "where in the swing am I" alongside the
  // sim's slash-hit arrival, without frame-counting video.
  await p.evaluate(() => {
    const w = window as unknown as {
      __rigDebug?: () => ({
        pid: string;
        x: number;
        y: number;
        impact?: unknown | null;
        melee?: { style: string; verb: string; elapsedMs: number; durationMs: number } | null;
      } & Record<string, unknown>)[] | null;
      __feelTrace: Record<string, unknown>[];
    };
    w.__feelTrace = [];
    const loop = () => {
      const rows = w.__rigDebug?.();
      if (rows) {
        const t = performance.now();
        for (const r of rows) {
          if (r.impact || r.melee) {
            w.__feelTrace.push({
              t,
              pid: r.pid,
              x: r.x,
              y: r.y,
              ...(r.impact ? (r.impact as object) : {}),
              meleePose: r.melee ?? null,
            });
            if (w.__feelTrace.length > 60_000) w.__feelTrace.shift();
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  // Drive: pursue the nearest bot into melee range; toggle Fire for fresh
  // rising edges. Same 170ms toggle as the Kindled tape (K12) — deliberate
  // apples-to-apples so any NEW latency artifact at Interstice's faster
  // true sim cadence (215ms full FSM cycle vs Kindled's much slower one) is
  // attributable to the class, not a different driving rhythm.
  await p.evaluate(() => {
    let fire = false;
    window.setInterval(() => {
      fire = !fire;
      (window as unknown as { __setBotInput?: (g: Record<string, unknown> | null) => void })
        .__setBotInput?.({ moveTowardFoe: true, stopRangePx: 34, aimAtFoe: true, hopWhenStuck: true, fire });
    }, 170);
  });
}

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

async function harvest(): Promise<void> {
  const dump = await page
    .evaluate(() => {
      const w = window as unknown as {
        __feelEvents?: unknown[];
        __feelTrace?: unknown[];
        __rawEvents?: unknown[];
        __contactClockSamples?: unknown[];
      };
      const out = {
        events: w.__feelEvents ?? [],
        trace: w.__feelTrace ?? [],
        raw: w.__rawEvents ?? [],
        contactClock: w.__contactClockSamples ?? [],
      };
      if (w.__feelEvents) w.__feelEvents = [];
      if (w.__feelTrace) w.__feelTrace = [];
      if (w.__rawEvents) w.__rawEvents = [];
      if (w.__contactClockSamples) w.__contactClockSamples = [];
      return out;
    })
    .catch(() => ({ events: [], trace: [], raw: [], contactClock: [] }));
  allEvents.push(...dump.events);
  allTrace.push(...dump.trace);
  allRaw.push(...dump.raw);
  allContactClock.push(...dump.contactClock);
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
let totalKills = 0;
let lastMyMeleeKills = 0;
let harvestedMyMeleeKills = 0;
while (Date.now() - started < CAP_MS) {
  await page.waitForTimeout(400);
  await autoPick();
  await page
    .evaluate(() => {
      (window as unknown as {
        __jakesjam_game__?: { scene: { getScene(k: string): { renderHostStart?: () => void } | null } };
      }).__jakesjam_game__?.scene.getScene("OnlineMatchScene")?.renderHostStart?.();
    })
    .catch(() => {});
  const c = await probe().catch(() => null);
  if (!c) continue;
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
        `swings=${c.slashStarted} hits=${c.slashHit} kills=${c.killed} ` +
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
  if (prev && (c.slashHit > prev.slashHit || c.killed > prev.killed)) {
    const kind = c.killed > (prev?.killed ?? 0) ? "kill" : "hit";
    await page.screenshot({
      path: `${OUT}/${TAG}-contact-${String(shot++).padStart(2, "0")}-${kind}.png`,
    }).catch(() => {});
    console.log(
      `[tape] contact ${kind} — hits=${c.slashHit} kills=${c.killed} trace=${c.trace}`,
    );
  }
  prev = c;
  totalSlashHit = allEventsCount("slash-hit") + c.slashHit;
  totalKills = allEventsCount("player-killed") + c.killed;
  // Exit: at least ONE on-camera melee kill by me + a real contact floor
  // (no bash for Interstice — floor is slash hits only). Linger 2s past the
  // last kill so the full kill chord + shock/debris tail are on tape.
  if (
    harvestedMyMeleeKills + c.myMeleeKills >= 1 &&
    totalSlashHit >= 10 &&
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
writeFileSync(`${OUT}/${TAG}-contactclock.json`, JSON.stringify(allContactClock, null, 1));
writeFileSync(
  `${OUT}/${TAG}-meta.json`,
  JSON.stringify({ videoT0, myMeleeKills: harvestedMyMeleeKills }, null, 1),
);
console.log(
  `[tape] events=${allEvents.length} traceSamples=${allTrace.length} → ${OUT}/${TAG}-{events,trace}.json`,
);

const video = page.video();
await ctx.close();
if (video) console.log(`[tape] video: ${await video.path()}`);
await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS:\n" + errors.slice(0, 10).join("\n"));
}
console.log(`ok — ${TAG} tape complete`);
