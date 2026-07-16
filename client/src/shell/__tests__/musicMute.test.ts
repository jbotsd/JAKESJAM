// Music context law (venue-sprint2-goal S2.C.2): the venue track is a full
// citizen of the existing music settings — mute silences it like every other
// context, and lobby↔arena context flips pick exactly one active track with
// everything else fading out. No new audio category.

import { describe, test, expect } from "bun:test";
import {
  applyMusicMute,
  activeTrack,
  inactiveTracks,
  type MusicContext,
} from "../musicMute.js";

function mkTracks() {
  return {
    menu: { muted: false, id: "menu" },
    world: { muted: false, id: "world" },
    venue: { muted: false, id: "venue" },
  };
}

describe("music mute law (S2.C.2)", () => {
  test("mute → EVERY context's track muted, venue included", () => {
    const tracks = mkTracks();
    applyMusicMute(tracks, true);
    expect(tracks.menu.muted).toBe(true);
    expect(tracks.world.muted).toBe(true);
    expect(tracks.venue.muted).toBe(true);
  });

  test("unmute → every track unmuted again", () => {
    const tracks = mkTracks();
    applyMusicMute(tracks, true);
    applyMusicMute(tracks, false);
    expect(Object.values(tracks).every((t) => !t.muted)).toBe(true);
  });

  test("venue context activates exactly the venue track; the rest fade out", () => {
    const tracks = mkTracks();
    expect(activeTrack(tracks, "venue").id).toBe("venue");
    const fading = inactiveTracks(tracks, "venue").map((t) => t.id);
    expect(fading.sort()).toEqual(["menu", "world"]);
  });

  test("active + inactive partition the track set for every context", () => {
    const tracks = mkTracks();
    for (const context of ["menu", "world", "venue"] as MusicContext[]) {
      const ids = [activeTrack(tracks, context).id, ...inactiveTracks(tracks, context).map((t) => t.id)];
      expect(ids.sort()).toEqual(["menu", "venue", "world"]);
    }
  });
});
