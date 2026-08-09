// gospel N2.7 — the native asset pack.
//
// "Deterministic packer (a Bun script is fine — it's a build tool, not the
// artifact): fonts + SFX + music manifest → one pack file with content
// hashes. No network fetch at runtime; offline means offline."
//
// Format, chosen so the Zig reader is ~50 lines and needs no allocator
// for the index:
//
//   magic   "JJPK"                       4 bytes
//   version u32 le                       4
//   count   u32 le                       4
//   ── index, `count` entries, fixed 96 bytes each ──
//     name    [64]u8  NUL-padded utf8
//     kind    u32 le  (0 font, 1 sfx, 2 music)
//     offset  u32 le  from start of file
//     size    u32 le
//     hash    u32 le  FNV-1a of the bytes
//     _pad    [16]u8  zero — room to grow without a version bump
//   ── payload, entries in index order, 8-byte aligned ──
//
// DETERMINISM is the requirement that shapes everything here: entries are
// sorted by name, padding is zeroed rather than left as whatever the
// buffer held, and no timestamps or paths from the build machine cross
// into the file. Two runs on two machines from the same inputs must
// produce byte-identical packs, or the pack cannot be content-addressed
// and "did the assets change?" becomes unanswerable.
//
//   bun run pack:assets            # writes sim/assets.jjpk
//   bun run pack:assets --verify   # rebuild in memory, compare, no write

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, basename, extname } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const OUT = resolve(ROOT, "sim/assets.jjpk");

const MAGIC = "JJPK";
const VERSION = 1;
const ENTRY_BYTES = 96;
const NAME_BYTES = 64;

type Kind = 0 | 1 | 2;
const KIND_FONT: Kind = 0;
const KIND_SFX: Kind = 1;
const KIND_MUSIC: Kind = 2;

type Source = { name: string; kind: Kind; path: string };

/** FNV-1a, 32-bit. Same function the Zig reader will use to verify. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function collect(): Source[] {
  const out: Source[] = [];

  // SFX — the canonical meme recordings. NEVER synthesized (standing
  // rule), so the packer only ever collects files that already exist and
  // says so loudly when the directory is empty rather than inventing
  // placeholders.
  const sfxDir = resolve(ROOT, "assets/sfx-memes");
  if (existsSync(sfxDir)) {
    for (const f of readdirSync(sfxDir)) {
      if (![".wav", ".ogg", ".mp3"].includes(extname(f).toLowerCase())) continue;
      out.push({ name: `sfx/${basename(f)}`, kind: KIND_SFX, path: resolve(sfxDir, f) });
    }
  }

  // Fonts. The repo ships .woff2, which raylib cannot load (N1.1 finding)
  // — those are deliberately NOT packed, because a pack full of files the
  // shell cannot open is worse than an empty one: it looks solved.
  const fontDir = resolve(ROOT, "client/public/fonts");
  if (existsSync(fontDir)) {
    for (const f of readdirSync(fontDir)) {
      const ext = extname(f).toLowerCase();
      if (ext !== ".ttf" && ext !== ".otf") continue;
      out.push({ name: `font/${basename(f)}`, kind: KIND_FONT, path: resolve(fontDir, f) });
    }
  }

  const musicDir = resolve(ROOT, "standalone/audio");
  if (existsSync(musicDir)) {
    for (const f of readdirSync(musicDir)) {
      if (![".wav", ".ogg", ".mp3"].includes(extname(f).toLowerCase())) continue;
      out.push({ name: `music/${basename(f)}`, kind: KIND_MUSIC, path: resolve(musicDir, f) });
    }
  }

  // Sorted by name: readdir order is filesystem-dependent, and a pack
  // whose byte layout depends on the machine that built it is not
  // deterministic no matter what else is careful.
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

function build(sources: Source[]): Uint8Array {
  const blobs = sources.map((s) => new Uint8Array(readFileSync(s.path)));

  const headerBytes = 12;
  const indexBytes = sources.length * ENTRY_BYTES;
  let payload = headerBytes + indexBytes;
  const offsets: number[] = [];
  for (const b of blobs) {
    // 8-byte align so a Zig reader can hand slices straight to raylib
    // without a copy for alignment's sake.
    payload = (payload + 7) & ~7;
    offsets.push(payload);
    payload += b.length;
  }

  const buf = new Uint8Array(payload);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode(MAGIC), 0);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, sources.length, true);

  sources.forEach((s, i) => {
    const at = headerBytes + i * ENTRY_BYTES;
    const nameBytes = new TextEncoder().encode(s.name);
    if (nameBytes.length > NAME_BYTES) {
      throw new Error(`asset name too long (${nameBytes.length} > ${NAME_BYTES}): ${s.name}`);
    }
    buf.set(nameBytes, at); // rest of the field is already zero
    dv.setUint32(at + NAME_BYTES, s.kind, true);
    dv.setUint32(at + NAME_BYTES + 4, offsets[i]!, true);
    dv.setUint32(at + NAME_BYTES + 8, blobs[i]!.length, true);
    dv.setUint32(at + NAME_BYTES + 12, fnv1a(blobs[i]!), true);
    // +16 pad stays zero.
    buf.set(blobs[i]!, offsets[i]!);
  });

  return buf;
}

const verify = process.argv.includes("--verify");
const sources = collect();
if (sources.length === 0) {
  console.error("[pack:assets] no assets found — refusing to write an empty pack");
  process.exit(1);
}

const packed = build(sources);

if (verify) {
  if (!existsSync(OUT)) {
    console.error(`[pack:assets] --verify but ${OUT} does not exist`);
    process.exit(1);
  }
  const onDisk = new Uint8Array(readFileSync(OUT));
  const same =
    onDisk.length === packed.length && onDisk.every((b, i) => b === packed[i]);
  console.log(
    same
      ? `[pack:assets] VERIFY OK — ${sources.length} assets, ${packed.length} bytes, byte-identical`
      : `[pack:assets] VERIFY FAILED — on-disk pack differs from a fresh build`,
  );
  process.exit(same ? 0 : 1);
}

writeFileSync(OUT, packed);
console.log(`[pack:assets] wrote ${OUT}`);
console.log(`  ${sources.length} assets, ${packed.length} bytes, pack hash ${fnv1a(packed).toString(16)}`);
for (const s of sources) {
  const sz = statSync(s.path).size;
  console.log(`  ${["font", "sfx", "music"][s.kind]!.padEnd(6)} ${s.name.padEnd(34)} ${sz} B`);
}
