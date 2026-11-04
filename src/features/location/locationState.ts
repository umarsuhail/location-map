import type { LocationObject } from 'expo-location';

export type Position = {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, when the provider reports one. */
  accuracy: number | null;
  timestamp: number;
  /** False for the cached "last known" fix shown while GPS warms up. */
  isLive: boolean;
};

export type LocationState =
  | { status: 'checking' }
  | { status: 'needs-permission' }
  | { status: 'blocked' }
  | { status: 'services-off' }
  | { status: 'locating' }
  | { status: 'ready'; position: Position }
  | { status: 'error'; message: string };

export type PermissionVerdict = 'granted' | 'ask' | 'blocked';

/**
 * Android stops showing the system dialog after the user denies twice (or picks
 * "Don't allow" with "don't ask again"). Once `canAskAgain` is false the only
 * way back is the app's page in system Settings.
 */
export function toPermissionVerdict(response: {
  granted: boolean;
  canAskAgain: boolean;
}): PermissionVerdict {
  if (response.granted) return 'granted';
  return response.canAskAgain ? 'ask' : 'blocked';
}

export function toPosition(location: LocationObject, isLive: boolean): Position {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    timestamp: location.timestamp,
    isLive,
  };
}

/**
 * A cached last-known fix is only a placeholder: it must never replace a
 * position we already have, which is either live or the same placeholder.
 */
export function applyLastKnown(prev: LocationState, lastKnown: Position): LocationState {
  if (prev.status === 'ready') return prev;
  return { status: 'ready', position: lastKnown };
}
