import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the store at a throwaway dir BEFORE the store module's first call —
// without this, every test run wrote its fake signups into the PRODUCTION
// server/.signups/signups.json (260 junk rows before it was caught,
// 2026-07-17). The env is read lazily by signupStore, so setting it here,
// before the import's functions ever run, is sufficient.
process.env.JAKESJAM_SIGNUPS_DIR = mkdtempSync(join(tmpdir(), "signups-test-"));

import { recordSignupLocal, listSignupsLocal } from "../signupStore.ts";
function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe("signupStore", () => {
  test("recording a signup makes it show up in the list", async () => {
    const email = uniqueEmail();
    await recordSignupLocal(email, "splash");
    const all = await listSignupsLocal();
    expect(all.some((s) => s.email === email && s.source === "splash")).toBe(true);
  });

  test("email is normalized to lowercase regardless of input casing", async () => {
    // Deliberately NOT derived from uniqueEmail()/randomUUID() — a UUID is
    // lowercase hex, so uppercasing an arbitrary character has a real
    // chance of landing on a digit (a no-op), silently making this test's
    // "mixed case" input identical to the lowercase form it's meant to
    // differ from. A fixed literal with a guaranteed uppercase letter in
    // both the local part and domain is unambiguous.
    const unique = randomUUID().slice(0, 8);
    const mixedCase = `MixedCase-${unique}@Example.com`;
    const lowercase = `mixedcase-${unique}@example.com`;
    await recordSignupLocal(mixedCase, "splash");
    const all = await listSignupsLocal();
    expect(all.some((s) => s.email === lowercase)).toBe(true);
    expect(all.some((s) => s.email === mixedCase)).toBe(false);
  });

  test("resubmitting the same email updates in place instead of duplicating (retry/double-click safe)", async () => {
    const email = uniqueEmail();
    await recordSignupLocal(email, "splash");
    const countAfterFirst = (await listSignupsLocal()).filter((s) => s.email === email).length;
    await recordSignupLocal(email, "splash-retry");
    const countAfterSecond = (await listSignupsLocal()).filter((s) => s.email === email).length;
    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1); // no growth on the resubmit
    const entry = (await listSignupsLocal()).find((s) => s.email === email);
    expect(entry?.source).toBe("splash-retry"); // latest source wins
  });

  test("distinct emails are stored as distinct entries", async () => {
    const emailA = uniqueEmail();
    const emailB = uniqueEmail();
    await recordSignupLocal(emailA, "splash");
    await recordSignupLocal(emailB, "splash");
    const all = await listSignupsLocal();
    expect(all.some((s) => s.email === emailA)).toBe(true);
    expect(all.some((s) => s.email === emailB)).toBe(true);
  });
});
