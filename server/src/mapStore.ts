// Custom map persistence — Arena Forge's "save & share" backend.
//
// Same idiom as replayStore.ts/clipStore.ts (the only persistence pattern
// this server has: JSON files under a server-local dir, Bun.write, oldest-
// first quota eviction — no DB, no Convex). Maps are tiny (a few KB even
// with dozens of pieces) compared to clips/replays, so the quota here is
// generous and mostly a DoS guard, not a real capacity concern.
//
// This is the first place in `server/` that accepts a full untrusted
// STRUCTURED payload (every other private-lobby "setting" is a bounded
// string/string[] with just length-truncation, see privateLobby.ts) — so
// unlike those, this does real shape/type/range validation before the
// payload is ever handed to validateMap() (which assumes well-formed
// input) or allowed to reach a live match.

import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { validateMap, type MapValidation } from "@sim/data/mapGen.ts";
import type {
  DestructibleDefinition,
  DestructibleKind,
  MapDefinition,
  PickupDefinition,
  PickupKind,
  PlatformDefinition,
  Vec2,
} from "@sim/types.ts";

const MAPS_DIR = resolve(import.meta.dir, "..", ".maps");
/** Generous — a map with the max-allowed 200 platforms + 200 pickups + 200
 *  destructibles is still well under 100KB of JSON. This mostly guards
 *  against a hand-crafted oversized payload, not real content. */
const MAX_MAP_BYTES = 256 * 1024;
/** Maps are tiny; this is a big margin, not a real capacity limit. */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ARENA_THEME_KEYS = new Set([
  "voidVessel",
  "crystalDock",
  "autogenesHull",
  "jadeIsles",
  "ivoryClouds",
  "hangingWood",
]);
const DESTRUCTIBLE_KINDS = new Set(["barrel", "box", "mine", "cube"]);
const PICKUP_KINDS = new Set([
  "health-shard",
  "shield-cell",
  "overcharge-core",
  "damage-amp",
  "speed-boost",
  "melee-mode",
  "slow-trap",
  "vulnerability-trap",
  "block-jammer",
  "boss-core",
  "card-cache",
]);
const PLATFORM_KINDS = new Set(["floor", "wall", "platform"]);
const MAX_PLATFORMS = 200;
const MAX_PICKUPS = 200;
const MAX_DESTRUCTIBLES = 200;
const MAX_SPAWNS = 64;
const MIN_SPAWNS = 2;
/** Absolute sanity bound on any coordinate/size — not a gameplay balance
 *  rule (that's validateMap's job), just a guard against pathological
 *  values (Infinity-adjacent numbers) reaching the reachability BFS. */
const MAX_COORD = 100_000;

let dirReady = false;
function ensureDir(): void {
  if (dirReady) return;
  mkdirSync(MAPS_DIR, { recursive: true });
  dirReady = true;
}

function mintCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return code;
}

/** Trust boundary for a code arriving from a URL/request — must match the
 *  exact shape mintCode() produces before it's ever used to build a path. */
export function isValidMapCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{6}$/.test(value);
}

function enforceQuota(): void {
  ensureDir();
  const entries = readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = resolve(MAPS_DIR, f);
      const st = statSync(p);
      return { p, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  let total = entries.reduce((s, e) => s + e.size, 0);
  for (const e of entries) {
    if (total <= MAX_TOTAL_BYTES) break;
    try {
      unlinkSync(e.p);
      total -= e.size;
    } catch {
      break;
    }
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
}

function isVec2(v: unknown): v is Vec2 {
  return !!v && typeof v === "object" && isFiniteNumber((v as Vec2).x) && isFiniteNumber((v as Vec2).y);
}

function validatePlatform(v: unknown): PlatformDefinition | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id) return null;
  if (!isVec2(p.position) || !isVec2(p.size)) return null;
  if (typeof p.kind !== "string" || !PLATFORM_KINDS.has(p.kind)) return null;
  if (p.size.x <= 0 || p.size.y <= 0) return null;
  return { id: p.id.slice(0, 64), position: p.position, size: p.size, kind: p.kind as PlatformDefinition["kind"] };
}

function validatePickup(v: unknown): PickupDefinition | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id) return null;
  if (typeof p.kind !== "string" || !PICKUP_KINDS.has(p.kind)) return null;
  if (!isVec2(p.position) || !isFiniteNumber(p.radius) || p.radius <= 0) return null;
  if (!isFiniteNumber(p.amount) || !isFiniteNumber(p.respawnMs) || p.respawnMs < 0) return null;
  const durationMs = isFiniteNumber(p.durationMs) ? p.durationMs : undefined;
  return {
    id: p.id.slice(0, 64),
    kind: p.kind as PickupKind,
    position: p.position,
    radius: p.radius,
    amount: p.amount,
    respawnMs: p.respawnMs,
    durationMs,
  };
}

function validateDestructible(v: unknown): DestructibleDefinition | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== "string" || !d.id) return null;
  if (typeof d.kind !== "string" || !DESTRUCTIBLE_KINDS.has(d.kind)) return null;
  if (!isFiniteNumber(d.health) || d.health <= 0) return null;
  if (!isVec2(d.position) || !isVec2(d.size) || d.size.x <= 0 || d.size.y <= 0) return null;
  if (typeof d.explosive !== "boolean" || typeof d.flammable !== "boolean") return null;
  return {
    id: d.id.slice(0, 64),
    kind: d.kind as DestructibleKind,
    health: d.health,
    position: d.position,
    size: d.size,
    explosive: d.explosive,
    flammable: d.flammable,
  };
}

export type ShapeValidationResult =
  | { ok: true; map: MapDefinition }
  | { ok: false; error: string };

/** Defensive shape/type/range check — the FIRST gate, before validateMap()
 *  (which assumes well-formed input) ever sees this payload. Rejects
 *  anything with the wrong types, missing fields, or absurd/oversized
 *  arrays; does not judge playability (that's the second gate). */
export function validateMapShape(input: unknown): ShapeValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "not an object" };
  const m = input as Record<string, unknown>;
  if (typeof m.name !== "string" || m.name.trim().length === 0) {
    return { ok: false, error: "missing name" };
  }
  if (!isVec2(m.size) || m.size.x <= 0 || m.size.y <= 0) return { ok: false, error: "invalid size" };
  if (!Array.isArray(m.spawns) || m.spawns.length < MIN_SPAWNS || m.spawns.length > MAX_SPAWNS) {
    return { ok: false, error: `spawns must be an array of ${MIN_SPAWNS}-${MAX_SPAWNS}` };
  }
  if (!m.spawns.every(isVec2)) return { ok: false, error: "invalid spawn point" };

  if (!Array.isArray(m.platforms) || m.platforms.length === 0 || m.platforms.length > MAX_PLATFORMS) {
    return { ok: false, error: `platforms must be an array of 1-${MAX_PLATFORMS}` };
  }
  const platforms: PlatformDefinition[] = [];
  for (const p of m.platforms) {
    const parsed = validatePlatform(p);
    if (!parsed) return { ok: false, error: "invalid platform" };
    platforms.push(parsed);
  }

  const rawPickups = Array.isArray(m.pickups) ? m.pickups : [];
  if (rawPickups.length > MAX_PICKUPS) return { ok: false, error: `too many pickups (max ${MAX_PICKUPS})` };
  const pickups: PickupDefinition[] = [];
  for (const p of rawPickups) {
    const parsed = validatePickup(p);
    if (!parsed) return { ok: false, error: "invalid pickup" };
    pickups.push(parsed);
  }

  const rawDestructibles = Array.isArray(m.destructibles) ? m.destructibles : [];
  if (rawDestructibles.length > MAX_DESTRUCTIBLES) {
    return { ok: false, error: `too many destructibles (max ${MAX_DESTRUCTIBLES})` };
  }
  const destructibles: DestructibleDefinition[] = [];
  for (const d of rawDestructibles) {
    const parsed = validateDestructible(d);
    if (!parsed) return { ok: false, error: "invalid destructible" };
    destructibles.push(parsed);
  }

  const arenaTheme =
    typeof m.arenaTheme === "string" && ARENA_THEME_KEYS.has(m.arenaTheme)
      ? (m.arenaTheme as MapDefinition["arenaTheme"])
      : undefined;

  return {
    ok: true,
    map: {
      id: "custom", // overwritten with the real code on save
      name: m.name.slice(0, 64),
      size: m.size,
      spawns: m.spawns as Vec2[],
      platforms,
      pickups,
      destructibles,
      arenaTheme,
    },
  };
}

export type SaveMapOutcome =
  | { ok: true; code: string }
  | { ok: false; error: string; violations?: MapValidation };

/** Full save pipeline: shape validation, then playability validation
 *  (validateMap — reachability/routes-up/sightline/density/spawns), then
 *  disk write. Rejects on either gate failing — a map that can't be
 *  validated shouldn't be shareable (no "save as broken draft" in v1). */
export function saveCustomMap(input: unknown): SaveMapOutcome {
  const shape = validateMapShape(input);
  if (!shape.ok) return { ok: false, error: shape.error };

  const playability = validateMap(shape.map);
  if (!playability.ok) {
    return { ok: false, error: "map is not playable yet", violations: playability };
  }

  ensureDir();
  const code = mintCode();
  const map: MapDefinition = { ...shape.map, id: code };
  const json = JSON.stringify(map);
  if (json.length > MAX_MAP_BYTES) {
    return { ok: false, error: "map payload too large" };
  }
  const path = resolve(MAPS_DIR, `${code}.json`);
  Bun.write(path, json);
  enforceQuota();
  return { ok: true, code };
}

/** Reads a previously-saved map back by its code. Returns null if missing/
 *  invalid — callers (server-side match construction, GET /maps/:code)
 *  treat this the same as "unknown map" (existing graceful fallback). */
export async function loadCustomMap(code: string): Promise<MapDefinition | null> {
  if (!isValidMapCode(code)) return null;
  try {
    ensureDir();
    const path = resolve(MAPS_DIR, `${code}.json`);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const parsed = (await file.json()) as unknown;
    const shape = validateMapShape(parsed);
    return shape.ok ? { ...shape.map, id: code } : null;
  } catch {
    return null;
  }
}
