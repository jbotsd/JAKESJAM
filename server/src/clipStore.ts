// Highlight-clip storage. Accepts an uploaded clip (client/src/game/highlights/
// ClipRecorder.ts), writes it to a server-local directory served statically,
// and returns the URL a future TikTok Content Posting API PULL_FROM_URL call
// would use. Posting to TikTok itself is a separate, credential-gated module —
// this file only owns "get the file onto a URL we can hand someone."

import { copyFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseFocusTrace, transcodeVertical } from "./clipTranscode.ts";

const CLIPS_DIR = resolve(process.cwd(), ".clips");
/** Durable keepers — never auto-evicted. Mirrors pins from clip-pins.json. */
const KEPT_DIR = resolve(process.cwd(), ".clips/kept");
/** Pin list lives next to server package (committed). */
const PINS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../clip-pins.json");
/** Generous but bounded — a ~20s 720p webm clip is a few MB; this guards
 *  against a misbehaving client looping uploads. */
const MAX_CLIP_BYTES = 40 * 1024 * 1024;
/** Hard ceiling on total disk used by clips, regardless of upload volume.
 *  `/clips/upload` has no auth (any world visitor's browser calls it), so
 *  the per-file cap alone doesn't bound a scripted flood — this does, via
 *  oldest-first eviction before every write. */
const MAX_TOTAL_CLIPS_BYTES = 500 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["webm", "mp4"]);

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  dirReady ??= Promise.all([
    mkdir(CLIPS_DIR, { recursive: true }),
    mkdir(KEPT_DIR, { recursive: true }),
  ]).then(() => undefined);
  return dirReady;
}

/** Filenames (id.ext) that must never be deleted by quota eviction. */
let pinnedNames: Set<string> | null = null;

export type ClipPinRecord = {
  id: string;
  ext: string;
  note?: string;
  pinnedAt?: string;
};

type PinsFile = { pins: ClipPinRecord[] };

async function readPinsFile(): Promise<PinsFile> {
  try {
    const raw = await readFile(PINS_PATH, "utf8");
    const data = JSON.parse(raw) as { pins?: ClipPinRecord[] };
    return { pins: Array.isArray(data.pins) ? data.pins : [] };
  } catch {
    return { pins: [] };
  }
}

async function writePinsFile(data: PinsFile): Promise<void> {
  await Bun.write(PINS_PATH, `${JSON.stringify(data, null, 2)}\n`);
  // Bust cache so loadPinnedNames re-reads.
  pinnedNames = null;
}

async function loadPinnedNames(): Promise<Set<string>> {
  if (pinnedNames) return pinnedNames;
  const out = new Set<string>();
  const data = await readPinsFile();
  for (const p of data.pins) {
    if (p.id && p.ext && ALLOWED_EXTENSIONS.has(p.ext)) {
      out.add(`${p.id}.${p.ext}`);
    }
  }
  pinnedNames = out;
  return out;
}

function isPinnedFilename(name: string): boolean {
  return pinnedNames?.has(name) ?? false;
}

function parseClipFilename(filename: string): { id: string; ext: string } | null {
  if (!/^[a-f0-9-]+\.(webm|mp4)$/i.test(filename)) return null;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const id = filename.slice(0, dot).toLowerCase();
  const ext = filename.slice(dot + 1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return { id, ext };
}

/**
 * Ensure a pinned clip exists under both `.clips/` and `.clips/kept/`.
 * Call after pins load so a kept copy survives if the live file was lost.
 */
export async function ensurePinnedClipsOnDisk(): Promise<void> {
  await ensureDir();
  const pins = await loadPinnedNames();
  for (const name of pins) {
    const live = resolve(CLIPS_DIR, name);
    const kept = resolve(KEPT_DIR, name);
    const liveExists = await Bun.file(live).exists();
    const keptExists = await Bun.file(kept).exists();
    if (liveExists && !keptExists) {
      try {
        await copyFile(live, kept);
      } catch {
        /* best effort */
      }
    } else if (!liveExists && keptExists) {
      try {
        await copyFile(kept, live);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Evicts oldest clips first until `incomingBytes` will fit under the total
 *  quota. Best-effort: a listing/stat/unlink race just means we evict one
 *  extra file or slightly overshoot for one write, never a hard failure.
 *  Pinned clips (server/clip-pins.json) are never deleted. */
async function enforceQuota(incomingBytes: number): Promise<void> {
  const pins = await loadPinnedNames();
  let names: string[];
  try {
    names = await readdir(CLIPS_DIR);
  } catch {
    return;
  }
  const files = (
    await Promise.all(
      names.map(async (name) => {
        if (name === "kept") return null; // subdirectory
        if (pins.has(name)) return null; // never evict
        try {
          const s = await stat(resolve(CLIPS_DIR, name));
          if (!s.isFile()) return null;
          return { name, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    )
  ).filter((f): f is { name: string; size: number; mtimeMs: number } => f !== null);

  // Quota still counts pinned size so we don't fill the disk forever.
  let total = 0;
  for (const name of names) {
    if (name === "kept") continue;
    try {
      total += (await stat(resolve(CLIPS_DIR, name))).size;
    } catch {
      /* skip */
    }
  }
  total += incomingBytes;
  if (total <= MAX_TOTAL_CLIPS_BYTES) return;

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const f of files) {
    if (total <= MAX_TOTAL_CLIPS_BYTES) break;
    if (isPinnedFilename(f.name)) continue;
    try {
      await unlink(resolve(CLIPS_DIR, f.name));
      total -= f.size;
    } catch {
      // Already gone — fine.
    }
  }
}

export type ClipUploadResult =
  | {
      ok: true;
      url: string;
      mediaUrl: string;
      /** Present when the upload carried a focus trace and the server-side
       *  NVENC vertical transcode succeeded (clipTranscode.ts). */
      verticalUrl?: string;
      verticalMediaUrl?: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Public origin for shareable clip links.
 *
 * Prefer brand domain (PUBLIC_URL / elyad.io) over whatever Host the upload
 * request used — Tailscale funnel (randel.*.ts.net) and raw IPs must not leak
 * into Copy / share toasts when play.elyad.io is the product face.
 */
export function publicClipOrigin(req: Request, fallbackUrl: URL): string {
  const envPublic = (process.env.PUBLIC_URL ?? process.env.CLIP_PUBLIC_ORIGIN ?? "")
    .trim()
    .replace(/\/$/, "");
  if (envPublic.startsWith("http://") || envPublic.startsWith("https://")) {
    try {
      const u = new URL(envPublic);
      return u.origin;
    } catch {
      /* fall through */
    }
  }

  // Prefer Forwarded host when the edge (cloudflared) rewrites Host.
  const xfHost = (req.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim();
  const host = (xfHost || req.headers.get("host") || fallbackUrl.host).toLowerCase();
  const protoHeader = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const proto =
    protoHeader === "http" || protoHeader === "https"
      ? protoHeader
      : fallbackUrl.protocol.replace(":", "") || "https";

  // Brand hosts always win over ts.net / localhost when present on the request.
  if (host.endsWith("elyad.io") || host === "play.elyad.io" || host === "jakesjam.elyad.io") {
    return `https://${host.split(":")[0]}`;
  }

  // Local / non-brand: keep request origin so dev still works without PUBLIC_URL.
  if (host.includes("localhost") || host.startsWith("127.") || host.includes("ts.net")) {
    // If we only have a ts.net host and no PUBLIC_URL, still default share
    // links to the product domain so Copy never hands out a Tailscale URL.
    if (host.includes("ts.net")) {
      return "https://play.elyad.io";
    }
    return `${proto}://${host}`;
  }

  return `${proto}://${host}`;
}

/**
 * Handle a multipart POST containing a `file` field. `originStr` is the
 * public origin for share URLs (see publicClipOrigin) — not necessarily the
 * raw request Host (which may be a Tailscale funnel hostname).
 */
export async function handleClipUpload(
  req: Request,
  originStr: string,
): Promise<ClipUploadResult> {
  let form: Awaited<ReturnType<typeof req.formData>>;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, status: 400, message: "expected multipart/form-data" };
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, status: 400, message: "missing file field" };
  }
  if (file.size > MAX_CLIP_BYTES) {
    return { ok: false, status: 413, message: "clip too large" };
  }
  const nameField = file instanceof File ? file.name : "";
  const extFromName = nameField.split(".").pop()?.toLowerCase() ?? "";
  const ext = ALLOWED_EXTENSIONS.has(extFromName) ? extFromName : "webm";

  await ensureDir();
  await enforceQuota(file.size);
  // Server generates the filename — never trust client-supplied paths.
  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const full = resolve(CLIPS_DIR, filename);
  await Bun.write(full, file);

  // GPU vertical: when the upload carries a crop-focus trace, produce the
  // 720x1280 deliverable here with NVENC (clipTranscode.ts). The browser
  // no longer records a second vertical stream — Linux Chromium can only
  // software-encode, and the dual realtime encode stalled the game.
  let verticalUrl: string | undefined;
  let verticalMediaUrl: string | undefined;
  const traceRaw = form.get("focusTrace");
  const srcW = Number(form.get("srcW") ?? 0);
  const srcH = Number(form.get("srcH") ?? 0);
  if (typeof traceRaw === "string" && srcW > 15 && srcH > 15) {
    const trace = parseFocusTrace(traceRaw);
    if (trace) {
      const vid = randomUUID();
      const vFilename = `${vid}.mp4`;
      const okV = await transcodeVertical({
        srcPath: full,
        dstPath: resolve(CLIPS_DIR, vFilename),
        trace,
        srcW,
        srcH,
      });
      if (okV) {
        await enforceQuota(0); // vertical landed after the quota check — re-settle
        verticalUrl = `${originStr}/c/${vid}`;
        verticalMediaUrl = `${originStr}/v/${vFilename}`;
      }
    }
  }

  // Share page without .mp4 suffix (Facebook treats *.mp4 share URLs as bare
  // video and skips the HTML card / og:video pipeline). Media is always raw.
  return {
    ok: true,
    url: `${originStr}/c/${id}`,
    mediaUrl: `${originStr}/v/${filename}`,
    verticalUrl,
    verticalMediaUrl,
  };
}

/**
 * Serve a previously-uploaded clip by filename. Filenames are always
 * server-generated UUIDs (see handleClipUpload), so this only needs to guard
 * against path traversal / non-matching extensions, not authenticate.
 */
export async function serveClip(filename: string): Promise<Response | null> {
  if (!/^[a-f0-9-]+\.(webm|mp4)$/i.test(filename)) return null;
  await loadPinnedNames();
  // Prefer live dir, then kept/ backup for pinned highlight reels.
  const candidates = [resolve(CLIPS_DIR, filename), resolve(KEPT_DIR, filename)];
  for (const full of candidates) {
    if (!full.startsWith(CLIPS_DIR + "/")) continue; // defense in depth
    const file = Bun.file(full);
    if (!(await file.exists())) continue;
    const isMp4 = filename.toLowerCase().endsWith(".mp4");
    return new Response(file, {
      headers: {
        "content-type": isMp4 ? "video/mp4" : "video/webm",
        // Social crawlers (FB/Discord) need: correct MIME, ranges, inline play.
        "content-disposition": `inline; filename="${filename}"`,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-length,content-range,accept-ranges",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return null;
}

// ── Ops surface: list / pin / unpin ──────────────────────────────────────────

export type ClipListEntry = {
  filename: string;
  id: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  pinned: boolean;
  kept: boolean;
  /** Public path (caller prefixes origin). */
  path: string;
  note?: string;
};

export type ClipDiskStats = {
  totalBytes: number;
  maxBytes: number;
  fileCount: number;
  pinnedCount: number;
  keptCount: number;
};

/** List clips on disk + pin metadata for the ops console. */
export async function listClips(): Promise<{ clips: ClipListEntry[]; stats: ClipDiskStats }> {
  await ensureDir();
  const pins = await loadPinnedNames();
  const pinMeta = await readPinsFile();
  const noteByName = new Map<string, string | undefined>(
    pinMeta.pins.map((p) => [`${p.id}.${p.ext}`, p.note]),
  );

  let names: string[] = [];
  try {
    names = await readdir(CLIPS_DIR);
  } catch {
    names = [];
  }

  let keptNames: string[] = [];
  try {
    keptNames = await readdir(KEPT_DIR);
  } catch {
    keptNames = [];
  }
  const keptSet = new Set(keptNames.filter((n) => parseClipFilename(n)));

  const clips: ClipListEntry[] = [];
  let totalBytes = 0;
  const seen = new Set<string>();

  for (const name of names) {
    if (name === "kept") continue;
    const parsed = parseClipFilename(name);
    if (!parsed) continue;
    seen.add(name);
    try {
      const s = await stat(resolve(CLIPS_DIR, name));
      if (!s.isFile()) continue;
      totalBytes += s.size;
      clips.push({
        filename: name,
        id: parsed.id,
        ext: parsed.ext,
        sizeBytes: s.size,
        mtimeMs: s.mtimeMs,
        pinned: pins.has(name),
        kept: keptSet.has(name),
        path: `/c/${parsed.id}`,
        note: noteByName.get(name),
      });
    } catch {
      /* skip */
    }
  }

  // Pinned/kept-only files that vanished from live dir still matter.
  for (const name of keptSet) {
    if (seen.has(name)) continue;
    const parsed = parseClipFilename(name);
    if (!parsed) continue;
    try {
      const s = await stat(resolve(KEPT_DIR, name));
      if (!s.isFile()) continue;
      totalBytes += s.size;
      clips.push({
        filename: name,
        id: parsed.id,
        ext: parsed.ext,
        sizeBytes: s.size,
        mtimeMs: s.mtimeMs,
        pinned: pins.has(name),
        kept: true,
        path: `/c/${parsed.id}`,
        note: noteByName.get(name),
      });
    } catch {
      /* skip */
    }
  }

  clips.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return {
    clips,
    stats: {
      totalBytes,
      maxBytes: MAX_TOTAL_CLIPS_BYTES,
      fileCount: clips.length,
      pinnedCount: pins.size,
      keptCount: keptSet.size,
    },
  };
}

export async function listPinRecords(): Promise<ClipPinRecord[]> {
  const data = await readPinsFile();
  return data.pins;
}

/**
 * Pin a clip forever (never auto-evicted). Copies into `.clips/kept/`.
 * `filename` is `uuid.ext` as returned by upload / list.
 */
export async function pinClip(
  filename: string,
  note?: string,
): Promise<{ ok: true; pin: ClipPinRecord } | { ok: false; message: string }> {
  const parsed = parseClipFilename(filename);
  if (!parsed) return { ok: false, message: "invalid clip filename" };

  await ensureDir();
  const live = resolve(CLIPS_DIR, filename);
  const kept = resolve(KEPT_DIR, filename);
  const liveExists = await Bun.file(live).exists();
  const keptExists = await Bun.file(kept).exists();
  if (!liveExists && !keptExists) {
    return { ok: false, message: "clip file not found on disk" };
  }

  const data = await readPinsFile();
  const existing = data.pins.find((p) => p.id === parsed.id && p.ext === parsed.ext);
  const pin: ClipPinRecord = {
    id: parsed.id,
    ext: parsed.ext,
    note: note?.trim() || existing?.note || "Pinned from ops console",
    pinnedAt: existing?.pinnedAt ?? new Date().toISOString().slice(0, 10),
  };
  if (existing) {
    Object.assign(existing, pin);
  } else {
    data.pins.push(pin);
  }
  await writePinsFile(data);

  // Mirror into kept/
  try {
    if (liveExists && !keptExists) await copyFile(live, kept);
    else if (!liveExists && keptExists) await copyFile(kept, live);
  } catch {
    /* best effort */
  }

  await loadPinnedNames();
  return { ok: true, pin };
}

/** Remove pin (file stays on disk until quota eviction). */
export async function unpinClip(
  filename: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = parseClipFilename(filename);
  if (!parsed) return { ok: false, message: "invalid clip filename" };

  const data = await readPinsFile();
  const before = data.pins.length;
  data.pins = data.pins.filter((p) => !(p.id === parsed.id && p.ext === parsed.ext));
  if (data.pins.length === before) {
    return { ok: false, message: "not pinned" };
  }
  await writePinsFile(data);
  await loadPinnedNames();
  return { ok: true };
}
