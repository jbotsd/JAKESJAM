// Ingests pipe-delimited structured research findings (the format every
// market-intel research agent this session was instructed to return) into
// the warehouse. Auto-detects which table a line belongs to by field count
// AND a table hint, so one script handles all four research-shaped tables.
//
// Usage:
//   bun data-warehouse/ingest-research.ts <table> <path-to-text-file>
//   table one of: market_research | competitor_titles | portal_analytics | audience_demographics
//
// Line format per table (pipe-delimited, matches what agents were told to return):
//   market_research:        DOMAIN | TOPIC | FINDING | METRIC_NAME | METRIC_VALUE | METRIC_UNIT | SOURCE_NAME | SOURCE_URL | CONFIDENCE
//   competitor_titles:      NAME | GENRE | PLATFORM | STEAM_REVIEWS_TOTAL | STEAM_REVIEW_PCT | CONCURRENT_PLAYERS_PEAK | LIFETIME_PLAYERS | MONETIZATION_MODEL | PRICE_USD | RELEASE_DATE | PUBLISHER | NOTES | SOURCE_URL
//   portal_analytics:       PORTAL_NAME | METRIC_NAME | METRIC_VALUE | METRIC_UNIT | AS_OF_DATE | SOURCE_URL
//   audience_demographics:  POPULATION | DIMENSION | SEGMENT | VALUE | SOURCE_NAME | SOURCE_URL
//
// Non-matching lines (prose, headers, empty) are silently skipped — this is
// deliberately lenient since agent output always has surrounding narration.

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(HERE, "jakesjam.db"));

const table = process.argv[2];
const filePath = process.argv[3];
if (!table || !filePath) {
  console.error("Usage: bun data-warehouse/ingest-research.ts <table> <path-to-text-file>");
  process.exit(1);
}

const text = readFileSync(filePath, "utf8");
const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
const now = new Date().toISOString();

function splitPipes(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const parts = line.split("|").map((p) => p.trim());
  return parts;
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[,$%]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

let inserted = 0;
let skipped = 0;

if (table === "market_research") {
  const insert = db.prepare(
    `INSERT INTO market_research (domain, topic, finding, metric_name, metric_value, metric_unit, source_name, source_url, collected_at, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    const p = splitPipes(line);
    if (!p || p.length < 3) { skipped++; continue; }
    const [domain, topic, finding, metric_name, metric_value, metric_unit, source_name, source_url, confidence] = p;
    if (!domain || !topic || !finding) { skipped++; continue; }
    insert.run(
      domain, topic, finding,
      metric_name || null, metric_value || null, metric_unit || null,
      source_name || null, source_url || null, now,
      (confidence || "medium").toLowerCase(),
    );
    inserted++;
  }
} else if (table === "competitor_titles") {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO competitor_titles
     (name, genre, platform, steam_reviews_total, steam_review_pct, concurrent_players_peak, lifetime_players, monetization_model, price_usd, release_date, publisher, notes, source_url, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    const p = splitPipes(line);
    if (!p || p.length < 3) { skipped++; continue; }
    const [name, genre, platform, reviewsTotal, reviewPct, ccu, lifetime, monetization, price, release, publisher, notes, url] = p;
    if (!name || name.toUpperCase() === "NAME") { skipped++; continue; }
    insert.run(
      name, genre || null, platform || null,
      num(reviewsTotal), num(reviewPct), num(ccu),
      lifetime || null, monetization || null, num(price),
      release || null, publisher || null, notes || null, url || null, now,
    );
    inserted++;
  }
} else if (table === "portal_analytics") {
  const insert = db.prepare(
    `INSERT INTO portal_analytics (portal_name, metric_name, metric_value, metric_unit, as_of_date, source_url, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    const p = splitPipes(line);
    if (!p || p.length < 3) { skipped++; continue; }
    const [portal, metricName, metricValue, unit, asOf, url] = p;
    if (!portal || portal.toUpperCase() === "PORTAL_NAME") { skipped++; continue; }
    insert.run(portal, metricName || null, metricValue || null, unit || null, asOf || null, url || null, now);
    inserted++;
  }
} else if (table === "audience_demographics") {
  const insert = db.prepare(
    `INSERT INTO audience_demographics (population, dimension, segment, value, source_name, source_url, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    const p = splitPipes(line);
    if (!p || p.length < 4) { skipped++; continue; }
    const [population, dimension, segment, value, sourceName, url] = p;
    if (!population || population.toUpperCase() === "POPULATION") { skipped++; continue; }
    insert.run(population, dimension || null, segment || null, value || null, sourceName || null, url || null, now);
    inserted++;
  }
} else {
  console.error(`Unknown table: ${table}`);
  process.exit(1);
}

db.prepare(`INSERT INTO research_log (run_at, agent_task, rows_added, summary) VALUES (?, ?, ?, ?)`).run(
  now,
  `ingest-research:${table}`,
  inserted,
  `Parsed ${filePath} — ${inserted} rows inserted, ${skipped} lines skipped (non-matching)`,
);

console.log(`[ingest-research] ${table}: ${inserted} inserted, ${skipped} skipped`);
db.close();
