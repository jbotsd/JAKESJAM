// Track P1 — the funnel instrument's own rules.
//
// This measures the north star's numeric gates, all of which currently read
// "unmeasured". An instrument that lies is worse than no instrument (L8), so
// the rules that keep it honest get tests: fire once, stay ordered, back-fill
// visibly, and never report a wrong-input firehose.

import { describe, expect, test, beforeEach, mock } from "bun:test";

const recorded: Array<{ kind: string; sig: string; data?: Record<string, unknown> }> = [];
mock.module("../../telemetry", () => ({
  record: (ev: { kind: string; sig: string; data?: Record<string, unknown> }) => {
    recorded.push(ev);
  },
  crumb: () => {},
}));

const {
  funnel,
  initFunnel,
  funnelReached,
  noteWrongInput,
  flushWrongInputs,
  FUNNEL_STEPS,
  __funnelStateForTests,
} = await import("../funnel.ts");

beforeEach(() => {
  recorded.length = 0;
  initFunnel(0);
});

describe("funnel", () => {
  test("a milestone fires exactly once, however many times it is marked", () => {
    funnel("first_shot", 1000);
    const first = recorded.length;
    funnel("first_shot", 2000);
    funnel("first_shot", 3000);
    expect(recorded.length).toBe(first);
  });

  test("elapsed ms is measured from the funnel's origin", () => {
    funnel("playable", 1234);
    const ev = recorded.find((e) => e.sig === "funnel:playable");
    expect(ev?.data?.ms).toBe(1234);
  });

  test("a later milestone back-fills the earlier ones, and says so", () => {
    // A first_kill with no first_shot recorded is a WIRING bug, not a player
    // who killed without shooting — so the gap is filled and flagged rather
    // than left for the report to misread as a drop-off.
    funnel("first_kill", 5000);
    const sigs = recorded.map((e) => e.sig);
    expect(sigs).toContain("funnel:page_load");
    expect(sigs).toContain("funnel:first_input");
    expect(sigs).toContain("funnel:first_shot");
    expect(sigs).toContain("funnel:first_kill");

    const backfilled = recorded.filter((e) => e.data?.backfilled === true);
    const own = recorded.filter((e) => e.data?.backfilled === false);
    expect(own.map((e) => e.sig)).toEqual(["funnel:first_kill"]);
    expect(backfilled.length).toBe(FUNNEL_STEPS.indexOf("first_kill"));
  });

  test("steps carry their index so the report can order without hardcoding", () => {
    funnel("playable", 10);
    const ev = recorded.find((e) => e.sig === "funnel:playable");
    expect(ev?.data?.stepIndex).toBe(FUNNEL_STEPS.indexOf("playable"));
  });

  test("funnelReached tracks what has fired", () => {
    expect(funnelReached("first_shot")).toBe(false);
    funnel("first_shot", 100);
    expect(funnelReached("first_shot")).toBe(true);
    expect(funnelReached("first_kill")).toBe(false);
  });

  test("wrong inputs are counted locally and reported ONCE", () => {
    // A key-mashing visitor must cost one event, not fifty — the whole point
    // of the local tally.
    for (let i = 0; i < 50; i++) noteWrongInput(1000 + i);
    expect(__funnelStateForTests().wrongInputs).toBe(50);
    expect(recorded.filter((e) => e.sig === "funnel:wrong_inputs").length).toBe(0);

    flushWrongInputs(40_000); // past the 30 s window
    const sent = recorded.filter((e) => e.sig === "funnel:wrong_inputs");
    expect(sent.length).toBe(1);
    expect(sent[0]?.data?.count).toBe(50);

    flushWrongInputs(50_000); // idempotent
    expect(recorded.filter((e) => e.sig === "funnel:wrong_inputs").length).toBe(1);
  });

  test("wrong inputs outside the opening window are not counted", () => {
    noteWrongInput(40_000);
    // The late call flushes rather than tallying; with nothing tallied there
    // is nothing to report.
    expect(__funnelStateForTests().wrongInputs).toBe(0);
    expect(recorded.filter((e) => e.sig === "funnel:wrong_inputs").length).toBe(0);
  });

  test("initFunnel resets a session", () => {
    funnel("first_shot", 100);
    initFunnel(0);
    expect(funnelReached("first_shot")).toBe(false);
    expect(__funnelStateForTests().reached).toEqual([]);
  });
});
