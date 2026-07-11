// Figure-ground presence layer (the gestalt pass, 2026-07-11).
//
// Characters were drawn straight onto a busy field — ochre platforms,
// cosmic seal linework, stars — and could melt into it. Classic
// figure-ground fix: give every figure a soft DARK backing (negative
// space travels with the body, so the silhouette always has local
// contrast), and give the LOCAL player an ownership accent (feet ring +
// faint aura) so "which one is me" is answered pre-attentively.
//
// ONE painter, both scenes (pillar 6). Drawn on a NORMAL-blend Graphics
// UNDER the rigs — the dark backing must darken, not add.

import type Phaser from "phaser";
import type { PlayerId, WorldState } from "../../sim/types";

const LOCAL_ACCENT = 0x50e3c2;

/**
 * Draw the presence layer for every living player. `localId` may be null
 * (replay/spectator renders — everyone gets the neutral backing only).
 */
export function drawPlayerPresence(
  g: Phaser.GameObjects.Graphics,
  state: WorldState,
  localId: string | null,
  fxLevel: number,
): void {
  for (const pid in state.players) {
    const p = state.players[pid as PlayerId]!;
    if (!p.alive) continue;
    const isLocal = pid === localId;
    // Soft dark radial backing — two lobes read as one smooth falloff.
    g.fillStyle(0x000000, isLocal ? 0.30 : 0.22);
    g.fillCircle(p.x, p.y - 6, 34);
    g.fillStyle(0x000000, isLocal ? 0.16 : 0.10);
    g.fillCircle(p.x, p.y - 6, 54);
    if (isLocal) {
      // Ownership accent: crisp feet ellipse + a whisper of aura.
      g.lineStyle(2, LOCAL_ACCENT, 0.5);
      g.strokeEllipse(p.x, p.y + 30, 46, 14);
      g.fillStyle(LOCAL_ACCENT, 0.05);
      g.fillEllipse(p.x, p.y + 30, 46, 14);
      if (fxLevel >= 1) {
        g.fillStyle(LOCAL_ACCENT, 0.05);
        g.fillCircle(p.x, p.y - 10, 62);
      }
    }
  }
}
