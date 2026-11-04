import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCENT_COLOR } from '@/config/map';

type Props = {
  title: string;
  body?: string;
  busy?: boolean;
  action?: { label: string; onPress: () => void };
};

/** Floating card over the map for every state that is not "here you are". */
export function StatusPanel({ title, body, busy = false, action }: Props) {
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.card} accessibilityLiveRegion="polite">
        {busy && <ActivityIndicator color={ACCENT_COLOR} style={styles.spinner} />}
        <Text style={styles.title}>{title}</Text>
        {body && <Text style={styles.body}>{body}</Text>}
        {action && (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={action.onPress}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    elevation: 6,
  },
  spinner: {
    marginBottom: 12,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#11181C',
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: '#5F6B73',
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    backgroundColor: ACCENT_COLOR,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
