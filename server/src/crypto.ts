// Device identity. A device is its P-256 public key: the id is the SHA-256 of
// the key, so nobody can claim an id without holding the matching private
// key, which on the phone never leaves the hardware keystore.

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const COORDINATE_BYTES = 32;

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function deviceIdOf(publicKeySpki: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', publicKeySpki));
}

/**
 * Android's SHA256withECDSA emits an ASN.1 DER signature,
 * SEQUENCE { INTEGER r, INTEGER s }, while WebCrypto verifies the fixed-width
 * r‖s form. Each INTEGER may carry a leading 0x00 (to stay positive) or be
 * shorter than 32 bytes, so both are normalised to exactly 32.
 */
export function derSignatureToRaw(der: Uint8Array): Uint8Array | null {
  let offset = 0;
  const readLength = (): number | null => {
    const first = der[offset++];
    if (first === undefined) return null;
    if (first < 0x80) return first;
    const count = first & 0x7f;
    if (count !== 1) return null; // P-256 signatures never need more
    const length = der[offset++];
    return length === undefined ? null : length;
  };
  const readInteger = (): Uint8Array | null => {
    if (der[offset++] !== 0x02) return null;
    const length = readLength();
    if (length === null || length === 0 || offset + length > der.length) return null;
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > COORDINATE_BYTES && value[0] === 0) value = value.subarray(1);
    if (value.length > COORDINATE_BYTES) return null;
    const padded = new Uint8Array(COORDINATE_BYTES);
    padded.set(value, COORDINATE_BYTES - value.length);
    return padded;
  };

  if (der[offset++] !== 0x30) return null;
  const sequenceLength = readLength();
  if (sequenceLength === null || offset + sequenceLength !== der.length) return null;
  const r = readInteger();
  const s = readInteger();
  if (!r || !s || offset !== der.length) return null;

  const raw = new Uint8Array(COORDINATE_BYTES * 2);
  raw.set(r, 0);
  raw.set(s, COORDINATE_BYTES);
  return raw;
}

/** True only for a well-formed P-256 key and a valid signature over `message`. */
export async function verifySignature(
  publicKeySpki: Uint8Array,
  message: string,
  derSignature: Uint8Array,
): Promise<boolean> {
  const raw = derSignatureToRaw(derSignature);
  if (!raw) return false;
  try {
    const key = await crypto.subtle.importKey('spki', publicKeySpki, ECDSA_P256, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      raw,
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}
