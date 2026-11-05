import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { AUTH_CONTEXT, fingerprintOf } from '../../shared/protocol';
import { CLOSE_AUTH_FAILED, CLOSE_REPLACED } from '../src/hub';
import { createDevice, pairedClients, TestClient } from './device';

describe('device verification', () => {
  it('issues a challenge and accepts a correct signature', async () => {
    const device = await createDevice();
    const { ready } = await TestClient.connect(device);

    expect(ready.deviceId).toMatch(/^[0-9a-f]{64}$/);
    expect(ready.fingerprint).toBe(fingerprintOf(ready.deviceId));
    expect(ready.peer).toBeNull();
  });

  it('derives the same id for the same key on every connection', async () => {
    const device = await createDevice();
    const first = await TestClient.connect(device);
    const second = await TestClient.connect(device);
    expect(second.ready.deviceId).toBe(first.ready.deviceId);
  });

  it('rejects a signature made by a different key', async () => {
    const real = await createDevice();
    const impostor = await createDevice();
    const client = await TestClient.open();
    const { nonce } = await client.expect('challenge');

    client.send({ type: 'auth', publicKey: real.publicKey, signature: await impostor.sign(AUTH_CONTEXT + nonce) });

    expect(await client.expect('error')).toMatchObject({ code: 'auth-failed' });
    expect(await client.closed()).toBe(CLOSE_AUTH_FAILED);
  });

  it('rejects a signature over a different challenge (replay)', async () => {
    const device = await createDevice();
    const first = await TestClient.open();
    const { nonce: oldNonce } = await first.expect('challenge');
    const replayed = await device.sign(AUTH_CONTEXT + oldNonce);

    const second = await TestClient.open();
    await second.expect('challenge');
    second.send({ type: 'auth', publicKey: device.publicKey, signature: replayed });

    expect(await second.expect('error')).toMatchObject({ code: 'auth-failed' });
  });

  it('refuses anything before authentication', async () => {
    const client = await TestClient.open();
    await client.expect('challenge');
    client.send({ type: 'create-invite' });

    expect(await client.expect('error')).toMatchObject({ code: 'not-authenticated' });
    expect(await client.closed()).toBe(CLOSE_AUTH_FAILED);
  });

  it('keeps only the newest connection for a device', async () => {
    const device = await createDevice();
    const older = await TestClient.connect(device);
    await TestClient.connect(device);

    expect(await older.client.expect('error')).toMatchObject({ code: 'replaced' });
    expect(await older.client.closed()).toBe(CLOSE_REPLACED);
  });
});

describe('pairing', () => {
  it('pairs two phones and shows each the other’s fingerprint', async () => {
    const alice = await createDevice();
    const bob = await createDevice();
    const a = await TestClient.connect(alice);
    const b = await TestClient.connect(bob);

    a.client.send({ type: 'create-invite' });
    const invite = await a.client.expect('invite');
    expect(invite.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);

    // Typed loosely, the way a person would.
    b.client.send({ type: 'accept-invite', code: `${invite.code.slice(0, 4).toLowerCase()}-${invite.code.slice(4)}` });

    expect(await a.client.expect('paired')).toMatchObject({
      peer: { deviceId: b.ready.deviceId, fingerprint: b.ready.fingerprint, online: true },
    });
    expect(await b.client.expect('paired')).toMatchObject({
      peer: { deviceId: a.ready.deviceId, online: true },
    });
  });

  it('will not pair a third phone with either half of a pair', async () => {
    const { a, b } = await pairedClients();
    const carol = await TestClient.connect(await createDevice());

    a.send({ type: 'create-invite' });
    expect(await a.expect('error')).toMatchObject({ code: 'already-paired' });

    carol.client.send({ type: 'create-invite' });
    const { code } = await carol.client.expect('invite');
    b.send({ type: 'accept-invite', code });
    expect(await b.expect('error')).toMatchObject({ code: 'already-paired' });
  });

  it('makes an invite single-use', async () => {
    const host = await TestClient.connect(await createDevice());
    host.client.send({ type: 'create-invite' });
    const { code } = await host.client.expect('invite');

    const first = await TestClient.connect(await createDevice());
    first.client.send({ type: 'accept-invite', code });
    await first.client.expect('paired');

    const second = await TestClient.connect(await createDevice());
    second.client.send({ type: 'accept-invite', code });
    expect(await second.client.expect('error')).toMatchObject({ code: 'invalid-code' });
  });

  it('cannot accept its own invite', async () => {
    const { client } = await TestClient.connect(await createDevice());
    client.send({ type: 'create-invite' });
    const { code } = await client.expect('invite');
    client.send({ type: 'accept-invite', code });
    expect(await client.expect('error')).toMatchObject({ code: 'invalid-code' });
  });

  it('rate-limits wrong codes per device', async () => {
    const { client } = await TestClient.connect(await createDevice());
    for (let i = 0; i < 5; i++) {
      client.send({ type: 'accept-invite', code: 'ZZZZZZZZ' });
      expect(await client.expect('error')).toMatchObject({ code: 'invalid-code' });
    }
    client.send({ type: 'accept-invite', code: 'ZZZZZZZZ' });
    expect(await client.expect('error')).toMatchObject({ code: 'rate-limited' });
  });

  it('frees both phones on unpair, so each can pair again', async () => {
    const { a, b } = await pairedClients();
    b.send({ type: 'unpair' });
    await a.expect('unpaired');
    await b.expect('unpaired');

    const carol = await TestClient.connect(await createDevice());
    a.send({ type: 'create-invite' });
    const { code } = await a.expect('invite');
    carol.client.send({ type: 'accept-invite', code });
    await carol.client.expect('paired');
  });

  it('remembers the pairing across reconnects', async () => {
    const { bob, aliceId } = await pairedClients();
    const again = await TestClient.connect(bob);
    expect(again.ready.peer).toMatchObject({ deviceId: aliceId, online: true });
  });
});

describe('chat', () => {
  it('relays to the partner and echoes clientId only to the sender', async () => {
    const { a, b, aliceId } = await pairedClients();
    a.send({ type: 'send', clientId: 'c1', body: '  hello  ' });

    const echo = await a.expect('message');
    const delivered = await b.expect('message');
    expect(echo.message).toMatchObject({ from: aliceId, body: 'hello', clientId: 'c1' });
    expect(delivered.message).toMatchObject({ id: echo.message.id, from: aliceId, body: 'hello' });
    expect(delivered.message.clientId).toBeUndefined();
  });

  it('delivers history to a phone that was offline', async () => {
    const { a, b, bob } = await pairedClients();
    b.ws.close(1000);
    await a.expect('presence');

    a.send({ type: 'send', clientId: 'c1', body: 'while you were away' });
    await a.expect('message');

    const { client } = await TestClient.connect(bob);
    expect(await client.expect('history')).toMatchObject({
      messages: [{ body: 'while you were away' }],
    });
  });

  it('tells the partner when the other phone goes offline', async () => {
    const { a, b } = await pairedClients();
    b.ws.close(1000);
    expect(await a.expect('presence')).toEqual({ type: 'presence', online: false });
  });

  it('refuses empty and oversized messages', async () => {
    const { a } = await pairedClients();
    a.send({ type: 'send', clientId: 'c1', body: '   ' });
    expect(await a.expect('error')).toMatchObject({ code: 'bad-request' });
    a.send({ type: 'send', clientId: 'c2', body: 'x'.repeat(4001) });
    expect(await a.expect('error')).toMatchObject({ code: 'bad-request' });
  });

  it('refuses to send when not paired', async () => {
    const { client } = await TestClient.connect(await createDevice());
    client.send({ type: 'send', clientId: 'c1', body: 'anyone?' });
    expect(await client.expect('error')).toMatchObject({ code: 'not-paired' });
  });

  it('deletes the conversation on unpair', async () => {
    const { a, b, bob } = await pairedClients();
    a.send({ type: 'send', clientId: 'c1', body: 'secret' });
    await a.expect('message');
    await b.expect('message');
    a.send({ type: 'unpair' });
    await a.expect('unpaired');

    // Pair the same two phones again: the old conversation must be gone.
    a.send({ type: 'create-invite' });
    const { code } = await a.expect('invite');
    b.send({ type: 'accept-invite', code });
    await b.expect('unpaired');
    await b.expect('paired');
    const reconnected = await TestClient.connect(bob);
    expect(reconnected.ready.peer).not.toBeNull();
    expect(await reconnected.client.expect('history')).toEqual({ type: 'history', messages: [] });
  });
});

describe('worker routes', () => {
  it('answers health checks and rejects plain HTTP on /connect', async () => {
    expect(await (await exports.default.fetch('https://chat.test/health')).text()).toBe('ok');
    expect((await exports.default.fetch('https://chat.test/connect')).status).toBe(426);
    expect((await exports.default.fetch('https://chat.test/nope')).status).toBe(404);
  });
});
