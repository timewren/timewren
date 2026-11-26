import type { Envelope } from '@sentry/core';
import type { ReactNativeOptions } from '@sentry/react-native';
import type { init as initSdk } from '@sentry/react-native/dist/js/sdk';
import { withScope } from '@sentry/core';
import { init } from '@sentry/react-native';
import { RN_GLOBAL_OBJ } from '@sentry/react-native/dist/js/utils/worldwide';
import { Platform } from 'react-native';
import { initMonitoring } from './monitoring';

jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));
jest.mock('@sentry/react-native/dist/js/utils/environment', () => ({
  ...jest.requireActual('@sentry/react-native/dist/js/utils/environment'),
  isExpo: () => true,
  isHermesEnabled: () => true,
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('env', () => ({
  EXPO_PUBLIC_SENTRY_DSN: 'https://public@sentry.example.invalid/1',
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_VERSION: '1.2.3',
}));

function monitoringOptions(): ReactNativeOptions {
  initMonitoring();
  return jest.mocked(init).mock.calls.at(-1)![0];
}

const errorUtils = RN_GLOBAL_OBJ.ErrorUtils!;
const originalHandler = errorUtils.getGlobalHandler();
const defaultHandler = jest.fn();
let sdk: { init: typeof initSdk };

beforeAll(() => {
  // The tracing module starts a cleanup interval when imported.
  jest.useFakeTimers();
  try {
    sdk = jest.requireActual<typeof sdk>('@sentry/react-native/dist/js/sdk');
  }
  finally {
    jest.useRealTimers();
  }
}, 30_000);

beforeEach(() => {
  defaultHandler.mockReset();
  errorUtils.setGlobalHandler(defaultHandler);
});

afterEach(() => {
  errorUtils.setGlobalHandler(originalHandler);
  jest.restoreAllMocks();
});

function initTestSdk(transport: NonNullable<ReactNativeOptions['transport']>): void {
  // Discard the SDK's unused tracing cleanup intervals started during initialization.
  jest.useFakeTimers();
  try {
    sdk.init({
      ...monitoringOptions(),
      patchGlobalPromise: false,
      integrations: defaults => defaults.filter(integration => integration.name !== 'DebugSymbolicator').map((integration) => {
        // Each platform represents a new process with its own fatal-handler state.
        if (integration.name === 'ReactNativeErrorHandlers')
          return { ...integration, setup: integration.setupOnce, setupOnce: undefined };
        return integration;
      }),
      transport,
    });
  }
  finally {
    jest.useRealTimers();
  }
}

it.each(['ios', 'android'] as const)('sender kun tekniske felter fra et JavaScript-crash på %s', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const secret = 'synthetic-private-value';
  const url = `https://${secret}.invalid/private/${secret}?token=${secret}#${secret}`;
  const bundleName = platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle';
  const filename = `app:///${bundleName}`;
  const debugId = '01234567-89ab-cdef-0123-456789abcdef';
  const bundleUrl = 'address at entry-release.hbc';
  const debugIds = { [`Error\n    at debugId (${bundleUrl}:1:10)`]: debugId };
  const runtime = globalThis as typeof globalThis & {
    __DEV__: boolean;
    _sentryDebugIds?: Record<string, string>;
  };
  const originalDebugIds = runtime._sentryDebugIds;
  const error = new TypeError(`Synthetic crash: ${secret}`);
  error.stack = `${error}\n    at ${secret} (native)\n    at ${secret} (${bundleUrl}:1:321)`;
  let finishRequest!: () => void;
  const request = new Promise<object>((resolve) => {
    finishRequest = () => resolve({});
  });
  let startFlush!: () => void;
  const flushStarted = new Promise<void>((resolve) => {
    startFlush = resolve;
  });
  let transportFinished = false;
  const send = jest.fn<Promise<object>, [Envelope]>(() => request);
  const flush = jest.fn(async () => {
    startFlush();
    await request;
    transportFinished = true;
    return true;
  });
  runtime._sentryDebugIds = debugIds;
  const originalDev = __DEV__;
  try {
    runtime.__DEV__ = false;
    initTestSdk(() => ({ send, flush }));
    const crashHandler = errorUtils.getGlobalHandler();
    expect(crashHandler).not.toBe(defaultHandler);

    await withScope(async (scope) => {
      scope.addEventProcessor(event => ({
        ...event,
        message: `Request failed for ${url}`,
        user: { id: secret, email: secret, name: secret, ip_address: secret },
        request: { url, headers: { Authorization: `Bearer ${secret}`, Cookie: secret }, data: secret },
        breadcrumbs: [{ category: 'http', message: secret, data: { url } }],
        contexts: { custom: { host: url }, device: { name: secret } },
        extra: { query: [url], note: secret },
        tags: { private: secret },
        transaction: url,
      }));
      scope.addAttachment({ filename: secret, data: secret });
      let transportFinishedAtDefaultHandler = false;
      const handled = new Promise<void>((resolve) => {
        defaultHandler.mockImplementationOnce(() => {
          transportFinishedAtDefaultHandler = transportFinished;
          resolve();
        });
      });
      await Promise.resolve(crashHandler(error, true));
      await Promise.race([flushStarted, handled]);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(defaultHandler).not.toHaveBeenCalled();
      finishRequest();
      await handled;
      expect(transportFinishedAtDefaultHandler).toBe(true);
    });
  }
  finally {
    runtime.__DEV__ = originalDev;
    finishRequest();
    runtime._sentryDebugIds = originalDebugIds;
  }

  expect(defaultHandler).toHaveBeenCalledWith(error, true);
  expect(send).toHaveBeenCalledTimes(1);
  const [envelope] = send.mock.calls[0]!;
  expect(JSON.stringify(envelope)).not.toContain(secret);
  expect(envelope[1]).toEqual([[{ type: 'event' }, {
    event_id: expect.stringMatching(/^[a-f0-9]{32}$/),
    timestamp: expect.any(Number),
    environment: 'production',
    release: 'timetrack-app@1.2.3',
    platform: 'javascript',
    level: 'fatal',
    exception: {
      values: [{
        type: 'TypeError',
        mechanism: { type: 'generic', handled: false },
        stacktrace: { frames: [{ filename, lineno: 1, colno: 322 }] },
      }],
    },
    debug_meta: { images: [{ type: 'sourcemap', code_file: filename, debug_id: debugId }] },
    sdk: expect.objectContaining({
      name: 'sentry.javascript.react-native',
      settings: { infer_ip: 'never' },
    }),
  }]]);
});

it('deaktiverer breadcrumbs, native rapporter og sessionsporing uden at slå traces til', () => {
  const options = monitoringOptions();
  expect(options).toMatchObject({
    enableNative: false,
    enableAutoSessionTracking: false,
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 0,
  });
  expect(options).not.toHaveProperty('tracesSampleRate');
  expect(options).not.toHaveProperty('tracesSampler');
});

it('afviser fritstående beskeder og erstatter ukendte exception-navne', async () => {
  const beforeSend = monitoringOptions().beforeSend!;
  expect(await beforeSend({ type: undefined, message: 'synthetic-private-message' }, {})).toBeNull();
  const event = { type: undefined, exception: { values: [{ type: 'synthetic-private-name' }] } };
  expect(await beforeSend(event, {})).toMatchObject({ exception: { values: [{ type: 'Error' }] } });
});
