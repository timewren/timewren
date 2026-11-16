import type { RouterOutputs } from '~/api/app-router';
import { CalendarPlus } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorState, ListRow, ListSkeleton, SectionHeader, StatTile } from '~/components/ui';
import { PendingEntryRow } from '~/features/offline/components/pending-entry-row';
import { usePendingDeletes, usePendingEntries } from '~/features/offline/use-pending-entries';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { goTo, ROUTES } from '../navigation';

type Entry = RouterOutputs['time']['list']['entries'][number];

function useTodayRange() {
  const today = useToday();
  return React.useMemo(() => ({ startDate: today, endDate: today }), [today]);
}

function entryClient(entry: Entry): string | null {
  return entry.client?.name ?? entry.project?.client?.name ?? null;
}

/** Dagens total + de 5 seneste poster. Tryk → registreringens detaljeside. */
export function TodayCard() {
  const range = useTodayRange();
  const total = trpc.time.todayTotal.useQuery();
  const list = trpc.time.list.useQuery({ ...range, onlyOwn: true, limit: 5 });
  const pendingDeletes = usePendingDeletes();
  const entries = (list.data?.entries ?? []).filter(e => !pendingDeletes.has(e.id));
  const pending = usePendingEntries(range.startDate);
  const pendingHours = pending.reduce((acc, e) => acc + e.hours, 0);
  useReportLoad(list, translate('common.loaded'));

  const isEmpty = !list.isLoading && !list.isError && entries.length === 0 && pending.length === 0;
  const showTotal = !isEmpty || (total.data ?? 0) > 0;

  return (
    <View>
      <SectionHeader
        title={translate('home.today_title')}
        action={{ label: translate('home.see_all'), onPress: () => goTo(ROUTES.time), testID: 'today-see-all' }}
      />
      {showTotal
        ? (
            <View className="mb-3 flex-row gap-3">
              <StatTile
                label={translate('home.today_total')}
                value={formatHours((total.data ?? 0) + pendingHours)}
                loading={total.isLoading}
                error={total.isError}
                tone="primary"
                testID="today-total"
              />
            </View>
          )
        : null}
      {list.isLoading
        ? <ListSkeleton rows={2} />
        : list.isError
          ? <Card className="p-0"><ErrorState onRetry={list.refetch} /></Card>
          : entries.length === 0 && pending.length === 0
            ? (
                <Card className="p-0">
                  <EmptyState
                    compact
                    icon={CalendarPlus}
                    title={translate('home.no_entries_title')}
                    description={translate('home.no_entries_body')}
                    action={{ label: translate('home.new_entry'), onPress: () => goTo(ROUTES.newEntry), testID: 'today-new-entry' }}
                  />
                </Card>
              )
            : (
                <Card className="p-0">
                  {entries.map((entry, i) => (
                    <ListRow
                      key={entry.id}
                      title={entry.description || entry.project?.name || translate('timer.default_description')}
                      subtitle={[entryClient(entry), entry.project?.name].filter(Boolean).join(' · ') || undefined}
                      right={formatHours(entry.hours)}
                      onPress={() => goTo(ROUTES.entry(entry.id))}
                      last={i === entries.length - 1 && pending.length === 0}
                      testID={`today-entry-${entry.id}`}
                    />
                  ))}
                  {pending.map((entry, i) => (
                    <PendingEntryRow key={entry.id} entry={entry} last={i === pending.length - 1} />
                  ))}
                </Card>
              )}
    </View>
  );
}
