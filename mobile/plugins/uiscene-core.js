// Flytter iOS-appen over på UIScene-livscyklussen, så den kan bygges med iOS 27 SDK.
// Fra iOS 27 SDK crasher en app uden scener ved opstart (build 11, Guideline 2.1(a)).
//
// Expo SDK 54 / React Native 0.81 har ingen scene-understøttelse: ExpoAppDelegate og
// RCTReactNativeFactory opretter vinduet i AppDelegate. Expo har først scene-runtime fra SDK 57.0.23
// (expo/expo#50191, opt-in) og som standard i SDK 58 (expo/expo#46733). Indtil appen opgraderes
// gør dette plugin det samme i lille format:
//   1. Info.plist får UIApplicationSceneManifest med SceneDelegate.
//   2. AppDelegate.swift starter ikke længere React Native; den bygger factory'en og beholder et
//      tomt vindue, som expo-dev-launcher kræver i didFinishLaunching (Debug-builds).
//   3. SceneDelegate.swift knytter vinduet til scenen, starter React Native og videresender URL'er,
//      universal links og scene-faserne til RCTLinkingManager og Expos subscribere.
// Fjern pluginet, når Expo-SDK'en har scene-understøttelse (og tjek da AppDelegate-skabelonen).

const SCENE_DELEGATE_CLASS = 'SceneDelegate';
const SCENE_CONFIGURATION_NAME = 'Default Configuration';
const APP_DELEGATE_MARKER = '// with-uiscene: React Native startes i SceneDelegate';

// Blokken i Expo 54-skabelonens AppDelegate, der opretter vinduet og starter React Native.
const APP_DELEGATE_START_BLOCK = /([ \t]*#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n)\s*factory\.startReactNative\([^)]*\)\s*\n(\s*#endif[ \t]*\n)/;

const SCENE_DELEGATE_SWIFT = `import Expo
import ExpoModulesCore
import React
import UIKit

// Genereret af plugins/with-uiscene.js. Ret ikke i hånden: næste prebuild overskriver filen.
@objc(${SCENE_DELEGATE_CLASS})
public class ${SCENE_DELEGATE_CLASS}: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      fatalError("SceneDelegate: AppDelegate har ikke oprettet React Native-factory'en")
    }

    // Vinduet fra AppDelegate genbruges (expo-dev-launcher får det i didFinishLaunching og lægger
    // sin rodvisning i det); det knyttes nu til scenen.
    let window = appDelegate.window ?? UIWindow(windowScene: windowScene)
    window.windowScene = windowScene
    self.window = window
    appDelegate.window = window

    if window.rootViewController == nil {
      factory.startReactNative(
        withModuleName: "main",
        in: window,
        launchOptions: Self.launchOptions(from: connectionOptions))
    } else {
      // Scenen genforbindes (eller dev launcher ejer opstarten): React Native kører allerede og
      // læser ikke launchOptions igen, så links i connectionOptions sendes som almindelige links.
      window.makeKeyAndVisible()
      if !connectionOptions.urlContexts.isEmpty {
        self.scene(scene, openURLContexts: connectionOptions.urlContexts)
      }
      for activity in connectionOptions.userActivities where activity.activityType == NSUserActivityTypeBrowsingWeb {
        self.scene(scene, continue: activity)
      }
    }
  }

  // MARK: - Links

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    let application = UIApplication.shared
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      let handled = ExpoAppDelegateSubscriberManager.application(application, open: context.url, options: options)
      if !handled {
        _ = RCTLinkingManager.application(application, open: context.url, options: options)
      }
    }
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    let application = UIApplication.shared
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: { _ in })
    _ = ExpoAppDelegateSubscriberManager.application(application, continue: userActivity, restorationHandler: { _ in }) || result
  }

  // MARK: - Scene-faser (AppState og Expo-subscribere)
  // Med scener kalder UIKit ikke længere AppDelegate's applicationDidBecomeActive m.fl.
  // UIApplication-notifikationerne, som React Natives AppState lytter på, udløses stadig.

  public func sceneDidBecomeActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(UIApplication.shared)
  }

  public func sceneWillResignActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(UIApplication.shared)
  }

  public func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(UIApplication.shared)
  }

  public func sceneDidEnterBackground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(UIApplication.shared)
  }

  // MARK: - Hjælpere

  /// Oversætter scenens opstartsmuligheder til de launchOptions, AppDelegate ellers ville have fået.
  /// Et link, der kold-starter appen, ligger i connectionOptions og ikke i openURLContexts. React Native
  /// læser det via launchOptions (Linking.getInitialURL), så det sendes ikke ekstra til scene(_:openURLContexts:).
  private static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any] {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    return launchOptions
  }
}
`;

/**
 * @param {Record<string, any>} plist Info.plist som objekt.
 * @returns {Record<string, any>} Samme objekt med UIApplicationSceneManifest.
 */
function applySceneManifest(plist) {
  plist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: SCENE_CONFIGURATION_NAME,
          UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
        },
      ],
    },
  };
  return plist;
}

/**
 * Fjerner React Native-opstarten fra AppDelegate.swift (den flytter til SceneDelegate); vinduet bliver stående.
 * @param {string} contents AppDelegate.swift fra `expo prebuild`.
 * @returns {string} AppDelegate.swift uden startReactNative.
 */
function patchAppDelegate(contents) {
  if (contents.includes(APP_DELEGATE_MARKER))
    return contents;
  if (!APP_DELEGATE_START_BLOCK.test(contents))
    throw new Error('with-uiscene: fandt ikke window/startReactNative-blokken i AppDelegate.swift. Expo-skabelonen er ændret; opdatér pluginet.');
  return contents.replace(APP_DELEGATE_START_BLOCK, `$1    ${APP_DELEGATE_MARKER}\n$2`);
}

module.exports = {
  SCENE_DELEGATE_CLASS,
  SCENE_DELEGATE_SWIFT,
  applySceneManifest,
  patchAppDelegate,
};
