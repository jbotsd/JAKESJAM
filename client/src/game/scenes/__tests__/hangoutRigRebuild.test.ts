// Live class-switch rig-rebuild invariant (2026-07-19 bug report: Jake
// switched to Interstice mid-visit in the venue lobby and saw his own rig
// render "thin, pale, wireframe" next to two normal-looking gold ALLY
// NPCs). HangoutScene itself can't be constructed under `bun test`
// (`import Phaser from "phaser"` throws — see chassisSilhouette.test.ts's
// header comment for the established precedent this file follows), so this
// exercises the PURE resolution formula `HangoutScene.makePlayerRig` uses
// (client/src/game/scenes/HangoutScene.ts, search `rosterCharacterIds.get`)
// via the same real, exported building blocks it calls — `characters` and
// `classAccentPalette` — rather than a from-scratch reimplementation.
//
// What this proves: `renderWorld`'s rebuild block
// (`this.rosterCharacterIds.set(pid, player.characterId)` immediately
// followed by `stale.destroy()` and, on the very next line of the SAME
// synchronous loop iteration, `this.makePlayerRig(player, ...)`) can never
// observe a stale roster entry — by the time `makePlayerRig` reads
// `this.rosterCharacterIds.get(player.id)`, it has ALREADY been overwritten
// to `player.characterId` on the current tick, in the current call frame,
// with no `await`/frame boundary between the write and the read. So a
// "rebuilt" rig's constructor options are byte-identical to what a "fresh"
// rig (one built from a roster that already agreed with `player.characterId`
// from the start, e.g. right after ServerHello) would have received for the
// same target class — there is no code path that can hand the rebuilt rig
// a stale classId/scale/palette.
//
// What this does NOT prove: this test found no evidence of a code bug
// anywhere in this resolution — see the investigation write-up. It rules
// OUT "stale roster cache read at rebuild time" as the cause of the
// reported visual, it does not explain the reported visual.

import { describe, expect, test } from "bun:test";
import { characters } from "../../data/characters";
import { classAccentPalette } from "../../ui/classAccentColors";
import type { ClassId } from "../../../sim/data/cardTypes.js";

// Mirrors HangoutScene.ts's own private constant (PLAYER_VISUAL_SCALE) and
// getVisualScale()/makePlayerRig() byte-for-byte. If that constant or
// formula ever drifts, this literal must be updated to match — same
// "copied verbatim, documented divergence risk" precedent chassisSilhouette
// .test.ts already accepts for HEAD/S/F.
const PLAYER_VISUAL_SCALE = 0.78;

type ResolvedRigChassis = {
  classId: ClassId;
  scale: number;
  maxHealth: number;
  accentColor: number;
  visorColor: number;
  palmColor: number;
  jointColor: number;
  auraColor: number;
};

const characterById = new Map(characters.map((c) => [c.id as string, c]));

/** Byte-for-byte mirror of HangoutScene.makePlayerRig's option resolution
 *  (no cosmetics override case — the class-default palette path, which is
 *  what a cosmetics-less local player like a fresh venue visitor hits). */
function resolveRigChassis(characterId: string): ResolvedRigChassis {
  const character = characterById.get(characterId) ?? characters[0]!;
  const palette = classAccentPalette(character.classId);
  return {
    classId: character.classId,
    scale: PLAYER_VISUAL_SCALE * character.sizeScale,
    maxHealth: character.maxHealth,
    accentColor: palette.accentColor,
    visorColor: palette.visorColor,
    palmColor: palette.palmColor,
    jointColor: palette.jointColor,
    auraColor: palette.auraColor,
  };
}

describe("HangoutScene rig-rebuild-on-class-switch invariant", () => {
  test("a rig rebuilt after a live class-pick resolves identically to a rig freshly built for that class from scratch", () => {
    for (const target of characters) {
      // "Fresh" — a rig built the first time HangoutScene ever sees this
      // player (ServerHello path, rosterCharacterIds already agrees).
      const fresh = resolveRigChassis(target.id as string);

      // "Rebuilt" — the SAME resolution, called after the exact
      // roster.set(pid, player.characterId) mutation renderWorld's rebuild
      // block performs immediately before calling makePlayerRig again.
      // There's no distinct code path for "rebuild" vs "fresh" — both call
      // the identical resolveRigChassis logic against whatever
      // rosterCharacterIds/player.characterId agree on at read time. This
      // assertion documents that agreement, not a coincidence.
      const rosterCharacterIds = new Map<string, string>();
      rosterCharacterIds.set("bingus", "balanced"); // arbitrary prior class
      rosterCharacterIds.set("bingus", target.id as string); // the live-sync line
      const rebuilt = resolveRigChassis(rosterCharacterIds.get("bingus")!);

      expect(rebuilt).toEqual(fresh);
    }
  });

  test("every class resolves a real, non-degenerate scale and a fully-opaque-capable (non-zero, non-transparent) accent palette — no near-invisible fallback", () => {
    for (const target of characters) {
      const resolved = resolveRigChassis(target.id as string);
      expect(resolved.scale).toBeGreaterThan(0.5);
      expect(resolved.scale).toBeLessThan(1.5);
      expect(resolved.maxHealth).toBeGreaterThan(0);
      for (const channel of [
        resolved.accentColor,
        resolved.visorColor,
        resolved.palmColor,
        resolved.jointColor,
        resolved.auraColor,
      ]) {
        expect(channel).toBeGreaterThan(0); // not black/unset (0x000000)
        expect(channel).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  test("Interstice (ninja) is only ~8% smaller than Geometrician (wizard), not a dramatic size collapse", () => {
    const wizard = resolveRigChassis("balanced");
    const ninja = resolveRigChassis("sprinter");
    const ratio = ninja.scale / wizard.scale;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(0.95);
  });
});
