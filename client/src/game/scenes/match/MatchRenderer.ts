// MatchRenderer — seam between the match update tick and all visual output.
//
// Depth: the suite of syncPlayerVisuals, syncRemotePlayerVisuals, drawShield,
// updateReticle, updateFireVisuals, updateDestructibleVisuals, updatePickupVisuals,
// updateHudSystem, and updateRoundBannerSystem calls are folded behind a single
// render(deltaMs) call. The orchestrator never addresses visual sub-systems
// individually — it calls render() once per frame and this module decides what
// to draw.
//
// Construction: takes a reference to MatchScene because all the Phaser objects
// (Graphics, Text, ProceduralPlayerRig) are owned by the scene. The renderer
// calls scene private methods via a narrow delegation interface rather than
// importing Phaser directly — keeping the module decoupled from the Phaser
// version while the scene stays as the Phaser object host.

export type RendererDelegate = {
  syncPlayerVisuals(deltaMs: number): void;
  syncRemotePlayerVisuals(deltaMs: number): void;
  drawShield(): void;
  updateReticle(): void;
  updateFireVisuals(): void;
  updateDestructibleVisuals(): void;
  updatePickupVisuals(): void;
  updateTargetVisuals(): void;
  updateHudSystem(): void;
  updateRoundBannerSystem(): void;
  updateScoreboardOverlay(): void;
  /** Tick all element-status VFX (burn sparks, freeze shards) for this frame. */
  tickAllStatusVfx(deltaMs: number): void;
};

export class MatchRenderer {
  private readonly delegate: RendererDelegate;

  constructor(delegate: RendererDelegate) {
    this.delegate = delegate;
  }

  /**
   * Render a single frame. Calls all visual sub-systems in the correct order:
   * status VFX, entity visuals, shield/parry overlay, reticle, arena hazards,
   * and HUD layers. deltaMs is the raw (un-scaled) frame delta.
   */
  render(deltaMs: number): void {
    // Status VFX timers — update particle emitters, color overlays, etc.
    this.delegate.tickAllStatusVfx(deltaMs);

    // Entity visuals.
    this.delegate.syncPlayerVisuals(deltaMs);
    this.delegate.syncRemotePlayerVisuals(deltaMs);
    this.delegate.updateTargetVisuals();

    // Shield / parry overlay — drawn on top of player rig.
    this.delegate.drawShield();

    // Cursor reticle.
    this.delegate.updateReticle();

    // Arena hazard layers (fire, destructibles, pickups).
    this.delegate.updateFireVisuals();
    this.delegate.updateDestructibleVisuals();
    this.delegate.updatePickupVisuals();

    // HUD and scoreboard layers.
    this.delegate.updateScoreboardOverlay();
    this.delegate.updateHudSystem();
    this.delegate.updateRoundBannerSystem();
  }
}
