import type { RouterOutputs } from '~/api/app-router';
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { errorMessage, trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';

export type CheckInStatus = RouterOutputs['enterprise']['getCheckInStatus'];

const POLL_MS = 60_000;

/** Sekunder siden et tidspunkt; komponenten gen-renderes hvert sekund mens aktiv. */
function useElapsedSeconds(since: Date | string | null | undefined): number {
  // `now` sættes kun i interval-callback'et (aldrig synkront i effect/render)
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!since)
      return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since)
    return 0;
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
}

function haptic(kind: 'success' | 'error') {
  void Haptics.notificationAsync(
    kind === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

/**
 * Check-ind/ud-tilstand: status polles hvert minut mens man er tjekket ind,
 * så kortet følger med hvis man tjekker ud fra web. Mutationerne invaliderer
 * alle enterprise-queries (timeseddel, flex) da check-ud skriver en tidspost.
 */
export function useCheckIn(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const utils = trpc.useUtils();
  const status = trpc.enterprise.getCheckInStatus.useQuery(undefined, {
    enabled,
    refetchInterval: query => (query.state.data?.open ? POLL_MS : false),
  });
  const open = status.data?.open ?? null;
  const elapsedSeconds = useElapsedSeconds(open?.checkedInAt);

  const invalidate = React.useCallback(() => {
    void utils.enterprise.invalidate();
    void utils.time.invalidate();
  }, [utils]);

  const onError = React.useCallback((error: unknown) => {
    haptic('error');
    showMessage({ message: errorMessage(error), type: 'danger' });
  }, []);

  const checkIn = trpc.enterprise.checkIn.useMutation({
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError,
  });

  const checkOut = trpc.enterprise.checkOut.useMutation({
    onSuccess: (result) => {
      haptic('success');
      invalidate();
      const warnings = result.complianceWarnings ?? [];
      showMessage({
        message: translate('enterprise.checkin.checked_out_toast', { hours: formatHours(result.hours) }),
        description: warnings.length > 0 ? warnings.join('\n') : undefined,
        type: warnings.length > 0 ? 'warning' : 'success',
        duration: warnings.length > 0 ? 6000 : 3000,
      });
    },
    onError,
  });

  return {
    status: status.data,
    open,
    elapsedSeconds,
    isLoading: status.isLoading,
    isError: status.isError,
    refetch: () => void status.refetch(),
    checkIn: () => checkIn.mutate(),
    checkOut: () => checkOut.mutate(open ? { checkInId: open.id } : undefined),
    isCheckingIn: checkIn.isPending,
    isCheckingOut: checkOut.isPending,
    busy: checkIn.isPending || checkOut.isPending,
  };
}
