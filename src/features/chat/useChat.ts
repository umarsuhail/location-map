import * as DeviceKey from 'device-key';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { CHAT_SERVER_URL } from '@/config/chat';

import { ChatConnection } from './ChatConnection';
import { chatReducer, type ConnectionStatus, initialChatState } from './chatState';

function unavailableStatus(): ConnectionStatus | null {
  if (!CHAT_SERVER_URL) return 'unconfigured';
  if (!DeviceKey.isDeviceKeyAvailable) return 'unsupported';
  return null;
}

/**
 * Chat with the paired phone. Connected while the app is in the foreground;
 * the server keeps messages for the partner while either side is away.
 */
export function useChat() {
  const blocked = unavailableStatus();
  const [state, dispatch] = useReducer(chatReducer, blocked ?? 'connecting', initialChatState);
  const connection = useRef<ChatConnection | null>(null);
  // Bodies of unconfirmed messages, for retrying with the same clientId.
  const outbox = useRef(new Map<string, string>());

  useEffect(() => {
    if (blocked || !CHAT_SERVER_URL) return;
    const conn = new ChatConnection(CHAT_SERVER_URL, DeviceKey, {
      onStatus: (status) => dispatch({ type: 'connection', status }),
      onMessage: (message) => {
        if (message.type === 'message' && message.message.clientId) {
          outbox.current.delete(message.message.clientId);
        }
        dispatch({ type: 'server', message });
      },
    });
    connection.current = conn;
    conn.start();

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') conn.start();
      else if (next === 'background') conn.stop();
    });
    return () => {
      appState.remove();
      conn.stop();
      connection.current = null;
    };
  }, [blocked]);

  const send = useCallback((message: Parameters<ChatConnection['send']>[0]) => {
    return connection.current?.send(message) ?? false;
  }, []);

  const sendMessage = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!text || !state.me) return;
      const clientId = randomUUID();
      outbox.current.set(clientId, text);
      dispatch({ type: 'local-send', clientId, body: text, from: state.me.deviceId, at: Date.now() });
      if (!send({ type: 'send', clientId, body: text })) dispatch({ type: 'send-failed', clientId });
    },
    [send, state.me],
  );

  const retry = useCallback(
    (clientId: string) => {
      const body = outbox.current.get(clientId);
      if (!body) return;
      dispatch({ type: 'retry', clientId });
      if (!send({ type: 'send', clientId, body })) dispatch({ type: 'send-failed', clientId });
    },
    [send],
  );

  return {
    state,
    sendMessage,
    retry,
    createInvite: useCallback(() => send({ type: 'create-invite' }), [send]),
    acceptInvite: useCallback((code: string) => send({ type: 'accept-invite', code }), [send]),
    unpair: useCallback(() => send({ type: 'unpair' }), [send]),
    dismissError: useCallback(() => dispatch({ type: 'dismiss-error' }), []),
    reconnect: useCallback(() => {
      connection.current?.stop();
      connection.current?.start();
    }, []),
  };
}
