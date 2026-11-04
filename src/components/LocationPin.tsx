import { StyleSheet, View } from 'react-native';

import { PIN_COLOR } from '@/config/map';

const SIZE = 34;
// The head is a square rotated 45° with one sharp corner pointing down. Rotated,
// it spans a full diagonal each way, so it sits centred in a box that size: the
// box never clips it, and the down-pointing tip lands on the bottom edge —
// anchor the marker "bottom".
const BOX = Math.ceil(SIZE * Math.SQRT2);

export function LocationPin({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <View style={[styles.wrap, dimmed && styles.dimmed]} pointerEvents="none">
      <View style={styles.head}>
        <View style={styles.dot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: BOX,
    height: BOX,
  },
  dimmed: {
    opacity: 0.55,
  },
  head: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderBottomRightRadius: 0,
    backgroundColor: PIN_COLOR,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  dot: {
    width: SIZE * 0.36,
    height: SIZE * 0.36,
    borderRadius: SIZE * 0.18,
    backgroundColor: '#fff',
  },
});
