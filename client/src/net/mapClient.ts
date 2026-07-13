// Arena Forge save/share client — talks to the bun server's /maps endpoints
// (server/src/mapStore.ts). Same httpBase() convention as PrivateRoomClient.
//
// This file lives under client/src/net/ (mirrors worldClient.ts), which the
// SERVER's tsconfig broadly type-checks too (`include` sweeps that whole
// directory so @net/* aliases resolve) — no DOM lib there, so `window` must
// go through globalThis the same defensive way worldClient.ts's own
// browserLocation() does, not as a bare global.

import { readGameServerUrlOverride } from "./worldClient.js";
import { isCustomMapId, setCustomMap } from "../sim/data/maps.js";
import type { MapDefinition } from "../sim/types.js";

function originFallback(): string {
  return (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
}

function httpBase(): string {
  const override =
    readGameServerUrlOverride() ??
    (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ??
    null;
  if (override) {
    return override.replace(/^ws/i, "http").replace(/\/$/, "");
  }
  // Same origin when served from bun statics (SERVE_CLIENT_DIR).
  return originFallback();
}

export type SaveCustomMapResult =
  | { ok: true; code: string }
  | { ok: false; error: string; violations?: unknown };

/** Saves a Forge-authored map. The server re-validates shape AND
 *  playability (validateMap) — never trust the client-side check alone,
 *  it's purely instant feedback while building. */
export async function saveCustomMap(map: MapDefinition): Promise<SaveCustomMapResult> {
  try {
    const res = await fetch(`${httpBase()}/maps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(map),
    });
    const json = (await res.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      violations?: unknown;
    };
    if (!res.ok || !json.code) {
      return { ok: false, error: json.error ?? `save failed (${res.status})`, violations: json.violations };
    }
    return { ok: true, code: json.code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetches a previously-saved custom map by its 6-char code. Returns null
 *  on any failure (missing/expired/network) — callers treat this the same
 *  as any other "unknown map" fallback. */
export async function fetchCustomMap(code: string): Promise<MapDefinition | null> {
  try {
    const res = await fetch(`${httpBase()}/maps/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return (await res.json()) as MapDefinition;
  } catch {
    return null;
  }
}

/**
 * Must be awaited to completion BEFORE a `custom:<code>` mapId is ever
 * handed to `resolveMap()` (which stays synchronous for clientLoop.ts's
 * hot path — see maps.ts). Call this once, early, from the connection-
 * setup flow (already async: OnlineMatchScene's pre-connect step, a
 * private-room join) whenever the target mapId might be a custom one.
 * No-op for anything that isn't a "custom:" id.
 */
export async function prefetchCustomMap(mapId: string): Promise<void> {
  if (!isCustomMapId(mapId)) return;
  const code = mapId.slice("custom:".length);
  const map = await fetchCustomMap(code);
  if (map) setCustomMap(code, map);
}
