const path = require('node:path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withUniwindConfig } = require('uniwind/metro');
const { cacheKey } = require('./scripts/babel-direct-imports');
const { createCacheStore } = require('./scripts/metro-cache-store');

const config = getSentryExpoConfig(__dirname);

// Babel-pluginet er ikke en del af Metros cachenøgle; nøglen her er.
config.cacheVersion = `${config.cacheVersion}-${cacheKey}`;

module.exports = {
  ...withUniwindConfig(config, {
    cssEntryFile: './src/global.css',
  }),
  // Cachen ligger i projektet, så CI kan gemme den mellem kørsler (`pnpm start -c` rydder den).
  // Sættes efter withUniwindConfig, som ellers lægger sin egen FileStore i os.tmpdir().
  // Storen beholder uniwinds skipCache-vagt, så global.css aldrig genbruges fra disk.
  cacheStores: [createCacheStore(path.join(__dirname, 'node_modules/.cache/metro'))],
};
