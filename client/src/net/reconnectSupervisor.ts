// Reconnect supervisor for ClientLoop's WS transport.
//
// Owns:
//   - Backoff schedule (5 attempts, exponential 500ms..8s).
//   - Whether a given close reason is terminal (no retry).
//   - Scheduling of the next attempt + invocation of a transport
//     factory to build the replacement.
//
// Does NOT own:
//   - The transport itself (caller passes the new instance back in via
//     onAttempt — keeping the supervisor pure of WS/Bun specifics).
//   - The hello handshake — that runs on the new transport's onOpen.
//
// Extracted from clientLoop.ts during Phase E3 to deepen ClientLoop's
// interface (one fewer responsibility on the facade).

export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

/** Close reasons that should NOT trigger reconnect (terminal disconnects). */
const TERMINAL_CLOSE_REASONS = new Set<string>([
  "match-ended",
  "auth-failed",
  "protocol-mismatch",
  "server-shutdown",
]);

export type ReconnectState = {
  attempt: number;
  lastAttemptAt: number | null;
  isReconnecting: boolean;
};

export type ReconnectSupervisorOptions = {
  /**
   * Build + return a fresh transport. Called by the supervisor at the
   * scheduled attempt time. The caller is responsible for wiring the
   * transport's onOpen/onMessage/onClose. The supervisor only cares
   * that it was built.
   */
  onAttempt: () => void;
  /**
   * Fired when reconnect is abandoned (terminal reason or attempts
   * exhausted). The downstream listener should surface it to the UI
   * and stop the sim loop.
   */
  onAbandon: (reason: string) => void;
  /**
   * Fired before each scheduled attempt — useful for status text in
   * the lobby/HUD.
   */
  onScheduled?: (attemptNumber: number, nextDelayMs: number) => void;
};

export class ReconnectSupervisor {
  private readonly opts: ReconnectSupervisorOptions;
  private readonly enabled: boolean;
  private attempt = 0;
  private lastAttemptAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inProgress = false;
  private abandoned = false;

  /**
   * `enabled` mirrors ClientLoop's "did you pass a reconnectUrl?" check.
   * When false, the supervisor never schedules and always abandons on
   * the first close — useful for tests with mock transports.
   */
  constructor(enabled: boolean, opts: ReconnectSupervisorOptions) {
    this.enabled = enabled;
    this.opts = opts;
  }

  /** Mark a successful (re)connect — called from transport.onOpen. */
  noteOpen(): void {
    this.attempt = 0;
    this.inProgress = false;
  }

  /** Decide whether to schedule a retry or abandon. */
  noteClose(reason: string): void {
    if (this.abandoned) return;
    if (!this.enabled || TERMINAL_CLOSE_REASONS.has(reason)) {
      this.abandoned = true;
      this.opts.onAbandon(reason);
      return;
    }
    if (this.attempt >= RECONNECT_BACKOFF_MS.length) {
      this.abandoned = true;
      this.opts.onAbandon(reason);
      return;
    }
    this.scheduleNext();
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Caller surface for UI (mirrors prior ClientLoop.getReconnectState). */
  state(): ReconnectState {
    return {
      attempt: this.attempt,
      lastAttemptAt: this.lastAttemptAt,
      isReconnecting: this.inProgress,
    };
  }

  isAbandoned(): boolean {
    return this.abandoned;
  }

  private scheduleNext(): void {
    if (this.timer) return;
    const delay = RECONNECT_BACKOFF_MS[this.attempt]!;
    const attemptNumber = this.attempt + 1;
    this.inProgress = true;
    this.opts.onScheduled?.(attemptNumber, delay);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.abandoned) return;
      this.attempt += 1;
      this.lastAttemptAt = Date.now();
      this.opts.onAttempt();
    }, delay);
  }
}
