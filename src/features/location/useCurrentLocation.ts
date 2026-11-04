import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import {
  applyLastKnown,
  type LocationState,
  toPermissionVerdict,
  toPosition,
} from './locationState';

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 2000,
  distanceInterval: 5,
};

// Older than this and the cached fix is more misleading than helpful.
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: 'checking' });
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const syncing = useRef(false);
  const mounted = useRef(true);

  const stopWatching = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
  }, []);

  /**
   * Brings the hook in line with the device: permission, location services,
   * and the position watcher. Safe to call repeatedly — it is what runs on
   * launch and every time the app returns to the foreground (e.g. back from
   * Settings).
   */
  const sync = useCallback(
    async ({ request }: { request: boolean }) => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && request && permission.canAskAgain) {
          permission = await Location.requestForegroundPermissionsAsync();
        }

        const verdict = toPermissionVerdict(permission);
        if (verdict !== 'granted') {
          stopWatching();
          setState({ status: verdict === 'ask' ? 'needs-permission' : 'blocked' });
          return;
        }

        if (!(await Location.hasServicesEnabledAsync())) {
          stopWatching();
          setState({ status: 'services-off' });
          return;
        }

        if (subscription.current) return;

        setState((prev) => (prev.status === 'ready' ? prev : { status: 'locating' }));

        const watcher = await Location.watchPositionAsync(
          WATCH_OPTIONS,
          (location) => setState({ status: 'ready', position: toPosition(location, true) }),
          (message) => setState({ status: 'error', message }),
        );
        if (!mounted.current) {
          watcher.remove();
          return;
        }
        subscription.current = watcher;

        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
        });
        if (lastKnown && mounted.current) {
          setState((prev) => applyLastKnown(prev, toPosition(lastKnown, false)));
        }
      } catch (error) {
        if (mounted.current) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        syncing.current = false;
      }
    },
    [stopWatching],
  );

  useEffect(() => {
    mounted.current = true;
    // sync() only sets state after awaiting the OS, so nothing renders
    // synchronously here; the rule cannot see past the function call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sync({ request: true });

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') sync({ request: false });
    });

    return () => {
      mounted.current = false;
      appState.remove();
      stopWatching();
    };
  }, [sync, stopWatching]);

  const requestPermission = useCallback(() => sync({ request: true }), [sync]);

  const openSettings = useCallback(() => Linking.openSettings(), []);

  /** Shows Android's "turn on location" dialog; declining it throws. */
  const enableServices = useCallback(async () => {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      return;
    }
    await sync({ request: false });
  }, [sync]);

  const retry = useCallback(() => {
    stopWatching();
    return sync({ request: false });
  }, [stopWatching, sync]);

  return { state, requestPermission, openSettings, enableServices, retry };
}
