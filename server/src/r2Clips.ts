// Cloudflare R2 storage for rendered highlight clips.
//
// Background: clips currently live only on the local disk of the desktop
// running the game server (server/.clips*), tying availability to that one
// box's uptime with no real backup. This module adds an R2 mirror, reusing
// the SAME Cloudflare account already used for bassradian-api and
// meditationcompass.au (both run R2 buckets there for audio) — R2 has zero
// egress fees on every access path, which is the whole reason it won over
// keeping bytes local or paying S3 egress.
//
// FEATURE-FLAGGED, OFF BY DEFAULT: every exported function here is a no-op
// (or reports "not configured") until all four required env vars are set.
// clipStore.ts is the only caller in the live server; it keeps writing to
// local disk unconditionally regardless of R2 state — this module only
// ADDS a best-effort mirror + redirect-serving on top once configured, and
// never removes the local-disk fallback path.
//
// Required env vars (all four, or the client stays disabled):
//   R2_ACCOUNT_ID        - Cloudflare account id (same account as
//                          bassradian-api / meditationcompass.au)
//   R2_ACCESS_KEY_ID     - R2 API token access key id. Generated via the
//                          Cloudflare dashboard: R2 > Manage API Tokens >
//                          Create API Token (scoped to the clips bucket).
//                          This is NOT the `wrangler login` OAuth token —
//                          that can't sign S3 requests.
//   R2_SECRET_ACCESS_KEY - the paired secret, shown once at token creation.
//   R2_BUCKET            - name of the PUBLIC bucket that fronts the live
//                          share pages (/c/<slug>, /v/<file>, /clips/*).
//
// Optional:
//   R2_PUBLIC_CLIP_DOMAIN - custom domain fronting R2_BUCKET (e.g.
//                          clips.elyad.io), connected via R2 bucket
//                          Settings > Custom Domains. Until this is set,
//                          uploads still mirror to R2 (so migration/backup
//                          can proceed) but serving stays on local disk —
//                          we never redirect a viewer to a bucket that has
//                          no public route yet.
//   R2_ARCHIVE_BUCKET     - COLD/private bucket for footage-study archival
//                          (.clips-highlights, .clips-quarantine). Only
//                          touched by scripts/migrate-clips-to-r2.ts, never
//                          by the live server — no public domain needed,
//                          S3-API/tooling access only.

import { resolve } from "node:path";

/** Minimal surface this module needs from Bun.S3Client — narrowed so tests
 *  can inject a fake without constructing a real client (which would try
 *  to resolve real credentials/network). */
export type ClipsR2Client = {
  write(
    path: string,
    data: string | ArrayBufferView | ArrayBuffer | Blob | Response,
    options?: { type?: string },
  ): Promise<number>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  delete(path: string): Promise<void>;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** All four required R2 write-path vars present. */
export function r2ClipsConfigured(): boolean {
  return Boolean(
    env("R2_ACCOUNT_ID") &&
      env("R2_ACCESS_KEY_ID") &&
      env("R2_SECRET_ACCESS_KEY") &&
      env("R2_BUCKET"),
  );
}

/** Write path configured AND a public domain is connected — only then is
 *  it safe to redirect viewers at R2 instead of local disk. */
export function r2ServingConfigured(): boolean {
  return r2ClipsConfigured() && Boolean(env("R2_PUBLIC_CLIP_DOMAIN"));
}

/** Archive (cold/private) bucket configured — used by the migration script
 *  for .clips-highlights / .clips-quarantine, never by the live server. */
export function r2ArchiveConfigured(): boolean {
  return Boolean(
    env("R2_ACCOUNT_ID") &&
      env("R2_ACCESS_KEY_ID") &&
      env("R2_SECRET_ACCESS_KEY") &&
      env("R2_ARCHIVE_BUCKET"),
  );
}

function r2Endpoint(): string {
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

/** Public URL a browser can hit directly (custom domain, not the S3 API
 *  endpoint). Returns null when no domain is connected yet — callers must
 *  fall back to local serving in that case. */
export function getPublicClipUrl(key: string): string | null {
  const domain = env("R2_PUBLIC_CLIP_DOMAIN");
  if (!domain) return null;
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/${key}`;
}

export function contentTypeForExt(ext: string): string {
  return ext.toLowerCase() === "mp4" ? "video/mp4" : "video/webm";
}

// ── Client construction (test-injectable) ───────────────────────────────

let testClient: ClipsR2Client | null | undefined;
let testArchiveClient: ClipsR2Client | null | undefined;
let liveClient: ClipsR2Client | null = null;
let liveClientKey = "";
let liveArchiveClient: ClipsR2Client | null = null;
let liveArchiveClientKey = "";

/** Cache key so a live client is rebuilt if credentials change mid-process
 *  (e.g. tests toggling env vars) instead of holding a stale instance. */
function credsKey(bucket: string): string {
  return [env("R2_ACCOUNT_ID"), env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY"), bucket].join("|");
}

/** The PUBLIC-bucket client used by clipStore.ts's upload/serve mirror.
 *  Returns null when not configured (feature flag no-op). */
export function getR2Client(): ClipsR2Client | null {
  if (testClient !== undefined) return testClient;
  if (!r2ClipsConfigured()) return null;
  const bucket = env("R2_BUCKET");
  const key = credsKey(bucket);
  if (!liveClient || liveClientKey !== key) {
    // Constructed lazily (only reached once the feature flag is on) so
    // importing this module never touches Bun.S3Client / network in the
    // default (unconfigured) case.
    liveClient = new Bun.S3Client({
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      bucket,
      endpoint: r2Endpoint(),
    }) as unknown as ClipsR2Client;
    liveClientKey = key;
  }
  return liveClient;
}

/** The ARCHIVE-bucket client used only by scripts/migrate-clips-to-r2.ts. */
export function getArchiveR2Client(): ClipsR2Client | null {
  if (testArchiveClient !== undefined) return testArchiveClient;
  if (!r2ArchiveConfigured()) return null;
  const bucket = env("R2_ARCHIVE_BUCKET");
  const key = credsKey(bucket);
  if (!liveArchiveClient || liveArchiveClientKey !== key) {
    liveArchiveClient = new Bun.S3Client({
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      bucket,
      endpoint: r2Endpoint(),
    }) as unknown as ClipsR2Client;
    liveArchiveClientKey = key;
  }
  return liveArchiveClient;
}

export type UploadResult = { ok: true } | { ok: false; error: string };

/**
 * Best-effort mirror of an already-locally-written clip up to R2. Never
 * throws — callers (clipStore.handleClipUpload) must not fail a player's
 * upload just because the R2 mirror hiccuped; local disk stays the
 * authoritative write either way until Jake's separate later cleanup step.
 */
export async function uploadClipToR2(
  key: string,
  data: Blob | ArrayBuffer | ArrayBufferView,
  contentType: string,
): Promise<UploadResult> {
  const client = getR2Client();
  if (!client) return { ok: false, error: "r2 not configured" };
  try {
    await client.write(key, data, { type: contentType });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Local "mirrored to R2" marker sidecars ───────────────────────────────
//
// Lives next to the existing `${id}.dims.json` sidecar pattern
// (clipStore.ts). Presence of `${id}.r2.json` in a clip's directory is
// what flips serveClip() from local-disk serving to a redirect at the R2
// custom domain — written the moment a clip's upload mirror to R2
// succeeds, and (for pre-existing clips) by scripts/migrate-clips-to-r2.ts
// once a file has been copied up and size-verified. Keeping this a plain
// file next to the clip (rather than an in-memory set) means it survives
// server restarts and needs no separate database.

export function r2MarkerFilePath(dir: string, id: string): string {
  return resolve(dir, `${id}.r2.json`);
}

export async function writeR2Marker(
  dir: string,
  id: string,
  info: { bucket: string; key: string },
): Promise<void> {
  await Bun.write(
    r2MarkerFilePath(dir, id),
    JSON.stringify({ ...info, uploadedAt: new Date().toISOString() }),
  );
}

export async function hasR2Marker(dir: string, id: string): Promise<boolean> {
  return Bun.file(r2MarkerFilePath(dir, id)).exists();
}

// ── Test-only injection seams ────────────────────────────────────────────

/** Inject a fake client so tests never construct a real Bun.S3Client
 *  (which would need real credentials / hit the network). Pass null to
 *  simulate "not configured" explicitly, or undefined to clear the
 *  override and fall back to the real env-var-driven path. */
export function __setR2ClientForTest(client: ClipsR2Client | null | undefined): void {
  testClient = client;
}

export function __setArchiveR2ClientForTest(client: ClipsR2Client | null | undefined): void {
  testArchiveClient = client;
}

export function __resetR2ForTests(): void {
  testClient = undefined;
  testArchiveClient = undefined;
  liveClient = null;
  liveClientKey = "";
  liveArchiveClient = null;
  liveArchiveClientKey = "";
}
