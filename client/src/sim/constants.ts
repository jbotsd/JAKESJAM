export const STEP_MS = 1000 / 60;
// Snapshot every sim tick — 60Hz authoritative state to clients. Doubles the
// upstream bandwidth from 30Hz but cuts the worst-case prediction-correction
// window in half, which is what "feels snappy" in practice. At jam scale
// (1v1 → 10 players, ~600 byte snapshots) this is well under residential
// upload limits. Drop back to 2 (= 30Hz) if delta encoding lands and we
// want to spend the bandwidth on bigger frames instead.
export const SNAPSHOT_HZ = 60;
export const SNAPSHOT_INTERVAL_TICKS = 1;
