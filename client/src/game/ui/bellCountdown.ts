// The persistent next-bell countdown line (Doors 1.5b — "a visible
// next-bell countdown from second zero", docs/open-doors-goal.md Phase 1).
//
// Before this, the only dedicated countdown in the venue was the bell
// totem's world-space label ("THE BELL · M:SS") — visible only when the
// camera is near the bell — plus a sub-line of the dim arena feed that
// didn't exist until the first 1Hz venue-status frame arrived. A visitor
// facing an up-to-100 s wait deserves the answer to "when do I fight?"
// on screen from the second they enter.
//
// Honesty rules follow phaseCountdown.ts's doctrine (venue-goal Pillar
// 0.2): fighting/round-over times are UPPER-BOUND estimates (a round can
// end early, a draft can resolve early — the number only ever jumps
// DOWN), so they render with a "~" instead of asserting false precision.
// Drafting is exact; countdown reads 0:00 (the bell IS ringing — already
// the joinable moment, msUntilNextBell's own convention). Null = no
// status frame yet: an honest placeholder, never a fabricated number.
//
// Pure and engine-free so it's testable under bun:test (HangoutScene
// can't be constructed there — hangoutRigRebuild.test.ts precedent).

export type VenueArenaPhase = "countdown" | "fighting" | "round-over" | "drafting";

export function formatBellCountdown(
  bellMs: number | null,
  phase?: VenueArenaPhase,
): string {
  if (bellMs === null) return "NEXT BELL --:--";
  const sec = Math.max(0, Math.ceil(bellMs / 1000));
  const mm = Math.floor(sec / 60);
  const ss = (sec % 60).toString().padStart(2, "0");
  const approx = phase === "fighting" || phase === "round-over";
  return `NEXT BELL ${approx ? "~" : ""}${mm}:${ss}`;
}
