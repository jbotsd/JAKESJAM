// Public entrypoint for the shared sim/ package.
// Imported by client/src/net/ and server/src/.

export * from './types.js';
export { World } from './World.js';

export const STEP_MS = 1000 / 60; // 16.6667 ms — fixed simulation timestep
export const SNAPSHOT_HZ = 30;
export const SNAPSHOT_INTERVAL_TICKS = 2; // every 2nd 60Hz tick = 30Hz snapshots
