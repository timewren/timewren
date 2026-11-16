import type { RouterOutputs } from '~/api/app-router';
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { useInvalidateAbsence } from './use-absence';

type BatchResult = RouterOutputs['enterprise']['approveMany'];

export function haptic(ok: boolean) {
  void Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
}

/** Godkend/afvis (enkelt + batch) med haptik, toast og invalidering. */
export function useApprovalMutations(onBatchDone?: () => void) {
  const invalidate = useInvalidateAbsence();

  const onError = React.useCallback((e: unknown) => {
    haptic(false);
    showMessage({ message: errorMessage(e), type: 'danger' });
  }, []);

  const onSingle = React.useCallback((messageKey: 'enterprise.absence.approved_toast' | 'enterprise.absence.rejected_toast') => () => {
    haptic(true);
    showMessage({ message: translate(messageKey), type: 'success' });
    invalidate();
  }, [invalidate]);

  const onBatch = React.useCallback((result: BatchResult) => {
    const ok = result.succeeded.length;
    const failed = result.failed.length;
    haptic(failed === 0);
    showMessage({
      message: translate('enterprise.absence.batch_done', { ok, failed }),
      description: failed ? result.failed.map(f => f.message).join('\n') : undefined,
      type: failed ? 'warning' : 'success',
    });
    onBatchDone?.();
    invalidate();
  }, [invalidate, onBatchDone]);

  const approve = trpc.enterprise.approveRequest.useMutation({ onSuccess: onSingle('enterprise.absence.approved_toast'), onError });
  const reject = trpc.enterprise.rejectRequest.useMutation({ onSuccess: onSingle('enterprise.absence.rejected_toast'), onError });
  const approveMany = trpc.enterprise.approveMany.useMutation({ onSuccess: onBatch, onError });
  const rejectMany = trpc.enterprise.rejectMany.useMutation({ onSuccess: onBatch, onError });

  const busy = approve.isPending || reject.isPending || approveMany.isPending || rejectMany.isPending;
  return { approve, reject, approveMany, rejectMany, busy };
}
