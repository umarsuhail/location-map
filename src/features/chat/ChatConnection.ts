import {
  AUTH_CONTEXT,
  type ClientMessage,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  parseServerMessage,
  type ServerMessage,
} from '@shared/protocol';

import type { ConnectionStatus } from './chatState';

/** Close codes the server uses to say "do not reconnect" (see server/src/hub.ts). */
const CLOSE_REPLACED = 4001;
const CLOSE_AUTH_FAILED = 4003;

const KEEPALIVE_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export type DeviceSigner = {
  getPublicKey(): Promise<string>;
  sign(message: string): Promise<string>;
};

type Listeners = {
  onStatus(status: ConnectionStatus): void;
  onMessage(message: ServerMessage): void;
};

type SocketFactory = (url: string) => WebSocket;

/**
 * One authenticated WebSocket to the chat server. Answers the server's
 * challenge with a signature from the device key, keeps the socket alive, and
 * reconnects with exponential backoff — except when the server has said this
 * device is rejected or superseded, where retrying would only repeat that.
 */
export class ChatConnection {
  private socket: WebSocket | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private publicKey: Promise<string> | null = null;

  constructor(
    private readonly url: string,
    private readonly signer: DeviceSigner,
    private readonly listeners: Listeners,
    private readonly createSocket: SocketFactory = (u) => new WebSocket(u),
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }

  /** False when there is no open, authenticated socket to send on. */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open() {
    this.listeners.onStatus('connecting');
    const socket = this.createSocket(`${this.url.replace(/\/+$/, '')}/connect`);
    this.socket = socket;

    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== 'string' || event.data === KEEPALIVE_PONG) return;
      let message: ServerMessage | null = null;
      try {
        message = parseServerMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed frames
      }
      if (!message) return;
      if (message.type === 'challenge') {
        this.authenticate(socket, message.nonce);
        return;
      }
      if (message.type === 'ready') {
        this.attempt = 0;
        this.listeners.onStatus('online');
      }
      this.listeners.onMessage(message);
    };

    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.clearTimers();
      if (this.stopped) return;
      if (event.code === CLOSE_AUTH_FAILED) return this.listeners.onStatus('auth-failed');
      if (event.code === CLOSE_REPLACED) return this.listeners.onStatus('replaced');
      this.listeners.onStatus('offline');
      this.scheduleReconnect();
    };

    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.keepalive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(KEEPALIVE_PING);
      }, KEEPALIVE_MS);
    };
  }

  private async authenticate(socket: WebSocket, nonce: string) {
    try {
      this.publicKey ??= this.signer.getPublicKey();
      const [publicKey, signature] = await Promise.all([this.publicKey, this.signer.sign(AUTH_CONTEXT + nonce)]);
      if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'auth', publicKey, signature } satisfies ClientMessage));
      }
    } catch {
      // The keystore refused; a retry would fail the same way.
      this.publicKey = null;
      this.stop();
      this.listeners.onStatus('auth-failed');
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private clearTimers() {
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.keepalive = null;
    this.retryTimer = null;
  }
}
