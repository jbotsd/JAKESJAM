export const STEP_MS = 1000 / 60;

/**
 * Smallest platform height (px) we can author. Sub-stepping in stepPlayer
 * uses 0.6× this as the per-sub-step max displacement so the swept sweep
 * never has to span a thin platform in a single integration. 12 px is
 * generous — boxworks-mini's thinnest platform is 18 px.
 */
export const MIN_PLATFORM_H_PX = 12;
// Snapshot every sim tick — 60Hz authoritative state to clients. Doubles the
// upstream bandwidth from 30Hz but cuts the worst-case prediction-correction
// window in half, which is what "feels snappy" in practice. At jam scale
// (1v1 → 10 players, ~600 byte snapshots) this is well under residential
// upload limits. Drop back to 2 (= 30Hz) if delta encoding lands and we
// want to spend the bandwidth on bigger frames instead.
export const SNAPSHOT_HZ = 60;
export const SNAPSHOT_INTERVAL_TICKS = 1;
