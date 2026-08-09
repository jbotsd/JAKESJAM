// Class verbs on FIRST pick — Doors 3.3's last row.
//
// "Class verbs taught on first pick of that class, not up front." The
// up-front version is what the loadout station already does: four cards
// of kit text a newcomer reads before any of it means anything. Teaching
// on pick means the words arrive attached to a decision the player just
// made, about a body they are about to wear.
//
// Once per class, not once ever — picking Kindled teaches you nothing
// about Syzygist, so each chassis gets its own first time. The set of
// classes already taught lives in one localStorage key.

const SEEN_KEY = "jakesjam.classVerbsSeen";

function seen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    // Corrupt or unavailable — treat as "nothing taught yet". Teaching a
    // second time is a far cheaper failure than never teaching.
    return new Set();
  }
}

function remember(id: string): void {
  try {
    const s = seen();
    s.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable — the hint simply repeats next time */
  }
}

/** True the first time this chassis is ever picked on this browser. */
export function isFirstPick(characterId: string): boolean {
  return !seen().has(characterId);
}

/**
 * Announce a chassis's verbs. `summary` is the same `kitSummary` the
 * picker shows — deliberately the SAME string rather than a second copy
 * that could drift, and `characters.ts` already enforces the discipline
 * that a kitSummary names only abilities that are live today.
 *
 * No-ops (and stays silent) when this chassis has been picked before.
 */
export function noteClassPicked(characterId: string, name: string, summary: string): void {
  if (!isFirstPick(characterId)) return;
  remember(characterId);

  const host = document.createElement("div");
  // Reuses the personal-best strip's geometry so the two can never
  // disagree about where a transient line lives, with an --info modifier
  // for the palette: cyan is information, gold is earned (chassis
  // grammar). A class pick is not an achievement.
  host.className = "pb-toast pb-toast--info";
  host.setAttribute("role", "status");
  const item = document.createElement("span");
  item.className = "pb-toast-item";
  const kicker = document.createElement("b");
  kicker.textContent = name.toUpperCase();
  const body = document.createElement("span");
  // textContent, not innerHTML: `name` comes from our own table today,
  // but this is the boundary where a future custom chassis label would
  // arrive, and escaping at the boundary beats remembering later.
  body.textContent = summary;
  item.append(kicker, body);
  host.appendChild(item);
  document.body.appendChild(host);

  window.setTimeout(() => {
    host.classList.add("pb-toast--out");
    window.setTimeout(() => host.remove(), 500);
  }, 6400); // longer than the PB strip: this is a sentence, not a score
}
