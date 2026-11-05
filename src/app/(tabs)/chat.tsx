import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Conversation } from '@/components/chat/Conversation';
import { PairingView } from '@/components/chat/PairingView';
import { StatusPanel } from '@/components/StatusPanel';
import { useChat } from '@/features/chat/useChat';

export default function ChatScreen() {
  const chat = useChat();
  const { state } = chat;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Body chat={chat} />
      {state.me && state.connection === 'offline' && (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>Offline — reconnecting…</Text>
        </View>
      )}
      {state.error && (
        <Pressable style={[styles.banner, styles.errorBanner]} onPress={chat.dismissError} accessibilityRole="alert">
          <Text style={styles.bannerText}>{state.error.message}</Text>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function Body({ chat }: { chat: ReturnType<typeof useChat> }) {
  const { state } = chat;

  switch (state.connection) {
    case 'unconfigured':
      return (
        <StatusPanel
          title="Chat server not set"
          body="This build has no chat server address. Set the CHAT_SERVER_URL repository variable and rebuild."
        />
      );
    case 'unsupported':
      return (
        <StatusPanel
          title="Chat needs the Android app"
          body="Device verification uses this phone's hardware keystore, which only the installed APK can reach."
        />
      );
    case 'auth-failed':
      return (
        <StatusPanel
          title="This phone couldn't be verified"
          body="The server rejected this device's signature."
          action={{ label: 'Try again', onPress: chat.reconnect }}
        />
      );
    case 'replaced':
      return (
        <StatusPanel
          title="Chat opened elsewhere"
          body="This phone connected again from another session, so this one was closed."
          action={{ label: 'Reconnect here', onPress: chat.reconnect }}
        />
      );
  }

  if (!state.me) return <StatusPanel busy title="Connecting…" body="Verifying this phone with the server." />;

  if (!state.peer) {
    return (
      <PairingView
        fingerprint={state.me.fingerprint}
        invite={state.invite}
        online={state.connection === 'online'}
        onCreateInvite={chat.createInvite}
        onAcceptInvite={chat.acceptInvite}
      />
    );
  }

  return (
    <Conversation
      myId={state.me.deviceId}
      peer={state.peer}
      messages={state.messages}
      canSend={state.connection === 'online'}
      onSend={chat.sendMessage}
      onRetry={chat.retry}
      onUnpair={chat.unpair}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F3F5' },
  banner: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#5F6B73',
    elevation: 4,
  },
  errorBanner: { backgroundColor: '#E5484D' },
  bannerText: { flex: 1, color: '#fff', fontSize: 14 },
  dismiss: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
