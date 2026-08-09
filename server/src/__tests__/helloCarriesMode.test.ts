// The venue lobby must tell clients it is a HANGOUT, not leave them to
// guess from its name.
//
// The bug this locks down (found 2026-08-09 via the venue 2.5 e2e): the
// client resolved WorldMode with
//
//     matchId.startsWith("hangout_") ? "hangout" : "combat"
//
// and the venue lobby's id is plain "lobby". So the default landing
// surface for EVERY visitor predicted in combat mode against a server
// running hangout, and the client's round machine walked the lobby into
// phase "round-over" — a state hangout mode exists to make impossible.
//
// The fix is ServerHello.mode. These tests guard both halves: that the
// server actually states it, and that the old inference really was wrong
// for this id (so nobody "simplifies" back to the sniff later).

import { describe, expect, test } from "bun:test";
import { VENUE_LOBBY_MATCH_ID } from "../venueHost.ts";

describe("venue lobby mode is stated, not inferred", () => {
  test("the lobby's id defeats the old startsWith('hangout_') inference", () => {
    // This is the whole bug in one line. If someone renames the lobby to
    // "hangout_lobby" this assertion fails loudly and can be deleted with
    // the fix it guards — but until then, the inference is NOT safe.
    expect(VENUE_LOBBY_MATCH_ID.startsWith("hangout_")).toBe(false);
  });

  test("ServerHello carries an explicit mode field", async () => {
    // Structural, not behavioural: assert the hello builder names `mode`.
    // Standing up a real MatchHost + socket here would test bun's WebSocket
    // more than it tests this contract.
    const src = await Bun.file(
      new URL("../matchHost.ts", import.meta.url).pathname,
    ).text();
    const hello = src.slice(src.indexOf("private sendHello"));
    const body = hello.slice(0, hello.indexOf("\n  }"));
    expect(body).toContain("mode: this.mode");

    // Vacuity guard: if sendHello were ever renamed or removed, the two
    // slices above would silently produce an empty/odd string and the
    // assertion could pass on nothing.
    expect(body).toContain('t: "hello"');
    expect(body.length).toBeGreaterThan(80);
  });
});
