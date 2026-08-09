// Which warehouse rows are test artefacts, not reality.
//
// gospel-goal P5 / law L8 (honest meters). report.ts announced "20 email
// signups captured" on 2026-08-09. All 20 were `@example.com` UUID
// addresses written by the splash-form test runs of 2026-07-13/14 — and
// the ONE real signup (2026-07-14T01:13Z) was not among them, because
// ingest last ran before it arrived. The meter was inflated 20x and
// missing its only true row at the same time, on the single number the
// whole funnel exists to move.
//
// The rule here is: never delete captured data, always label it. A test
// row stays in the table and is excluded from the headline, so the count
// can be audited instead of trusted.

/** Reserved / non-deliverable domains — RFC 2606 + RFC 6761. Nothing real
 *  can ever arrive from these, so matching them cannot produce a false
 *  positive against a genuine signup. */
export const RESERVED_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "test",
  "invalid",
  "localhost",
];

/** True when this address cannot belong to a real person. Deliberately
 *  conservative: it matches only addresses that are unroutable by
 *  standard, never "looks fake to me" heuristics — under-counting a test
 *  row is a much cheaper mistake than hiding a real signup. */
export function isTestEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return true; // not an address at all
  const domain = email.slice(at + 1).toLowerCase();
  return RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** SQL fragment matching the same rule, for counting in-database. Kept
 *  next to isTestEmail so the two cannot drift apart silently. */
export const TEST_EMAIL_SQL = `(
  LOWER(email) LIKE '%@example.com' OR LOWER(email) LIKE '%.example.com' OR
  LOWER(email) LIKE '%@example.org' OR LOWER(email) LIKE '%.example.org' OR
  LOWER(email) LIKE '%@example.net' OR LOWER(email) LIKE '%.example.net' OR
  LOWER(email) LIKE '%@test'        OR LOWER(email) LIKE '%.test' OR
  LOWER(email) LIKE '%@invalid'     OR LOWER(email) LIKE '%.invalid' OR
  LOWER(email) LIKE '%@localhost'   OR LOWER(email) LIKE '%.localhost' OR
  INSTR(email, '@') = 0
)`;
