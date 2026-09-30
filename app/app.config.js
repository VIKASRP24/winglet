// app.json holds the static config; this layer stamps the release version from CI and adds the
// release-signing plugin. WINGLET_VERSION is the tag without the "v" (e.g. 0.1.2).
module.exports = ({ config }) => {
  const version = process.env.WINGLET_VERSION || config.version;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`WINGLET_VERSION must look like 1.2.3, got "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error('minor and patch must be below 100 to keep versionCode monotonic');
  return {
    ...config,
    version,
    android: { ...config.android, versionCode: major * 10000 + minor * 100 + patch },
    plugins: [...(config.plugins ?? []), './plugins/withReleaseSigning'],
  };
};
