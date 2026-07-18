// Test isolation for replayStore.ts (found live 2026-07-18, while adding the
// perf-audit N5 bot-only-match persist-gate test: postMatchResult() calls
// persistReplay() for real when a match ever had a human, and without an
// override that writes straight into the REAL production `.replays`
// directory — the exact same class of bug the .clips test-isolation fix
// (clipsDirIsolation.ts) addressed earlier the same day).
//
// Loaded via server/bunfig.toml's `[test] preload` — this runs before ANY
// test file (and therefore before replayStore.ts's first import anywhere),
// so JAKESJAM_REPLAYS_DIR is set before that module reads it into its
// module-level REPLAYS_DIR constant.

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jakesjam-replays-test-"));
process.env.JAKESJAM_REPLAYS_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
