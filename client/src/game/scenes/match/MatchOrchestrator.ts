// MatchOrchestrator — owns the frame-level update tick for the offline match.
//
// Depth: the full update sequence (round state, input gating, movement,
// combat, projectiles, network sync, rendering) sits behind a single
// update(deltaMs) call. MatchScene.update() becomes a 5-line guard + delegate.
//
// Construction: takes a narrow MatchTickDelegate rather than the full
// MatchScene, so future extraction can swap the delegate for a different
// implementation without touching the orchestrator.

export type MatchTickDelegate = {
  // Guard: returns true when the scene is fully initialised and can tick.
  isReady(): boolean;

  // Round / respawn.
  advanceRoundState(deltaMs: number): void;
  updateRespawnCountdown(deltaMs: number): void;
  isRespawnPending(): boolean;
  freezePlayerForRespawn(): void;

  // Reset shortcut (R key).
  handleDebugReset(): void;

  // Chaos profile.
  getChaosTimeScale(): number;
  getChaosGravityMultiplier(): number;

  // Player update paths.
  updateShield(scaledDeltaMs: number): void;
  updateParry(scaledDeltaMs: number): void;
  readAndApplyMovement(scaledDeltaMs: number, scaledDeltaSeconds: number): void;
  checkOutOfBounds(): void;
  updateCameraTarget(): void;
  updatePickups(scaledDeltaMs: number): void;
  tryFireWeapon(scaledDeltaMs: number): void;

  // Sim / environment.
  updateTarget(scaledDeltaMs: number): void;
  updateChaosHazards(scaledDeltaMs: number): void;
  updateFirePatches(scaledDeltaMs: number): void;
  stepAndApplyProjectiles(scaledDeltaSeconds: number): void;

  // Network sync.
  updateNetworkSync(deltaMs: number): void;

  // Rendering (all visual output for one frame).
  renderFrame(deltaMs: number): void;
};

export class MatchOrchestrator {
  private readonly delegate: MatchTickDelegate;

  constructor(delegate: MatchTickDelegate) {
    this.delegate = delegate;
  }

  /**
   * Execute one frame of the offline match. `deltaMs` is the raw wall-clock
   * delta provided by Phaser's update callback.
   *
   * Returns immediately if the delegate reports not ready (i.e. Phaser objects
   * haven't been created yet).
   */
  update(deltaMs: number): void {
    const d = this.delegate;
    if (!d.isReady()) return;

    // Round state runs on raw dt so chaos time-scale doesn't stretch timers.
    d.advanceRoundState(deltaMs);
    d.handleDebugReset();

    const chaosTimeScale = d.getChaosTimeScale();
    const scaledDeltaMs = deltaMs * chaosTimeScale;
    const scaledDeltaSeconds = Math.min(scaledDeltaMs / 1000, 1 / 30);

    d.updateRespawnCountdown(deltaMs);

    if (d.isRespawnPending()) {
      // Frozen state: no movement, no firing, no parry — but the world still
      // advances (projectiles, hazards, network).
      d.freezePlayerForRespawn();
      d.updateTarget(scaledDeltaMs);
      d.updateChaosHazards(scaledDeltaMs);
      d.updateFirePatches(scaledDeltaMs);
      d.stepAndApplyProjectiles(scaledDeltaSeconds);
      d.updateNetworkSync(deltaMs);
      d.renderFrame(deltaMs);
      return;
    }

    // Full player update.
    d.updateShield(scaledDeltaMs);
    d.updateParry(scaledDeltaMs);
    d.readAndApplyMovement(scaledDeltaMs, scaledDeltaSeconds);
    d.checkOutOfBounds();
    d.updateCameraTarget();
    d.updatePickups(scaledDeltaMs);
    d.tryFireWeapon(scaledDeltaMs);
    d.updateTarget(scaledDeltaMs);
    d.updateChaosHazards(scaledDeltaMs);
    d.updateFirePatches(scaledDeltaMs);
    d.stepAndApplyProjectiles(scaledDeltaSeconds);
    d.updateNetworkSync(deltaMs);
    d.renderFrame(deltaMs);
  }
}
