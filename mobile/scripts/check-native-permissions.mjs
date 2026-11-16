#!/usr/bin/env node
// Tjekker de native tilladelser, som production-konfigurationen giver appen, mod en tilladt liste.
// Expos automatiske config-plugins lægger ellers engelske standardtekster ind for kamera,
// mikrofon og Face ID, som appen ikke bruger (App Store 5.1.1), og React Natives skabelon
// tilføjer SYSTEM_ALERT_WINDOW på Android. Kører `expo config --type introspect` (ingen prebuild).
//
// Dækker Info.plist og app-manifestet, som config-plugins skriver. Tilladelser, som biblioteker
// fletter ind ved Gradle-byg (fx BILLING fra expo-iap), ses først i den byggede AAB.
import { execFileSync } from 'node:child_process';
import process from 'node:process';

// Kun disse formålstekster må stå i Info.plist, og de skal være skrevet til appen.
const ALLOWED_IOS_USAGE = new Set(['NSPhotoLibraryUsageDescription']);
// Tilladelser appen ikke må bede om (ubrugte eller med Play-erklæringskrav).
const FORBIDDEN_ANDROID = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_CALL_LOG',
];

/**
 * @param {any} config Resultatet af `expo config --type introspect --json`.
 * @returns {string[]}
 */
export function findProblems(config) {
  const problems = [];
  const mod = config._internal?.modResults ?? {};
  // Fejl lukket: ændrer Expo strukturen, må tjekket ikke melde ok uden at have set noget.
  if (!mod.ios?.infoPlist || !mod.android?.manifest?.manifest)
    return ['introspektionen gav ingen modResults for Info.plist/manifest (har Expo ændret formatet?)'];
  const plist = mod.ios?.infoPlist ?? config.ios?.infoPlist ?? {};
  for (const [key, value] of Object.entries(plist)) {
    if (!/^NS\w+UsageDescription$/.test(key))
      continue;
    if (!ALLOWED_IOS_USAGE.has(key))
      problems.push(`iOS: ${key} er sat ("${value}"), men appen bruger ikke funktionen`);
    else if (typeof value !== 'string' || value.includes('$(PRODUCT_NAME)') || value.startsWith('Allow '))
      problems.push(`iOS: ${key} har en generisk standardtekst ("${value}")`);
  }
  const permissions = (mod.android?.manifest?.manifest?.['uses-permission'] ?? [])
    .map((/** @type {{ $?: Record<string, string> }} */ p) => p.$ ?? {})
    .filter((/** @type {Record<string, string>} */ p) => p['tools:node'] !== 'remove')
    .map((/** @type {Record<string, string>} */ p) => p['android:name']);
  for (const name of permissions) {
    if (FORBIDDEN_ANDROID.includes(name) || name.startsWith('android.permission.FOREGROUND_SERVICE'))
      problems.push(`Android: ${name} er med i manifestet`);
  }
  return problems;
}

function introspect() {
  const env = {
    ...process.env,
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'https://app.timetrack.dk',
    APP_BUILD_NUMBER: process.env.APP_BUILD_NUMBER ?? '1',
  };
  const out = execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

// Kun når filen køres direkte (ikke når testen importerer findProblems).
if (process.argv[1]?.endsWith('check-native-permissions.mjs')) {
  const problems = findProblems(introspect());
  if (problems.length > 0) {
    console.error(`Native tilladelser: ${problems.length} problem(er)\n${problems.map(p => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Native tilladelser: ok (Info.plist og app-manifest)');
}
