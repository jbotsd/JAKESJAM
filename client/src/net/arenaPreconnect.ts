// Arena pre-connect (open-doors 1.3 — the admission race).
//
// While a venue player stands QUEUED at the bell, the client opens the
// /ws/world socket in the background. The server parks it as a
// spectator-grade pending entrant (WorldHost.holdEntrant — the venue's
// truth keeps it out of the fight until the bell actually admits its
// player), so by the time `venue-admitted` arrives the TCP+TLS+WS
// handshake — the thing that used to lose the ~3 s countdown race on a
// cold cache / slow phone — has already happened. OnlineMatchScene then
// ADOPTS this connection instead of opening a fresh one.
//
// Adoption wrinkle: the ServerHello for this socket was sent while the
// player was still in the lobby scene, before any ClientLoop existed to
// consume it. The holder therefore decodes frames just enough to retain
// the LATEST raw hello (the server re-hellos the socket at the bell drain
// and at world recycles, so "latest" is always the current world), and
// `takeArenaPreconnect` wraps the socket in a replaying adapter that
// delivers that stored hello to the adopting ClientLoop's handler via a
// microtask — guaranteed to run before any subsequent network frame
// (message events are macrotasks), so the loop always meets the hello
// first. Everything else self-heals: the server deltas only against
// client-ACKED baselines, and this holder never acks, so the socket
// receives full snapshots until the adopting loop starts acking.
//
// The holder is module-level state (not scene state) because it must
// survive the HangoutScene → OnlineMatchScene handoff.

import { WsTransport } from "./wsTransport.js";
import type { Transport, TransportState } from "./transport.js";
import { decodeMessage, type ServerMessage } from "./protocol.js";
import { fetchWorldAssignment } from "./worldClient.js";

type Preconnect = {
  playerId: string;
  wsUrl: string;
  transport: Transport;
  /** Latest raw ServerHello frame seen on this socket (copied — the
   *  transport's buffers are not ours to alias). */
  helloFrame: Uint8Array | null;
  /** Flipped by take(): the holder's decode tap becomes a no-op the
   *  moment the adopting ClientLoop owns the stream. */
  taken: boolean;
};

let current: Preconnect | null = null;
/** Bumped by disarm — kills any in-flight arm whose fetch resolves after
 *  the player already stepped off the bell (no zombie sockets). */
let generation = 0;
let arming = false;

/** True while a live (or in-flight) pre-open exists for this player. */
export function isArenaPreconnectArmed(playerId: string): boolean {
  if (arming) return true;
  return (
    current !== null &&
    current.playerId === playerId &&
    current.transport.state !== "closed" &&
    current.transport.state !== "closing"
  );
}

/**
 * Open (or keep open) the background arena socket for a queued player.
 * Idempotent per venue-status tick: no-ops while armed, silently re-arms
 * on the next tick if a previous socket dropped. Failures are swallowed —
 * the pre-open is an optimization; the server-side admission ticket keeps
 * the acceptance ("ALWAYS inserted at the bell they were admitted for")
 * true even when this never connects.
 */
export async function armArenaPreconnect(
  playerId: string,
  displayName?: string,
  characterId?: string,
): Promise<void> {
  if (isArenaPreconnectArmed(playerId)) return;
  disarmArenaPreconnect(); // clear a stale (closed / other-player) holder
  const gen = generation;
  arming = true;
  try {
    const assignment = await fetchWorldAssignment(playerId, displayName, characterId);
    if (gen !== generation) return; // dequeued while the token fetch flew
    const pre: Preconnect = {
      playerId,
      wsUrl: assignment.wsUrl,
      transport: new WsTransport({ url: assignment.wsUrl }),
      helloFrame: null,
      taken: false,
    };
    pre.transport.onMessage((frame) => {
      if (pre.taken) return;
      try {
        const decoded = decodeMessage<ServerMessage>(frame);
        if (decoded?.message.t === "hello") pre.helloFrame = frame.slice();
      } catch {
        // Unknown/undecodable frame — not the holder's business to crash on.
      }
    });
    current = pre;
  } catch {
    // Token fetch failed — nothing armed; the 1 Hz venue-status tick
    // retries while the player remains queued.
  } finally {
    arming = false;
  }
}

/** Close and forget the pre-open (player dequeued / left the venue). A
 *  transport already handed to `takeArenaPreconnect` is never closed here
 *  — it belongs to the arena loop now. */
export function disarmArenaPreconnect(): void {
  generation += 1;
  if (current && !current.taken) current.transport.close("preconnect-disarmed");
  current = null;
}

/**
 * Hand the warm socket to the adopting arena scene. Returns null when no
 * usable pre-open exists (never armed, wrong player, or the socket died
 * between admission and adoption) — callers fall back to the ordinary
 * fresh-connect path.
 */
export function takeArenaPreconnect(
  playerId: string,
): { transport: Transport; wsUrl: string } | null {
  const pre = current;
  if (!pre || pre.playerId !== playerId) return null;
  current = null;
  generation += 1;
  if (pre.transport.state === "closed" || pre.transport.state === "closing") return null;
  pre.taken = true;
  return {
    transport: new HelloReplayingTransport(pre.transport, pre.helloFrame),
    wsUrl: pre.wsUrl,
  };
}

/** Test seam: install a fake holder without touching the network. */
export function installArenaPreconnectForTest(
  playerId: string,
  transport: Transport,
  wsUrl: string,
  helloFrame: Uint8Array | null,
): void {
  disarmArenaPreconnect();
  current = { playerId, wsUrl, transport, helloFrame, taken: false };
}

/**
 * Transport adapter that replays the held hello to each newly-registered
 * message handler before any live frame reaches it. Microtask delivery:
 * runs after the registering constructor finishes (the loop is fully
 * built) but before the next network macrotask (no live frame can jump
 * the queue). A hello arriving live AFTER adoption simply supersedes the
 * replayed one — ClientLoop already handles repeat hellos (the world-
 * recycle path).
 */
class HelloReplayingTransport implements Transport {
  private readonly inner: Transport;
  private readonly helloFrame: Uint8Array | null;

  constructor(inner: Transport, helloFrame: Uint8Array | null) {
    this.inner = inner;
    this.helloFrame = helloFrame;
  }

  get state(): TransportState {
    return this.inner.state;
  }

  send(message: Uint8Array): void {
    this.inner.send(message);
  }

  onOpen(handler: () => void): void {
    this.inner.onOpen(handler);
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    const hello = this.helloFrame;
    if (hello) queueMicrotask(() => handler(hello));
    this.inner.onMessage(handler);
  }

  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }

  close(reason?: string): void {
    this.inner.close(reason);
  }
}
