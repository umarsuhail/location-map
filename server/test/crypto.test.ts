import { describe, expect, it } from 'vitest';

import { derSignatureToRaw, verifySignature, base64ToBytes } from '../src/crypto';
import { createDevice, rawSignatureToDer } from './device';

describe('derSignatureToRaw', () => {
  it('round-trips coordinates that need a sign byte or are short', () => {
    const raw = new Uint8Array(64);
    raw[0] = 0xff; // r has its high bit set → DER adds a leading 0x00
    raw.fill(0x01, 1, 32);
    raw.fill(0x00, 32, 34); // s starts with zeros → DER drops them
    raw.fill(0x7f, 34, 64);
    expect(derSignatureToRaw(rawSignatureToDer(raw))).toEqual(raw);
  });

  it('rejects malformed input', () => {
    expect(derSignatureToRaw(new Uint8Array([]))).toBeNull();
    expect(derSignatureToRaw(Uint8Array.of(0x30, 0x02, 0x02, 0x00))).toBeNull();
    expect(derSignatureToRaw(Uint8Array.of(0x31, 0x00))).toBeNull();
  });
});

describe('verifySignature', () => {
  it('rejects a tampered message and garbage keys without throwing', async () => {
    const device = await createDevice();
    const spki = base64ToBytes(device.publicKey);
    const signature = base64ToBytes(await device.sign('hello'));

    expect(await verifySignature(spki, 'hello', signature)).toBe(true);
    expect(await verifySignature(spki, 'hellO', signature)).toBe(false);
    expect(await verifySignature(new Uint8Array([1, 2, 3]), 'hello', signature)).toBe(false);
  });
});
