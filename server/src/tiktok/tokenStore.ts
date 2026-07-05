// Minimal persisted token store for the TikTok integration. Single JSON file
// under server/.tiktok/ (gitignored, mirrors clipStore.ts's server/.clips/
// pattern) — appropriate for a single-process indie deployment; a real
// multi-instance deployment would swap this for a real datastore without
// touching any caller.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TikTokTokenResponse } from "./auth.ts";

const DIR = resolve(process.cwd(), ".tiktok");
const FILE = resolve(DIR, "tokens.json");

export type StoredToken = TikTokTokenResponse & { obtainedAtMs: number };

async function readAll(): Promise<Record<string, StoredToken>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, StoredToken>;
  } catch {
    return {};
  }
}

async function writeAll(all: Record<string, StoredToken>): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

export async function saveToken(openId: string, token: TikTokTokenResponse): Promise<void> {
  const all = await readAll();
  all[openId] = { ...token, obtainedAtMs: Date.now() };
  await writeAll(all);
}

export async function getToken(openId: string): Promise<StoredToken | null> {
  const all = await readAll();
  return all[openId] ?? null;
}

/** True once fewer than this many ms remain before the access_token expires —
 *  a caller should refresh proactively rather than let a post attempt 401. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function isAccessTokenStale(token: StoredToken, nowMs: number = Date.now()): boolean {
  const expiresAtMs = token.obtainedAtMs + token.expires_in * 1000;
  return nowMs >= expiresAtMs - REFRESH_MARGIN_MS;
}
