import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCENE_DELEGATE_SWIFT } from '../plugins/uiscene-core';

import { findSdkProblem, readNativeSources } from './check-ios-sdk.mjs';

const NO_SCENES = { CFBundleIdentifier: 'dk.timetrack.app' };
const WITH_SCENES = {
  ...NO_SCENES,
  UIApplicationSceneManifest: {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        { UISceneConfigurationName: 'Default', UISceneDelegateClassName: 'SceneDelegate' },
      ],
    },
  },
};
const MODULE_QUALIFIED = {
  ...NO_SCENES,
  UIApplicationSceneManifest: {
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        { UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' },
      ],
    },
  },
};
const EMPTY_MANIFEST = { ...NO_SCENES, UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false } };
const APP_DELEGATE = 'public class AppDelegate: ExpoAppDelegate {}';
const SOURCES = [APP_DELEGATE, SCENE_DELEGATE_SWIFT];

describe('findSdkProblem', () => {
  it('godkender iOS 26 SDK uden scener (sådan blev build 10 bygget)', () => {
    expect(findSdkProblem('26.5', NO_SCENES, [APP_DELEGATE])).toBeNull();
  });

  it('afviser iOS 27 SDK uden UIApplicationSceneManifest (build 11 crashede ved opstart)', () => {
    expect(findSdkProblem('27.2', NO_SCENES, [APP_DELEGATE])).toContain('UIApplicationSceneManifest');
  });

  it('afviser også senere SDK-versioner uden scener', () => {
    expect(findSdkProblem('28.0', NO_SCENES, [APP_DELEGATE])).not.toBeNull();
  });

  it('godkender iOS 27 SDK, når scene-klassen findes i projektet', () => {
    expect(findSdkProblem('27.2', WITH_SCENES, SOURCES)).toBeNull();
  });

  it('godkender et modulkvalificeret klassenavn', () => {
    expect(findSdkProblem('27.2', MODULE_QUALIFIED, SOURCES)).toBeNull();
  });

  it('afviser iOS 27 SDK, når manifestet peger på en klasse, der ikke findes', () => {
    const problem = findSdkProblem('27.2', WITH_SCENES, [APP_DELEGATE]);
    expect(problem).toContain('SceneDelegate');
    expect(problem).toContain('findes ikke');
  });

  it('lader sig ikke narre af et klassenavn, der kun ligner', () => {
    expect(findSdkProblem('27.2', WITH_SCENES, ['class MySceneDelegateHelper {}'])).not.toBeNull();
  });

  it('afviser et tomt UIApplicationSceneManifest uden delegate-klasse', () => {
    expect(findSdkProblem('27.2', EMPTY_MANIFEST, SOURCES)).toContain('UISceneDelegateClassName');
  });

  it('kræver ikke klassen for iOS 26 SDK', () => {
    expect(findSdkProblem('26.5', WITH_SCENES, [])).toBeNull();
  });

  it('fejler lukket, når SDK-versionen ikke kan læses', () => {
    expect(findSdkProblem('', NO_SCENES, [])).toContain('kunne ikke læse');
  });
});

describe('readNativeSources', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-ios-sdk-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('læser Swift- og Objective-C-filer, også i undermapper, og ignorerer resten', () => {
    mkdirSync(join(dir, 'Supporting'));
    writeFileSync(join(dir, 'SceneDelegate.swift'), 'class SceneDelegate {}');
    writeFileSync(join(dir, 'Supporting', 'Legacy.m'), '@implementation LegacyDelegate');
    writeFileSync(join(dir, 'Info.plist'), 'class NotSource {}');
    const sources = readNativeSources(dir);
    expect(sources).toHaveLength(2);
    expect(findSdkProblem('27.2', WITH_SCENES, sources)).toBeNull();
  });
});
