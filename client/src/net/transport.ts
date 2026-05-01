// Transport interface. wsTransport is the only concrete implementation today.
// Mocked in tests by hand-rolling { send, onMessage, close }.

export type TransportState = "connecting" | "open" | "closing" | "closed";

export interface Transport {
  readonly state: TransportState;
  send(message: Uint8Array): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(reason?: string): void;
}
