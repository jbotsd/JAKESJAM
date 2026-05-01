// Weapon data lives in client/src/sim/data/weapons.ts so the authoritative
// server and the prediction client share one definition. Re-exported here to
// keep existing client imports stable.
export { starterWeapon, weapons } from "../../sim/data/weapons";
