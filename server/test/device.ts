// Test double for a phone: a P-256 key pair that signs like Android's
// SHA256withECDSA (DER output), and a WebSocket client for the hub.
import { exports } from 'cloudflare:workers';

import { AUTH_CONTEXT, type ClientMessage, type ServerMessage } from '../../shared/protocol';

const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

/** Encodes one 32-byte coordinate as a DER INTEGER (minimal, kept positive). */
function derInteger(coordinate: Uint8Array): Uint8Array {
  let start = 0;
  while (start < coordinate.length - 1 && coordinate[start] === 0) start++;
  const trimmed = coordinate.subarray(start);
  const body = trimmed[0]! & 0x80 ? Uint8Array.of(0, ...trimmed) : trimmed;
  return Uint8Array.of(0x02, body.length, ...body);
}

export function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const r = derInteger(raw.subarray(0, 32));
  const s = derInteger(raw.subarray(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

export type TestDevice = {
  publicKey: string;
  sign(message: string): Promise<string>;
};

export async function createDevice(): Promise<TestDevice> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer;
  return {
    publicKey: toBase64(spki),
    async sign(message) {
      const raw = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keys.privateKey,
        new TextEncoder().encode(message),
      );
      return toBase64(rawSignatureToDer(new Uint8Array(raw)));
    },
  };
}

/** A connected socket with a queue of received server messages. */
export class TestClient {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  closeCode: number | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code;
    });
  }

  static async open(): Promise<TestClient> {
    const response = await exports.default.fetch('https://chat.test/connect', {
      headers: { Upgrade: 'websocket' },
    });
    const ws = response.webSocket;
    if (!ws) throw new Error(`Expected a WebSocket, got HTTP ${response.status}`);
    ws.accept();
    return new TestClient(ws);
  }

  /** Opens a socket and completes the challenge-response with `device`. */
  static async connect(device: TestDevice): Promise<{ client: TestClient; ready: Extract<ServerMessage, { type: 'ready' }> }> {
    const client = await TestClient.open();
    const challenge = await client.expect('challenge');
    client.send({
      type: 'auth',
      publicKey: device.publicKey,
      signature: await device.sign(AUTH_CONTEXT + challenge.nonce),
    });
    return { client, ready: await client.expect('ready') };
  }

  send(message: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(message));
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a server message')), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async expect<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const message = await this.next();
    if (message.type !== type) {
      throw new Error(`Expected "${type}", got ${JSON.stringify(message)}`);
    }
    return message as Extract<ServerMessage, { type: T }>;
  }

  async closed(timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error('Socket did not close');
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.closeCode;
  }
}

/** Two devices paired with each other, both connected. */
export async function pairedClients() {
  const alice = await createDevice();
  const bob = await createDevice();
  const a = await TestClient.connect(alice);
  const b = await TestClient.connect(bob);
  a.client.send({ type: 'create-invite' });
  const { code } = await a.client.expect('invite');
  b.client.send({ type: 'accept-invite', code });
  await a.client.expect('paired');
  await b.client.expect('paired');
  return { alice, bob, a: a.client, b: b.client, aliceId: a.ready.deviceId, bobId: b.ready.deviceId };
}
