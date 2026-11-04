import {
  Camera,
  type CameraRef,
  type LngLat,
  Map as MapView,
  Marker,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationPin } from '@/components/LocationPin';
import { ACCENT_COLOR, MAP_STYLE_URL, USER_ZOOM, WORLD_VIEW } from '@/config/map';
import type { Position } from '@/features/location/locationState';

type Props = {
  /** Null while there is no fix yet; the map shows the world until one arrives. */
  position: Position | null;
};

/**
 * Follows the user until they pan the map themselves, then stays put until
 * they tap "My location".
 */
export function LocationMap({ position }: Props) {
  const camera = useRef<CameraRef>(null);
  const [following, setFollowing] = useState(true);
  const hasCentered = useRef(false);
  const insets = useSafeAreaInsets();

  const lngLat: LngLat | null = position ? [position.longitude, position.latitude] : null;

  useEffect(() => {
    if (!lngLat || !following) return;
    if (!hasCentered.current) {
      camera.current?.flyTo({ center: lngLat, zoom: USER_ZOOM, duration: 1200 });
      hasCentered.current = true;
    } else {
      camera.current?.easeTo({ center: lngLat, duration: 500 });
    }
    // lngLat is a fresh array each render; depend on its values instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lngLat?.[0], lngLat?.[1], following]);

  const onRegionWillChange = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    if (event.nativeEvent.userInteraction) setFollowing(false);
  };

  // Re-enter follow mode through the effect's first-fix path, so a single
  // animation both re-centres and restores street-level zoom.
  const recenter = () => {
    hasCentered.current = false;
    setFollowing(true);
  };

  return (
    <View style={styles.fill}>
      <MapView
        style={styles.fill}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        attribution
        compass
        onRegionWillChange={onRegionWillChange}
      >
        <Camera ref={camera} initialViewState={WORLD_VIEW} />
        {lngLat && position && (
          <Marker id="me" lngLat={lngLat} anchor="bottom">
            <LocationPin dimmed={!position.isLive} />
          </Marker>
        )}
      </MapView>

      {position && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <View style={styles.card}>
            <Text style={styles.coords} selectable>
              {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
            </Text>
            <Text style={styles.meta}>
              {position.isLive
                ? position.accuracy != null
                  ? `Accurate to ±${Math.round(position.accuracy)} m`
                  : 'Live'
                : 'Last known position — getting a GPS fix…'}
            </Text>
          </View>
          {!following && (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              onPress={recenter}
              accessibilityRole="button"
              accessibilityLabel="Center the map on my location"
            >
              <Text style={styles.buttonText}>My location</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    gap: 10,
    alignItems: 'stretch',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    elevation: 3,
  },
  coords: {
    fontSize: 17,
    fontWeight: '600',
    color: '#11181C',
    fontVariant: ['tabular-nums'],
  },
  meta: {
    marginTop: 2,
    fontSize: 13,
    color: '#5F6B73',
  },
  button: {
    alignSelf: 'flex-end',
    backgroundColor: ACCENT_COLOR,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    elevation: 3,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
