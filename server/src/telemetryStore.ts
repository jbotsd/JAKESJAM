// Sovereign telemetry store (docs/TELEMETRY.md) — the server half of the
// no-bug-report pipeline. Flat JSONL day files + a signature dedupe index,
// on our own disk, size-capped. The privacy contract is enforced HERE as
// well as client-side: the ingest path never receives the remote address,
// and the stored record is exactly the validated client payload + a
// server timestamp.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TELEMETRY_DIR = resolve(import.meta.dir, "..", ".telemetry");
const SIG_PATH = resolve(TELEMETRY_DIR, "signatures.json");
/** Events are small JSON lines; 50MB is months of headroom. */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** Shape caps — anything beyond these is a malformed/hostile payload. */
const MAX_EVENTS_PER_BATCH = 40;
const MAX_MESSAGE_LEN = 500;
const MAX_STACK_LEN = 4_000;
const MAX_CRUMBS = 48;
const MAX_CRUMB_LEN = 200;
const MAX_DATA_KEYS = 16;

const VALID_KINDS = new Set(["error", "context-loss", "net", "perf", "boot"]);

export type StoredTelemetryEvent = {
  at: string; // server ISO timestamp
  session: string;
  build: string;
  seq: number;
  kind: string;
  sig: string;
  message: string;
  stack?: string;
  crumbs?: string[];
  data?: Record<string, string | number | boolean>;
};

type SignatureIndex = Record<
  string,
  {
    kind: string;
    message: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    lastBuild: string;
    /** One full sample (stack + crumbs) kept per signature. */
    sample?: { stack?: string; crumbs?: string[]; data?: Record<string, unknown> };
  }
>;

let dirReady = false;
let sigIndex: SignatureIndex | null = null;
let sigDirty = false;
let lastSigFlush = 0;

function ensureDir(): void {
  if (dirReady) return;
  mkdirSync(TELEMETRY_DIR, { recursive: true });
  dirReady = true;
}

// ── New-signature alerting ──────────────────────────────────────────
// When a NEVER-seen error signature lands, ping Jake (desktop + SimpleX)
// so he can prompt a fix. Human in the loop — no automation beyond the
// ping. Storm-capped so a Fight Night incident can't flood the channels.
const ALERT_KINDS = new Set(["error", "context-loss"]);
const alertTimes: number[] = [];
const ALERT_CAP = 5; // max alerts per 10 minutes; overflow logs only

function alertNewSignature(sig: string, kind: string, message: string, build: string): void {
  const now = Date.now();
  while (alertTimes.length > 0 && now - alertTimes[0]! > 600_000) alertTimes.shift();
  if (alertTimes.length >= ALERT_CAP) {
    console.warn(`[telemetry] new sig ${sig} (alert cap reached, logged only): ${message}`);
    return;
  }
  alertTimes.push(now);
  const text = `JAKESJAM new ${kind}: [${sig}] ${message.slice(0, 140)} (build ${build}) — ask Claude to check the error pipeline`;
  try {
    Bun.spawn(["notify-send", "-u", "critical", "-a", "JAKESJAM", "New game error", text], {
      stdout: "ignore", stderr: "ignore",
    });
  } catch { /* headless host — fine */ }
  try {
    Bun.spawn(["/home/jimothy/.local/bin/simplex-alert", text], {
      stdout: "ignore", stderr: "ignore",
    });
  } catch { /* channel down — desktop notify still fired */ }
}

function loadSigIndex(): SignatureIndex {
  if (sigIndex) return sigIndex;
  try {
    sigIndex = JSON.parse(readFileSync(SIG_PATH, "utf8")) as SignatureIndex;
  } catch {
    sigIndex = {};
  }
  return sigIndex;
}

function flushSigIndex(): void {
  if (!sigDirty || !sigIndex) return;
  // Coalesce writes — a crash-looping client must not thrash the disk.
  if (Date.now() - lastSigFlush < 5_000) return;
  try {
    ensureDir();
    Bun.write(SIG_PATH, `${JSON.stringify(sigIndex, null, 2)}\n`);
    sigDirty = false;
    lastSigFlush = Date.now();
  } catch {
    // Best effort.
  }
}

function enforceQuota(): void {
  try {
    const entries = readdirSync(TELEMETRY_DIR)
      .filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"))
      .map((f) => {
        const p = resolve(TELEMETRY_DIR, f);
        const st = statSync(p);
        return { p, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((s, e) => s + e.size, 0);
    for (const e of entries) {
      if (total <= MAX_TOTAL_BYTES) break;
      unlinkSync(e.p);
      total -= e.size;
    }
  } catch {
    // Best effort.
  }
}

function cleanData(
  raw: unknown,
): Record<string, string | number | boolean> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_DATA_KEYS) break;
    if (typeof v === "string") out[k.slice(0, 40)] = v.slice(0, 300);
    else if (typeof v === "number" && Number.isFinite(v)) out[k.slice(0, 40)] = v;
    else if (typeof v === "boolean") out[k.slice(0, 40)] = v;
    else continue;
    n += 1;
  }
  return n > 0 ? out : undefined;
}

/**
 * Validate + persist one client batch. Returns the number of stored events
 * (0 for malformed payloads). Never throws. NOTE: deliberately takes no
 * request/IP argument — the caller must not pass one (privacy contract).
 */
export function ingestTelemetryBatch(payload: unknown): number {
  try {
    if (typeof payload !== "object" || payload === null) return 0;
    const p = payload as { v?: unknown; session?: unknown; build?: unknown; events?: unknown };
    if (p.v !== 1 || typeof p.session !== "string" || !Array.isArray(p.events)) return 0;
    const session = p.session.slice(0, 64);
    const build = typeof p.build === "string" ? p.build.slice(0, 32) : "unknown";
    const at = new Date().toISOString();
    const index = loadSigIndex();
    let stored = 0;
    ensureDir();
    const dayFile = resolve(TELEMETRY_DIR, `events-${at.slice(0, 10)}.jsonl`);
    let lines = "";
    for (const raw of p.events.slice(0, MAX_EVENTS_PER_BATCH)) {
      if (typeof raw !== "object" || raw === null) continue;
      const e = raw as Record<string, unknown>;
      if (typeof e.kind !== "string" || !VALID_KINDS.has(e.kind)) continue;
      if (typeof e.sig !== "string" || typeof e.message !== "string") continue;
      const ev: StoredTelemetryEvent = {
        at,
        session,
        build,
        seq: typeof e.seq === "number" ? e.seq : 0,
        kind: e.kind,
        sig: e.sig.slice(0, 32),
        message: e.message.slice(0, MAX_MESSAGE_LEN),
      };
      if (typeof e.stack === "string") ev.stack = e.stack.slice(0, MAX_STACK_LEN);
      if (Array.isArray(e.crumbs)) {
        ev.crumbs = e.crumbs
          .slice(0, MAX_CRUMBS)
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.slice(0, MAX_CRUMB_LEN));
      }
      const data = cleanData(e.data);
      if (data) ev.data = data;
      lines += `${JSON.stringify(ev)}\n`;
      stored += 1;

      const sig = index[ev.sig];
      if (sig) {
        sig.count += 1;
        sig.lastSeen = at;
        sig.lastBuild = build;
      } else {
        index[ev.sig] = {
          kind: ev.kind,
          message: ev.message.slice(0, 200),
          count: 1,
          firstSeen: at,
          lastSeen: at,
          lastBuild: build,
          sample: { stack: ev.stack, crumbs: ev.crumbs, data: ev.data },
        };
        if (ALERT_KINDS.has(ev.kind)) {
          alertNewSignature(ev.sig, ev.kind, ev.message, build);
        }
      }
      sigDirty = true;
    }
    if (stored > 0) {
      appendFileSync(dayFile, lines);
      enforceQuota();
      flushSigIndex();
    }
    return stored;
  } catch (err) {
    console.warn(`[telemetry] ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** Top signatures for the ops summary, most-recent-first. */
export function telemetrySummary(limit = 50): {
  signatures: Array<{ sig: string } & SignatureIndex[string]>;
  storeBytes: number;
} {
  const index = loadSigIndex();
  const signatures = Object.entries(index)
    .map(([sig, v]) => ({ sig, ...v }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, limit);
  let storeBytes = 0;
  try {
    for (const f of readdirSync(TELEMETRY_DIR)) {
      storeBytes += statSync(resolve(TELEMETRY_DIR, f)).size;
    }
  } catch {
    // Dir may not exist yet.
  }
  return { signatures, storeBytes };
}
