// gospel E2-a — the authority resolver, and specifically the two
// behaviours that were missing when this went wrong.
//
// 1. An explicit "0" must WIN. Rolling back by *omitting* the variable is
//    what made e2-flip.sh's kill-switch a no-op: omission let the dotenv
//    supply "1" again and the script reported success.
// 2. An untracked dotenv must be VISIBLE. The live host ran wasm for ~29h
//    because nothing anywhere said "this value came from a file git has
//    never seen".

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dotenvDeclaresAuthority,
  resolveSimAuthority,
  warnIfAuthorityIsUntracked,
  TRACKED_DEFAULT_AUTHORITY,
} from "../simAuthority.ts";

function withDir(contents: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "jj-authority-"));
  try {
    for (const [name, body] of Object.entries(contents)) {
      writeFileSync(join(dir, name), body);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("resolveSimAuthority", () => {
  test("an explicit 0 beats a dotenv that says 1 — the rollback case", () => {
    withDir({ ".env.local": "USE_WASM_STEP_WORLD=1\n" }, (dir) => {
      const d = resolveSimAuthority({ USE_WASM_STEP_WORLD: "0" }, dir);
      expect(d.authority).toBe("ts");
      expect(d.source).toBe("env");
      // Still reported, because the operator should know the file is there
      // even when their explicit value is winning.
      expect(d.dotenvDeclares).toBe(true);
    });
  });

  test("an explicit 1 resolves to wasm", () => {
    withDir({}, (dir) => {
      expect(resolveSimAuthority({ USE_WASM_STEP_WORLD: "1" }, dir).authority).toBe("wasm");
      expect(resolveSimAuthority({ USE_WASM_STEP_WORLD: "true" }, dir).authority).toBe("wasm");
    });
  });

  test("nothing set → the TRACKED default, and it is named as such", () => {
    withDir({}, (dir) => {
      const d = resolveSimAuthority({}, dir);
      expect(d.authority).toBe(TRACKED_DEFAULT_AUTHORITY);
      expect(d.source).toBe("tracked-default");
      expect(d.dotenvDeclares).toBe(false);
    });
  });

  test("an empty string is not a decision", () => {
    withDir({}, (dir) => {
      expect(resolveSimAuthority({ USE_WASM_STEP_WORLD: "" }, dir).source).toBe("tracked-default");
    });
  });
});

describe("dotenvDeclaresAuthority", () => {
  test("finds the flag in .env.local and in .env", () => {
    withDir({ ".env.local": "FOO=1\nUSE_WASM_STEP_WORLD=1\n" }, (dir) => {
      expect(dotenvDeclaresAuthority(dir)).toBe(true);
    });
    withDir({ ".env": "USE_WASM_STEP_WORLD=0\n" }, (dir) => {
      // Value irrelevant — the point is that an untracked file is deciding.
      expect(dotenvDeclaresAuthority(dir)).toBe(true);
    });
  });

  test("ignores comments, and does not match a lookalike key", () => {
    withDir({ ".env.local": "# USE_WASM_STEP_WORLD=1\nUSE_WASM_STEP_WORLD_EXTRA=1\n" }, (dir) => {
      expect(dotenvDeclaresAuthority(dir)).toBe(false);
    });
  });

  test("no dotenv at all is false, not a throw", () => {
    withDir({}, (dir) => {
      expect(dotenvDeclaresAuthority(dir)).toBe(false);
    });
  });
});

describe("warnIfAuthorityIsUntracked", () => {
  test("warns, and names both the effective value and the tracked default", () => {
    const msg = warnIfAuthorityIsUntracked({
      authority: "wasm",
      source: "env",
      dotenvDeclares: true,
    });
    expect(msg).toContain("UNTRACKED");
    expect(msg).toContain('"wasm"');
    expect(msg).toContain(TRACKED_DEFAULT_AUTHORITY);
  });

  test("silent when nothing untracked is in play — no cry-wolf", () => {
    expect(
      warnIfAuthorityIsUntracked({ authority: "ts", source: "tracked-default", dotenvDeclares: false }),
    ).toBeNull();
  });
});
