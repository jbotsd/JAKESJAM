// Test isolation for clipStore.ts (found live 2026-07-18: clipStore.test.ts
// and ops.test.ts called handleClipUpload/pinClip directly against the
// REAL production `.clips` directory — every test run left junk files
// behind, some of them pinned into `kept/` and never cleaned up, all
// reachable at real public /c/<uuid> share pages indistinguishable from
// genuine highlights. 258 fixture files had accumulated on disk).
//
// Loaded via server/bunfig.toml's `[test] preload` — this runs before ANY
// test file (and therefore before clipStore.ts's first import anywhere),
// so JAKESJAM_CLIPS_DIR is set before that module reads it into its
// module-level CLIPS_DIR/KEPT_DIR constants.

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jakesjam-clips-test-"));
process.env.JAKESJAM_CLIPS_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
