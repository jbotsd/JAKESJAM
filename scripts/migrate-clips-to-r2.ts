// One-off migration: copy the existing local clip stash up to Cloudflare
// R2 (server/src/r2Clips.ts). Safe to re-run — every file is skipped once
// its remote size matches local (idempotent), and this script NEVER
// deletes a local file; that's a separate later cleanup step once Jake's
// confident the R2 copies are good.
//
// Maps straight onto the two live/archival categories that already exist
// on disk:
//   server/.clips/               -> R2_BUCKET (the PUBLIC bucket — same
//                                   flat keys clipStore.ts already serves
//                                   from). This is the only one of the
//                                   three directories the live server
//                                   actually reads (clipStore.ts's
//                                   CLIPS_DIR) — .clips-highlights and
//                                   .clips-quarantine are manual footage-
//                                   study curation piles, never served.
//                                   A local `${id}.r2.json` marker is
//                                   written per migrated clip — the same
//                                   sidecar clipStore.ts writes on a live
//                                   upload — so serveClip() starts
//                                   redirecting these clips at the R2
//                                   custom domain immediately (once one is
//                                   connected; r2ServingConfigured()).
//   server/.clips-highlights/    -> R2_ARCHIVE_BUCKET, key prefix
//   server/.clips-quarantine/       "clips-highlights/" / "clips-quarantine/"
//                                   (cold/private, footage-study archival
//                                   only — no public domain, no marker).
//
// Usage:
//   bun scripts/migrate-clips-to-r2.ts [--dry-run] [--skip-public] [--skip-archive]
//
// Requires the env vars documented in server/src/r2Clips.ts. Exits 1 (and
// prints exactly which vars are missing) if NEITHER side is configured;
// runs whichever side(s) ARE configured otherwise.

import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  contentTypeForExt,
  getArchiveR2Client,
  getR2Client,
  r2ArchiveConfigured,
  r2ClipsConfigured,
  writeR2Marker,
  type ClipsR2Client,
} from "../server/src/r2Clips.ts";

const ROOT = resolve(import.meta.dir, "..");
const CLIPS_DIR = resolve(process.env.JAKESJAM_CLIPS_DIR ?? resolve(ROOT, "server", ".clips"));
const KEPT_DIR = resolve(CLIPS_DIR, "kept");
const HIGHLIGHTS_DIR = resolve(
  process.env.JAKESJAM_HIGHLIGHTS_DIR ?? resolve(ROOT, "server", ".clips-highlights"),
);
const QUARANTINE_DIR = resolve(
  process.env.JAKESJAM_QUARANTINE_DIR ?? resolve(ROOT, "server", ".clips-quarantine"),
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_PUBLIC = args.includes("--skip-public");
const SKIP_ARCHIVE = args.includes("--skip-archive");

const CLIP_NAME_RE = /^[a-f0-9-]+\.(webm|mp4)$/i;

type Tally = { uploaded: number; skipped: number; failed: number; bytes: number };
function newTally(): Tally {
  return { uploaded: 0, skipped: 0, failed: 0, bytes: 0 };
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(resolve(dir, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

async function verifySizeMatch(
  client: ClipsR2Client,
  key: string,
  localBytes: number,
): Promise<boolean> {
  try {
    if (!(await client.exists(key))) return false;
    const remoteBytes = await client.size(key);
    return remoteBytes === localBytes;
  } catch {
    return false;
  }
}

async function migratePublic(): Promise<Tally> {
  const tally = newTally();
  const client = getR2Client();
  if (!client) {
    console.log("  [public] R2_BUCKET client unavailable — skipping (should not happen; already gated by caller).");
    return tally;
  }

  // Prefer the live dir; fall back to kept/ for anything evicted from
  // live but still mirrored there (pinned highlight reels).
  const liveNames = new Set(listFiles(CLIPS_DIR).filter((n) => CLIP_NAME_RE.test(n)));
  const keptNames = listFiles(KEPT_DIR).filter((n) => CLIP_NAME_RE.test(n));
  const allNames = new Set([...liveNames, ...keptNames]);

  console.log(`  [public] ${allNames.size} clip file(s) found across .clips/ + .clips/kept/`);

  for (const filename of allNames) {
    const localPath = liveNames.has(filename) ? resolve(CLIPS_DIR, filename) : resolve(KEPT_DIR, filename);
    const dot = filename.lastIndexOf(".");
    const id = filename.slice(0, dot);
    const ext = filename.slice(dot + 1).toLowerCase();
    const localBytes = statSync(localPath).size;

    const already = await verifySizeMatch(client, filename, localBytes);
    if (already) {
      tally.skipped += 1;
      if (!DRY_RUN) {
        try {
          await writeR2Marker(CLIPS_DIR, id, { bucket: process.env.R2_BUCKET ?? "", key: filename });
        } catch {
          /* best effort */
        }
      }
      console.log(`    SKIP  (already migrated, size-matched) ${filename}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`    WOULD-UPLOAD ${filename} (${localBytes} bytes)`);
      tally.uploaded += 1;
      tally.bytes += localBytes;
      continue;
    }

    try {
      await client.write(filename, Bun.file(localPath), { type: contentTypeForExt(ext) });
      const ok = await verifySizeMatch(client, filename, localBytes);
      if (!ok) {
        tally.failed += 1;
        console.log(`    FAIL  (size mismatch after upload) ${filename}`);
        continue;
      }
      await writeR2Marker(CLIPS_DIR, id, { bucket: process.env.R2_BUCKET ?? "", key: filename });
      tally.uploaded += 1;
      tally.bytes += localBytes;
      console.log(`    OK    ${filename} (${localBytes} bytes)`);
    } catch (err) {
      tally.failed += 1;
      console.log(`    FAIL  ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return tally;
}

async function migrateArchiveDir(dir: string, prefix: string): Promise<Tally> {
  const tally = newTally();
  const client = getArchiveR2Client();
  if (!client) return tally;

  const names = listFiles(dir);
  console.log(`  [archive:${prefix}] ${names.length} file(s) found in ${dir}`);

  for (const filename of names) {
    const localPath = resolve(dir, filename);
    const key = `${prefix}/${filename}`;
    const localBytes = statSync(localPath).size;

    const already = await verifySizeMatch(client, key, localBytes);
    if (already) {
      tally.skipped += 1;
      console.log(`    SKIP  (already migrated, size-matched) ${key}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`    WOULD-UPLOAD ${key} (${localBytes} bytes)`);
      tally.uploaded += 1;
      tally.bytes += localBytes;
      continue;
    }

    try {
      await client.write(key, Bun.file(localPath), { type: "application/octet-stream" });
      const ok = await verifySizeMatch(client, key, localBytes);
      if (!ok) {
        tally.failed += 1;
        console.log(`    FAIL  (size mismatch after upload) ${key}`);
        continue;
      }
      tally.uploaded += 1;
      tally.bytes += localBytes;
      console.log(`    OK    ${key} (${localBytes} bytes)`);
    } catch (err) {
      tally.failed += 1;
      console.log(`    FAIL  ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return tally;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function printTally(label: string, t: Tally): void {
  console.log(
    `  ${label}: uploaded=${t.uploaded} skipped=${t.skipped} failed=${t.failed} bytes=${fmtBytes(t.bytes)}`,
  );
}

async function main(): Promise<void> {
  console.log(`JAKESJAM clip migration -> R2${DRY_RUN ? "  (DRY RUN — no writes)" : ""}`);

  const wantPublic = !SKIP_PUBLIC && r2ClipsConfigured();
  const wantArchive = !SKIP_ARCHIVE && r2ArchiveConfigured();

  if (!wantPublic && !wantArchive) {
    console.error("\nNothing to do — R2 is not configured (or both sides were --skip-*'d).");
    console.error("Required for the PUBLIC side (server/.clips -> live share pages):");
    console.error("  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
    console.error("Required for the ARCHIVE side (.clips-highlights/.clips-quarantine -> cold backup):");
    console.error("  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ARCHIVE_BUCKET");
    console.error("\nSee server/src/r2Clips.ts for exactly how each is generated (Cloudflare");
    console.error("dashboard: R2 > Manage API Tokens > Create API Token — NOT `wrangler login`).");
    process.exit(1);
  }

  if (!SKIP_PUBLIC && !r2ClipsConfigured()) {
    console.log("\n[public] skipped — R2_BUCKET write-path env vars not set.");
  }
  if (!SKIP_ARCHIVE && !r2ArchiveConfigured()) {
    console.log("\n[archive] skipped — R2_ARCHIVE_BUCKET env vars not set.");
  }

  let publicTally = newTally();
  let highlightsTally = newTally();
  let quarantineTally = newTally();

  if (wantPublic) {
    console.log("\n== PUBLIC (server/.clips -> R2_BUCKET) ==");
    publicTally = await migratePublic();
  }

  if (wantArchive) {
    console.log("\n== ARCHIVE (.clips-highlights + .clips-quarantine -> R2_ARCHIVE_BUCKET) ==");
    highlightsTally = await migrateArchiveDir(HIGHLIGHTS_DIR, "clips-highlights");
    quarantineTally = await migrateArchiveDir(QUARANTINE_DIR, "clips-quarantine");
  }

  console.log("\n== Summary ==");
  if (wantPublic) printTally("public            ", publicTally);
  if (wantArchive) {
    printTally("archive/highlights", highlightsTally);
    printTally("archive/quarantine", quarantineTally);
  }

  const totalFailed = publicTally.failed + highlightsTally.failed + quarantineTally.failed;
  if (totalFailed > 0) {
    console.error(`\n${totalFailed} file(s) failed to migrate — re-run this script to retry (it's idempotent).`);
    process.exit(1);
  }
  console.log(DRY_RUN ? "\nDry run complete — no local files were touched or deleted." : "\nDone — no local files were deleted.");
}

main().catch((err) => {
  console.error("migrate-clips-to-r2 crashed:", err);
  process.exit(1);
});
