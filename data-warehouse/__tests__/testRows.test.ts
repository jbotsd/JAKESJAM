// gospel P5 / law L8 — the honest-signup filter, guarded.
//
// The bug this protects against is not "the filter is wrong today". It is
// that `isTestEmail` and `TEST_EMAIL_SQL` are TWO implementations of ONE
// rule, living in the same file precisely because they must agree — and
// nothing in the codebase forced them to. Add a reserved domain to one
// and forget the other and the headline number silently goes wrong again,
// in the same direction as before: flattering.
//
// So the central test runs BOTH against the same corpus and demands the
// same verdict row for row, rather than testing each against my own
// expectations twice.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { isTestEmail, RESERVED_DOMAINS, TEST_EMAIL_SQL } from "../testRows.ts";

/** Probes GENERATED from the rule, not hand-written.
 *
 *  The first version of this file compared the two implementations
 *  against a hand-written corpus, and a mutation test proved it vacuous:
 *  adding a domain to the TS list and not to the SQL — the single most
 *  likely real drift — passed 18/18, because no corpus row used the new
 *  domain. A hand-written corpus can only ever catch drift on domains
 *  someone already thought of, which is precisely the set that is not at
 *  risk.
 *
 *  Deriving one probe per reserved domain (plus one subdomain form)
 *  means any future edit to RESERVED_DOMAINS automatically grows the
 *  corpus, and the SQL must keep up or this fails. */
const DERIVED_PROBES = RESERVED_DOMAINS.flatMap((d) => [
  { email: `probe@${d}`, test: true, why: `reserved: ${d}` },
  { email: `probe@sub.${d}`, test: true, why: `subdomain of reserved: ${d}` },
]);

/** Deliberately mixed: reserved domains in several shapes, plus real
 *  addresses that LOOK testy (the "test" in `test@`, a `.com.au` that
 *  ends in no reserved label) because those are what a sloppier
 *  heuristic would eat. */
const CORPUS: Array<{ email: string; test: boolean; why: string }> = [
  // --- unroutable by standard: must be excluded ---
  { email: "4c591702-325a@example.com", test: true, why: "RFC 2606 example.com" },
  { email: "MixedCase-8b5a@EXAMPLE.COM", test: true, why: "case-insensitive" },
  { email: "a@example.org", test: true, why: "RFC 2606 example.org" },
  { email: "a@example.net", test: true, why: "RFC 2606 example.net" },
  { email: "a@foo.example.com", test: true, why: "subdomain of a reserved domain" },
  { email: "a@localhost", test: true, why: "RFC 6761 localhost" },
  { email: "a@box.localhost", test: true, why: "subdomain of localhost" },
  { email: "a@thing.test", test: true, why: "RFC 6761 .test TLD" },
  { email: "a@thing.invalid", test: true, why: "RFC 6761 .invalid TLD" },
  { email: "not-an-address", test: true, why: "no @ at all" },

  // --- real people: must survive ---
  //
  // The anchor row. This is the ONE genuine signup the funnel has ever
  // captured (2026-07-14T01:13Z). If a future filter change eats it, the
  // meter goes from over-reporting to under-reporting and the funnel
  // reads as stone dead. Pinned by name on purpose.
  { email: "jay@oraclesound.com.au", test: false, why: "the one real signup" },
  { email: "test@gmail.com", test: false, why: "'test' in the LOCAL part is not a test row" },
  { email: "jake@intrepiddev.com.au", test: false, why: "ordinary address" },
  { email: "someone@example.com.au", test: false, why: "NOT example.com — a real ccTLD suffix" },
  { email: "a@examplecom", test: false, why: "no dot; must not match by substring" },
  { email: "a@mytest.io", test: false, why: "'test' inside a label is not the .test TLD" },
  ...DERIVED_PROBES,
];

// Vacuity guard. If the corpus ever loses one of its two halves, every
// assertion below still "passes" while proving nothing — the exact
// failure shape this repo has been bitten by all day.
describe("corpus", () => {
  test("contains both real and test addresses", () => {
    expect(CORPUS.filter((c) => c.test).length).toBeGreaterThan(3);
    expect(CORPUS.filter((c) => !c.test).length).toBeGreaterThan(3);
    // Every reserved domain is probed, so the corpus cannot fall behind
    // the rule it is meant to police.
    expect(DERIVED_PROBES.length).toBe(RESERVED_DOMAINS.length * 2);
  });
});

describe("isTestEmail", () => {
  for (const { email, test: isTest, why } of CORPUS) {
    test(`${isTest ? "excludes" : "keeps"} ${email} — ${why}`, () => {
      expect(isTestEmail(email)).toBe(isTest);
    });
  }
});

describe("TEST_EMAIL_SQL agrees with isTestEmail, row for row", () => {
  test("no drift between the two implementations", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE signups (email TEXT)");
    const insert = db.prepare("INSERT INTO signups (email) VALUES (?)");
    for (const { email } of CORPUS) insert.run(email);

    const flagged = new Set(
      (
        db
          .query(`SELECT email FROM signups WHERE ${TEST_EMAIL_SQL}`)
          .all() as Array<{ email: string }>
      ).map((r) => r.email),
    );

    // Compare as a whole set, so a failure names every disagreement at
    // once instead of stopping at the first.
    const disagreements = CORPUS.filter(
      ({ email }) => flagged.has(email) !== isTestEmail(email),
    ).map(({ email }) => `${email}: sql=${flagged.has(email)} ts=${isTestEmail(email)}`);

    expect(disagreements).toEqual([]);

    // Vacuity guard: prove the SQL actually matched something. An empty
    // result set would agree with a broken isTestEmail that returns false
    // for everything.
    expect(flagged.size).toBe(CORPUS.filter((c) => c.test).length);
  });
});
