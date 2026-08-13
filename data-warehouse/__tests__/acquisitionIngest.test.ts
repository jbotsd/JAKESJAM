// End-to-end: does an acquisition-tagged boot event actually REACH its
// column in session_fingerprints?
//
// This test exists because the live warehouse currently shows NULL in
// every acquisition column, and NULL is exactly what a broken ingest
// would also show. Unit-testing the classifier proves the classifier;
// only this proves the wiring between the boot payload and the column.
//
// It drives the REAL ingest.ts as a subprocess against a throwaway DB and
// a fixture telemetry dir — not a reimplementation of its logic.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const INGEST = resolve(import.meta.dir, "..", "ingest.ts");

let work: string;
let dbPath: string;

/** One stored telemetry line, in the exact shape telemetryStore writes. */
function bootLine(session: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({
    at: "2026-08-13T04:00:00.000Z",
    session,
    build: "testbuild",
    seq: 0,
    kind: "boot",
    sig: "boot",
    message: "boot",
    data: { tier: "standard", renderer: "Intel Arc B580", touch: false, w: 1920, h: 1080, dpr: 1, ...data },
  })}\n`;
}

beforeAll(async () => {
  work = mkdtempSync(resolve(tmpdir(), "jj-acq-"));
  dbPath = resolve(work, "test.db");
  const telemetryDir = resolve(work, "telemetry");
  mkdirSync(telemetryDir, { recursive: true });
  writeFileSync(
    resolve(telemetryDir, "events-2026-08-13.jsonl"),
    bootLine("sess-social", {
      src: "reddit.com",
      refGroup: "social",
      ref: "reddit.com",
      landing: "/",
    }) +
      bootLine("sess-tagged", {
        src: "instagram",
        refGroup: "direct",
        utmMedium: "social",
        utmCampaign: "fight-night",
        landing: "/play",
      }) +
      // A pre-instrument session: no acquisition keys at all.
      bootLine("sess-legacy", {}),
  );

  const proc = Bun.spawn(["bun", INGEST], {
    env: {
      ...process.env,
      JAKESJAM_WAREHOUSE_DB: dbPath,
      JAKESJAM_TELEMETRY_DIR: telemetryDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`ingest failed (${code}): ${await new Response(proc.stderr).text()}`);
  }
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("acquisition reaches session_fingerprints", () => {
  test("an untagged social referral lands with its host and group", () => {
    const db = new Database(dbPath, { readonly: true });
    const r = db
      .query<{ src: string; ref_group: string; ref: string; landing: string }, [string]>(
        `SELECT src, ref_group, ref, landing FROM session_fingerprints WHERE session = ?`,
      )
      .get("sess-social");
    db.close();
    expect(r).toEqual({ src: "reddit.com", ref_group: "social", ref: "reddit.com", landing: "/" });
  });

  test("a utm-tagged visit carries campaign and medium", () => {
    const db = new Database(dbPath, { readonly: true });
    const r = db
      .query<{ src: string; utm_campaign: string; utm_medium: string; landing: string }, [string]>(
        `SELECT src, utm_campaign, utm_medium, landing FROM session_fingerprints WHERE session = ?`,
      )
      .get("sess-tagged");
    db.close();
    expect(r).toEqual({
      src: "instagram",
      utm_campaign: "fight-night",
      utm_medium: "social",
      landing: "/play",
    });
  });

  test("a pre-instrument session stays NULL — not '' and not 'direct'", () => {
    // The reporting rule depends on this: un-instrumented must remain
    // distinguishable from un-referred, or the pre-August traffic would
    // read as a wall of direct visits that nobody ever measured.
    const db = new Database(dbPath, { readonly: true });
    const r = db
      .query<{ src: string | null; ref_group: string | null }, [string]>(
        `SELECT src, ref_group FROM session_fingerprints WHERE session = ?`,
      )
      .get("sess-legacy");
    db.close();
    expect(r).toEqual({ src: null, ref_group: null });
  });

  test("the fixture is not vacuous — all three sessions were ingested", () => {
    // If the fixture path were wrong, every assertion above would be
    // comparing undefined to undefined and passing for the wrong reason.
    const db = new Database(dbPath, { readonly: true });
    const n = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM session_fingerprints`).get();
    db.close();
    expect(n?.n).toBe(3);
  });
});
