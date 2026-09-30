// Signs release builds with the maintainer's own key when CI provides one (see docs/RELEASING.md).
// Without WINGLET_KEYSTORE_PATH a release build falls back to the public debug key, which is only
// acceptable for throwaway test builds; the release workflow refuses to publish those.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (System.getenv('WINGLET_KEYSTORE_PATH')) {
                storeFile file(System.getenv('WINGLET_KEYSTORE_PATH'))
                storePassword System.getenv('WINGLET_KEYSTORE_PASSWORD')
                keyAlias System.getenv('WINGLET_KEY_ALIAS')
                keyPassword System.getenv('WINGLET_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes("System.getenv('WINGLET_KEYSTORE_PATH')")) return cfg;
    const signingConfigs = /signingConfigs\s*\{/;
    const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!signingConfigs.test(gradle) || !releaseBuildType.test(gradle)) {
      throw new Error('withReleaseSigning: unexpected android/app/build.gradle layout');
    }
    gradle = gradle.replace(signingConfigs, (m) => `${m}${RELEASE_CONFIG}`);
    gradle = gradle.replace(
      releaseBuildType,
      "$1signingConfig System.getenv('WINGLET_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
