// Synthesized snapshot of the warehouse's current state — re-run any time
// to see what's actually in there without hand-writing SQL. Not a
// replacement for real querying (use query.ts for that), just a fast
// "what do we know right now" overview.
//
// Usage: bun data-warehouse/report.ts

import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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

section("INTERNAL: signups");
const signupCount = row1(`SELECT COUNT(*) AS n FROM signups`);
console.log(`${signupCount?.n ?? 0} email signups captured`);

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
