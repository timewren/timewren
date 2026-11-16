import type { AbsenceRequest, VacationBalance } from './use-absence';
import { addDays, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { CalendarOff, Palmtree, Plus } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button } from '~/components/ui/button';
import { Card, SectionHeader } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { ListRow } from '~/components/ui/list-row';
import { ListSkeleton } from '~/components/ui/skeleton';
import { StatTile } from '~/components/ui/stat-tile';
import { Text } from '~/components/ui/text';
import { trpc } from '~/lib/api';
import { formatDateShort, toISODate } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { calendarWeeks, formatDays, pickCurrentBalance, rangeOverlaps } from './absence-logic';
import { AbsenceRequestRow } from './components/absence-request-row';
import { CalendarStrip } from './components/calendar-strip';
import { useHolidays, useMyRequests } from './use-absence';

function BalanceCards({ balance, isLoading }: { balance: VacationBalance | undefined; isLoading: boolean }) {
  if (isLoading)
    return <ListSkeleton rows={1} />;
  const vacationHint = balance
    ? translate('enterprise.absence.balance_used_of', { used: formatDays(balance.usedDays), total: formatDays(balance.totalDays) })
    : translate('enterprise.absence.balance_none');
  const extraHint = balance
    ? translate('enterprise.absence.balance_used_of', { used: formatDays(balance.extraUsedDays), total: formatDays(balance.extraTotalDays) })
    : translate('enterprise.absence.balance_none');
  return (
    <View>
      <View className="flex-row gap-3">
        <StatTile
          label={translate('enterprise.absence.balance_vacation')}
          value={formatDays(balance?.remaining ?? 0)}
          hint={vacationHint}
          icon={Palmtree}
          tone="violet"
          testID="vacation-balance"
        />
        <StatTile
          label={translate('enterprise.absence.balance_extra')}
          value={formatDays(balance?.extraRemaining ?? 0)}
          hint={extraHint}
          tone="violet"
          testID="extra-balance"
        />
      </View>
      {balance?.periodLabel
        ? <Text className="mt-1 text-xs text-muted-foreground">{translate('enterprise.absence.balance_period', { period: balance.periodLabel })}</Text>
        : null}
    </View>
  );
}

type UpcomingProps = { requests: readonly AbsenceRequest[]; today: string; onPress: (id: string) => void };

function Upcoming({ requests, today, onPress }: UpcomingProps) {
  const upcoming = React.useMemo(
    () => requests
      .filter(r => r.status === 'approved' && (r.endDate ?? r.startDate) >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 5),
    [requests, today],
  );
  if (upcoming.length === 0) {
    return (
      <Card>
        <Text className="text-sm text-muted-foreground">{translate('enterprise.absence.no_upcoming')}</Text>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      {upcoming.map((r, i) => (
        <AbsenceRequestRow key={r.id} request={r} onPress={() => onPress(r.id)} last={i === upcoming.length - 1} />
      ))}
    </Card>
  );
}

export function AbsenceOverview() {
  const router = useRouter();
  const today = useToday();
  const year = Number(today.slice(0, 4));
  const balanceQuery = trpc.enterprise.getVacationBalance.useQuery();
  const requests = useMyRequests(year);
  const nextYearRequests = useMyRequests(year + 1);
  const { holidays, isLoading: holidaysLoading, isError: holidaysError, refetch: refetchHolidays } = useHolidays();
  const closures = trpc.enterprise.listClosurePeriods.useQuery(undefined, { staleTime: 60 * 60 * 1000 });

  // Fem regioner, ét stop: saldo, årets anmodninger, næste års, helligdage og
  // lukkeperioder. Uden eget stop sagde hver især "Indhold indlæst", og en
  // skærmlæser hørte fem gange for én fane.
  useReportLoad(balanceQuery, translate('common.loaded'));
  useReportLoad(requests, translate('common.loaded'));
  useReportLoad(nextYearRequests, translate('common.loaded'));
  useReportLoad({ isLoading: holidaysLoading, isError: holidaysError }, translate('common.loaded'));
  useReportLoad(closures, translate('common.loaded'));

  const retryRequests = React.useCallback(() => {
    requests.refetch();
    nextYearRequests.refetch();
  }, [requests, nextYearRequests]);
  const retryHolidays = React.useCallback(() => {
    refetchHolidays();
    closures.refetch();
  }, [closures, refetchHolidays]);

  const balance = pickCurrentBalance(balanceQuery.data, today);
  const allMine = React.useMemo(() => [...requests.mine, ...nextYearRequests.mine], [requests.mine, nextYearRequests.mine]);
  const windowEnd = toISODate(addDays(parseISO(today), 60));
  const closureList = closures.data ?? [];
  const upcomingClosures = closureList.filter(c => rangeOverlaps({ startDate: c.startDate, endDate: c.endDate }, { from: today, to: windowEnd }, today));
  const upcomingHolidays = holidays.filter(h => h.date >= today && h.date <= windowEnd);
  const calendarEnd = calendarWeeks(parseISO(today)).at(-1)?.at(-1) ?? windowEnd;
  const inCalendar = (start: string, end: string) => start <= calendarEnd && end >= today;
  const showCalendar = allMine.some(r => (r.status === 'approved' || r.status === 'pending') && inCalendar(r.startDate, r.endDate ?? r.startDate))
    || holidays.some(h => inCalendar(h.date, h.date))
    || closureList.some(c => inCalendar(c.startDate, c.endDate));

  return (
    <ScreenLoad message={translate('common.loaded')}>
      <View>
        {balanceQuery.isError
          ? <ErrorState onRetry={balanceQuery.refetch} />
          : <BalanceCards balance={balance} isLoading={balanceQuery.isLoading} />}
        <Button
          label={translate('enterprise.absence.request_button')}
          className="mt-4"
          onPress={() => router.push('/enterprise/absence/new')}
          testID="absence-new"
        >
          <View className="flex-row items-center gap-2">
            <Plus size={18} color="#fff" />
            <Text className="text-base font-semibold text-white">{translate('enterprise.absence.request_button')}</Text>
          </View>
        </Button>

        {showCalendar
          ? (
              <>
                <SectionHeader title={translate('enterprise.absence.calendar_title')} />
                <CalendarStrip requests={allMine} holidays={holidays} closures={closureList} today={today} />
              </>
            )
          : null}

        <SectionHeader title={translate('enterprise.absence.upcoming_title')} />
        {/* Næste års anmodninger tæller med i listen, så en fejl dér er en
            stille mangel — ikke en kortere liste. */}
        {requests.isLoading
          ? <ListSkeleton rows={2} />
          : requests.isError || nextYearRequests.isError
            ? <ErrorState onRetry={retryRequests} />
            : <Upcoming requests={allMine} today={today} onPress={id => router.push(`/enterprise/absence/${id}`)} />}

        <SectionHeader title={translate('enterprise.absence.holidays_title')} />
        <Text className="-mt-1 mb-2 text-xs text-muted-foreground" tx="enterprise.absence.holidays_hint" />
        {holidaysLoading || closures.isLoading
          ? <ListSkeleton rows={2} />
          : closures.isError || holidaysError
            ? <ErrorState onRetry={retryHolidays} />
            : upcomingHolidays.length + upcomingClosures.length === 0
              ? <EmptyState icon={CalendarOff} title={translate('enterprise.absence.no_holidays')} compact />
              : (
                  <Card className="p-0">
                    {upcomingClosures.map(c => (
                      <ListRow
                        key={c.id}
                        title={c.name}
                        subtitle={`${formatDateShort(parseISO(c.startDate))} – ${formatDateShort(parseISO(c.endDate))}`}
                        right={translate('enterprise.absence.closure_badge')}
                      />
                    ))}
                    {upcomingHolidays.map((h, i) => (
                      <ListRow
                        key={h.id}
                        title={h.name}
                        subtitle={h.isHalfDay ? translate('enterprise.absence.half_holiday') : undefined}
                        right={formatDateShort(parseISO(h.date))}
                        last={i === upcomingHolidays.length - 1}
                      />
                    ))}
                  </Card>
                )}
      </View>
    </ScreenLoad>
  );
}
