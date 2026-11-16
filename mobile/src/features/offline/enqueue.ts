import type { QueuedMutation } from './queue-logic';
import { onlineManager } from '@tanstack/react-query';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { offlineQueue } from './queue-store';

export function isOffline(): boolean {
  return !onlineManager.isOnline();
}

/** Læg mutationen i køen og fortæl brugeren at den synkroniseres senere. */
export function enqueueOffline(mutation: QueuedMutation): void {
  offlineQueue().enqueue(mutation);
  showMessage({
    message: translate('offline.saved_title'),
    description: translate('offline.saved_body'),
    type: 'info',
  });
}
