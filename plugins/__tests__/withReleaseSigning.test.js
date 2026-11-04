const { patch } = require('../withReleaseSigning');

const TEMPLATE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

it('adds a release signing config and uses it only for release builds', () => {
  const out = patch(TEMPLATE);

  expect(out).toContain("storeFile file(findProperty('LOCATIONMAP_STORE_FILE'))");
  expect(out).toMatch(
    /release \{[^]*signingConfig findProperty\('LOCATIONMAP_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/,
  );
  expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
});

it('is idempotent across repeated prebuilds', () => {
  const once = patch(TEMPLATE);
  expect(patch(once)).toBe(once);
});

it('fails loudly if the template changes shape', () => {
  expect(() => patch('android { }')).toThrow(/no longer matches/);
});
