// In-memory session clip list for the CLIPS place. Cap + pair vertical/original.

export type ClipKind = "vertical" | "original";

export type ClipEntry = {
  id: string;
  url: string;
  kind: ClipKind;
  pairId?: string;
  label?: string;
  atMs: number;
};

export type ClipPairRow = {
  pairId: string;
  atMs: number;
  label?: string;
  vertical?: ClipEntry;
  original?: ClipEntry;
};

const DEFAULT_MAX = 24;

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `clip_${idSeq}_${Date.now().toString(36)}`;
}

export class ClipSession {
  private readonly max: number;
  private entries: ClipEntry[] = [];

  constructor(max: number = DEFAULT_MAX) {
    this.max = Math.max(1, max);
  }

  add(input: {
    url: string;
    kind: ClipKind;
    pairId?: string;
    label?: string;
    atMs?: number;
    id?: string;
  }): ClipEntry {
    const entry: ClipEntry = {
      id: input.id ?? nextId(),
      url: input.url,
      kind: input.kind,
      pairId: input.pairId,
      label: input.label,
      atMs: input.atMs ?? Date.now(),
    };
    this.entries.unshift(entry);
    while (this.entries.length > this.max) {
      this.entries.pop();
    }
    return entry;
  }

  list(): readonly ClipEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  /** Group by pairId (or solo id) newest first for CLIPS UI rows. */
  pairs(): ClipPairRow[] {
    const order: string[] = [];
    const map = new Map<string, ClipPairRow>();
    for (const e of this.entries) {
      const key = e.pairId ?? e.id;
      let row = map.get(key);
      if (!row) {
        row = { pairId: key, atMs: e.atMs, label: e.label };
        map.set(key, row);
        order.push(key);
      }
      if (e.kind === "vertical") row.vertical = e;
      else row.original = e;
      if (e.label) row.label = e.label;
      row.atMs = Math.max(row.atMs, e.atMs);
    }
    return order.map((k) => map.get(k)!);
  }

  /** Prefer vertical URL for share; fall back to original. */
  primaryShareUrl(): string | null {
    for (const row of this.pairs()) {
      const url = row.vertical?.url ?? row.original?.url;
      if (url) return url;
    }
    return null;
  }
}

/** Shared session used by shell + toast path. */
export const globalClipSession = new ClipSession();
