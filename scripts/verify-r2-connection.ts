// One-off connectivity check for the R2 credentials in server/.env.local.
// Prints ONLY pass/fail and safe metadata (byte counts, booleans) — never
// the account id, access key, secret, or any env var value. Safe to run
// from anywhere, including through a tool that logs its output, since
// nothing sensitive is ever written to stdout/stderr.
//
// Usage: bun --cwd server ../scripts/verify-r2-connection.ts
// (run with cwd=server so Bun auto-loads server/.env.local, same as the
// live server does)

import {
  getArchiveR2Client,
  getR2Client,
  r2ArchiveConfigured,
  r2ClipsConfigured,
  r2ServingConfigured,
} from "../server/src/r2Clips.ts";

const PROBE_KEY = `_connectivity-check-${Date.now()}.txt`;
const PROBE_BODY = "jakesjam r2 connectivity probe - safe to delete";
const PROBE_BYTES = new TextEncoder().encode(PROBE_BODY).length;

async function checkClient(label: string, client: ReturnType<typeof getR2Client>): Promise<boolean> {
  if (!client) {
    console.log(`${label}: NOT CONFIGURED (skipped — required env vars missing)`);
    return false;
  }
  try {
    const bytesWritten = await client.write(PROBE_KEY, PROBE_BODY, { type: "text/plain" });
    const existsAfterWrite = await client.exists(PROBE_KEY);
    const remoteSize = await client.size(PROBE_KEY);
    await client.delete(PROBE_KEY);
    const existsAfterDelete = await client.exists(PROBE_KEY);

    const ok = existsAfterWrite && remoteSize === PROBE_BYTES && !existsAfterDelete;
    console.log(
      `${label}: ${ok ? "OK" : "MISMATCH"} — wrote ${bytesWritten}B, remote size ${remoteSize}B (expected ${PROBE_BYTES}), existed-after-write=${existsAfterWrite}, gone-after-delete=${!existsAfterDelete}`,
    );
    return ok;
  } catch (err) {
    // Only the error's message/name, never credential values (this client
    // never throws credential material in its errors — it's an S3 client
    // error, not an env dump).
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${label}: FAILED — ${msg}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("JAKESJAM R2 connectivity check (no secret values are ever printed)\n");

  console.log(`r2ClipsConfigured()   = ${r2ClipsConfigured()}`);
  console.log(`r2ServingConfigured() = ${r2ServingConfigured()} ${r2ClipsConfigured() && !r2ServingConfigured() ? "(write path ready, no public domain bound yet — serving stays on local disk, expected)" : ""}`);
  console.log(`r2ArchiveConfigured() = ${r2ArchiveConfigured()}\n`);

  const publicOk = await checkClient("Public bucket  (R2_BUCKET)        ", getR2Client());
  const archiveOk = await checkClient("Archive bucket (R2_ARCHIVE_BUCKET)", getArchiveR2Client());

  console.log(`\nOverall: ${publicOk || archiveOk ? "at least one bucket round-tripped a real write/read/delete successfully" : "no bucket is configured/reachable yet"}`);
}

main();
