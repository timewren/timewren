import Env from 'env';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { brand } from '~/features/server/server-config';
import { trpcClient } from '~/lib/api';
import { capturePushFirebaseWarning } from '~/lib/monitoring';
import { storage } from '~/lib/storage';

const PUSH_TOKEN_KEY = 'push.expoToken';
const PUSH_DECLINED_KEY = 'push.declined';
const PUSH_FIREBASE_WARNING_BUILD_KEY = 'push.firebaseWarningBuild';
export const ANDROID_CHANNEL_ID = 'default';

export type PushRegisterResult
  = | { status: 'registered'; token: string }
    | { status: 'denied' }
    | { status: 'simulator' }
    | { status: 'no_project_id' }
    | { status: 'firebase_unavailable' }
    | { status: 'error'; message: string };

/**
 * Backend-procedurerne `mobile.registerPushToken`/`unregisterPushToken` ligger i
 * timetrack-web PR #550 (feat/mobile-auth-og-push, merget til develop = beta) og
 * er endnu ikke på main, som appens typer læses fra. Den smalle type her matcher
 * PR'ens zod-input; fjern casten når PR'en er på main.
 */
type PushProcedures = {
  mobile: {
    registerPushToken: {
      mutate: (input: {
        token: string;
        platform: 'ios' | 'android';
        deviceName?: string;
        appVersion?: string;
      }) => Promise<unknown>;
    };
    unregisterPushToken: {
      mutate: (input: { token: string }) => Promise<unknown>;
    };
  };
};

const pushClient = trpcClient as unknown as PushProcedures;

/** Token gemt fra sidste vellykkede registrering (null = push er slået fra). */
export function getStoredPushToken(): string | null {
  return storage.getString(PUSH_TOKEN_KEY) ?? null;
}

/** Har brugeren tidligere afvist push? Så spørger vi ikke igen automatisk. */
export function hasDeclinedPush(): boolean {
  return storage.getBoolean(PUSH_DECLINED_KEY) === true;
}

function setDeclined(declined: boolean) {
  if (declined)
    storage.set(PUSH_DECLINED_KEY, true);
  else storage.remove(PUSH_DECLINED_KEY);
}

function platform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android')
    return Platform.OS;
  return null;
}

async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (granted)
    return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android')
    return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: brand.name,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Bed om tilladelse, hent Expo-push-token og registrér det hos backenden.
 * Simulator, afslag og manglende EAS-projectId håndteres som egne
 * resultater — funktionen kaster aldrig.
 */
export async function registerForPush(): Promise<PushRegisterResult> {
  const os = platform();
  if (!os || !Device.isDevice)
    return { status: 'simulator' };

  try {
    if (!await ensurePermission()) {
      setDeclined(true);
      return { status: 'denied' };
    }
    await ensureAndroidChannel();

    const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] Mangler extra.eas.projectId i app.config — push-token kan ikke hentes');
      return { status: 'no_project_id' };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await pushClient.mobile.registerPushToken.mutate({
      token,
      platform: os,
      deviceName: Device.deviceName ?? undefined,
      appVersion: Env.EXPO_PUBLIC_VERSION,
    });
    storage.set(PUSH_TOKEN_KEY, token);
    setDeclined(false);
    return { status: 'registered', token };
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (os === 'android' && /Default FirebaseApp is not initialized/i.test(message)) {
      // Preview APKs can reuse both native version numbers across installs.
      const lastUpdate = await Application.getLastUpdateTimeAsync().catch(() => null);
      const nativeBuild = `${Application.nativeApplicationVersion}+${Application.nativeBuildVersion}:${lastUpdate?.getTime() ?? 'unknown'}`;
      if (storage.getString(PUSH_FIREBASE_WARNING_BUILD_KEY) !== nativeBuild) {
        storage.set(PUSH_FIREBASE_WARNING_BUILD_KEY, nativeBuild);
        capturePushFirebaseWarning();
      }
      return { status: 'firebase_unavailable' };
    }
    return { status: 'error', message };
  }
}

async function forgetToken(): Promise<void> {
  const token = getStoredPushToken();
  storage.remove(PUSH_TOKEN_KEY);
  if (!token)
    return;
  try {
    await pushClient.mobile.unregisterPushToken.mutate({ token });
  }
  catch {
    // Serveren rydder selv døde tokens ved næste afsendelse.
  }
}

/** Afmeld telefonens token hos backenden og glem det lokalt. Fejl fra serveren ignoreres — tokenet glemmes uanset. */
export async function unregisterPush(): Promise<void> {
  setDeclined(true);
  await forgetToken();
}

/** Registreret i denne app-session — for den bruger, der er logget ind nu. */
let registeredThisSession = false;

/** Skal push registreres ved dette login? Én gang pr. session, og aldrig efter et afslag. */
export function shouldRegisterPush(): boolean {
  return !registeredThisSession && !hasDeclinedPush();
}

export function markPushRegistered(): void {
  registeredThisSession = true;
}

/**
 * Ved log ud: tokenet hører til den bruger, der går. Uden afmelding fik
 * telefonen fortsat hans push — også i "uden konto" og efter et login med en
 * anden konto, som så selv blev sprunget over, fordi sessionen allerede var
 * registreret. Et afslag gemmes IKKE: det er brugerens valg, ikke kontoens.
 * Skal kaldes, mens login-cookien stadig findes.
 */
export async function releasePushForSignOut(): Promise<void> {
  registeredThisSession = false;
  await forgetToken();
}
