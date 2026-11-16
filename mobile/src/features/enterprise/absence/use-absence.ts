import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { trpc } from '~/lib/api';
import { useCurrentYear } from '~/lib/hooks/use-today';

export type AbsenceRequest = RouterOutputs['enterprise']['listRequests'][number];
export type AbsenceType = RouterOutputs['enterprise']['listTypes'][number];
export type VacationBalance = RouterOutputs['enterprise']['getVacationBalance'][number];
export type Holiday = RouterOutputs['enterprise']['listHolidays'][number];
export type ClosurePeriod = RouterOutputs['enterprise']['listClosurePeriods'][number];

/**
 * Eget bruger-id fra sessionen. `AuthSession` udledes til `never` under
 * strict TS (better-auth/expo-plugin-cast, se docs/MOBILE-PLAN.md), så vi
 * læser feltet gennem en smal struktur-type.
 */
export function useMyUserId(): string | undefined {
  const session = useAuthStore(s => s.session) as unknown as { user?: { id?: string } } | null;
  return session?.user?.id;
}

export function useAbsenceTypes() {
  return trpc.enterprise.listTypes.useQuery(undefined, { staleTime: 30 * 60 * 1000 });
}

/** Egne anmodninger i et år (managers får også teamets — filtreres på userId). */
export function useMyRequests(year: number) {
  const me = useMyUserId();
  const query = trpc.enterprise.listRequests.useQuery({ year });
  const mine = React.useMemo(
    () => (query.data ?? []).filter(r => !me || r.userId === me),
    [query.data, me],
  );
  return { ...query, mine };
}

/** Afventende anmodninger fra teamet (uden egne). Kun for managers. */
export function usePendingTeamRequests(enabled: boolean) {
  const me = useMyUserId();
  const query = trpc.enterprise.listRequests.useQuery({ status: 'pending' }, { enabled });
  const pending = React.useMemo(
    () => (query.data ?? []).filter(r => r.userId !== me),
    [query.data, me],
  );
  return { ...query, pending };
}

/** Helligdage for i år + næste år (vinduet kan krydse årsskiftet). */
export function useHolidays() {
  const year = useCurrentYear();
  const thisYear = trpc.enterprise.listHolidays.useQuery({ year }, { staleTime: 60 * 60 * 1000 });
  const nextYear = trpc.enterprise.listHolidays.useQuery({ year: year + 1 }, { staleTime: 60 * 60 * 1000 });
  const holidays = React.useMemo(
    () => [...(thisYear.data ?? []), ...(nextYear.data ?? [])],
    [thisYear.data, nextYear.data],
  );
  return {
    holidays,
    isLoading: thisYear.isLoading,
    // Kun en fejl i BEGge kaldes en fejl: ét år uden helligdage er en rigtig
    // liste, der mangler næste års — ikke en fejl der skal skjule den.
    isError: thisYear.isError && nextYear.isError,
    refetch: () => void Promise.all([thisYear.refetch(), nextYear.refetch()]),
  };
}

/**
 * Invalidér alt der påvirkes af en fraværsændring: anmodninger, saldi,
 * flex og overtid (godkendt fravær posterer på begge).
 */
export function useInvalidateAbsence() {
  const utils = trpc.useUtils();
  return React.useCallback(() => {
    void utils.enterprise.listRequests.invalidate();
    void utils.enterprise.getVacationBalance.invalidate();
    void utils.enterprise.listVacationLedger.invalidate();
    void utils.enterprise.getBalance.invalidate();
    void utils.enterprise.getEntries.invalidate();
    void utils.enterprise.getMyOvertime.invalidate();
    void utils.enterprise.getOvertimeOverview.invalidate();
    void utils.enterprise.inboxUnreadCount.invalidate();
  }, [utils]);
}
