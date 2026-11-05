import { requireOptionalNativeModule } from 'expo';

export type SecurityLevel = 'strongbox' | 'tee' | 'software' | 'unknown';

type DeviceKeyNative = {
  getPublicKey(): Promise<string>;
  sign(message: string): Promise<string>;
  getSecurityLevel(): Promise<SecurityLevel>;
};

// Null where the native side is not compiled in (iOS, web, Jest).
const native = requireOptionalNativeModule<DeviceKeyNative>('DeviceKey');

export const isDeviceKeyAvailable = native !== null;

function required(): DeviceKeyNative {
  if (!native) throw new Error('The device key is only available in the Android app build.');
  return native;
}

/** Base64 X.509 SubjectPublicKeyInfo of this phone's P-256 key (created on first call). */
export const getPublicKey = () => required().getPublicKey();

/** Base64 DER ECDSA-SHA256 signature, made inside the phone's keystore. */
export const sign = (message: string) => required().sign(message);

export const getSecurityLevel = () => required().getSecurityLevel();
