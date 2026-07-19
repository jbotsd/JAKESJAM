// Player callsign sanitizer — ONE function, imported by both the client
// (splash input, live-preview) and the server (ws upgrade — the
// authoritative pass; the client copy is UX-only and must never be
// trusted). Extreme allowlist on purpose: names render as plain text in
// Phaser canvas (already injection-safe there) but also reach DOM contexts
// (ops console, share-page copy) and get logged — so the bar is "safe
// everywhere, not just the one place we thought of."
//
// Rules (in order):
//   1. Hard-cap the RAW input before any regex touches it — an attacker
//      hitting /ws/world directly (bypassing the browser's maxlength=14)
//      could otherwise hand the server an arbitrarily long string and pay
//      for a regex pass over all of it. Capped well before any HTTP
//      header-size limit becomes the real bound.
//   2. ASCII allowlist: letters/digits/space/hyphen/period/apostrophe
//      only. `\w` in a non-`/u` JS regex is ASCII-only, so this single
//      pass already strips homoglyphs, zero-width joiners, RTL overrides,
//      combining-mark ("zalgo") stacks, and emoji — none of those
//      characters are in the class, so they're removed, not merely
//      escaped.
//   3. Collapse runs of whitespace to one space, then trim.
//   4. Reject (→ undefined, caller falls back to the id suffix) unless
//      the result is 2-14 chars AND contains at least one alnum
//      character — "...", "--", and "   " all fall back rather than
//      producing a blank-looking or punctuation-only plate.
//   5. Reject exact-match (case-insensitive) impersonation of reserved
//      labels the UI treats specially ("YOU" in the scoreboard) or
//      system/brand identities, plus anything starting with "bot" — bots
//      render as "BOT · <name>"; a real player naming themselves to start
//      with "bot" could spoof that plate.

const RAW_MAX_LEN = 64;
const MAX_LEN = 14;
const MIN_LEN = 2;

const RESERVED = new Set([
  "you",
  "system",
  "admin",
  "administrator",
  "server",
  "host",
  "jakesjam",
  "binipe",
  "null",
  "undefined",
  "nobody",
]);

/**
 * Character-level filter only — allowlist + whitespace collapse, capped to
 * MAX_LEN. No trim, no reserved-word/min-length rejection. This is the
 * "as you type" pass: it must never blank the field mid-typing just
 * because a legal substring transiently matches a reserved word (e.g.
 * typing "youtuber" passes through "you"). Also used server-side as a
 * building block, but `sanitizePlayerName` — not this — is what the
 * server treats as authoritative for what actually joins the world.
 */
export function stripDisallowedChars(raw: string): string {
  return raw
    .slice(0, RAW_MAX_LEN)
    .replace(/[^\w \-.']/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_LEN);
}

/** Returns a clean 2-14 char callsign, or `undefined` if nothing usable
 *  survives sanitization (caller should fall back to the id suffix). Call
 *  this at COMMIT time (join, localStorage write) — never per-keystroke. */
export function sanitizePlayerName(raw: string): string | undefined {
  const collapsed = stripDisallowedChars(raw).trim();

  if (collapsed.length < MIN_LEN) return undefined;
  if (!/\w/.test(collapsed)) return undefined; // punctuation/space-only

  const lower = collapsed.toLowerCase();
  if (RESERVED.has(lower)) return undefined;
  if (lower.startsWith("bot")) return undefined;

  return collapsed;
}

/**
 * Deterministic guest callsign for zero-friction shared-link entry. The
 * authored callsign prompt remains the normal front-door experience; this is
 * only the safe fallback when an invite needs to enter play immediately.
 */
export function fallbackPlayerName(playerId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i += 1) {
    hash ^= playerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `Vessel-${(hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}
