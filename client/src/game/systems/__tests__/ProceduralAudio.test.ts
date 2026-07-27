import { describe, expect, test } from "bun:test";
import { shouldTapEvidenceAudio } from "../ProceduralAudio.js";

// clip-goal D4: the live-audio evidence tap gates ClipRecorder's audio fix
// (B3) as well as the pre-existing `?evidence=1` Playwright path
// (scripts/autoplay.ts). Pinned as a truth table so neither caller can
// silently regress the other.
describe("shouldTapEvidenceAudio", () => {
  test("stays on for the pre-existing ?evidence=1 Playwright path regardless of clip consent", () => {
    expect(shouldTapEvidenceAudio(true, true)).toBe(true);
    expect(shouldTapEvidenceAudio(true, false)).toBe(true);
  });

  test("turns on for clip capture even without ?evidence=1", () => {
    expect(shouldTapEvidenceAudio(false, true)).toBe(true);
  });

  test("stays off when neither evidence mode nor clip consent is active", () => {
    expect(shouldTapEvidenceAudio(false, false)).toBe(false);
  });
});
