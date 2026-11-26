import * as Sentry from '@sentry/react-native';
import Env from 'env';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { cleanErrorEvent } from './monitoring-privacy';

export const PUSH_FIREBASE_WARNING = 'Android-push er utilgængelig, fordi Firebase ikke er konfigureret i buildet.';

function isTimeWren(): boolean {
  return Boolean(Constants.expoConfig?.extra?.timewren);
}

function sentryDsn() {
  if (isTimeWren())
    return Platform.OS === 'android' ? Env.EXPO_PUBLIC_SENTRY_DSN_TIMEWREN : undefined;
  return Env.EXPO_PUBLIC_SENTRY_DSN;
}

export function initMonitoring(): void {
  const dsn = sentryDsn();
  if (!dsn)
    return;
  const warningOnly = isTimeWren();
  const build = {
    environment: Env.EXPO_PUBLIC_APP_ENV,
    release: `timetrack-app@${Env.EXPO_PUBLIC_VERSION}`,
  };
  Sentry.init({
    dsn,
    ...build,
    // Native events can bypass the JavaScript beforeSend hook.
    enableNative: false,
    enableAutoSessionTracking: false,
    ...(warningOnly && { defaultIntegrations: false }),
    sendClientReports: false,
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    // Kun fejl: ingen performance-traces (mindre data i App Privacy/Data safety).
    beforeSend(event, hint) {
      hint.attachments = [];
      if (Platform.OS === 'android' && event.message === PUSH_FIREBASE_WARNING) {
        return {
          type: undefined,
          event_id: event.event_id,
          timestamp: event.timestamp,
          ...build,
          platform: 'javascript',
          level: 'warning',
          message: PUSH_FIREBASE_WARNING,
        };
      }
      return warningOnly ? null : cleanErrorEvent(event, build);
    },
  });
}

export function capturePushFirebaseWarning(): void {
  if (sentryDsn())
    Sentry.captureMessage(PUSH_FIREBASE_WARNING, 'warning');
  else
    console.warn(`[push] ${PUSH_FIREBASE_WARNING}`);
}

export function captureError(error: unknown): void {
  if (isTimeWren() || !Env.EXPO_PUBLIC_SENTRY_DSN)
    return;
  Sentry.captureException(error);
}
