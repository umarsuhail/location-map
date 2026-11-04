/**
 * OpenFreeMap serves OpenStreetMap vector tiles with no API key and no usage
 * limits. Any MapLibre style URL works here (MapTiler, Stadia, self-hosted).
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Street level — close enough to see which building you are in. */
export const USER_ZOOM = 16;

/** Shown only until the first fix arrives: the whole world. */
export const WORLD_VIEW = { center: [0, 20] as [number, number], zoom: 1 };

export const PIN_COLOR = '#E5484D';
export const ACCENT_COLOR = '#0B6BCB';
