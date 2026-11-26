import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { findSdkProblem } from '../scripts/check-ios-sdk.mjs';

import {
  applySceneManifest,
  patchAppDelegate,
  SCENE_DELEGATE_CLASS,
  SCENE_DELEGATE_SWIFT,
} from './uiscene-core';

// Expo-skabelonens rigtige AppDelegate, så en Expo-opgradering, der ændrer blokken, bryder testen.
const templatePath = createRequire(__filename).resolve('expo/template.tgz');
const templateAppDelegate = execFileSync(
  'tar',
  ['-xzOf', templatePath, 'package/ios/HelloWorld/AppDelegate.swift'],
  { encoding: 'utf8' },
);

describe('uiscene-core', () => {
  describe('applySceneManifest', () => {
    it('tilføjer scene-manifestet med SceneDelegate', () => {
      const plist = applySceneManifest({ CFBundleIdentifier: 'dk.timetrack.app' });
      expect(plist).toMatchSnapshot();
    });

    it('består SDK-tjekket for iOS 27, som en prebuild uden pluginet ikke gør', () => {
      expect(findSdkProblem('27.2', { CFBundleIdentifier: 'dk.timetrack.app' }, [])).not.toBeNull();
      expect(findSdkProblem('27.2', applySceneManifest({ CFBundleIdentifier: 'dk.timetrack.app' }), [SCENE_DELEGATE_SWIFT])).toBeNull();
    });

    it('overskriver et eksisterende manifest i stedet for at lægge en ekstra scene til', () => {
      const once = applySceneManifest({});
      const twice = applySceneManifest(structuredClone(once));
      expect(twice).toEqual(once);
    });
  });

  describe('patchAppDelegate', () => {
    it('fjerner startReactNative men beholder vinduet i Expo 54-skabelonens AppDelegate', () => {
      expect(templateAppDelegate).toContain('factory.startReactNative(');
      const patched = patchAppDelegate(templateAppDelegate);
      expect(patched).not.toContain('startReactNative');
      // expo-dev-launcher laver fatalError i didFinishLaunching, hvis AppDelegate ikke har et vindue.
      expect(patched).toContain('window = UIWindow(frame');
      // Factory'en skal stadig oprettes og bindes, for SceneDelegate henter den derfra.
      expect(patched).toContain('reactNativeFactory = factory');
      expect(patched).toContain('bindReactNativeFactory(factory)');
      expect(patched).toMatchSnapshot();
    });

    it('er idempotent', () => {
      const once = patchAppDelegate(templateAppDelegate);
      expect(patchAppDelegate(once)).toBe(once);
    });

    it('fejler højlydt, når skabelonen ikke har den forventede blok', () => {
      expect(() => patchAppDelegate('class AppDelegate {}')).toThrow('with-uiscene');
    });
  });

  describe('sceneDelegate.swift', () => {
    it('har samme klassenavn som Info.plist peger på og videresender links og scene-faser', () => {
      const plist = applySceneManifest({}) as {
        UIApplicationSceneManifest: { UISceneConfigurations: Record<string, { UISceneDelegateClassName: string }[]> };
      };
      const [config] = plist.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication!;
      expect(config!.UISceneDelegateClassName).toBe(SCENE_DELEGATE_CLASS);
      expect(SCENE_DELEGATE_SWIFT).toContain(`@objc(${SCENE_DELEGATE_CLASS})`);
      for (const call of [
        'scene(_ scene: UIScene, openURLContexts',
        'scene(_ scene: UIScene, continue userActivity',
        'RCTLinkingManager.application(application, open:',
        'RCTLinkingManager.application(application, continue:',
        'sceneDidBecomeActive',
        'sceneWillResignActive',
        'sceneWillEnterForeground',
        'sceneDidEnterBackground',
      ]) {
        expect(SCENE_DELEGATE_SWIFT).toContain(call);
      }
    });

    it('genbruger AppDelegate-vinduet og videresender links ved genforbundet scene', () => {
      expect(SCENE_DELEGATE_SWIFT).toContain('appDelegate.window ?? UIWindow(windowScene: windowScene)');
      expect(SCENE_DELEGATE_SWIFT).toContain('window.rootViewController == nil');
      expect(SCENE_DELEGATE_SWIFT).toContain('self.scene(scene, openURLContexts: connectionOptions.urlContexts)');
      expect(SCENE_DELEGATE_SWIFT).toContain('self.scene(scene, continue: activity)');
    });

    it('matcher snapshot', () => {
      expect(SCENE_DELEGATE_SWIFT).toMatchSnapshot();
    });
  });
});
