import { DurableObject } from 'cloudflare:workers';

import {
  AUTH_CONTEXT,
  type ChatMessage,
  type ClientMessage,
  type ErrorCode,
  fingerprintOf,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  MAX_MESSAGE_LENGTH,
  normalizeInviteCode,
  type PeerInfo,
  parseClientMessage,
  type ServerMessage,
} from '../../shared/protocol';
import { base64ToBytes, deviceIdOf, verifySignature } from './crypto';

const AUTH_TIMEOUT_MS = 30_000;
const INVITE_TTL_MS = 5 * 60_000;
const MAX_FAILED_CODES = 5;
const FAILED_CODE_WINDOW_MS = 10 * 60_000;
const HISTORY_LIMIT = 500;
const MAX_FRAME_BYTES = 16_384;

/** Close codes in the 4000 range are ours; the app reads them to decide whether to reconnect. */
export const CLOSE_AUTH_FAILED = 4003;
export const CLOSE_REPLACED = 4001;

/** Per-socket state; survives the object hibernating between messages. */
type Attachment = { nonce: string; issuedAt: number; deviceId?: string };

type DeviceRow = {
  device_id: string;
  paired_with: string | null;
  failed_codes: number;
  failed_window_start: number;
};

const pairKey = (a: string, b: string) => [a, b].sort().join(':');

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

function randomInviteCode(): string {
  // 31 symbols: reject bytes ≥ 248 (8 × 31) so every symbol is equally likely.
  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && code.length < INVITE_CODE_LENGTH) code += INVITE_ALPHABET[byte % 31];
    }
  }
  return code;
}

/**
 * One object owns every device, pairing and connection. Keeping it in one
 * place makes "a device has at most one partner" a plain single-threaded
 * check-then-write instead of a distributed lock. Sockets use the hibernation
 * API, so idle connections cost nothing.
 */
export class ChatHub extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        paired_with TEXT,
        failed_codes INTEGER NOT NULL DEFAULT 0,
        failed_window_start INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pair_key TEXT NOT NULL,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_by_pair ON messages (pair_key, id);
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const nonce = randomNonce();
    server.serializeAttachment({ nonce, issuedAt: Date.now() } satisfies Attachment);
    this.send(server, { type: 'challenge', nonce });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_FRAME_BYTES) {
      return this.error(ws, 'bad-request', 'Expected a JSON text frame.');
    }
    let message: ClientMessage | null;
    try {
      message = parseClientMessage(JSON.parse(data));
    } catch {
      message = null;
    }
    if (!message) return this.error(ws, 'bad-request', 'Malformed message.');

    const attachment = ws.deserializeAttachment() as Attachment;
    const deviceId = attachment.deviceId;
    if (!deviceId) {
      if (message.type !== 'auth') {
        this.error(ws, 'not-authenticated', 'Authenticate first.');
        return ws.close(CLOSE_AUTH_FAILED, 'not-authenticated');
      }
      return this.authenticate(ws, attachment, message.publicKey, message.signature);
    }

    switch (message.type) {
      case 'auth':
        return this.error(ws, 'bad-request', 'Already authenticated.');
      case 'create-invite':
        return this.createInvite(ws, deviceId);
      case 'accept-invite':
        return this.acceptInvite(ws, deviceId, message.code);
      case 'unpair':
        return this.unpair(ws, deviceId);
      case 'send':
        return this.relay(ws, deviceId, message.clientId, message.body);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.disconnected(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.disconnected(ws);
  }

  // ── authentication ────────────────────────────────────────────────────

  private async authenticate(ws: WebSocket, attachment: Attachment, publicKey: string, signature: string) {
    const reject = () => {
      this.error(ws, 'auth-failed', 'Device verification failed.');
      ws.close(CLOSE_AUTH_FAILED, 'auth-failed');
    };
    if (Date.now() - attachment.issuedAt > AUTH_TIMEOUT_MS) return reject();

    let spki: Uint8Array;
    let derSignature: Uint8Array;
    try {
      spki = base64ToBytes(publicKey);
      derSignature = base64ToBytes(signature);
    } catch {
      return reject();
    }
    if (!(await verifySignature(spki, AUTH_CONTEXT + attachment.nonce, derSignature))) return reject();

    // Another auth frame on this socket may have finished while we awaited.
    const current = ws.deserializeAttachment() as Attachment;
    if (current.deviceId || current.nonce !== attachment.nonce) return;

    const deviceId = await deviceIdOf(spki);
    // Spend the nonce: it can never authenticate a second time.
    ws.serializeAttachment({ nonce: '', issuedAt: attachment.issuedAt, deviceId } satisfies Attachment);

    // One live connection per device; the newest wins.
    for (const other of this.socketsOf(deviceId)) {
      if (other === ws) continue;
      this.error(other, 'replaced', 'This device connected again elsewhere.');
      other.close(CLOSE_REPLACED, 'replaced');
    }

    this.sql.exec(
      `INSERT INTO devices (device_id, public_key, created_at) VALUES (?, ?, ?)
       ON CONFLICT (device_id) DO NOTHING`,
      deviceId,
      publicKey,
      Date.now(),
    );

    const peerId = this.device(deviceId)?.paired_with ?? null;
    this.send(ws, {
      type: 'ready',
      deviceId,
      fingerprint: fingerprintOf(deviceId),
      peer: peerId ? this.peerInfo(peerId) : null,
    });
    if (peerId) {
      this.send(ws, { type: 'history', messages: this.history(deviceId, peerId) });
      this.broadcast(peerId, { type: 'presence', online: true });
    }
  }

  // ── pairing ───────────────────────────────────────────────────────────

  private createInvite(ws: WebSocket, deviceId: string) {
    if (this.device(deviceId)?.paired_with) {
      return this.error(ws, 'already-paired', 'Unpair before pairing with another phone.');
    }
    const now = Date.now();
    this.sql.exec('DELETE FROM invites WHERE expires_at <= ? OR device_id = ?', now, deviceId);

    let code = randomInviteCode();
    while (this.sql.exec('SELECT 1 FROM invites WHERE code = ?', code).toArray().length > 0) {
      code = randomInviteCode();
    }
    const expiresAt = now + INVITE_TTL_MS;
    this.sql.exec('INSERT INTO invites (code, device_id, expires_at) VALUES (?, ?, ?)', code, deviceId, expiresAt);
    this.send(ws, { type: 'invite', code, expiresAt });
  }

  private acceptInvite(ws: WebSocket, deviceId: string, rawCode: string) {
    const me = this.device(deviceId);
    if (!me) return this.error(ws, 'not-authenticated', 'Unknown device.');
    if (me.paired_with) return this.error(ws, 'already-paired', 'Unpair before pairing with another phone.');

    const now = Date.now();
    const windowExpired = now - me.failed_window_start > FAILED_CODE_WINDOW_MS;
    const failed = windowExpired ? 0 : me.failed_codes;
    if (failed >= MAX_FAILED_CODES) {
      return this.error(ws, 'rate-limited', 'Too many wrong codes. Try again in a few minutes.');
    }

    const code = normalizeInviteCode(rawCode);
    const invite = this.sql
      .exec<{ device_id: string }>('SELECT device_id FROM invites WHERE code = ? AND expires_at > ?', code, now)
      .toArray()[0];
    const inviter = invite && invite.device_id !== deviceId ? this.device(invite.device_id) : undefined;

    if (!invite || !inviter || inviter.paired_with) {
      this.sql.exec(
        'UPDATE devices SET failed_codes = ?, failed_window_start = ? WHERE device_id = ?',
        failed + 1,
        windowExpired ? now : me.failed_window_start,
        deviceId,
      );
      return this.error(ws, 'invalid-code', 'That code is wrong or has expired.');
    }

    const peerId = inviter.device_id;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE devices SET paired_with = ? WHERE device_id = ?', peerId, deviceId);
      this.sql.exec('UPDATE devices SET paired_with = ? WHERE device_id = ?', deviceId, peerId);
      this.sql.exec('UPDATE devices SET failed_codes = 0 WHERE device_id = ?', deviceId);
      this.sql.exec('DELETE FROM invites WHERE device_id IN (?, ?)', deviceId, peerId);
    });

    this.broadcast(deviceId, { type: 'paired', peer: this.peerInfo(peerId) });
    this.broadcast(peerId, { type: 'paired', peer: this.peerInfo(deviceId) });
  }

  private unpair(ws: WebSocket, deviceId: string) {
    const peerId = this.device(deviceId)?.paired_with;
    if (!peerId) return this.error(ws, 'not-paired', 'This phone is not paired.');

    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE devices SET paired_with = NULL WHERE device_id IN (?, ?)', deviceId, peerId);
      this.sql.exec('DELETE FROM messages WHERE pair_key = ?', pairKey(deviceId, peerId));
    });
    this.broadcast(deviceId, { type: 'unpaired' });
    this.broadcast(peerId, { type: 'unpaired' });
  }

  // ── chat ──────────────────────────────────────────────────────────────

  private relay(ws: WebSocket, deviceId: string, clientId: string, rawBody: string) {
    const peerId = this.device(deviceId)?.paired_with;
    if (!peerId) return this.error(ws, 'not-paired', 'Pair with a phone before sending messages.');

    const body = rawBody.trim();
    if (!body || body.length > MAX_MESSAGE_LENGTH || clientId.length > 64) {
      return this.error(ws, 'bad-request', `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.`);
    }

    const key = pairKey(deviceId, peerId);
    const sentAt = Date.now();
    const { id } = this.sql
      .exec<{ id: number }>(
        'INSERT INTO messages (pair_key, sender, body, sent_at) VALUES (?, ?, ?, ?) RETURNING id',
        key,
        deviceId,
        body,
        sentAt,
      )
      .one();
    this.sql.exec(
      `DELETE FROM messages WHERE pair_key = ? AND id <= (
         SELECT id FROM messages WHERE pair_key = ? ORDER BY id DESC LIMIT 1 OFFSET ?
       )`,
      key,
      key,
      HISTORY_LIMIT,
    );

    const message: ChatMessage = { id, from: deviceId, body, sentAt };
    this.broadcast(deviceId, { type: 'message', message: { ...message, clientId } });
    this.broadcast(peerId, { type: 'message', message });
  }

  private history(deviceId: string, peerId: string): ChatMessage[] {
    return this.sql
      .exec<{ id: number; sender: string; body: string; sent_at: number }>(
        'SELECT id, sender, body, sent_at FROM messages WHERE pair_key = ? ORDER BY id',
        pairKey(deviceId, peerId),
      )
      .toArray()
      .map((row) => ({ id: row.id, from: row.sender, body: row.body, sentAt: row.sent_at }));
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private disconnected(ws: WebSocket) {
    const { deviceId } = (ws.deserializeAttachment() as Attachment | null) ?? {};
    if (!deviceId) return;
    const peerId = this.device(deviceId)?.paired_with;
    if (peerId && !this.isOnline(deviceId, ws)) this.broadcast(peerId, { type: 'presence', online: false });
  }

  private device(deviceId: string): DeviceRow | undefined {
    return this.sql
      .exec<DeviceRow>(
        'SELECT device_id, paired_with, failed_codes, failed_window_start FROM devices WHERE device_id = ?',
        deviceId,
      )
      .toArray()[0];
  }

  private peerInfo(peerId: string, excluding?: WebSocket): PeerInfo {
    return { deviceId: peerId, fingerprint: fingerprintOf(peerId), online: this.isOnline(peerId, excluding) };
  }

  /** Authenticated sockets for a device. */
  private socketsOf(deviceId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.deviceId === deviceId);
  }

  private isOnline(deviceId: string, excluding?: WebSocket): boolean {
    return this.socketsOf(deviceId).some((ws) => ws !== excluding && ws.readyState === WebSocket.OPEN);
  }

  private broadcast(deviceId: string, message: ServerMessage) {
    for (const ws of this.socketsOf(deviceId)) this.send(ws, message);
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // socket is closing; its close handler cleans up
    }
  }

  private error(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { type: 'error', code, message });
  }
}
