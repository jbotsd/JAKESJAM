// Personal-record surfacing — Doors 2.3.
//
// "Cheapest proven 'one more round' trigger, and it works for losers."
// That second half is the whole point: a win screen only rewards the
// winner, so in a four-player cycle it tells three people they wasted
// their time. A personal best is something a last-place finisher can
// still be handed, truthfully.
//
// Scoped deliberately to what the CLIENT already knows. The goal doc
// says this feeds off Pillar 4's sim-side run record, which does not
// exist yet and lives in a frozen path — but `playerStats` has tracked
// bests locally the whole time, so the trigger can ship now and get
// richer later. What it cannot do yet: per-round surfacing (there is no
// client round-end signal) or class-scoped records ("first win as
// Geometrician") — both recorded as open rather than faked.

/** One thing worth telling the player about what just happened. */
export type PersonalBest = { kicker: string; line: string };

/**
 * Notables for a finished cycle, best-first. Empty is a valid answer and
 * the common one — an unremarkable match should say nothing rather than
 * manufacture a compliment, which is how "achievement" toasts become
 * noise people learn to ignore.
 */
export function cycleNotables(input: {
  /** Did the local player win the cycle? */
  won: boolean;
  /** True when recordStreak() reported beating the stored best. */
  beatStreak: boolean;
  /** The streak that did it (only meaningful when beatStreak). */
  streak: number;
  /** From recordMatch(): this was their very first finished match. */
  firstEver: boolean;
  /** From recordMatch(): first win ever. */
  firstWin: boolean;
}): PersonalBest[] {
  const out: PersonalBest[] = [];

  // Firsts outrank repeats: the first win is a bigger moment than any
  // later one, and saying both would bury it.
  if (input.firstWin) {
    out.push({ kicker: "FIRST WIN", line: "your first cycle taken" });
  } else if (input.won) {
    out.push({ kicker: "WIN", line: "cycle taken" });
  }

  if (input.beatStreak) {
    out.push({
      kicker: "NEW BEST STREAK",
      line: `${input.streak} without dying`,
    });
  }

  // Only if nothing else fired — a first match that was also a first win
  // should not say both.
  if (out.length === 0 && input.firstEver) {
    out.push({ kicker: "FIRST CYCLE", line: "you finished one — the rest get easier" });
  }

  return out;
}

/**
 * Show the notables as a non-blocking strip. Same shape as the Discord
 * toast the email gate uses: a strip that dismisses itself, never an
 * interstitial — ui-axioms bans modal celebration as hard as it bans
 * modal tutorials, and the player is about to be asked "again?".
 */
export function showPersonalBests(notables: readonly PersonalBest[]): void {
  if (notables.length === 0) return;
  const host = document.createElement("div");
  host.className = "pb-toast";
  host.setAttribute("role", "status");
  host.innerHTML = notables
    .map(
      (n) =>
        `<span class="pb-toast-item"><b>${escapeHtml(n.kicker)}</b>${escapeHtml(n.line)}</span>`,
    )
    .join("");
  document.body.appendChild(host);
  window.setTimeout(() => {
    host.classList.add("pb-toast--out");
    window.setTimeout(() => host.remove(), 500);
  }, 5200);
}

/** These strings are ours, not user input — but a callsign could reach
 *  here the moment class-scoped records land, so escape at the boundary
 *  rather than remembering to later. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
