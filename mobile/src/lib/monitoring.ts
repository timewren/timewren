import * as Sentry from '@sentry/react-native';
import Env from 'env';

/**
 * Crash-rapportering. Slås kun til når EXPO_PUBLIC_SENTRY_DSN er sat (prod/preview).
 * Ingen PII sendes: brugere identificeres kun med id, aldrig e-mail eller navn.
 */
export function initMonitoring(): void {
  const dsn = Env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn)
    return;
  Sentry.init({
    dsn,
    environment: Env.EXPO_PUBLIC_APP_ENV,
    release: `timetrack-app@${Env.EXPO_PUBLIC_VERSION}`,
    enableAutoSessionTracking: true,
    sendDefaultPii: false,
    // Kun fejl: ingen performance-traces (mindre data i App Privacy/Data safety).
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

export function setMonitoringUser(userId: string | null): void {
  if (!Env.EXPO_PUBLIC_SENTRY_DSN)
    return;
  Sentry.setUser(userId ? { id: userId } : null);
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!Env.EXPO_PUBLIC_SENTRY_DSN)
    return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
