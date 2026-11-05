// Wire protocol between the app and the chat server, shared by both sides.
// Everything is a JSON object with a `type`, except the bare "ping"/"pong"
// keepalive strings, which the server answers without waking up.

/** Prefix of the bytes a device signs to prove it holds its key. */
export const AUTH_CONTEXT = 'location-map/auth/v1:';

export const KEEPALIVE_PING = 'ping';
export const KEEPALIVE_PONG = 'pong';

export const MAX_MESSAGE_LENGTH = 4000;
/**
 * Invite codes avoid look-alike characters (0/O, 1/I/L). Eight characters give
 * 31^8 ≈ 8.5e11 codes, so guessing a live one within its few-minute lifetime
 * is infeasible even for someone minting fresh device keys to dodge the
 * per-device attempt limit.
 */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;

/** Uppercases and drops separators/unknown characters, e.g. "abcd-2345" → "ABCD2345". */
export function normalizeInviteCode(input: string): string {
  return [...input.toUpperCase()].filter((c) => INVITE_ALPHABET.includes(c)).join('');
}

/** "ABCD2345" → "ABCD-2345" for display. */
export function formatInviteCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export type PeerInfo = {
  deviceId: string;
  fingerprint: string;
  online: boolean;
};

export type ChatMessage = {
  id: number;
  from: string;
  body: string;
  /** Server time, ms since epoch. */
  sentAt: number;
  /** Echoed only to the sender, to match its optimistic copy. */
  clientId?: string;
};

export type ErrorCode =
  | 'bad-request'
  | 'auth-failed'
  | 'not-authenticated'
  | 'already-paired'
  | 'not-paired'
  | 'invalid-code'
  | 'rate-limited'
  | 'replaced';

export type ServerMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'ready'; deviceId: string; fingerprint: string; peer: PeerInfo | null }
  | { type: 'invite'; code: string; expiresAt: number }
  | { type: 'paired'; peer: PeerInfo }
  | { type: 'unpaired' }
  | { type: 'history'; messages: ChatMessage[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'presence'; online: boolean }
  | { type: 'error'; code: ErrorCode; message: string };

export type ClientMessage =
  /** `publicKey`: base64 X.509 SubjectPublicKeyInfo (P-256). `signature`: base64 DER ECDSA over AUTH_CONTEXT + nonce. */
  | { type: 'auth'; publicKey: string; signature: string }
  | { type: 'create-invite' }
  | { type: 'accept-invite'; code: string }
  | { type: 'unpair' }
  | { type: 'send'; clientId: string; body: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

/** Narrows untrusted JSON to a ClientMessage, or null if it is malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'auth':
      return isString(raw.publicKey) && isString(raw.signature)
        ? { type: 'auth', publicKey: raw.publicKey, signature: raw.signature }
        : null;
    case 'create-invite':
      return { type: 'create-invite' };
    case 'accept-invite':
      return isString(raw.code) ? { type: 'accept-invite', code: raw.code } : null;
    case 'unpair':
      return { type: 'unpair' };
    case 'send':
      return isString(raw.clientId) && isString(raw.body)
        ? { type: 'send', clientId: raw.clientId, body: raw.body }
        : null;
    default:
      return null;
  }
}

/**
 * Narrows untrusted JSON to a ServerMessage. The client trusts its own server,
 * so this only checks the discriminant — it guards against protocol drift,
 * not against a hostile server.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isObject(raw) || !isString(raw.type)) return null;
  const known: ServerMessage['type'][] = [
    'challenge',
    'ready',
    'invite',
    'paired',
    'unpaired',
    'history',
    'message',
    'presence',
    'error',
  ];
  return known.includes(raw.type as ServerMessage['type']) ? (raw as ServerMessage) : null;
}

/**
 * Short, human-comparable form of a device id. Both phones show each other's
 * fingerprint after pairing, so the people holding them can confirm they
 * paired with the phone in front of them and not someone who guessed a code.
 */
export function fingerprintOf(deviceId: string): string {
  return (deviceId.slice(0, 16).toUpperCase().match(/.{1,4}/g) ?? []).join('-');
}
