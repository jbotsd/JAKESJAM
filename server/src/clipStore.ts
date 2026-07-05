// Highlight-clip storage. Accepts an uploaded clip (client/src/game/highlights/
// ClipRecorder.ts), writes it to a server-local directory served statically,
// and returns the URL a future TikTok Content Posting API PULL_FROM_URL call
// would use. Posting to TikTok itself is a separate, credential-gated module —
// this file only owns "get the file onto a URL we can hand someone."

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const CLIPS_DIR = resolve(process.cwd(), ".clips");
/** Generous but bounded — a ~20s 720p webm clip is a few MB; this guards
 *  against a misbehaving client looping uploads. */
const MAX_CLIP_BYTES = 40 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["webm", "mp4"]);

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  dirReady ??= mkdir(CLIPS_DIR, { recursive: true }).then(() => undefined);
  return dirReady;
}

export type ClipUploadResult =
  | { ok: true; url: string }
  | { ok: false; status: number; message: string };

/**
 * Handle a multipart POST containing a `file` field. `originStr` is the
 * request's own origin (matches the OG-image __ORIGIN__ pattern already used
 * for share cards) so the returned URL is absolute and correct behind
 * whichever tunnel/domain the request actually arrived on.
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
  // Server generates the filename — never trust client-supplied paths.
  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const full = resolve(CLIPS_DIR, filename);
  await Bun.write(full, file);

  return { ok: true, url: `${originStr}/clips/${filename}` };
}

/**
 * Serve a previously-uploaded clip by filename. Filenames are always
 * server-generated UUIDs (see handleClipUpload), so this only needs to guard
 * against path traversal / non-matching extensions, not authenticate.
 */
export async function serveClip(filename: string): Promise<Response | null> {
  if (!/^[a-f0-9-]+\.(webm|mp4)$/i.test(filename)) return null;
  const full = resolve(CLIPS_DIR, filename);
  if (!full.startsWith(CLIPS_DIR + "/")) return null; // defense in depth
  const file = Bun.file(full);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      "content-type": filename.endsWith(".mp4") ? "video/mp4" : "video/webm",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
