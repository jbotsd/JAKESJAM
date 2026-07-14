// Ad-hoc SQL query CLI against the warehouse. Read-only friendly, but does
// not block writes — be careful with anything destructive.
//
// Usage: bun data-warehouse/query.ts "SELECT * FROM market_research LIMIT 5"

import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(HERE, "jakesjam.db"));

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: bun data-warehouse/query.ts "SELECT ..."');
  process.exit(1);
}

try {
  const rows = db.query(sql).all();
  console.log(JSON.stringify(rows, null, 2));
  console.error(`\n${Array.isArray(rows) ? rows.length : 0} row(s)`);
} catch (e) {
  console.error("Query error:", (e as Error).message);
  process.exit(1);
}
