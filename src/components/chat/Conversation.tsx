import type { PeerInfo } from '@shared/protocol';
import { MAX_MESSAGE_LENGTH } from '@shared/protocol';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ACCENT_COLOR } from '@/config/map';
import type { DisplayMessage } from '@/features/chat/chatState';

type Props = {
  myId: string;
  peer: PeerInfo;
  messages: DisplayMessage[];
  canSend: boolean;
  onSend(body: string): void;
  onRetry(clientId: string): void;
  onUnpair(): void;
};

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Conversation({ myId, peer, messages, canSend, onSend, onRetry, onUnpair }: Props) {
  const [draft, setDraft] = useState('');
  // Inverted list: newest first, so it opens scrolled to the latest message.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);

  const confirmUnpair = () =>
    Alert.alert(
      'Unpair this phone?',
      'Both phones are unpaired and the conversation is deleted for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpair', style: 'destructive', onPress: onUnpair },
      ],
    );

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <View style={styles.header}>
        <View style={[styles.dot, peer.online ? styles.online : styles.away]} />
        <View style={styles.fill}>
          <Text style={styles.headerTitle}>{peer.online ? 'Paired phone · online' : 'Paired phone · away'}</Text>
          <Text style={styles.headerSub} selectable>
            ID {peer.fingerprint}
          </Text>
        </View>
        <Pressable onPress={confirmUnpair} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.unpair}>Unpair</Text>
        </Pressable>
      </View>

      <FlatList
        style={styles.fill}
        contentContainerStyle={styles.list}
        inverted
        data={newestFirst}
        keyExtractor={(m) => m.clientId ?? String(m.id)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>
            Paired. Check that the ID above matches the one on the other phone, then say hello.
          </Text>
        }
        renderItem={({ item }) => {
          const mine = item.from === myId;
          return (
            <Pressable
              disabled={!item.failed}
              onPress={() => item.clientId && onRetry(item.clientId)}
              style={[styles.bubble, mine ? styles.mine : styles.theirs]}
              accessibilityHint={item.failed ? 'Double tap to send again' : undefined}
            >
              <Text style={mine ? styles.mineText : styles.theirsText}>{item.body}</Text>
              <Text style={[styles.meta, mine && styles.mineMeta]}>
                {item.failed ? 'Not sent · tap to retry' : item.pending ? 'Sending…' : timeOf(item.sentAt)}
              </Text>
            </Pressable>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={canSend ? 'Message' : 'Reconnecting…'}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          accessibilityLabel="Message"
        />
        <Pressable
          style={({ pressed }) => [styles.send, (!canSend || !draft.trim()) && styles.disabled, pressed && styles.pressed]}
          onPress={submit}
          disabled={!canSend || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D0D7DE',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  online: { backgroundColor: '#30A46C' },
  away: { backgroundColor: '#B0B7BD' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#11181C' },
  headerSub: { fontSize: 12, color: '#5F6B73', fontVariant: ['tabular-nums'] },
  unpair: { fontSize: 15, fontWeight: '600', color: '#E5484D' },
  list: { padding: 12, gap: 6 },
  empty: {
    fontSize: 14,
    color: '#5F6B73',
    textAlign: 'center',
    paddingHorizontal: 24,
    // The list is inverted, so flip the placeholder back upright.
    transform: [{ scaleY: -1 }],
  },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: ACCENT_COLOR, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  mineText: { fontSize: 16, color: '#fff' },
  theirsText: { fontSize: 16, color: '#11181C' },
  meta: { fontSize: 11, marginTop: 2, color: '#8A949B', alignSelf: 'flex-end' },
  mineMeta: { color: 'rgba(255,255,255,0.75)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D0D7DE',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 20,
    backgroundColor: '#F1F3F5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#11181C',
  },
  send: { backgroundColor: ACCENT_COLOR, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
