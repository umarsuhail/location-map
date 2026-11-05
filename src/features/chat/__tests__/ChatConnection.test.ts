import { AUTH_CONTEXT, type ServerMessage } from '@shared/protocol';

import { ChatConnection } from '../ChatConnection';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: ServerMessage | string) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const signer = {
  getPublicKey: jest.fn(async () => 'PUBKEY'),
  sign: jest.fn(async (message: string) => `SIG(${message})`),
};

function setup() {
  const statuses: string[] = [];
  const messages: ServerMessage[] = [];
  const conn = new ChatConnection(
    'wss://chat.example/',
    signer,
    { onStatus: (s) => statuses.push(s), onMessage: (m) => messages.push(m) },
    (url) => new FakeSocket(url) as unknown as WebSocket,
  );
  return { conn, statuses, messages, socket: () => FakeSocket.instances.at(-1)! };
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));
const ready: ServerMessage = { type: 'ready', deviceId: 'a', fingerprint: 'A', peer: null };

beforeAll(() => {
  // React Native's WebSocket constants, which the class compares against.
  (globalThis as { WebSocket: unknown }).WebSocket = Object.assign(FakeSocket, { OPEN: 1 });
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  FakeSocket.instances = [];
  jest.clearAllMocks();
});

afterEach(() => jest.useRealTimers());

it('answers the challenge with the device key, then reports online', async () => {
  const { conn, statuses, socket } = setup();
  conn.start();
  expect(socket().url).toBe('wss://chat.example/connect');

  socket().open();
  socket().receive({ type: 'challenge', nonce: 'N1' });
  await flush();

  expect(signer.sign).toHaveBeenCalledWith(AUTH_CONTEXT + 'N1');
  expect(JSON.parse(socket().sent[0]!)).toEqual({ type: 'auth', publicKey: 'PUBKEY', signature: `SIG(${AUTH_CONTEXT}N1)` });

  socket().receive(ready);
  expect(statuses).toEqual(['connecting', 'online']);
});

it('reconnects with backoff after an unexpected drop', () => {
  const { conn, statuses, socket } = setup();
  conn.start();
  socket().open();
  socket().drop(1006);
  expect(statuses.at(-1)).toBe('offline');

  jest.advanceTimersByTime(999);
  expect(FakeSocket.instances).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(FakeSocket.instances).toHaveLength(2);

  socket().drop(1006);
  jest.advanceTimersByTime(1999);
  expect(FakeSocket.instances).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(FakeSocket.instances).toHaveLength(3);
});

it.each([
  [4003, 'auth-failed'],
  [4001, 'replaced'],
])('does not reconnect after close code %i', (code, status) => {
  const { conn, statuses, socket } = setup();
  conn.start();
  socket().open();
  socket().drop(code);

  expect(statuses.at(-1)).toBe(status);
  jest.advanceTimersByTime(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
});

it('sends keepalive pings and ignores the pongs', () => {
  const { conn, messages, socket } = setup();
  conn.start();
  socket().open();
  jest.advanceTimersByTime(25_000);
  expect(socket().sent).toContain('ping');

  socket().receive('pong');
  expect(messages).toEqual([]);
});

it('stays stopped after stop(), even when the socket then closes', () => {
  const { conn, socket } = setup();
  conn.start();
  socket().open();
  conn.stop();
  jest.advanceTimersByTime(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
});

it('refuses to send before the socket is open', () => {
  const { conn } = setup();
  conn.start();
  expect(conn.send({ type: 'create-invite' })).toBe(false);
});
