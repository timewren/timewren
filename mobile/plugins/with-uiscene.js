// Flytter iOS-appen over på UIScene-livscyklussen, så den kan bygges med iOS 27 SDK.
// Selve indholdet (Info.plist-manifest, AppDelegate-rettelse og SceneDelegate.swift) står i
// uiscene-core.js, så det kan testes uden Expos config-plugin-runtime. Forklaring: se dér.
const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const {
  SCENE_DELEGATE_CLASS,
  SCENE_DELEGATE_SWIFT,
  applySceneManifest,
  patchAppDelegate,
} = require('./uiscene-core');

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    applySceneManifest(cfg.modResults);
    return cfg;
  });
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withSceneDelegateFile(config) {
  return withXcodeProject(config, (cfg) => {
    const { projectName, platformProjectRoot } = cfg.modRequest;
    if (!projectName)
      throw new Error('with-uiscene: kunne ikke finde Xcode-projektets navn');
    const relative = `${projectName}/${SCENE_DELEGATE_CLASS}.swift`;
    fs.writeFileSync(path.join(platformProjectRoot, relative), SCENE_DELEGATE_SWIFT);
    if (!cfg.modResults.hasFile(relative)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relative,
        groupName: projectName,
        project: cfg.modResults,
      });
    }
    // xcode-biblioteket skriver `explicitFileType = undefined`, som overstyrer lastKnownFileType.
    for (const ref of Object.values(cfg.modResults.pbxFileReferenceSection())) {
      if (ref && typeof ref === 'object' && String(ref.path).replaceAll('"', '') === relative && 'explicitFileType' in ref && [undefined, 'undefined'].includes(ref.explicitFileType))
        delete ref.explicitFileType;
    }
    return cfg;
  });
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withAppDelegateStart(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const { projectName, platformProjectRoot } = cfg.modRequest;
      if (!projectName)
        throw new Error('with-uiscene: kunne ikke finde Xcode-projektets navn');
      const file = path.join(platformProjectRoot, projectName, 'AppDelegate.swift');
      fs.writeFileSync(file, patchAppDelegate(fs.readFileSync(file, 'utf8')));
      return cfg;
    },
  ]);
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withUIScene(config) {
  return withAppDelegateStart(withSceneDelegateFile(withSceneManifest(config)));
}

module.exports = withUIScene;
