import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useCurrentLocation } from '../useCurrentLocation';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
}));

const mocked = jest.mocked(Location);

const permission = (granted: boolean, canAskAgain = true) =>
  ({ granted, canAskAgain, status: granted ? 'granted' : 'denied', expires: 'never' }) as never;

const location = (latitude: number) =>
  ({ coords: { latitude, longitude: 10, accuracy: 5 }, timestamp: Date.now() }) as never;

let emit: (loc: unknown) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mocked.hasServicesEnabledAsync.mockResolvedValue(true);
  mocked.getLastKnownPositionAsync.mockResolvedValue(null);
  mocked.watchPositionAsync.mockImplementation(async (_options, callback) => {
    emit = callback as typeof emit;
    return { remove };
  });
});

it('asks for permission on first launch, then shows the live fix', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  mocked.requestForegroundPermissionsAsync.mockResolvedValue(permission(true));

  const { result } = await renderHook(() => useCurrentLocation());

  await waitFor(() => expect(result.current.state.status).toBe('locating'));
  expect(mocked.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

  await act(async () => emit(location(25)));
  expect(result.current.state).toMatchObject({
    status: 'ready',
    position: { latitude: 25, isLive: true },
  });
});

it('reports a denial it can still recover from', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  mocked.requestForegroundPermissionsAsync.mockResolvedValue(permission(false));

  const { result } = await renderHook(() => useCurrentLocation());

  await waitFor(() => expect(result.current.state.status).toBe('needs-permission'));
  expect(mocked.watchPositionAsync).not.toHaveBeenCalled();
});

it('does not prompt when Android has blocked the dialog', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(false, false));

  const { result } = await renderHook(() => useCurrentLocation());

  await waitFor(() => expect(result.current.state.status).toBe('blocked'));
  expect(mocked.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

it('detects location services being switched off', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
  mocked.hasServicesEnabledAsync.mockResolvedValue(false);

  const { result } = await renderHook(() => useCurrentLocation());

  await waitFor(() => expect(result.current.state.status).toBe('services-off'));
});

it('shows the last known position until GPS answers', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
  mocked.getLastKnownPositionAsync.mockResolvedValue(location(1));

  const { result } = await renderHook(() => useCurrentLocation());

  await waitFor(() =>
    expect(result.current.state).toMatchObject({ status: 'ready', position: { isLive: false } }),
  );

  await act(async () => emit(location(2)));
  expect(result.current.state).toMatchObject({ position: { latitude: 2, isLive: true } });
});

it('stops watching when unmounted', async () => {
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(true));

  const { unmount } = await renderHook(() => useCurrentLocation());
  await waitFor(() => expect(mocked.watchPositionAsync).toHaveBeenCalled());

  await unmount();
  expect(remove).toHaveBeenCalled();
});
