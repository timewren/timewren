import * as Sentry from '@sentry/react-native';
import Env from 'env';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { captureError, initMonitoring, PUSH_FIREBASE_WARNING } from '~/lib/monitoring';
import { storage } from '~/lib/storage';
import { registerForPush } from './push-registration';

jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'project' } } } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-application', () => ({ __esModule: true, nativeApplicationVersion: '1.0.0', nativeBuildVersion: '9', getLastUpdateTimeAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('~/lib/storage', () => {
  const values = new Map<string, string | boolean>();
  return {
    storage: {
      getBoolean: (key: string) => values.get(key) === true,
      getString: (key: string) => typeof values.get(key) === 'string' ? values.get(key) : undefined,
      set: (key: string, value: string | boolean) => values.set(key, value),
      clearAll: () => values.clear(),
    },
  };
});
jest.mock('~/lib/api', () => ({ trpcClient: {} }));
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

describe('registerForPush on Android', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.replaceProperty(Env, 'EXPO_PUBLIC_SENTRY_DSN', 'https://example.com/1');
    jest.clearAllMocks();
    storage.clearAll();
    jest.mocked(Application.getLastUpdateTimeAsync).mockResolvedValue(new Date(1000));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a missing Firebase configuration once across registration attempts', async () => {
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(new Error(
      'Fetching the token failed: Default FirebaseApp is not initialized in this process.',
    ));

    const result = { status: 'firebase_unavailable' };
    await expect(registerForPush()).resolves.toEqual(result);
    await expect(registerForPush()).resolves.toEqual(result);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(PUSH_FIREBASE_WARNING, 'warning');

    // A replacement preview APK can have exactly the same native version and build number.
    jest.mocked(Application.getLastUpdateTimeAsync).mockResolvedValue(new Date(2000));
    await expect(registerForPush()).resolves.toEqual(result);
    await expect(registerForPush()).resolves.toEqual(result);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('routes TimeWren warnings only to the TimeWren Sentry project', async () => {
    jest.replaceProperty(Constants, 'expoConfig', {
      name: 'TimeWren',
      slug: 'timewren',
      extra: { ...Constants.expoConfig?.extra, timewren: {} },
    });
    const dsn = jest.replaceProperty(Env, 'EXPO_PUBLIC_SENTRY_DSN_TIMEWREN', undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(
      new Error('Default FirebaseApp is not initialized'),
    );

    initMonitoring();
    await registerForPush();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    dsn.replaceValue('https://example.com/2');
    storage.clearAll();
    jest.replaceProperty(Platform, 'OS', 'ios');
    initMonitoring();
    captureError(new Error('Render crash'));
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();

    jest.replaceProperty(Platform, 'OS', 'android');
    initMonitoring();
    captureError(new Error('Render crash'));
    const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: 'https://example.com/2',
      enableNative: false,
      defaultIntegrations: false,
      enableAutoSessionTracking: false,
      sendClientReports: false,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(options?.beforeSend?.({ type: undefined, message: 'Render crash' }, {})).toBeNull();
    const warning = options?.beforeSend?.({
      type: undefined,
      message: PUSH_FIREBASE_WARNING,
      user: { id: 'user-id' },
    }, {});
    expect(warning).toMatchObject({ message: PUSH_FIREBASE_WARNING });
    expect(warning).not.toHaveProperty('user');
    await registerForPush();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(PUSH_FIREBASE_WARNING, 'warning');
  });

  it('strips user data and breadcrumbs from the Sentry warning', () => {
    initMonitoring();
    const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
    const warning = options?.beforeSend?.({
      type: undefined,
      message: PUSH_FIREBASE_WARNING,
      level: 'warning',
      user: { id: 'user-id' },
      breadcrumbs: [{ message: 'private breadcrumb' }],
      extra: { token: 'push-token' },
    }, {});

    expect(warning).toMatchObject({ message: PUSH_FIREBASE_WARNING, level: 'warning' });
    expect(warning).not.toHaveProperty('user');
    expect(warning).not.toHaveProperty('breadcrumbs');
    expect(warning).not.toHaveProperty('extra');
  });

  it('preserves other registration errors', async () => {
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(new Error('Network unavailable'));

    await expect(registerForPush()).resolves.toEqual({ status: 'error', message: 'Network unavailable' });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
