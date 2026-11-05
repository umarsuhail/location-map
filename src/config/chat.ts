/**
 * The deployed chat server, e.g. "wss://location-map-chat.<you>.workers.dev".
 * Baked in at build time: set the CHAT_SERVER_URL repository variable for CI
 * builds, or EXPO_PUBLIC_CHAT_URL in a local .env file.
 */
export const CHAT_SERVER_URL = process.env.EXPO_PUBLIC_CHAT_URL?.trim() || null;
