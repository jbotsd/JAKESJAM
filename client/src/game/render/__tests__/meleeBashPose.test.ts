// SHIELD BASH render sentence (slash-feel-ledger design-decision block) —
// pure planner layer, Phaser-free (this file must never import Phaser:
// the planner IS the testable surface). Proves the body-CHECK contract:
// slab chambers then punches, sword yields the beat, the kinetic chain
// loads before it surges, and the render contact fraction matches the
// sim's bash gate.

import { describe, expect, test } from "bun:test";
import {
  KINDLED_BASH_CONTACT_T,
  bashHandPose,
  bashKineticChain,
  bashStage,
  bashSwordHandPose,
} from "../meleeTiming.js";
import { EDGE_SWING_MS } from "../meleeTiming.js";

describe("bash stage clocks", () => {
  test("chamber → thrust → hold → recovery partition the sentence", () => {
    expect(bashStage(0).chamber).toBe(0);
    expect(bashStage(0.36).chamber).toBe(1);
    expect(bashStage(0.36).thrust).toBe(0);
    expect(bashStage(0.56).thrust).toBe(1);
    expect(bashStage(0.56).hold).toBe(0);
    expect(bashStage(0.74).hold).toBe(1);
    expect(bashStage(0.99).recovery).toBeGreaterThan(0.9);
  });

  test("render contact fraction matches the sim gate (windup 200 + 60 into active, of a 560ms sentence) within one tick", () => {
    const simContactMs = 200 + 60;
    const renderContactMs = KINDLED_BASH_CONTACT_T * EDGE_SWING_MS;
    expect(Math.abs(renderContactMs - simContactMs)).toBeLessThan(1000 / 60);
    // And contact lands inside the thrust window — the plate is at speed
    // when the sim confirms the hit, not parked.
    expect(KINDLED_BASH_CONTACT_T).toBeGreaterThan(0.36);
    expect(KINDLED_BASH_CONTACT_T).toBeLessThan(0.56);
  });
});

describe("slab hand — chamber then punch", () => {
  test("reach contracts into the chamber, extends hard through contact, and holds", () => {
    const ready = bashHandPose(0, 0).reach;
    const chambered = bashHandPose(0, 0.35).reach;
    const contact = bashHandPose(0, KINDLED_BASH_CONTACT_T).reach;
    const extended = bashHandPose(0, 0.56).reach;
    const held = bashHandPose(0, 0.7).reach;
    expect(chambered).toBeLessThan(ready); // mass gathers first
    expect(contact).toBeGreaterThan(ready); // already punching at the gate
    expect(extended).toBeGreaterThan(contact - 1e-9); // peak at full thrust
    expect(held).toBeGreaterThan(ready); // the check STAYS on the target
  });

  test("the punch stays on the aim axis (a straight check, not an arc)", () => {
    for (const t of [0.1, 0.3, 0.46, 0.6, 0.8]) {
      expect(Math.abs(bashHandPose(0, t).angle)).toBeLessThan(0.25);
    }
  });
});

describe("sword hand — yields the beat", () => {
  test("stays chambered behind the body line for the whole sentence", () => {
    for (const t of [0.1, 0.4, 0.6, 0.9]) {
      const { angle, reach } = bashSwordHandPose(0, 1, t);
      // Behind = more than a quarter-turn off the aim axis.
      expect(Math.abs(angle)).toBeGreaterThan(Math.PI / 2);
      expect(reach).toBeLessThan(35); // never extends into a strike
    }
  });
});

describe("kinetic chain — load before surge, weight through the front foot", () => {
  test("rear-side load during chamber, forward surge through thrust, settle in recovery", () => {
    const load = bashKineticChain(0.3);
    expect(load.pelvisDrive).toBeLessThan(0);
    expect(load.chestDrive).toBeLessThan(load.pelvisDrive); // chest rounds deeper
    const surge = bashKineticChain(0.56);
    expect(surge.pelvisDrive).toBeGreaterThan(10);
    expect(surge.chestDrive).toBeGreaterThan(surge.pelvisDrive); // shoulder-led check
    expect(surge.frontBrace).toBe(1); // weight pinned through the front foot
    const hold = bashKineticChain(0.7);
    expect(hold.frontBrace).toBe(1);
    expect(hold.pelvisDrive).toBeGreaterThan(10); // still committed on the target
    const end = bashKineticChain(0.999);
    expect(Math.abs(end.pelvisDrive)).toBeLessThan(1);
    expect(end.frontBrace).toBeLessThan(0.05);
  });

  test("pelvis opens before the chest catches up in the thrust (proximal-to-distal)", () => {
    const early = bashKineticChain(0.42);
    // Early thrust: pelvis has left its load further (proportionally) than
    // the chest — normalized progress from load toward peak.
    const pelvisProgress = (early.pelvisDrive - -7) / (15 - -7);
    const chestProgress = (early.chestDrive - -10) / (22 - -10);
    expect(pelvisProgress).toBeGreaterThan(chestProgress);
  });
});
