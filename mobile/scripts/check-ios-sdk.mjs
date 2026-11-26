#!/usr/bin/env node
// Stopper et iOS-releasebyg, der linkes mod iOS 27 SDK eller nyere, mens appen ikke bruger UIScene.
// Fra iOS 27 SDK crasher en app uden UIScene-livscyklus ved opstart på iOS 27
// (EXC_BREAKPOINT i _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Build 11 blev bygget med Xcode 27.2 og afvist af App Review 19/11-2026 (Guideline 2.1(a)).
// Expo 54 / React Native 0.81 genererer en AppDelegate uden scener. plugins/with-uiscene.js (indhold i plugins/uiscene-core.js) tilføjer dem,
// men indtil det er testet på iOS 27, bygges releases med Xcode 26.x (se docs/RELEASE.md).
//
// Et manifest i Info.plist er ikke nok: peger det på en klasse, der ikke findes i det genererede
// projekt, crasher appen stadig. Derfor skal delegate-klassen også kunne findes i kildefilerne.
//
// Brug: node scripts/check-ios-sdk.mjs <sdk-version> <Info.plist som JSON> <ios/<App>-mappen>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export const FIRST_SDK_REQUIRING_SCENES = 27;

/**
 * Et tomt manifest er ikke nok: appen skal have mindst én scene-konfiguration med en delegate-klasse.
 * @param {Record<string, unknown> | null | undefined} infoPlist
 * @returns {string[]} Delegate-klassernes navne, uden `$(PRODUCT_MODULE_NAME).`-præfikset.
 */
function sceneDelegateClasses(infoPlist) {
  const manifest = infoPlist?.UIApplicationSceneManifest;
  if (typeof manifest !== 'object' || manifest === null)
    return [];
  const configs = /** @type {Record<string, unknown>} */ (manifest).UISceneConfigurations;
  if (typeof configs !== 'object' || configs === null)
    return [];
  /** @type {string[]} */
  const names = [];
  for (const roleConfigs of Object.values(configs)) {
    if (!Array.isArray(roleConfigs))
      continue;
    for (const config of roleConfigs) {
      const name = config?.UISceneDelegateClassName;
      if (typeof name === 'string' && name !== '')
        names.push(name.replace(/^.*\./, ''));
    }
  }
  return names;
}

/**
 * @param {string} source
 * @param {string} className
 */
function declaresClass(source, className) {
  // Swift: `class SceneDelegate` eller `@objc(SceneDelegate)`. Objective-C: `@implementation SceneDelegate`.
  const name = className.replaceAll(/\W/g, '');
  return new RegExp(`\\bclass\\s+${name}\\b|@implementation\\s+${name}\\b|@objc\\(${name}\\)`).test(source);
}

/**
 * @param {string} dir Appens mappe i ios/ (den med AppDelegate.swift og Info.plist).
 * @returns {string[]} Indholdet af alle Swift/Objective-C-filer i mappen.
 */
export function readNativeSources(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(file => /\.(?:swift|mm?)$/.test(file))
    .map(file => readFileSync(join(dir, file), 'utf8'));
}

/**
 * @param {string} sdkVersion Fx "26.5" fra `xcrun --sdk iphoneos --show-sdk-version`.
 * @param {Record<string, unknown>} infoPlist Appens Info.plist.
 * @param {string[]} nativeSources Indholdet af det genererede projekts Swift/Objective-C-filer.
 * @returns {string | null} En fejltekst, eller null når bygget er sikkert.
 */
export function findSdkProblem(sdkVersion, infoPlist, nativeSources) {
  const major = Number.parseInt(String(sdkVersion).trim(), 10);
  // Fejl lukket: kan versionen ikke læses, må tjekket ikke melde ok.
  if (!Number.isFinite(major))
    return `kunne ikke læse iOS SDK-versionen ("${sdkVersion}")`;
  if (major < FIRST_SDK_REQUIRING_SCENES)
    return null;
  const delegates = sceneDelegateClasses(infoPlist);
  if (delegates.length > 0) {
    const missing = delegates.filter(name => !nativeSources.some(source => declaresClass(source, name)));
    if (missing.length === 0)
      return null;
    return `Info.plist peger på scene-delegate ${missing.join(', ')}, men klassen findes ikke i det genererede iOS-projekt. `
      + `Appen crasher ved opstart på iOS ${FIRST_SDK_REQUIRING_SCENES}+. Kør prebuild igen og tjek plugins/with-uiscene.js.`;
  }
  return `iOS SDK ${sdkVersion} kræver UIScene-livscyklus, men Info.plist har ingen scene-konfiguration med UISceneDelegateClassName under UIApplicationSceneManifest. `
    + `Appen crasher ved opstart på iOS ${FIRST_SDK_REQUIRING_SCENES}+. Byg med Xcode 26.x `
    + `(DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer), se docs/RELEASE.md.`;
}

if (process.argv[1]?.endsWith('check-ios-sdk.mjs')) {
  const [sdkVersion, plistJsonPath, appDir] = process.argv.slice(2);
  if (!sdkVersion || !plistJsonPath || !appDir) {
    console.error('Brug: node scripts/check-ios-sdk.mjs <sdk-version> <Info.plist som JSON> <ios/<App>-mappen>');
    process.exit(2);
  }
  const problem = findSdkProblem(sdkVersion, JSON.parse(readFileSync(plistJsonPath, 'utf8')), readNativeSources(appDir));
  if (problem) {
    console.error(`iOS SDK: ${problem}`);
    process.exit(1);
  }
  console.log(`iOS SDK ${sdkVersion}: ok`);
}
