import { describe, expect, test } from "bun:test";
import {
  EVENT_PRESENTATION_REGISTRY,
  getEventPresentationContract,
  listIncompleteEventPresentationContracts,
  type PresentationChannel,
} from "../eventPresentationRegistry.js";

describe("event presentation registry", () => {
  test("complete feedback stacks use at least three distinct channels", () => {
    for (const [kind, contract] of Object.entries(EVENT_PRESENTATION_REGISTRY)) {
      if (contract.state !== "complete") continue;
      const distinct = new Set<PresentationChannel>(contract.channels);
      expect(distinct.size, `${kind} channel count`).toBeGreaterThanOrEqual(3);
    }
  });

  test("every contract names a low-tier core and a legible state change", () => {
    for (const [kind, contract] of Object.entries(EVENT_PRESENTATION_REGISTRY)) {
      expect(contract.lowTierCore.length, `${kind} low-tier core`).toBeGreaterThan(10);
      expect(contract.stateChange.length, `${kind} state change`).toBeGreaterThan(10);
    }
  });

  test("known missing event reads stay visible in the orchestration backlog", () => {
    const incomplete = listIncompleteEventPresentationContracts();
    const missing = incomplete
      .filter(({ contract }) => contract.state === "missing")
      .map(({ kind }) => kind)
      .sort();

    expect(missing).toEqual([
    ]);
  });

  test("lookup returns the canonical contract", () => {
    expect(getEventPresentationContract("player-killed")).toBe(
      EVENT_PRESENTATION_REGISTRY["player-killed"],
    );
    expect(getEventPresentationContract("player-killed").intensity).toBe("kill");
  });
});
