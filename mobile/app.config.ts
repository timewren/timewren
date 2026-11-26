import type { ConfigContext, ExpoConfig } from '@expo/config';

import type { AppIconBadgeConfig } from 'app-icon-badge/types';

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/cjs';

// adding lint exception as we need to import tsx/cjs before env.ts is imported
// eslint-disable-next-line perfectionist/sort-imports
import Env, { timewren } from './env';

const isTimeWren = process.env.APP_VARIANT === 'timewren';
const asset = (name: string) => `./assets/${isTimeWren ? 'timewren/' : ''}${name}.png`;
const primaryColor = isTimeWren ? timewren.primaryColor : '#3B82F6';
// TimeWren bruger en lys flade bag mærket; TimeTrack bruger primærfarven.
const surfaceColor = isTimeWren ? timewren.backgroundColor : primaryColor;

function getGoogleServicesFile(projectRoot: string): string | undefined {
  const variable = isTimeWren ? 'GOOGLE_SERVICES_JSON_TIMEWREN' : 'GOOGLE_SERVICES_JSON';
  const stage = Env.EXPO_PUBLIC_APP_ENV;
  const variant = isTimeWren ? 'timewren' : stage === 'production' ? 'timetrack' : stage;
  const localFile = `./credentials/google-services.${variant}.json`;
  const easFile = process.env[variable];
  if (easFile && statSync(resolve(projectRoot, easFile), { throwIfNoEntry: false })?.isFile())
    return easFile;
  if (statSync(resolve(projectRoot, localFile), { throwIfNoEntry: false })?.isFile())
    return localFile;
  console.warn(`[Firebase] Android-push er ikke konfigureret for ${Env.EXPO_PUBLIC_PACKAGE}. Sæt ${variable} eller tilføj ${localFile}.`);
}

// ---------------------------------------------------------------------------
// Store-udgivelse — hvad Mads skal udfylde (se docs/STORE-CHECKLIST.md):
//
// EXPO_ACCOUNT_OWNER  Expo-kontoens brugernavn (efter `eas login` + `eas init`).
// EAS_PROJECT_ID      UUID fra `eas init` — uden det kan EAS ikke bygge/submitte.
// APP_BUILD_NUMBER    Heltal der bumpes ved HVER upload til App Store Connect /
//                     Play Console (bruges som ios.buildNumber og
//                     android.versionCode). Versionsnummeret (1.0.0) kommer fra
//                     package.json — bump det ved brugervendte releases.
//                     Styring er LOKAL (eas.json: appVersionSource "local"), så
//                     tallene i denne fil er sandheden, ikke EAS-serverne.
//
// Bevidst UDELADT indtil web-repoet serverer de tilhørende filer:
//   ios.associatedDomains  (kræver https://app.timetrack.dk/.well-known/apple-app-site-association)
//   android.intentFilters  (kræver https://app.timetrack.dk/.well-known/assetlinks.json)
// Deep links via schemet `timetrack://` virker uden dem (magic link håndteres i
// src/lib/auth/deep-link). Universal/App Links er en opfølgning i checklisten.
// ---------------------------------------------------------------------------
const EXPO_ACCOUNT_OWNER = process.env.EXPO_ACCOUNT_OWNER ?? 'mahoje';
const EAS_PROJECT_ID = isTimeWren ? (process.env.TIMEWREN_EAS_PROJECT_ID ?? '') : (process.env.EAS_PROJECT_ID ?? '9804ef2f-ca55-4c0d-8de0-7e6819344e55');
const APPLE_TEAM_ID = 'P7698GU4AV';

const APP_BUILD_NUMBER = Number.parseInt(process.env.APP_BUILD_NUMBER ?? '1', 10);
if (!Number.isInteger(APP_BUILD_NUMBER) || APP_BUILD_NUMBER < 1)
  throw new Error(`APP_BUILD_NUMBER skal være et positivt heltal, fik "${process.env.APP_BUILD_NUMBER}"`);
if (Env.EXPO_PUBLIC_APP_ENV === 'production' && !process.env.APP_BUILD_NUMBER)
  console.warn('⚠️  APP_BUILD_NUMBER er ikke sat — production-build får buildNumber/versionCode 1');

const appIconBadgeConfig: AppIconBadgeConfig = {
  enabled: Env.EXPO_PUBLIC_APP_ENV !== 'production',
  badges: [
    {
      text: Env.EXPO_PUBLIC_APP_ENV,
      type: 'banner',
      color: 'white',
    },
    {
      text: Env.EXPO_PUBLIC_VERSION.toString(),
      type: 'ribbon',
      color: 'white',
    },
  ],
};

// Sentry: config-pluginet uploader source maps ved release-builds og kræver
// SENTRY_ORG + SENTRY_PROJECT (+ SENTRY_AUTH_TOKEN i miljøet). Uden dem
// udelades pluginet — appen rapporterer stadig crashes hvis EXPO_PUBLIC_SENTRY_DSN er sat.
const SENTRY_ORG = process.env.SENTRY_ORG ?? '';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT ?? '';
const sentryPlugin: NonNullable<ExpoConfig['plugins']> = SENTRY_ORG && SENTRY_PROJECT
  ? [['@sentry/react-native/expo', { organization: SENTRY_ORG, project: SENTRY_PROJECT }]]
  : [];

const plugins: ExpoConfig['plugins'] = [
  ...sentryPlugin,
  // Xcode 27 (EAS latest) afviser pods med deployment target under 15.
  './plugins/with-pods-deployment-target',
  // iOS 27 SDK kræver UIScene-livscyklus (se plugins/with-uiscene.js).
  './plugins/with-uiscene',
  [
    'expo-build-properties',
    {
      android: {
        ...(isTimeWren ? { usesCleartextTraffic: true } : {}),
        // Mindre app: R8 fjerner ubrugt Java/Kotlin-kode og -ressourcer i release-builds.
        enableProguardInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        // Kun sideload-APK'en (eas profil "apk"): komprimér .so-filer, så filen man sender
        // er mindst mulig. Play-AAB'en lader dem være ukomprimerede (Googles anbefaling).
        useLegacyPackaging: process.env.APK_COMPRESS_NATIVE_LIBS === '1',
      },
    },
  ],
  [
    'expo-splash-screen',
    {
      backgroundColor: surfaceColor,
      image: asset('splash-icon'),
      imageWidth: 160,
      dark: isTimeWren
        ? { backgroundColor: timewren.darkColor, image: asset('splash-icon-dark') }
        : { backgroundColor: '#1E3A8A' },
    },
  ],
  [
    'expo-font',
    {
      ios: {
        fonts: [
          'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
          'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
          'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
        ],
      },
      android: {
        fonts: [
          {
            fontFamily: 'Inter',
            fontDefinitions: [
              {
                path: 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
                weight: 400,
              },
              {
                path: 'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
                weight: 500,
              },
              {
                path: 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
                weight: 600,
              },
              {
                path: 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
                weight: 700,
              },
            ],
          },
        ],
      },
    },
  ],
  'expo-apple-authentication',
  // Køb i appen (StoreKit 2 og Play Billing). Serveren verificerer købene selv.
  'expo-iap',
  // Explicit, ellers lægger Expos automatiske plugins engelske standardtekster ind for kamera,
  // mikrofon og Face ID ("Allow $(PRODUCT_NAME) to access…"), som appen ikke bruger. Ubrugte og
  // generiske formålstekster er en klassisk afvisning (App Store 5.1.1). false fjerner nøglen
  // (og på Android CAMERA/RECORD_AUDIO). Tjekkes af scripts/check-native-permissions.mjs.
  [
    'expo-image-picker',
    {
      photosPermission: 'Vælg et billede fra dit fotobibliotek for at vedhæfte det på en opgave.',
      cameraPermission: false,
      microphonePermission: false,
    },
  ],
  'expo-localization',
  'expo-router',
  ['expo-secure-store', { faceIDPermission: false }],
  'expo-web-browser',
  [
    'expo-notifications',
    {
      icon: asset('notification-icon'),
      color: primaryColor,
      defaultChannel: 'default',
    },
  ],
  ['app-icon-badge', appIconBadgeConfig],
];

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => ({
  ...config,
  name: Env.EXPO_PUBLIC_NAME,
  description: isTimeWren ? 'TimeWren' : 'TimeTrack — tidsregistrering, klippekort og fravær for freelancere, teams og virksomheder',
  ...(EXPO_ACCOUNT_OWNER ? { owner: EXPO_ACCOUNT_OWNER } : {}),
  scheme: Env.EXPO_PUBLIC_SCHEME,
  slug: isTimeWren ? 'timewren' : 'timetrack',
  version: Env.EXPO_PUBLIC_VERSION.toString(),
  orientation: 'portrait',
  icon: asset('icon'),
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  // Systemtekster pr. sprog (iOS InfoPlist.strings). Dansk står i infoPlist
  // nedenfor og er standard; Android har ingen egne permission-tekster.
  locales: {
    en: { ios: { NSPhotoLibraryUsageDescription: 'Choose a picture from your photo library to attach it to a task.' } },
    de: { ios: { NSPhotoLibraryUsageDescription: 'Wähle ein Bild aus deiner Fotomediathek, um es an eine Aufgabe anzuhängen.' } },
    es: { ios: { NSPhotoLibraryUsageDescription: 'Elige una imagen de tu fototeca para adjuntarla a una tarea.' } },
  },
  // Ingen OTA-opdateringer før der findes et EAS-projekt (expo-updates er ikke
  // installeret). Slå til ved at installere expo-updates, sætte enabled: true og
  // url: `https://u.expo.dev/${EAS_PROJECT_ID}` — runtimeVersion-politikken
  // "appVersion" betyder at hver package.json-version er sin egen runtime, så en
  // OTA aldrig rammer en native-inkompatibel binær.
  updates: {
    enabled: false,
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
  assetBundlePatterns: ['**/*'],
  ios: {
    // iPad understøttes (universal app). Store-krav: iPad-screenshots (13") og
    // et layout der ikke knækker på brede skærme — se docs/STORE-CHECKLIST.md.
    supportsTablet: true,
    // Sign in with Apple (entitlement com.apple.developer.applesignin)
    usesAppleSignIn: true,
    bundleIdentifier: Env.EXPO_PUBLIC_BUNDLE_ID,
    buildNumber: String(APP_BUILD_NUMBER),
    appleTeamId: APPLE_TEAM_ID,
    infoPlist: {
      ...(isTimeWren ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true } } : {}),
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDevelopmentRegion: 'da',
      CFBundleLocalizations: ['da', 'en', 'de', 'es'],
      UIBackgroundModes: ['remote-notification'],
      // NSPhotoLibraryUsageDescription sættes af expo-image-picker-pluginet ovenfor
      // (billeder fra et kundebesøg vedhæftes en opgave; kun fotobiblioteket).
      // Ingen andre NS*UsageDescription: appen bruger hverken kamera, lokation,
      // mikrofon, kontakter eller Face ID. Push-tilladelse har ingen plist-tekst
      // (iOS viser sin egen dialog). Tilføj KUN en usage description når et
      // modul der kræver den tages i brug — tomme/ubrugte tekster afvises i review.
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
    },
  },
  experiments: {
    typedRoutes: true,
  },
  android: {
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: asset('adaptive-icon'),
      ...(isTimeWren ? { monochromeImage: asset('adaptive-icon-monochrome') } : {}),
      backgroundColor: surfaceColor,
    },
    package: Env.EXPO_PUBLIC_PACKAGE,
    googleServicesFile: getGoogleServicesFile(projectRoot),
    versionCode: APP_BUILD_NUMBER,
    // Session-cookie ligger i SecureStore/Keystore — den må ikke ende i
    // Google-backup af app-data.
    allowBackup: false,
    // react-native-keyboard-controller forventer adjustResize.
    softwareKeyboardLayoutMode: 'resize',
    permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE'],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      // Kommer fra React Natives skabelon (dev-menuens overlay); release-appen tegner ikke over andre apps.
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  web: {
    favicon: asset('favicon'),
    bundler: 'metro',
  },
  plugins,
  extra: {
    ...(isTimeWren ? { timewren } : {}),
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
