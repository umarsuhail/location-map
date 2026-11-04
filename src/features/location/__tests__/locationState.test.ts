import type { LocationObject } from 'expo-location';

import { applyLastKnown, toPermissionVerdict, toPosition, type Position } from '../locationState';

const fix = (overrides: Partial<Position> = {}): Position => ({
  latitude: 25.2,
  longitude: 55.27,
  accuracy: 8,
  timestamp: 1,
  isLive: true,
  ...overrides,
});

describe('toPermissionVerdict', () => {
  it('is granted when the OS says so', () => {
    expect(toPermissionVerdict({ granted: true, canAskAgain: true })).toBe('granted');
  });

  it('can ask again after a single denial', () => {
    expect(toPermissionVerdict({ granted: false, canAskAgain: true })).toBe('ask');
  });

  it('is blocked once Android stops showing the dialog', () => {
    expect(toPermissionVerdict({ granted: false, canAskAgain: false })).toBe('blocked');
  });
});

describe('toPosition', () => {
  const location = {
    coords: {
      latitude: 1,
      longitude: 2,
      accuracy: null,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: 42,
  } as LocationObject;

  it('keeps coordinates and maps a missing accuracy to null', () => {
    expect(toPosition(location, false)).toEqual({
      latitude: 1,
      longitude: 2,
      accuracy: null,
      timestamp: 42,
      isLive: false,
    });
  });
});

describe('applyLastKnown', () => {
  const cached = fix({ isLive: false, latitude: 0 });

  it('shows the cached fix while still locating', () => {
    expect(applyLastKnown({ status: 'locating' }, cached)).toEqual({
      status: 'ready',
      position: cached,
    });
  });

  it('never replaces a live fix that arrived first', () => {
    const live = { status: 'ready' as const, position: fix() };
    expect(applyLastKnown(live, cached)).toBe(live);
  });
});
