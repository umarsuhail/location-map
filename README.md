# Location Map

An Android app with two tabs:

- **Map:** a map with your current location pinned on it.
- **Chat:** a private chat with exactly one other phone. Pairing ties the two physical phones together, and the server checks which phone it's talking to on every connection.

It is built with Expo (React Native) and uses native views rather than a WebView. You install it from an APK like any other app.

## Get the APK

Every push runs **Actions → Android APK**:

1. Open the latest run and download the **location-map-apk** artifact (a zip containing the `.apk`).
2. Copy the `.apk` to your phone and open it. Android asks you to allow
   *Install unknown apps* for whichever app opened it (Files, Chrome, …).
3. Open **Location Map** and allow location *while using the app*.

To publish a downloadable release, push a tag: `git tag v1.0.0 && git push --tags`.
The APK is then attached to a GitHub Release.

The APK targets real phones (`armeabi-v7a`, `arm64-v8a`). It does not include x86 emulator builds.

## Signing

If the signing secrets below are not set, CI signs the APK with the template's **public debug key** and warns you about it.
That is fine for trying the app. Before you share it, set up your own upload key:

```bash
keytool -genkeypair -v -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 \
  -keystore upload.jks -alias upload
base64 -w0 upload.jks   # macOS: base64 -i upload.jks
```

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 output |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | key password |

Back up `upload.jks` and its passwords somewhere safe. Android only installs an update over an existing install if the update is signed with the same key.
Switching from the debug key to your own key therefore means uninstalling the app once.

## Chat server

Chat goes through a small WebSocket server in `server/`, a Cloudflare Worker with one Durable Object.
Until the server is deployed and its address is baked into a build, the Chat tab shows *Chat server not set*.

1. **Cloudflare credentials.** In the Cloudflare dashboard, create an API token from the *Edit Cloudflare Workers* template and copy your Account ID.
   Add both under **Settings → Secrets and variables → Actions → Secrets** as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. **Deploy.** Run **Actions → Android APK → Run workflow**. The server also redeploys on every push to `main`.
   The *deploy-server* log prints the URL, `https://location-map-chat.<your-subdomain>.workers.dev`.
3. **Point the app at it.** Under **Settings → Secrets and variables → Actions → Variables**, add `CHAT_SERVER_URL` set to that URL with `wss://` in place of `https://`.
   Every APK built after that has chat enabled.

To run the server locally: `cd server && npm ci && npm run dev`, then put `EXPO_PUBLIC_CHAT_URL=ws://<your-computer's-LAN-IP>:8787` in `.env.local`.

### Pairing and device verification

Android has not let apps read the Wi-Fi or Bluetooth MAC address since Android 6. Apps get `02:00:00:00:00:00`, and Android 10+ also randomises the Wi-Fi MAC for each network.
A MAC address can also be faked, so it can't prove which phone is talking.
Each phone proves its identity with a key instead:

- On first use the app creates a P-256 key pair inside **Android Keystore** (`modules/device-key`, Kotlin).
  The private key can sign but can never be read out, by the app or by anyone else.
- A phone's **device ID** is the SHA-256 of its public key. Nobody can claim an ID without holding the matching private key.
- **Every connection** starts with a random challenge from the server. The phone signs it in the keystore, and the server checks the signature before accepting anything else.
  A signature can't be reused for a second connection, and a different key can't pass.
- **Pairing.** One phone shows an 8-character code (31⁸ possibilities, valid for 5 minutes, single-use), and the other enters it.
  The server pairs them only if *neither* is already paired. Pairing a third phone means unpairing first, and unpairing frees both phones and deletes the conversation.
- **Check the IDs.** After pairing, each phone shows the other's ID (for example `3F9A-…`). Compare them in person to be sure you paired with the phone in front of you.
- Each device has one live connection. If it connects again, the old connection is closed.

**Reinstalling the app or clearing its data deletes the key, so that phone becomes a new device.**
Its partner will show it as *away* indefinitely. Tap **Unpair** on the partner phone, then pair again.

Messages are stored on the server, at most the last 500 per pair, until either phone unpairs.
They are protected in transit by TLS, but are not end-to-end encrypted.

## How it works

```
src/
  app/                      Expo Router routes (each file is a screen)
    _layout.tsx
    (tabs)/_layout.tsx      native Material bottom tabs
    (tabs)/index.tsx        map screen + status overlay per location state
    (tabs)/chat.tsx         chat: connecting → pairing → conversation
  features/location/
    locationState.ts        pure state model (unit-tested)
    useCurrentLocation.ts   permission → services → watcher, re-synced on resume
  features/chat/
    ChatConnection.ts       WebSocket: challenge-response auth, keepalive, backoff
    chatState.ts            pure reducer: optimistic sends, retry, history merge
    useChat.ts              wires both to the app's foreground/background
  components/               LocationMap, LocationPin, StatusPanel, chat/*
  config/                   map style, chat server URL
modules/device-key/         Kotlin Expo module: Android Keystore key + signing
shared/protocol.ts          wire protocol, imported by both app and server
server/                     Cloudflare Worker + Durable Object (pairing, relay)
plugins/
  withReleaseSigning.js     injects the release signing config at prebuild
```

- **Map:** [MapLibre React Native](https://github.com/maplibre/maplibre-react-native) with
  [OpenFreeMap](https://openfreemap.org) OpenStreetMap tiles. It needs no API key and has no billing.
  You can switch to any MapLibre style URL in `src/config/map.ts`.
- **Location:** `expo-location`, foreground only, so no background-location prompt.
  The hook works through these states: `checking`, `needs-permission`, `blocked` (Android stopped asking), `services-off`, `locating`, `ready` and `error`.
  Each non-ready state has its own recovery action. The app shows the last known position (pin dimmed) until a live GPS fix arrives.
- **Camera:** the map follows you until you pan it yourself. After that, **My location** re-centres it.
- **Native project:** `android/` is generated by `expo prebuild` and is not committed.
  Configure native behaviour in `app.json` or in a config plugin.

## Develop

```bash
npm install
npm run typecheck && npm run lint && npm test
(cd server && npm ci && npm run typecheck && npm test)   # runs in the real Workers runtime
npx expo run:android      # needs Android Studio / SDK and a device or emulator
npm run build:apk         # local release APK → android/app/build/outputs/apk/release/
```

Expo Go cannot run this app because MapLibre and the device-key module include native code.
Use `npx expo run:android`, or install a CI-built APK.
