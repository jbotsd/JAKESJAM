// Map registry resolution: the io world server broadcasts the EMBEDDED
// `.id` of the map (post-expandMap, that's "boxworks-expanded"), but the
// registry's literal `MapId` keys are the human-friendly names ("boxworks",
// "boxworks-mini", "boxworks-tower"). resolveMap must accept either form
// or the OnlineMatchScene render path silently falls back to the default
// arena and the player sees a black world.

import { describe, test, expect } from "bun:test";
import {
  DEFAULT_MAP_ID,
  isMapId,
  mapsById,
  resolveMap,
} from "../data/maps.js";
import { boxworksWorld } from "../data/boxworks.js";

describe("resolveMap", () => {
  test("canonical MapId returns its mapDefinition", () => {
    expect(resolveMap("boxworks")).toBe(mapsById.boxworks);
    expect(resolveMap("boxworks-mini")).toBe(mapsById["boxworks-mini"]);
    expect(resolveMap("boxworks-tower")).toBe(mapsById["boxworks-tower"]);
  });

  test("embedded .id alias resolves to the same definition (boxworks-expanded → boxworks)", () => {
    // boxworksWorld is the post-expandMap result; its .id is
    // "boxworks-expanded" (per expandMap in boxworks.ts), but it lives in
    // the registry under the "boxworks" key. Both ids must resolve to
    // exactly the same MapDefinition object so the server's hello message
    // and the client's render call agree on the same arena.
    expect(boxworksWorld.id).toBe("boxworks-expanded");
    expect(resolveMap("boxworks-expanded")).toBe(mapsById.boxworks);
    expect(resolveMap("boxworks-expanded")).toBe(boxworksWorld);
  });

  test("unknown id falls back to the default map", () => {
    expect(resolveMap("definitely-not-a-real-map")).toBe(mapsById[DEFAULT_MAP_ID]);
  });

  test("undefined id falls back to the default map", () => {
    expect(resolveMap(undefined)).toBe(mapsById[DEFAULT_MAP_ID]);
  });

  test("isMapId narrows only canonical MapIds (NOT aliases)", () => {
    // The narrow type guard is intentionally strict — only literal MapIds
    // are MapId. Aliases like "boxworks-expanded" are accepted by
    // resolveMap but should NOT pass isMapId, which acts as the "is this
    // a value safe to construct a WorldHost with?" gate.
    expect(isMapId("boxworks")).toBe(true);
    expect(isMapId("boxworks-expanded")).toBe(false);
    expect(isMapId("nope")).toBe(false);
  });
});
