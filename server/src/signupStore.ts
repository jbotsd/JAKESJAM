// Local fallback for the devlog-funnel email signup (POST /api/signup).
// Single JSON file under server/.signups/ (gitignored, mirrors clipStore.ts /
// tokenStore.ts / stripe/entitlements.ts's own local-JSON-store pattern).
//
// Why this exists: convexClient.recordSignup() silently returns `false` and
// only logs a warning when CONVEX_URL isn't configured — by design, so a
// missing Convex config can never 500 the signup endpoint. But "logged a
// warning" and "the email is actually stored somewhere" are different
// things, and for a while they weren't: with Convex unset (the live
// deployment's default — see docs/game-design-document.md's architecture
// note), every real signup was accepted, told the visitor "you're in," and
// then discarded. This is the always-on floor underneath that: written
// FIRST, before Convex is ever attempted, so a signup is captured
// regardless of whether the optional Convex sync succeeds, fails, or was
// never configured at all. Convex (when configured) stays the durable,
// queryable, cross-deploy home for the list; this file is what guarantees
// "at minimum, we still have it" when it isn't.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Env override exists so tests (and any tooling) can point the store at a
// throwaway dir — before this, every `bun test` run wrote its fake
// @example.com signups into the PRODUCTION list (260 junk rows by the time
// it was caught, 2026-07-17). Resolved lazily, not at module load, so a
// test file can set the env before its first store call.
function storeFile(): string {
  return resolve(process.env.JAKESJAM_SIGNUPS_DIR ?? resolve(process.cwd(), ".signups"), "signups.json");
}
function storeDir(): string {
  return resolve(process.env.JAKESJAM_SIGNUPS_DIR ?? resolve(process.cwd(), ".signups"));
}

export type StoredSignup = {
  email: string;
  source: string;
  at: string; // ISO timestamp
};

async function readAll(): Promise<StoredSignup[]> {
  try {
    return JSON.parse(await readFile(storeFile(), "utf8")) as StoredSignup[];
  } catch {
    return [];
  }
}

async function writeAll(all: StoredSignup[]): Promise<void> {
  await mkdir(storeDir(), { recursive: true });
  await writeFile(storeFile(), JSON.stringify(all, null, 2));
}

/** Idempotent on email (case-insensitive — the caller already lowercases,
 *  this doesn't assume it) — a resubmission (retry, double-click, a second
 *  optimistic POST) updates the existing entry's `source`/`at` in place
 *  rather than growing the list, same "duplicate delivery is a no-op"
 *  shape stripe/entitlements.ts uses for webhook retries. */
export async function recordSignupLocal(email: string, source: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const all = await readAll();
  const existing = all.find((s) => s.email === normalized);
  const at = new Date().toISOString();
  if (existing) {
    existing.source = source;
    existing.at = at;
  } else {
    all.push({ email: normalized, source, at });
  }
  await writeAll(all);
}

export async function listSignupsLocal(): Promise<StoredSignup[]> {
  return readAll();
}

export async function countSignupsLocal(): Promise<number> {
  return (await readAll()).length;
}
