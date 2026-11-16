import { storage } from '~/lib/storage';

/**
 * "Log opkald" er slået FRA som standard og gemmes kun på denne telefon.
 * Uden den åbner deep linket en forklaring i stedet for formularen.
 */
export const CALL_LOGGING_KEY = 'calls.enabled';

export function isCallLoggingEnabled(): boolean {
  return storage.getBoolean(CALL_LOGGING_KEY) === true;
}

export function setCallLoggingEnabled(enabled: boolean): void {
  if (enabled)
    storage.set(CALL_LOGGING_KEY, true);
  else
    storage.remove(CALL_LOGGING_KEY);
}
