import { LocationMap } from '@/components/LocationMap';
import { StatusPanel } from '@/components/StatusPanel';
import type { LocationState } from '@/features/location/locationState';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';

export default function MapScreen() {
  const { state, requestPermission, openSettings, enableServices, retry } = useCurrentLocation();

  return (
    <>
      <LocationMap position={state.status === 'ready' ? state.position : null} />
      <StatusOverlay
        state={state}
        requestPermission={requestPermission}
        openSettings={openSettings}
        enableServices={enableServices}
        retry={retry}
      />
    </>
  );
}

type OverlayProps = Omit<ReturnType<typeof useCurrentLocation>, 'state'> & {
  state: LocationState;
};

function StatusOverlay({ state, requestPermission, openSettings, enableServices, retry }: OverlayProps) {
  switch (state.status) {
    case 'ready':
      return null;
    case 'checking':
      return <StatusPanel busy title="Checking location access…" />;
    case 'locating':
      return (
        <StatusPanel
          busy
          title="Finding you…"
          body="Getting a GPS fix. This is quicker near a window or outdoors."
        />
      );
    case 'needs-permission':
      return (
        <StatusPanel
          title="Location is off for this app"
          body="Allow location access so the map can pin where you are."
          action={{ label: 'Allow location', onPress: requestPermission }}
        />
      );
    case 'blocked':
      return (
        <StatusPanel
          title="Location access is blocked"
          body="Android won't ask again. Open Settings → Permissions → Location and choose “Allow only while using the app”."
          action={{ label: 'Open Settings', onPress: openSettings }}
        />
      );
    case 'services-off':
      return (
        <StatusPanel
          title="Your phone's location is turned off"
          body="Turn on location services to find where you are."
          action={{ label: 'Turn on location', onPress: enableServices }}
        />
      );
    case 'error':
      return (
        <StatusPanel
          title="Couldn't get your location"
          body={state.message}
          action={{ label: 'Try again', onPress: retry }}
        />
      );
  }
}
