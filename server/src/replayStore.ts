// Local replay persistence — the source feed for the headless replay
// renderer (RENDER_OVERHAUL_PLAN Phase 5) and a reliability fix: replays
// previously went to Convex fire-and-forget ("if Convex is down, drop the
// replay"), which on a self-hosted box means kill-worthy matches can just
// vanish. Files are tiny (kilobytes of msgpack inputs), so a generous
// quota outlasts anything the clip store keeps.

import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// Perf audit N5 test-isolation fix (2026-07-18): the new bot-only-match
// persist-gate test calls postMatchResult() for real, which reaches
// persistReplay() — without an override this wrote junk .jjr files into the
// REAL production .replays dir (same class of bug the .clips test-isolation
// fix addressed 2026-07-18 earlier the same day). See
// __tests__/setup/replaysDirIsolation.ts (server/bunfig.toml [test] preload).
const REPLAYS_DIR = process.env.JAKESJAM_REPLAYS_DIR
  ? resolve(process.env.JAKESJAM_REPLAYS_DIR)
  : resolve(import.meta.dir, "..", ".replays");
/** Inputs are kilobytes; 100MB holds tens of thousands of matches. */
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

let dirReady = false;

function ensureDir(): void {
  if (dirReady) return;
  mkdirSync(REPLAYS_DIR, { recursive: true });
  dirReady = true;
}

function enforceQuota(): void {
  const entries = readdirSync(REPLAYS_DIR)
    .filter((f) => f.endsWith(".jjr"))
    .map((f) => {
      const p = resolve(REPLAYS_DIR, f);
      const st = statSync(p);
      return { p, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  let total = entries.reduce((s, e) => s + e.size, 0);
  for (const e of entries) {
    if (total <= MAX_TOTAL_BYTES) break;
    try {
      unlinkSync(e.p);
      total -= e.size;
    } catch {
      break;
    }
  }
}

/** Write a finished match's serialized replay to disk. Never throws —
 *  persistence must not be able to break the post-match path. */
export function persistReplay(matchId: string, bytes: Uint8Array): string | null {
  try {
    ensureDir();
    // matchId is server-generated but sanitize anyway (filesystem path).
    const safe = matchId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = resolve(REPLAYS_DIR, `${safe}-${Date.now()}.jjr`);
    Bun.write(path, bytes);
    enforceQuota();
    return path;
  } catch (err) {
    console.warn(`[replays] local persist failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
