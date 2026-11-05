import type { ChatMessage, ErrorCode, PeerInfo, ServerMessage } from '@shared/protocol';

export type ConnectionStatus =
  | 'unconfigured' // no server URL in this build
  | 'unsupported' // no device key (not the Android build)
  | 'connecting'
  | 'online'
  | 'offline' // dropped; reconnecting on its own
  | 'auth-failed' // the server rejected this device's signature
  | 'replaced'; // this device connected again from another socket

export type DisplayMessage = ChatMessage & {
  /** Sent locally, not yet confirmed by the server. */
  pending?: boolean;
  /** The connection dropped before the server confirmed it. */
  failed?: boolean;
};

export type ChatState = {
  connection: ConnectionStatus;
  me: { deviceId: string; fingerprint: string } | null;
  peer: PeerInfo | null;
  invite: { code: string; expiresAt: number } | null;
  messages: DisplayMessage[];
  error: { code: ErrorCode; message: string } | null;
};

export type ChatAction =
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'server'; message: ServerMessage }
  | { type: 'local-send'; clientId: string; body: string; from: string; at: number }
  | { type: 'send-failed'; clientId: string }
  | { type: 'retry'; clientId: string }
  | { type: 'dismiss-error' };

export const initialChatState = (connection: ConnectionStatus): ChatState => ({
  connection,
  me: null,
  peer: null,
  invite: null,
  messages: [],
  error: null,
});

const isUnconfirmed = (m: DisplayMessage) => m.pending || m.failed;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'connection': {
      if (action.status === 'online') return { ...state, connection: 'online' };
      // Anything still in flight on the old socket is lost; let the user retry it.
      const messages = state.messages.map((m) => (m.pending ? { ...m, pending: false, failed: true } : m));
      return { ...state, connection: action.status, messages, invite: null };
    }
    case 'local-send':
      return {
        ...state,
        messages: [
          ...state.messages,
          // Local placeholder; the server's id replaces it on confirmation.
          { id: -action.at, from: action.from, body: action.body, sentAt: action.at, clientId: action.clientId, pending: true },
        ],
      };
    case 'send-failed':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.clientId === action.clientId ? { ...m, pending: false, failed: true } : m,
        ),
      };
    case 'retry':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.clientId === action.clientId && m.failed ? { ...m, failed: false, pending: true } : m,
        ),
      };
    case 'dismiss-error':
      return { ...state, error: null };
    case 'server':
      return applyServerMessage(state, action.message);
  }
}

function applyServerMessage(state: ChatState, message: ServerMessage): ChatState {
  switch (message.type) {
    case 'challenge':
      return state;
    case 'ready':
      return {
        ...state,
        me: { deviceId: message.deviceId, fingerprint: message.fingerprint },
        peer: message.peer,
        invite: null,
        // Confirmed history follows in a 'history' frame; keep unsent drafts.
        messages: message.peer ? state.messages.filter(isUnconfirmed) : [],
      };
    case 'history': {
      const confirmed = new Set(message.messages.map((m) => m.id));
      return {
        ...state,
        messages: [...message.messages, ...state.messages.filter((m) => isUnconfirmed(m) && !confirmed.has(m.id))],
      };
    }
    case 'message': {
      const incoming = message.message;
      if (state.messages.some((m) => m.id === incoming.id)) return state;
      const mine = incoming.clientId
        ? state.messages.findIndex((m) => m.clientId === incoming.clientId)
        : -1;
      if (mine === -1) return { ...state, messages: [...state.messages, incoming] };
      const messages = [...state.messages];
      messages[mine] = incoming;
      return { ...state, messages };
    }
    case 'invite':
      return { ...state, invite: { code: message.code, expiresAt: message.expiresAt } };
    case 'paired':
      return { ...state, peer: message.peer, invite: null, messages: [], error: null };
    case 'unpaired':
      return { ...state, peer: null, messages: [] };
    case 'presence':
      return state.peer ? { ...state, peer: { ...state.peer, online: message.online } } : state;
    case 'error':
      return { ...state, error: { code: message.code, message: message.message } };
  }
}
