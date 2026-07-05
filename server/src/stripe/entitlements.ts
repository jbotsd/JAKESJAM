// Persisted cosmetic-ownership store. Single JSON file under
// server/.entitlements/ (gitignored, mirrors clipStore.ts / tokenStore.ts).
// Granted exclusively by the webhook handler after a verified
// checkout.session.completed — never by a direct client call, so a player
// can't grant themselves cosmetics by hitting an endpoint.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DIR = resolve(process.cwd(), ".entitlements");
const FILE = resolve(DIR, "entitlements.json");

type EntitlementStore = Record<string, string[]>; // playerId -> skuId[]

async function readAll(): Promise<EntitlementStore> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as EntitlementStore;
  } catch {
    return {};
  }
}

async function writeAll(all: EntitlementStore): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

/** Idempotent — granting the same sku twice is a no-op, so a duplicate
 *  webhook delivery (Stripe retries on anything but a 2xx) can't double-grant. */
export async function grantEntitlement(playerId: string, skuId: string): Promise<void> {
  const all = await readAll();
  const owned = all[playerId] ?? [];
  if (!owned.includes(skuId)) owned.push(skuId);
  all[playerId] = owned;
  await writeAll(all);
}

export async function getEntitlements(playerId: string): Promise<string[]> {
  const all = await readAll();
  return all[playerId] ?? [];
}

export async function hasEntitlement(playerId: string, skuId: string): Promise<boolean> {
  return (await getEntitlements(playerId)).includes(skuId);
}
