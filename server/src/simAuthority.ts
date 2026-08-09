// gospel E2-a — decide sim authority in ONE tracked place, and say where
// the decision came from.
//
// The bug this exists to prevent already happened. `server/.env.local`
// (untracked, gitignored) has carried USE_WASM_STEP_WORLD=1 since
// 2026-07-28. Bun auto-loads .env.local from its cwd, which is `server/`
// for the live host, so the process ran Zig/wasm authority for ~29 hours
// while `/proc/<pid>/environ` — and therefore everyone checking — showed
// the flag absent. Nobody chose that on the record, and no other checkout
// of this repo behaves the same way.
//
// This module does NOT change what authority the process runs. It makes
// the decision legible: one resolver, a tracked default, and a `source`
// that /health reports so the next person can see WHY the server is in
// the mode it is in rather than inferring it from a launch command.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SimAuthority = "wasm" | "ts";

export type AuthorityDecision = {
  authority: SimAuthority;
  /**
   * Where the value came from:
   *   "env"             — an explicit USE_WASM_STEP_WORLD in the environment.
   *                       Could be a real export OR a dotenv file; see
   *                       `dotenvDeclares` to tell whether an untracked
   *                       file is in play.
   *   "tracked-default" — nothing set it; this file decided.
   */
  source: "env" | "tracked-default";
  /**
   * True when an untracked dotenv next to the server declares the flag.
   * This is the smoking gun for "prod behaviour lives in a file git has
   * never seen" — reported, and warned about at boot, but never acted on.
   */
  dotenvDeclares: boolean;
};

/**
 * The default when NOTHING sets the flag — the value a fresh clone gets.
 *
 * Deliberately "ts", matching matchHost.ts's standing instruction ("Do NOT
 * flip this default back without real, extensive human playtesting"). E2's
 * machine evidence is complete (2h11m soak, 0 fallback ticks; suites green
 * under both authorities; port passport agreeing), but flipping THIS
 * constant is the ratification itself and belongs to a human, not to a
 * green gate. Changing this one line is how the flip should happen — a
 * tracked, reviewable, revertable commit, instead of a dotenv nobody can
 * see.
 */
export const TRACKED_DEFAULT_AUTHORITY: SimAuthority = "ts";

const DOTENV_CANDIDATES = [".env.local", ".env"] as const;

/** Does an untracked dotenv beside the server declare the authority flag? */
export function dotenvDeclaresAuthority(dir: string): boolean {
  for (const name of DOTENV_CANDIDATES) {
    const path = resolve(dir, name);
    if (!existsSync(path)) continue;
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        if (/^USE_WASM_STEP_WORLD\s*=/.test(trimmed)) return true;
      }
    } catch {
      // Unreadable is not "absent", but it is also not evidence. Treat as
      // absent rather than crashing a boot over a diagnostic.
    }
  }
  return false;
}

export function resolveSimAuthority(
  env: Record<string, string | undefined> = process.env,
  dir: string = resolve(import.meta.dir, ".."),
): AuthorityDecision {
  const raw = env.USE_WASM_STEP_WORLD;
  const dotenvDeclares = dotenvDeclaresAuthority(dir);

  if (raw !== undefined && raw !== "") {
    // Any explicit value decides, including an explicit "0" — that is what
    // makes a rollback actually roll back in the presence of a dotenv.
    return {
      authority: raw === "1" || raw === "true" ? "wasm" : "ts",
      source: "env",
      dotenvDeclares,
    };
  }

  return { authority: TRACKED_DEFAULT_AUTHORITY, source: "tracked-default", dotenvDeclares };
}

/**
 * Say it out loud at boot when authority is being supplied by a file git
 * cannot see. Silence is how this went unnoticed for ~29 hours.
 */
export function warnIfAuthorityIsUntracked(decision: AuthorityDecision): string | null {
  if (!decision.dotenvDeclares) return null;
  const msg =
    `[sim-authority] USE_WASM_STEP_WORLD is declared in an UNTRACKED dotenv beside the server. ` +
    `Effective authority is "${decision.authority}" (source: ${decision.source}). ` +
    `This machine therefore behaves differently from a fresh clone, whose tracked default is ` +
    `"${TRACKED_DEFAULT_AUTHORITY}". Move the decision into tracked config (simAuthority.ts) ` +
    `to make it reviewable.`;
  console.warn(msg);
  return msg;
}
