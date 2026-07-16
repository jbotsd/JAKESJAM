// Persistent local player record (splash panel — replaced the world status
// badge, Jake 2026-07-16: "remove this add player stats"). One localStorage
// blob, guarded reads/writes (private-mode Safari throws), pure render
// helper so the splash markup stays a dumb consumer.
//
// Recording sites: OnlineMatchScene only — kills/deaths/streak from
// player-killed sim events, matches/wins at the results screen. Practice,
// tutorial, and the venue lobby's dummy plinking deliberately don't count.

const STORAGE_KEY = "jakesjam.playerStats";

export type PlayerStats = {
  kills: number;
  deaths: number;
  bestStreak: number;
  matches: number;
  matchWins: number;
};

const ZERO: PlayerStats = { kills: 0, deaths: 0, bestStreak: 0, matches: 0, matchWins: 0 };

export function loadPlayerStats(): PlayerStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...ZERO };
    const parsed = JSON.parse(raw) as Partial<PlayerStats>;
    return {
      kills: Number(parsed.kills) || 0,
      deaths: Number(parsed.deaths) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
      matches: Number(parsed.matches) || 0,
      matchWins: Number(parsed.matchWins) || 0,
    };
  } catch {
    return { ...ZERO };
  }
}

function save(stats: PlayerStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* storage unavailable — stats become session-ephemeral, never fatal */
  }
}

export function recordKill(): void {
  const s = loadPlayerStats();
  s.kills += 1;
  save(s);
}

export function recordDeath(): void {
  const s = loadPlayerStats();
  s.deaths += 1;
  save(s);
}

export function recordStreak(streak: number): void {
  const s = loadPlayerStats();
  if (streak > s.bestStreak) {
    s.bestStreak = streak;
    save(s);
  }
}

export function recordMatch(won: boolean): void {
  const s = loadPlayerStats();
  s.matches += 1;
  if (won) s.matchWins += 1;
  save(s);
}

/** The splash panel's line items — label/value pairs in display order. */
export function statLines(stats: PlayerStats): Array<{ label: string; value: string }> {
  return [
    { label: "KILLS", value: String(stats.kills) },
    { label: "DEATHS", value: String(stats.deaths) },
    { label: "BEST STREAK", value: String(stats.bestStreak) },
    { label: "MATCHES", value: String(stats.matches) },
    { label: "WINS", value: String(stats.matchWins) },
  ];
}
