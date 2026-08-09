// Autoplay harness — an automated pilot that plays a WHOLE scripted game
// and records it (Jake, 2026-07-17: "automated bot that can move around,
// play effectively, whole scripted game, record it, light on resources").
//
//   bun scripts/autoplay.ts                 # light mode (default)
//   bun scripts/autoplay.ts --heavy         # content-testing mode
//   bun scripts/autoplay.ts --minutes 10    # longer session cap
//   bun scripts/autoplay.ts --url http://localhost:8088
//   bun scripts/autoplay.ts --full-match    # footage run: play to the end,
//                                           # never exit on scenario beats
//
// The full loop it drives (the real player journey, not a shortcut):
//   splash deep-link → VENUE LOBBY → walk to the bell (position-steered,
//   hops cover pylons) → queue → starter draft pick → admitted at the bell
//   → ARENA: seek/aim/fire/dodge pilot vs whoever is in the world, drafts
//   between rounds → match results → done. WebM lands in
//   tests/e2e/.artifacts/autoplay/.
//
// LIGHT (default): headless, 960×540, ?quality=potato (game's own lowest
// render tier: 0.75× scale, 30fps cap, baked rigs, fx off), music+sfx
// muted, clips consent off. ~1 chromium tab of load.
// HEAVY (--heavy): 1280×720 + quality=standard — for eyeballing new
// content (cards, maps, vfx) at representative fidelity.
//
// The pilot drives TRUSTED inputs (Playwright keyboard/mouse over CDP) at
// ~5Hz decisions — same event path as a human, so input bugs aren't
// bypassed. It is deliberately server-agnostic: point --url anywhere.

import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  collectObservedBeats,
  findCausalProjectilePair,
  hasAllRequiredBeats,
  makeUnreviewedManifest,
  type PresentationEvidenceEvent,
} from "./presentationEvidence.js";
import { presentationScenario } from "./presentationScenarios.js";

// ── args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const HEAVY = flag("heavy");
const DIRECT_ARENA = flag("direct-arena");
/** Footage mode (P2 cadence): keep piloting until the match ends or the
 *  minutes cap, instead of ending the tape the moment the scenario's
 *  authoritative beats are captured. Evidence runs want the short tape;
 *  clip runs want a whole match, because the host only renders highlights
 *  from a HUMAN's kill moments (matchHost.ts) and one confirmed hit is not
 *  a highlight reel. */
const FULL_MATCH = flag("full-match");
const BASE_URL = opt("url", "http://localhost:8088");
const GAME_SERVER = opt("game-server", "");
const MAX_MINUTES = Number(opt("minutes", HEAVY ? "10" : "6"));
const QUALITY = opt("quality", HEAVY ? "standard" : "potato");
const SCENARIO_ID = opt("scenario", "core-starter-shot");
const SCENARIO = presentationScenario(SCENARIO_ID);
if (!SCENARIO) throw new Error(`unknown presentation scenario: ${SCENARIO_ID}`);
if (QUALITY !== "potato" && QUALITY !== "phone" && QUALITY !== "standard") {
  throw new Error(`evidence quality must be potato, phone, or standard; got ${QUALITY}`);
}
const VIEW = HEAVY ? { width: 1280, height: 720 } : { width: 960, height: 540 };
const OUT_DIR = "tests/e2e/.artifacts/autoplay";
const BELL_X = 2250; // vessel-nexus bell totem (resolveVenueTotems)

type GameHandle = {
  __jakesjam_game__?: {
    scene: {
      isActive(k: string): boolean;
      getScene(k: string): unknown;
    };
  };
};

type EvidenceWindow = Window & {
  __jakesjam_presentation_events__?: PresentationEvidenceEvent[];
  __jakesjam_evidence_audio_stream__?: MediaStream;
  __jakesjam_evidence_audio_recorder__?: MediaRecorder;
  __jakesjam_evidence_audio_chunks__?: Blob[];
};

async function startAudioEvidenceRecorder(page: Page): Promise<boolean> {
  // Each scene owns its own ProceduralAudio context. Trigger the arena
  // context's gesture unlock, then record the evidence-only mirror of its
  // already-mixed master bus.
  await page.keyboard.press("Shift").catch(() => {});
  const streamReady = await page.waitForFunction(
    () => (window as EvidenceWindow).__jakesjam_evidence_audio_stream__?.active === true,
    undefined,
    { timeout: 5000 },
  ).then(() => true).catch(() => false);
  if (!streamReady) return false;
  return page.evaluate(() => {
    const evidence = window as EvidenceWindow;
    const stream = evidence.__jakesjam_evidence_audio_stream__;
    if (!stream || typeof MediaRecorder === "undefined") return false;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.start(250);
    evidence.__jakesjam_evidence_audio_chunks__ = chunks;
    evidence.__jakesjam_evidence_audio_recorder__ = recorder;
    return true;
  });
}

async function stopAudioEvidenceRecorder(page: Page): Promise<number[] | null> {
  return page.evaluate(() => new Promise<number[] | null>((resolve) => {
    const evidence = window as EvidenceWindow;
    const recorder = evidence.__jakesjam_evidence_audio_recorder__;
    const chunks = evidence.__jakesjam_evidence_audio_chunks__ ?? [];
    if (!recorder || recorder.state === "inactive") {
      resolve(null);
      return;
    }
    recorder.addEventListener("stop", async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      resolve(Array.from(new Uint8Array(await blob.arrayBuffer())));
    }, { once: true });
    recorder.stop();
  }));
}

// ── page-side probes (single evaluate each — keep CDP chatter low) ─────
function probeArena(page: Page) {
  return page.evaluate(() => {
    type P = {
      x: number; y: number; vx?: number; vy?: number;
      alive: boolean; health: number; abilityCharge?: number;
    };
    type Scene = {
      loop: { getRenderState(): { players: Record<string, P>; round: { phase: string } } | null } | null;
      localPlayerId: string;
      cameras: { main: { worldView: { x: number; y: number; width: number; height: number } } };
      totems?: Array<{ id: string; x: number }>;
      venueStatus?: { queued: string[]; duoQueued: string[] } | null;
    };
    const g = (window as unknown as GameHandle).__jakesjam_game__;
    if (!g) return null;
    const inArena = g.scene.isActive("OnlineMatchScene");
    const scene = g.scene.getScene(
      inArena ? "OnlineMatchScene" : "HangoutScene",
    ) as Scene | null;
    const state = scene?.loop?.getRenderState();
    if (!scene || !state) return { inArena, phase: null, me: null, enemy: null, loadoutX: 750, queued: false, draftOpen: false, ended: false };
    const me = state.players[scene.localPlayerId] ?? null;
    // Nearest living enemy, projected into SCREEN space for real mouse aim.
    let enemy: { sx: number; sy: number; dist: number } | null = null;
    if (me) {
      const wv = scene.cameras.main.worldView;
      for (const [pid, p] of Object.entries(state.players)) {
        if (pid === scene.localPlayerId || !p.alive) continue;
        const dist = Math.hypot(p.x - me.x, p.y - me.y);
        if (!enemy || dist < enemy.dist) {
          // Starter crystal travels at 650 px/s. Lead the live render-state
          // velocity by its approximate time-of-flight so the evidence pilot
          // exercises the real projectile collision path against moving bots
          // instead of needing a stationary/teleported dummy.
          const leadSec = Math.min(0.55, dist / 650);
          const predictedX = p.x + (p.vx ?? 0) * leadSec;
          const predictedY = p.y + (p.vy ?? 0) * leadSec;
          enemy = {
            sx: ((predictedX - wv.x) / wv.width) * window.innerWidth,
            sy: ((predictedY - wv.y) / wv.height) * window.innerHeight,
            dist,
          };
        }
      }
    }
    const visible = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      // Overlay roots live in the DOM from scene-create — only a computed
      // visible display counts as "shown".
      return el !== null && getComputedStyle(el).display !== "none";
    };
    return {
      inArena,
      phase: state.round.phase,
      me: me
        ? { x: me.x, y: me.y, alive: me.alive, health: me.health, charge: me.abilityCharge ?? 0 }
        : null,
      enemy,
      loadoutX: scene.totems?.find((totem) => totem.id === "totem-loadout")?.x ?? 750,
      queued:
        (scene.venueStatus?.queued.includes(scene.localPlayerId) ?? false) ||
        (scene.venueStatus?.duoQueued.includes(scene.localPlayerId) ?? false),
      draftOpen: visible("[data-card-draft]"),
      ended: visible("[data-match-results]"),
    };
  });
}

async function pickDraftCard(page: Page): Promise<void> {
  const plates = page.locator("[data-card-draft] [data-card-plate]");
  if ((await plates.count()) > 0) {
    await plates.nth(Math.floor(Math.random() * (await plates.count()))).click({ timeout: 2000 }).catch(() => {});
  }
}

// ── main ────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const startedAt = Date.now();
const runId = `${SCENARIO.id}-${QUALITY}-${startedAt}`;
const deadline = startedAt + MAX_MINUTES * 60_000;
const pilotId = `autopilot_${Math.random().toString(36).slice(2, 8)}`;
const errors: string[] = [];

console.log(`[autoplay] ${HEAVY ? "HEAVY" : "light"} — scenario=${SCENARIO.id} ${VIEW.width}×${VIEW.height} quality=${QUALITY} cap=${MAX_MINUTES}min → ${BASE_URL}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEW,
  recordVideo: { dir: OUT_DIR, size: VIEW },
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 160));
});

await page.addInitScript(({ id, characterId }) => {
  localStorage.setItem("jakesjam.playerId", id);
  localStorage.setItem("jakesjam.playerName", "AUTOPILOT");
  localStorage.setItem("jakesjam-ftue-first-draft-shown", "1");
  localStorage.setItem("jakesjam.musicMuted", "true");
  // Evidence is specifically responsible for the audible fingerprint. Keep
  // music out of the review track, but never mute the SFX under test.
  localStorage.setItem("jakesjam.sfxMuted", "false");
  localStorage.setItem("jakesjam.clipsConsent", "0");
  localStorage.setItem("jakesjam.playerCharacter", characterId);
  sessionStorage.setItem("jakesjam.sessionSuffix", "auto");
  const evidenceWindow = window as EvidenceWindow;
  evidenceWindow.__jakesjam_presentation_events__ = [];
  window.addEventListener("jakesjam:presentation-event", (raw) => {
    const detail = (raw as CustomEvent<PresentationEvidenceEvent>).detail;
    evidenceWindow.__jakesjam_presentation_events__?.push(detail);
  });
}, { id: pilotId, characterId: SCENARIO.characterId });

const pageUrl = new URL(BASE_URL);
pageUrl.searchParams.set("world", "1");
pageUrl.searchParams.set("gate", "off");
pageUrl.searchParams.set("evidence", "1");
pageUrl.searchParams.set("quality", QUALITY);
if (GAME_SERVER) pageUrl.searchParams.set("server", GAME_SERVER);
await page.goto(pageUrl.toString());
await page.waitForSelector("#game-root canvas", { timeout: 30_000 });
await page.waitForFunction(
  () => (window as unknown as GameHandle).__jakesjam_game__?.scene.isActive("HangoutScene") ?? false,
  undefined,
  { timeout: 30_000 },
);
console.log(`[autoplay] in the venue lobby at +${Date.now() - startedAt}ms — ${DIRECT_ARENA ? "forced arena handoff" : "walking to the bell"}`);
await page.waitForTimeout(1500);

// Phase 1: steer to the bell, queue, pick the starter card.
let prevX: number | null = null;
let queuedAt = 0;
let loadoutEquipped = (SCENARIO.requiredCardIds?.length ?? 0) === 0;
let nextVenueTraceAt = 0;
if (DIRECT_ARENA) {
  if (!loadoutEquipped) {
    throw new Error(`scenario ${SCENARIO.id}: direct arena requires a server-side loadout force hook`);
  }
  // Evidence-only orchestration seam: skip the product journey, not the
  // authoritative arena. The browser still opens a real /ws/world socket and
  // the isolated fresh WorldHost admits it during countdown.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jakesjam:venue-admitted")));
  queuedAt = Date.now();
} else while (Date.now() < deadline) {
  const probe = await probeArena(page);
  if (!probe?.me) {
    await page.waitForTimeout(400);
    continue;
  }
  if (loadoutEquipped && probe.queued) {
    await page.keyboard.up("d").catch(() => {});
    await page.keyboard.up("a").catch(() => {});
    queuedAt = Date.now();
    console.log(`[autoplay] queued at the bell at +${queuedAt - startedAt}ms — waiting for admission`);
    break;
  }
  if (probe.draftOpen) {
    await page.keyboard.up("d").catch(() => {});
    await page.keyboard.up("a").catch(() => {});
    await page.keyboard.up("w").catch(() => {});
    if (!loadoutEquipped && SCENARIO.requiredCardIds) {
      // A wall-jump can carry the pilot through the station's circular
      // trigger while still airborne. Let the body settle and confirm the
      // panel stayed open before attempting a real pointer click.
      await page.waitForTimeout(750);
      const settled = await probeArena(page);
      if (!settled?.draftOpen) {
        console.log(`[autoplay] station fly-through at y=${Math.round(probe.me.y)} — settling and retrying`);
        continue;
      }
      for (const cardId of SCENARIO.requiredCardIds) {
        // Scene overlays are constructed up-front and kept in the DOM while
        // hidden. Scope to the station that is actually on screen; otherwise
        // Playwright can resolve an older hidden HangoutScene tile first.
        const tile = page.locator(
          `[data-card-draft]:visible [data-catalog-tile="${cardId}"]:visible`,
        );
        if ((await tile.count()) === 0) {
          throw new Error(`scenario ${SCENARIO.id}: visible catalog tile ${cardId} not available`);
        }
        await tile.first().scrollIntoViewIfNeeded({ timeout: 2000 });
        await tile.first().click({ timeout: 3000 });
        console.log(`[autoplay] equipped ${cardId} for ${SCENARIO.id}`);
      }
      loadoutEquipped = true;
      // Leave the station's hysteresis radius so the overlay closes and the
      // bell's starter offer can be distinguished from the catalog.
      await page.keyboard.down("d");
      await page.waitForTimeout(1200);
      await page.keyboard.up("d");
      continue;
    }
    await pickDraftCard(page);
    // Starter draft overlays are legacy-compatible here; current venue
    // queues admit directly. Queue truth comes from venueStatus above so
    // lingering near the bell can never toggle the pilot straight back out.
    await page.waitForTimeout(300);
    continue;
  }
  const x = probe.me.x;
  const stalled = prevX !== null && Math.abs(x - prevX) < 12;
  prevX = x;
  const targetX = loadoutEquipped ? BELL_X : probe.loadoutX;
  if (Date.now() >= nextVenueTraceAt) {
    nextVenueTraceAt = Date.now() + 2000;
    console.log(`[autoplay] venue x=${Math.round(x)} target=${Math.round(targetX)} loadout=${loadoutEquipped ? "equipped" : "pending"} stalled=${stalled}`);
  }
  const key = x < targetX ? "d" : "a";
  await page.keyboard.down(key);
  if (stalled) {
    // Vessel Nexus has tall floor-band chimney columns. One short ground hop
    // repeatedly cut itself before reaching a wall-jump, pinning the pilot at
    // x≈1541 forever. Pulse jump edges while continuing toward the target:
    // each wall contact gets a fresh authoritative wall-jump, then horizontal
    // intent steers back to the wall for the next climb beat.
    for (let hop = 0; hop < 6; hop++) {
      await page.keyboard.down("w");
      await page.waitForTimeout(55);
      await page.keyboard.up("w");
      await page.waitForTimeout(145);
    }
  }
  await page.waitForTimeout(400);
  await page.keyboard.up(key);
  if (Math.abs(x - targetX) < 60) await page.waitForTimeout(600);
}
if (queuedAt === 0) throw new Error("never reached the bell / no starter offer — see video");

// Phase 2: admitted → arena pilot until the match ends (or time cap).
await page.waitForFunction(
  () => (window as unknown as GameHandle).__jakesjam_game__?.scene.isActive("OnlineMatchScene") ?? false,
  undefined,
  { timeout: 200_000 },
);
console.log(`[autoplay] ADMITTED to the arena at +${Date.now() - startedAt}ms — piloting`);
const audioRecording = await startAudioEvidenceRecorder(page);
console.log(`[autoplay] audio-only evidence ${audioRecording ? "recording" : "UNAVAILABLE"}`);
// Queue admission is deliberately bell-gated and can consume most of a short
// evidence cap. Never arrive with only a few seconds left to exercise the
// package; once admitted, guarantee one bounded 30s observation window.
const arenaDeadline = Math.max(deadline, Date.now() + 30_000);

let firing = false;
let strafeDir: "a" | "d" = "d";
let strafeFlipAt = 0;
let arenaPrevX: number | null = null;
let roundsSeen = new Set<string>();
let slotTapAt = 0;
let slotCursor = 0;
let nextStarterShotAt = 0;
const isolatedStarterShot = SCENARIO.id === "core-starter-shot";
const requiredAbilityKind = SCENARIO.requiredBeats
  .find((beat) => beat.startsWith("ability:"))
  ?.slice("ability:".length);

async function scenarioBeatsSatisfied(): Promise<boolean> {
  const captured = await page.evaluate(() =>
    ((window as EvidenceWindow).__jakesjam_presentation_events__ ?? []).slice(),
  );
  if (!hasAllRequiredBeats(SCENARIO, collectObservedBeats(captured))) return false;
  if (SCENARIO.minimumProjectileFlightTicks !== undefined) {
    return findCausalProjectilePair(
      captured,
      SCENARIO.minimumProjectileFlightTicks,
    ) !== undefined;
  }
  return true;
}

while (Date.now() < arenaDeadline) {
  const probe = await probeArena(page);
  if (!probe) break;
  if (probe.ended) {
    console.log(`[autoplay] match ended at +${Date.now() - startedAt}ms`);
    await page.waitForTimeout(3000); // results screen on tape
    break;
  }
  if (probe.phase) roundsSeen.add(probe.phase);
  if (probe.draftOpen) {
    if (firing) { await page.mouse.up(); firing = false; }
    await page.keyboard.up(strafeDir).catch(() => {});
    await pickDraftCard(page);
    await page.waitForTimeout(500);
    continue;
  }
  if (probe.phase !== "fighting" || !probe.me?.alive) {
    if (firing) { await page.mouse.up(); firing = false; }
    await page.keyboard.up(strafeDir).catch(() => {});
    await page.waitForTimeout(400);
    continue;
  }
  // FIGHT: aim at the nearest enemy, burst fire, keep mid-range, hop around.
  if (probe.enemy) {
    const sx = Math.max(4, Math.min(VIEW.width - 4, probe.enemy.sx));
    const sy = Math.max(4, Math.min(VIEW.height - 4, probe.enemy.sy));
    await page.mouse.move(sx, sy);
    if (isolatedStarterShot) {
      // One discrete throw sentence at a time: press → release → visible
      // recovery. Holding M1 produced a machine-gun tape in which the action
      // was triggerable but the package's recovery could not be judged.
      const cleanStarterRange = probe.enemy.dist >= 140 && probe.enemy.dist <= 700;
      if (cleanStarterRange && Date.now() >= nextStarterShotAt) {
        await page.mouse.click(sx, sy, { delay: 45 });
        nextStarterShotAt = Date.now() + 420;
      }
    } else if (!firing) {
      await page.mouse.down();
      firing = true;
    }
    // Range discipline: close in when far, back off point-blank. Starter-shot
    // evidence deliberately works closer than general combat so a short tape
    // reliably contains one honest local hit without spawning/teleporting a
    // target or relaxing the authoritative collision path.
    const towardEnemy = probe.enemy.sx > VIEW.width / 2 ? "d" : "a";
    const closeRange = isolatedStarterShot ? 600 : 520;
    const want: "a" | "d" =
      probe.enemy.dist > closeRange ? towardEnemy
      : probe.enemy.dist < (isolatedStarterShot ? 140 : 170)
        ? (towardEnemy === "d" ? "a" : "d")
      : strafeDir;
    if (want !== strafeDir || Date.now() > strafeFlipAt) {
      await page.keyboard.up(strafeDir).catch(() => {});
      strafeDir = want === strafeDir ? (strafeDir === "d" ? "a" : "d") : want;
      strafeFlipAt = Date.now() + 1200 + Math.random() * 1500;
      await page.keyboard.down(strafeDir);
    }
  } else if (firing) {
    await page.mouse.up();
    firing = false;
  }
  // Hop when stuck on geometry or just to be a harder target.
  const stalled = arenaPrevX !== null && probe.me && Math.abs(probe.me.x - arenaPrevX) < 8;
  arenaPrevX = probe.me?.x ?? null;
  if (stalled || Math.random() < 0.12) {
    await page.keyboard.down("w");
    await page.waitForTimeout(180);
    await page.keyboard.up("w");
  }
  // Shield bash (RMB, 3s cooldown) when someone is point-blank.
  if (probe.enemy && probe.enemy.dist < 200 && Math.random() < 0.3) {
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: "right" });
  }
  // EMISSION (six-axes): cast the moment the meter fills — the client only
  // sends the Ability bit at full predicted charge, so tapping E below
  // full is inert by design; gate here anyway to log real casts.
  if (probe.me.charge >= 100) {
    await page.keyboard.press("e").catch(() => {});
    console.log(`[autoplay] EMISSION cast at +${Date.now() - startedAt}ms`);
  }
  // Drafted actives (six-axes): rotate a tap across the canonical three
  // slots every ~3s —
  // sim-validated no-ops for empty/cooling slots, real activations when a
  // drafted ability card is ready.
  if (Date.now() > slotTapAt) {
    slotTapAt = Date.now() + 3000 + Math.random() * 2000;
    slotCursor = (slotCursor % 3) + 1;
    await page.keyboard.press(String(slotCursor)).catch(() => {});
    console.log(`[autoplay] slot ${slotCursor} tap at +${Date.now() - startedAt}ms`);
    if (requiredAbilityKind) {
      await page.waitForTimeout(100);
      const captured = await page.evaluate((kind) =>
        ((window as EvidenceWindow).__jakesjam_presentation_events__ ?? [])
          .some((event) => event.kind === "ability-activated" && event.abilityKind === kind),
      requiredAbilityKind);
      if (captured) {
        console.log(`[autoplay] captured authoritative ability:${requiredAbilityKind} — scenario beat satisfied`);
        await page.waitForTimeout(700); // retain the authored recovery on tape
        if (!FULL_MATCH) break;
      }
    }
  }
  // This applies to every package, not only drafted abilities. Once all
  // authoritative beats are present, preserve the recovery sentence and end
  // the tape instead of burning minutes waiting for a whole match result.
  if (!FULL_MATCH && (await scenarioBeatsSatisfied())) {
    console.log(`[autoplay] all authoritative beats satisfied for ${SCENARIO.id}`);
    await page.waitForTimeout(700);
    break;
  }
  await page.waitForTimeout(200); // ~5Hz decisions
}

// ── report ──────────────────────────────────────────────────────────────
if (firing) await page.mouse.up().catch(() => {});
const stats = await page
  .evaluate(() => localStorage.getItem("jakesjam.playerStats"))
  .catch(() => null);
const observedEvents = await page.evaluate(() =>
  ((window as EvidenceWindow).__jakesjam_presentation_events__ ?? []).slice(),
);
const audioBytes = await stopAudioEvidenceRecorder(page).catch(() => null);
const video = page.video();
await context.close(); // flushes the recording
await browser.close();
const videoPath = video ? await video.path().catch(() => "(unavailable)") : "(none)";
const observedBeats = collectObservedBeats(observedEvents);
const evidenceDir = "tests/e2e/.artifacts/presentation";
mkdirSync(evidenceDir, { recursive: true });
const manifest = makeUnreviewedManifest(SCENARIO, {
  runId,
  qualityTier: QUALITY,
  viewport: VIEW,
  startedAt: new Date(startedAt).toISOString(),
});
manifest.videoPath = videoPath === "(none)" || videoPath === "(unavailable)" ? null : videoPath;
if (audioBytes && audioBytes.length > 0) {
  const audioPath = `${evidenceDir}/${runId}-audio.webm`;
  writeFileSync(audioPath, Uint8Array.from(audioBytes));
  manifest.audioPath = audioPath;
}
manifest.observedBeats = observedBeats;
manifest.observedEvents = observedEvents;
const manifestPath = `${evidenceDir}/${runId}.json`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log("\n[autoplay] ── session report ─────────────────────────────");
console.log(`  duration : ${Math.round((Date.now() - startedAt) / 1000)}s (cap ${MAX_MINUTES}min)`);
console.log(`  phases   : ${[...roundsSeen].join(", ") || "(none seen)"}`);
console.log(`  record   : ${stats ?? "(no stats blob)"}`);
console.log(`  errors   : ${errors.length === 0 ? "none" : ""}`);
for (const e of errors.slice(0, 10)) console.log(`    - ${e}`);
console.log(`  video    : ${videoPath}`);
console.log(`  evidence : ${manifestPath} (${observedEvents.length} authoritative events; unreviewed)`);
if (errors.length > 0) process.exitCode = 1;
