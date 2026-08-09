// Synthesized snapshot of the warehouse's current state — re-run any time
// to see what's actually in there without hand-writing SQL. Not a
// replacement for real querying (use query.ts for that), just a fast
// "what do we know right now" overview.
//
// Usage: bun data-warehouse/report.ts

import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { TEST_EMAIL_SQL } from "./testRows.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(HERE, "jakesjam.db"));

function section(title: string): void {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

function row1(sql: string): Record<string, unknown> | undefined {
  return db.query(sql).get() as Record<string, unknown> | undefined;
}

section("INTERNAL: traffic reality (session_fingerprints)");
const traffic = db
  .query(
    `SELECT
       SUM(is_jake_rtx4080) AS jake,
       SUM(is_automation_signature) AS automation,
       SUM(is_candidate_real_external) AS candidate_real,
       COUNT(*) AS total
     FROM session_fingerprints`,
  )
  .get() as Record<string, number>;
console.log(
  `${traffic.total} total boot sessions — ${traffic.jake} Jake's own machine (${((traffic.jake / traffic.total) * 100).toFixed(1)}%), ` +
    `${traffic.automation} automation signature (${((traffic.automation / traffic.total) * 100).toFixed(1)}%), ` +
    `${traffic.candidate_real} candidate-real external (${((traffic.candidate_real / traffic.total) * 100).toFixed(1)}%)`,
);

section("INTERNAL: funnel (Track P1)");
// Every north-star gate is a "how long until" question, so the funnel reports
// reach AND median elapsed ms. Split by traffic class deliberately: with
// ~90% of sessions being Jake's own machine, an unsplit funnel measures the
// developer, not the audience (the same mistake the signup count made).
const FUNNEL_STEPS = [
  "page_load",
  "playable",
  "first_input",
  "first_shot",
  "first_kill",
  "first_death",
  "round_end_seen",
  "played_again",
] as const;

function funnelRows(where: string): Array<{ step: string; sessions: number; medianMs: number | null }> {
  return FUNNEL_STEPS.map((step) => {
    const rows = db
      .query(
        `SELECT t.session AS session,
                json_extract(t.data_json, '$.ms') AS ms
           FROM telemetry_events t
           LEFT JOIN session_fingerprints f ON f.session = t.session
          WHERE t.kind = 'funnel' AND t.sig = ?${where ? ` AND ${where}` : ""}
          GROUP BY t.session`,
      )
      .all(`funnel:${step}`) as Array<{ session: string; ms: number | null }>;
    const times = rows
      .map((r) => r.ms)
      .filter((m): m is number => typeof m === "number")
      .sort((a, b) => a - b);
    return {
      step,
      sessions: rows.length,
      medianMs: times.length > 0 ? times[Math.floor(times.length / 2)]! : null,
    };
  });
}

function printFunnel(label: string, where: string): void {
  const rows = funnelRows(where);
  const top = rows[0]?.sessions ?? 0;
  console.log(`  ${label}:`);
  if (top === 0) {
    console.log("    (no funnel events yet — instrument landed 2026-08-09;");
    console.log("     it needs a dist rebuild + real visitors to say anything)");
    return;
  }
  for (const r of rows) {
    const pct = top > 0 ? ((r.sessions / top) * 100).toFixed(0) : "0";
    const t = r.medianMs === null ? "—" : `${(r.medianMs / 1000).toFixed(1)}s`;
    console.log(
      `    ${r.step.padEnd(15)} ${String(r.sessions).padStart(5)}  ${pct.padStart(3)}%  median ${t}`,
    );
  }
}

printFunnel("ALL sessions", "");
printFunnel(
  "EXTERNAL only (candidate-real)",
  "COALESCE(f.is_candidate_real_external, 0) = 1",
);

const wrongInputs = db
  .query(
    `SELECT COUNT(*) AS sessions, SUM(CAST(json_extract(data_json,'$.count') AS INTEGER)) AS total
       FROM telemetry_events WHERE kind='funnel' AND sig='funnel:wrong_inputs'`,
  )
  .get() as { sessions: number; total: number | null };
if ((wrongInputs?.sessions ?? 0) > 0) {
  console.log(
    `  confusion signal: ${wrongInputs.total ?? 0} wrong inputs in the first 30s across ${wrongInputs.sessions} session(s)`,
  );
}

section("INTERNAL: signups");
// P5/L8: this line used to read COUNT(*) and announce "20 email signups
// captured" when all 20 were @example.com test rows — and the one real
// signup was missing entirely. The funnel's single most important number
// must never flatter itself.
const signupSplit = row1(
  `SELECT
     COUNT(*) AS total,
     SUM(CASE WHEN ${TEST_EMAIL_SQL} THEN 1 ELSE 0 END) AS test_rows
   FROM signups`,
) as { total: number; test_rows: number } | undefined;
const totalSignups = signupSplit?.total ?? 0;
const testSignups = signupSplit?.test_rows ?? 0;
const realSignups = totalSignups - testSignups;
console.log(
  `${realSignups} REAL email signup${realSignups === 1 ? "" : "s"}` +
    (testSignups > 0
      ? `  (${testSignups} test row${testSignups === 1 ? "" : "s"} excluded of ${totalSignups} captured)`
      : ""),
);
for (const r of db
  .query(
    `SELECT email, source, at FROM signups WHERE NOT ${TEST_EMAIL_SQL} ORDER BY at DESC LIMIT 10`,
  )
  .all() as Array<{ email: string; source: string; at: string }>) {
  console.log(`  ${r.at}  ${r.email}  (${r.source})`);
}

section("INTERNAL: CRM (outreach targets)");
const crmByCategory = db.query(`SELECT category, tier, COUNT(*) AS n FROM crm_contacts GROUP BY category, tier ORDER BY category, tier`).all();
for (const r of crmByCategory as Array<{ category: string; tier: string | null; n: number }>) {
  console.log(`  ${r.category}${r.tier ? ` (${r.tier})` : ""}: ${r.n}`);
}
const apolloMatched = row1(`SELECT COUNT(*) AS n FROM crm_contacts WHERE apollo_matched = 1`);
console.log(`  ${apolloMatched?.n ?? 0} matched to real Apollo profiles w/ LinkedIn`);

section("INTERNAL: clips");
const clipStats = row1(`SELECT COUNT(*) AS total, SUM(pinned) AS pinned FROM clips`);
console.log(`${clipStats?.total ?? 0} rendered clips, ${clipStats?.pinned ?? 0} pinned as keepers`);

section("MARKET INTEL: coverage by domain");
const domains = db.query(`SELECT domain, COUNT(*) AS n, SUM(CASE WHEN confidence='high' THEN 1 ELSE 0 END) AS high_conf FROM market_research GROUP BY domain ORDER BY n DESC`).all();
if ((domains as unknown[]).length === 0) {
  console.log("  (no market_research rows yet — run the research agents + ingest-research.ts)");
} else {
  for (const r of domains as Array<{ domain: string; n: number; high_conf: number }>) {
    console.log(`  ${r.domain}: ${r.n} findings (${r.high_conf} high-confidence)`);
  }
}

section("MARKET INTEL: competitor titles tracked");
const competitors = db.query(`SELECT name, steam_reviews_total, steam_review_pct, monetization_model FROM competitor_titles ORDER BY steam_reviews_total DESC`).all();
if ((competitors as unknown[]).length === 0) {
  console.log("  (no competitor_titles rows yet)");
} else {
  for (const r of competitors as Array<{ name: string; steam_reviews_total: number | null; steam_review_pct: number | null; monetization_model: string | null }>) {
    console.log(`  ${r.name}: ${r.steam_reviews_total ?? "?"} reviews (${r.steam_review_pct ?? "?"}% positive), ${r.monetization_model ?? "unknown model"}`);
  }
}

section("MARKET INTEL: portal analytics rows");
const portalCount = row1(`SELECT COUNT(*) AS n FROM portal_analytics`);
console.log(`${portalCount?.n ?? 0} portal_analytics rows`);

section("MARKET INTEL: demographics rows");
const demoCount = row1(`SELECT COUNT(*) AS n FROM audience_demographics`);
console.log(`${demoCount?.n ?? 0} audience_demographics rows`);

section("Ingest history (research_log)");
const log = db.query(`SELECT run_at, agent_task, rows_added FROM research_log ORDER BY run_at DESC LIMIT 20`).all();
for (const r of log as Array<{ run_at: string; agent_task: string; rows_added: number }>) {
  console.log(`  ${r.run_at}  ${r.agent_task}  (+${r.rows_added})`);
}

db.close();
