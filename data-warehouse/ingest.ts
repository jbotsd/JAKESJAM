// JAKESJAM data warehouse — ingests every internal data source into a single
// queryable SQLite file. Idempotent (safe to re-run any time — uses
// INSERT OR IGNORE / OR REPLACE throughout), so this can be the standing
// "resync the warehouse" command going forward, not a one-shot script.
//
// Usage: bun data-warehouse/ingest.ts

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isTestEmail } from "./testRows.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
// Overridable so the pipeline can be exercised end-to-end against a
// throwaway DB + fixture telemetry. Without this the only way to check
// that a boot field actually reaches its column is to eyeball the live
// warehouse, where "NULL" and "the ingest is broken" look identical.
const DB_PATH = process.env.JAKESJAM_WAREHOUSE_DB ?? resolve(HERE, "jakesjam.db");
const TELEMETRY_DIR = process.env.JAKESJAM_TELEMETRY_DIR ?? resolve(ROOT, "server/.telemetry");

const db = new Database(DB_PATH, { create: true });
db.exec(readFileSync(resolve(HERE, "schema.sql"), "utf8"));

function log(msg: string): void {
  console.log(`[ingest] ${msg}`);
}

// schema.sql is all CREATE TABLE IF NOT EXISTS, so a column added to an
// existing table there reaches a FRESH database and silently misses every
// existing one — the ingest would keep running green while inserting into
// columns that are not there. Additive columns need this to actually land.
function addColumnIfMissing(table: string, column: string, decl: string): void {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (cols.length === 0) return; // table absent — schema.sql just created it
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  log(`migrated: ${table}.${column} added`);
}

for (const col of ["src", "ref_group", "ref", "utm_medium", "utm_campaign", "landing"]) {
  addColumnIfMissing("session_fingerprints", col, "TEXT");
}

// ---------------------------------------------------------------
// Telemetry: server/.telemetry/events-*.jsonl
// ---------------------------------------------------------------
function ingestTelemetry(): number {
  const dir = TELEMETRY_DIR;
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO telemetry_events (at, session, build, seq, kind, sig, message, data_json, source_file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  for (const file of files) {
    const text = readFileSync(resolve(dir, file), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed);
        insert.run(
          ev.at ?? null,
          ev.session ?? null,
          ev.build ?? null,
          ev.seq ?? null,
          ev.kind ?? null,
          ev.sig ?? null,
          ev.message ?? null,
          ev.data ? JSON.stringify(ev.data) : null,
          file,
        );
        n++;
      } catch {
        // skip malformed line
      }
    }
  }
  log(`telemetry_events: ${n} rows processed from ${files.length} files`);
  return n;
}

// Fingerprint every boot event into session_fingerprints, with the same
// dedup heuristics the growth brief's traffic re-audit used by hand:
// RTX 4080 renderer string = Jake's own machine; SwiftShader/empty
// renderer = automated/headless signature; everything else = candidate
// real external visitor.
function buildFingerprints(): number {
  const rows = db
    .query<
      { session: string; at: string; build: string; data_json: string },
      []
    >(`SELECT session, at, build, data_json FROM telemetry_events WHERE kind = 'boot' AND data_json IS NOT NULL`)
    .all();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO session_fingerprints
     (session, at, build, tier, renderer, touch, w, h, dpr, is_jake_rtx4080, is_automation_signature, is_candidate_real_external,
      src, ref_group, ref, utm_medium, utm_campaign, landing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  /** Absent field -> NULL, never "" or "direct": un-instrumented is not
   *  the same fact as un-referred, and only NULL says which one it was. */
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  let n = 0;
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      continue;
    }
    const renderer = String(data.renderer ?? "");
    const isRtx4080 = /RTX 4080/i.test(renderer);
    const isAutomation = /SwiftShader|headless|empty/i.test(renderer) || renderer.trim() === "";
    const isCandidateReal = !isRtx4080 && !isAutomation;
    insert.run(
      row.session,
      row.at,
      row.build,
      (data.tier as string) ?? null,
      renderer || null,
      data.touch ? 1 : 0,
      (data.w as number) ?? null,
      (data.h as number) ?? null,
      (data.dpr as number) ?? null,
      isRtx4080 ? 1 : 0,
      isAutomation ? 1 : 0,
      isCandidateReal ? 1 : 0,
      str(data.src),
      str(data.refGroup),
      str(data.ref),
      str(data.utmMedium),
      str(data.utmCampaign),
      str(data.landing),
    );
    n++;
  }
  log(`session_fingerprints: ${n} sessions fingerprinted`);
  return n;
}

// ---------------------------------------------------------------
// Signups: server/.signups/signups.json
// ---------------------------------------------------------------
function ingestSignups(): number {
  const path = resolve(ROOT, "server/.signups/signups.json");
  if (!existsSync(path)) return 0;
  const list = JSON.parse(readFileSync(path, "utf8")) as Array<{ email: string; source: string; at: string }>;
  const insert = db.prepare(`INSERT OR REPLACE INTO signups (email, source, at) VALUES (?, ?, ?)`);
  for (const s of list) insert.run(s.email, s.source, s.at);
  // P5/L8: report the real/test split at ingest, not just a row count.
  // A bare count is how 20 @example.com test rows became "20 email
  // signups captured" in report.ts — while the single genuine signup,
  // which arrived after that ingest ran and was never re-ingested, was
  // absent from the warehouse entirely.
  const testRows = list.filter((s) => isTestEmail(s.email)).length;
  log(`signups: ${list.length} rows (${list.length - testRows} real, ${testRows} test)`);
  return list.length;
}

// ---------------------------------------------------------------
// Entitlements: server/.entitlements/entitlements.json
// ---------------------------------------------------------------
function ingestEntitlements(): number {
  const path = resolve(ROOT, "server/.entitlements/entitlements.json");
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, "utf8");
  db.prepare(`DELETE FROM entitlements_raw`).run();
  db.prepare(`INSERT INTO entitlements_raw (raw_json, ingested_at) VALUES (?, ?)`).run(
    raw,
    new Date().toISOString(),
  );
  log(`entitlements_raw: snapshot stored (${raw.length} bytes)`);
  return 1;
}

// ---------------------------------------------------------------
// Clips: clip-pins.json (pinned) + server/.clips/ (all rendered files)
// ---------------------------------------------------------------
function ingestClips(): number {
  const pinsPath = resolve(ROOT, "server/clip-pins.json");
  const clipsDir = resolve(ROOT, "server/.clips");
  const pinned = new Set<string>();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO clips (id, ext, note, pinned_at, pinned, file_exists) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  if (existsSync(pinsPath)) {
    const pins = JSON.parse(readFileSync(pinsPath, "utf8")) as {
      pins: Array<{ id: string; ext: string; note: string; pinnedAt: string }>;
    };
    for (const p of pins.pins) {
      pinned.add(p.id);
      const fileExists = existsSync(resolve(clipsDir, `${p.id}.${p.ext}`));
      insert.run(p.id, p.ext, p.note, p.pinnedAt, 1, fileExists ? 1 : 0);
      n++;
    }
  }
  if (existsSync(clipsDir)) {
    for (const f of readdirSync(clipsDir)) {
      const m = f.match(/^([0-9a-f-]{36})\.(mp4|webm)$/i);
      if (!m) continue;
      const id = m[1]!;
      if (pinned.has(id)) continue;
      insert.run(id, m[2], null, null, 0, 1);
      n++;
    }
  }
  log(`clips: ${n} rows`);
  return n;
}

function main(): void {
  const startedAt = new Date().toISOString();
  let total = 0;
  total += ingestTelemetry();
  total += buildFingerprints();
  total += ingestSignups();
  total += ingestEntitlements();
  total += ingestClips();
  db.prepare(`INSERT INTO research_log (run_at, agent_task, rows_added, summary) VALUES (?, ?, ?, ?)`).run(
    startedAt,
    "internal-ingest",
    total,
    "Full internal-data ingest run (telemetry, signups, entitlements, clips)",
  );
  log(`Done. Total rows touched: ${total}. DB at ${DB_PATH}`);
}

main();
db.close();
