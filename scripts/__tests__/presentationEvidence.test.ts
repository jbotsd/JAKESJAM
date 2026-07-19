import { describe, expect, test } from "bun:test";
import {
  auditPresentationEvidence,
  collectObservedBeats,
  findCausalProjectilePair,
  hasAllRequiredBeats,
  makeUnreviewedManifest,
  REVIEW_LENSES,
} from "../presentationEvidence.js";
import { PRESENTATION_SCENARIOS } from "../presentationScenarios.js";
import { crystalRoundsCards } from "../../client/src/sim/data/cards.js";

describe("presentation evidence contract", () => {
  test("semantic aliases come only from authoritative event metadata", () => {
    const beats = collectObservedBeats([
      { kind: "shot-fired", atMs: 10 },
      { kind: "ability-activated", abilityKind: "self-lattice", atMs: 20 },
      { kind: "syz-ward-absorbed", wardBroke: true, atMs: 30 },
      { kind: "dash-through", atMs: 40 },
      { kind: "shot-fired", atMs: 50, remoteOnly: true },
    ]);
    expect(beats["shot-fired"]).toEqual([10]);
    expect(beats["ability:self-lattice"]).toEqual([20]);
    expect(beats["ward-cast"]).toEqual([20]);
    expect(beats["ward-broke"]).toEqual([30]);
    expect(beats["parry-or-dash-through"]).toEqual([40]);
    expect(beats["ability:flock-pulse"]).toBeUndefined();
    expect(beats["remote:shot-fired"]).toEqual([50]);
    expect(beats["shot-fired"]).toEqual([10]);
  });

  test("generic completion waits for every required beat", () => {
    const scenario = PRESENTATION_SCENARIOS["core-starter-shot"];
    expect(hasAllRequiredBeats(scenario, { "shot-fired": [10] })).toBe(false);
    expect(hasAllRequiredBeats(scenario, {
      "shot-fired": [10],
      "hit-confirmed": [30],
    })).toBe(true);
  });

  test("causal frame pairing follows projectile identity, not the nearest shot", () => {
    const pair = findCausalProjectilePair([
      { kind: "shot-fired", atMs: 100, localActor: true, projectileIds: [41] },
      { kind: "shot-fired", atMs: 180, localActor: true, projectileIds: [42] },
      { kind: "hit-confirmed", atMs: 220, localTarget: false, sourceProjectileId: 41 },
    ]);
    expect(pair).toEqual({ actionAtMs: 100, impactAtMs: 220, projectileId: 41 });
  });

  test("causal evidence rejects spawn-overlap hits below the flight-tick floor", () => {
    const events = [
      {
        kind: "shot-fired", atMs: 100, atTick: 80, localActor: true,
        projectileIds: [41],
      },
      {
        kind: "hit-confirmed", atMs: 101, atTick: 80, localTarget: false,
        sourceProjectileId: 41,
      },
      {
        kind: "shot-fired", atMs: 200, atTick: 90, localActor: true,
        projectileIds: [42],
      },
      {
        kind: "hit-confirmed", atMs: 280, atTick: 95, localTarget: false,
        sourceProjectileId: 42,
      },
    ];
    expect(findCausalProjectilePair(events, 4)).toEqual({
      actionAtMs: 200,
      impactAtMs: 280,
      projectileId: 42,
    });
  });

  test("a fresh capture cannot masquerade as reviewed evidence", () => {
    const scenario = PRESENTATION_SCENARIOS["core-starter-shot"];
    const manifest = makeUnreviewedManifest(scenario, {
      runId: "run-1",
      qualityTier: "potato",
      viewport: { width: 960, height: 540 },
      startedAt: "2026-07-18T00:00:00.000Z",
    });
    const audit = auditPresentationEvidence(scenario, manifest);
    expect(audit.complete).toBe(false);
    expect(audit.missing).toContain("beat:shot-fired");
    expect(audit.missing).toContain("review:audio-only");
  });

  test("all beats, phases, lenses, audio, and defects must close", () => {
    const scenario = PRESENTATION_SCENARIOS["core-starter-shot"];
    const manifest = makeUnreviewedManifest(scenario, {
      runId: "run-2",
      qualityTier: "standard",
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-07-18T00:00:00.000Z",
    });
    manifest.videoPath = "run.webm";
    manifest.audioPath = "run.wav";
    manifest.observedBeats = { "shot-fired": [100], "hit-confirmed": [250] };
    manifest.frames = {
      anticipation: ["a.png"], action: ["b.png"], impact: ["c.png"], recovery: ["d.png"],
    };
    for (const lens of REVIEW_LENSES) manifest.reviews[lens].verdict = "pass";
    manifest.defects = [{ id: "blur", description: "impact blurred", resolved: false }];
    expect(auditPresentationEvidence(scenario, manifest).missing).toContain("defect:blur");
    manifest.defects[0]!.resolved = true;
    expect(auditPresentationEvidence(scenario, manifest)).toEqual({ complete: true, missing: [] });
  });

  test("every shipped active owns an independently audited scenario", () => {
    const activeKinds = crystalRoundsCards
      .filter((card) => card.active)
      .map((card) => card.active!.kind);
    expect(activeKinds.length).toBeGreaterThan(40);
    for (const kind of activeKinds) {
      const scenario = PRESENTATION_SCENARIOS[`ability-${kind}`];
      expect(scenario, kind).toBeDefined();
      expect(scenario.requiredBeats).toContain(`ability:${kind}`);
    }
  });
});
