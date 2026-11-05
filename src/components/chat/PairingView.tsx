import { formatInviteCode, INVITE_CODE_LENGTH, normalizeInviteCode } from '@shared/protocol';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ACCENT_COLOR } from '@/config/map';

type Props = {
  fingerprint: string;
  invite: { code: string; expiresAt: number } | null;
  online: boolean;
  onCreateInvite(): void;
  onAcceptInvite(code: string): void;
};

/** Seconds left until `expiresAt`, ticking once a second. */
function useSecondsLeft(expiresAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function PairingView({ fingerprint, invite, online, onCreateInvite, onAcceptInvite }: Props) {
  const [typed, setTyped] = useState('');
  const code = normalizeInviteCode(typed);
  const secondsLeft = useSecondsLeft(invite?.expiresAt ?? null);
  const inviteLive = invite !== null && secondsLeft > 0;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Pair with one phone</Text>
      <Text style={styles.body}>
        This phone can be paired with exactly one other phone. One of you shows a code, the other enters it.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Show a code</Text>
        {inviteLive ? (
          <>
            <Text style={styles.code} selectable accessibilityLabel={`Pairing code ${invite.code.split('').join(' ')}`}>
              {formatInviteCode(invite.code)}
            </Text>
            <Text style={styles.hint}>
              Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} · waiting for the
              other phone…
            </Text>
            <Pressable onPress={() => Clipboard.setStringAsync(invite.code)} accessibilityRole="button">
              <Text style={styles.link}>Copy code</Text>
            </Pressable>
          </>
        ) : (
          <Button label={invite ? 'Code expired — get a new one' : 'Get a pairing code'} onPress={onCreateInvite} disabled={!online} />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Enter a code</Text>
        <TextInput
          style={styles.input}
          value={typed}
          onChangeText={setTyped}
          placeholder="ABCD-2345"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={INVITE_CODE_LENGTH + 2}
          returnKeyType="go"
          onSubmitEditing={() => code.length === INVITE_CODE_LENGTH && onAcceptInvite(code)}
          accessibilityLabel="Pairing code from the other phone"
        />
        <Button
          label="Pair"
          onPress={() => onAcceptInvite(code)}
          disabled={!online || code.length !== INVITE_CODE_LENGTH}
        />
      </View>

      <Text style={styles.fingerprint}>This phone’s ID: {fingerprint}</Text>
    </ScrollView>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#11181C' },
  body: { fontSize: 15, lineHeight: 21, color: '#5F6B73' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12, elevation: 2 },
  label: { fontSize: 13, fontWeight: '600', color: '#5F6B73', textTransform: 'uppercase', letterSpacing: 0.6 },
  code: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: '#11181C',
    fontVariant: ['tabular-nums'],
  },
  hint: { fontSize: 13, color: '#5F6B73', textAlign: 'center' },
  link: { fontSize: 15, fontWeight: '600', color: ACCENT_COLOR, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#D0D7DE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 22,
    letterSpacing: 3,
    textAlign: 'center',
    color: '#11181C',
  },
  button: { backgroundColor: ACCENT_COLOR, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fingerprint: { fontSize: 12, color: '#8A949B', textAlign: 'center', fontVariant: ['tabular-nums'] },
});
