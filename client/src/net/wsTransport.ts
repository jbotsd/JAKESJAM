// Browser WebSocket transport. Binary frames only. The server expects every
// payload to be a Uint8Array (MessagePack with version prefix); ArrayBuffer
// frames coming the other way are normalized here.

import type { Transport, TransportState } from "./transport.js";

export type WsTransportOptions = {
  url: string;
  // Called once on the very first message handler registration if state is
  // already open by then (race-safe wiring for late subscribers).
  protocols?: string | string[];
};

export class WsTransport implements Transport {
  private readonly socket: WebSocket;
  private _state: TransportState = "connecting";
  private openHandlers: Array<() => void> = [];
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  private closeHandlers: Array<(reason: string) => void> = [];

  constructor(opts: WsTransportOptions) {
    this.socket = new WebSocket(opts.url, opts.protocols);
    this.socket.binaryType = "arraybuffer";

    this.socket.addEventListener("open", () => {
      this._state = "open";
      for (const h of this.openHandlers) h();
    });
    this.socket.addEventListener("message", (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        for (const h of this.messageHandlers) h(bytes);
      }
      // Text frames are unexpected; drop silently.
    });
    this.socket.addEventListener("close", (event) => {
      this._state = "closed";
      const reason = event.reason || `code:${event.code}`;
      for (const h of this.closeHandlers) h(reason);
    });
    this.socket.addEventListener("error", () => {
      // Errors trigger close; nothing to do here yet beyond logging if useful.
    });
  }

  get state(): TransportState {
    return this._state;
  }

  send(message: Uint8Array): void {
    if (this._state !== "open") return;
    // Slice to a fresh ArrayBuffer to satisfy WebSocket.send's BufferSource
    // signature, which rejects Uint8Array<ArrayBufferLike> under recent TS lib defs.
    const view = message.byteOffset === 0 && message.byteLength === message.buffer.byteLength
      ? message.buffer
      : message.slice().buffer;
    this.socket.send(view as ArrayBuffer);
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
    if (this._state === "open") handler();
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandlers.push(handler);
    if (this._state === "closed") handler("already-closed");
  }

  close(reason?: string): void {
    if (this._state === "closed" || this._state === "closing") return;
    this._state = "closing";
    this.socket.close(1000, reason);
  }
}
