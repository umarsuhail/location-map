import { type ChatState, chatReducer, initialChatState } from '../chatState';

const peer = { deviceId: 'b'.repeat(64), fingerprint: 'BBBB-BBBB-BBBB-BBBB', online: true };
const me = { deviceId: 'a'.repeat(64), fingerprint: 'AAAA-AAAA-AAAA-AAAA' };

const paired = (): ChatState =>
  chatReducer(initialChatState('online'), { type: 'server', message: { type: 'ready', ...me, peer } });

const sendLocal = (state: ChatState, clientId: string, body = 'hi') =>
  chatReducer(state, { type: 'local-send', clientId, body, from: me.deviceId, at: 1000 });

describe('chatReducer', () => {
  it('replaces an optimistic message with the server-confirmed one', () => {
    let state = sendLocal(paired(), 'c1');
    expect(state.messages[0]).toMatchObject({ pending: true });

    state = chatReducer(state, {
      type: 'server',
      message: { type: 'message', message: { id: 7, from: me.deviceId, body: 'hi', sentAt: 2000, clientId: 'c1' } },
    });
    expect(state.messages).toEqual([{ id: 7, from: me.deviceId, body: 'hi', sentAt: 2000, clientId: 'c1' }]);
  });

  it('ignores a message it already has', () => {
    const msg = { id: 3, from: peer.deviceId, body: 'yo', sentAt: 1 };
    let state = chatReducer(paired(), { type: 'server', message: { type: 'message', message: msg } });
    state = chatReducer(state, { type: 'server', message: { type: 'message', message: msg } });
    expect(state.messages).toHaveLength(1);
  });

  it('marks in-flight messages failed when the connection drops, and retry re-arms them', () => {
    let state = sendLocal(paired(), 'c1');
    state = chatReducer(state, { type: 'connection', status: 'offline' });
    expect(state.messages[0]).toMatchObject({ pending: false, failed: true });

    state = chatReducer(state, { type: 'retry', clientId: 'c1' });
    expect(state.messages[0]).toMatchObject({ pending: true, failed: false });
  });

  it('keeps unsent drafts across a reconnect, after the server history', () => {
    let state = sendLocal(paired(), 'c1', 'draft');
    state = chatReducer(state, { type: 'connection', status: 'offline' });
    state = chatReducer(state, { type: 'server', message: { type: 'ready', ...me, peer } });
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'history', messages: [{ id: 1, from: peer.deviceId, body: 'earlier', sentAt: 1 }] },
    });
    expect(state.messages.map((m) => m.body)).toEqual(['earlier', 'draft']);
  });

  it('clears the conversation on unpair and on a new pairing', () => {
    let state = chatReducer(paired(), {
      type: 'server',
      message: { type: 'message', message: { id: 1, from: peer.deviceId, body: 'x', sentAt: 1 } },
    });
    state = chatReducer(state, { type: 'server', message: { type: 'unpaired' } });
    expect(state.peer).toBeNull();
    expect(state.messages).toEqual([]);
  });

  it('tracks partner presence', () => {
    const state = chatReducer(paired(), { type: 'server', message: { type: 'presence', online: false } });
    expect(state.peer?.online).toBe(false);
  });

  it('drops a live invite when the connection drops (the code may have expired meanwhile)', () => {
    let state = chatReducer(initialChatState('online'), {
      type: 'server',
      message: { type: 'invite', code: 'ABCD2345', expiresAt: 9 },
    });
    state = chatReducer(state, { type: 'connection', status: 'offline' });
    expect(state.invite).toBeNull();
  });
});
