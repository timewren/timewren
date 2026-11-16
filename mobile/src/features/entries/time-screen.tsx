import type { EntryFilter } from './entry-filter';
import type { PeriodMode } from './period';
import type { TimeEntry } from './use-entries';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { EmptyState, ErrorState, Screen, Segmented, useModal } from '~/components/ui';
import { OfflineBanner } from '~/features/offline/components/offline-banner';
import { useEntriesWithPending, usePendingDeletes, usePendingEntries } from '~/features/offline/use-pending-entries';
import { trpc } from '~/lib/api';
import { toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { DayView } from './components/day-view';
import { EntryActionsSheet } from './components/entry-actions-sheet';
import { EntryFilters } from './components/entry-filters';
import { MonthView } from './components/month-view';
import { PeriodHeader } from './components/period-header';
import { SelectToggle, TimeFooter } from './components/time-selection';
import { WeekView } from './components/week-view';
import { ALL_BILLABLE, ALL_BILLED, applyLocalFilters, filterHidesAll, hasActiveFilter, NO_FILTER } from './entry-filter';
import { dateKey, entriesOnDay, fetchRange, isSameDate, periodTitle, shiftPeriod } from './period';
import { useCopyWeek } from './use-copy-week';
import { confirmDelete, useEntriesInRange, useEntryActions } from './use-entries';
import { useEntrySelection } from './use-entry-selection';

const SWIPE_THRESHOLD = 60;

function periodContainsToday(mode: PeriodMode, date: Date): boolean {
  const today = new Date();
  const { start, end } = fetchRange(mode, date);
  if (mode === 'day')
    return isSameDate(date, today);
  return today >= start && today <= end;
}

/** Periode-state + swipe/pil-navigation. */
function usePeriod() {
  const [mode, setMode] = React.useState<PeriodMode>('day');
  const [date, setDate] = React.useState(() => new Date());
  const go = React.useCallback((direction: 1 | -1) => setDate(d => shiftPeriod(mode, d, direction)), [mode]);
  const today = React.useCallback(() => setDate(new Date()), []);
  const openDay = React.useCallback((day: Date) => {
    setDate(day);
    setMode('day');
  }, []);
  const gesture = React.useMemo(
    () => Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-24, 24])
      .failOffsetY([-16, 16])
      .onEnd((e) => {
        if (e.translationX < -SWIPE_THRESHOLD)
          go(1);
        else if (e.translationX > SWIPE_THRESHOLD)
          go(-1);
      }),
    [go],
  );
  return { mode, setMode, date, go, today, openDay, gesture };
}

/**
 * Filteret skjuler alt. Den normale tom-tilstand må ikke bruges her — den
 * siger "Der er ikke registreret tid i denne periode" og tilbyder at registrere,
 * hvilket er en påstand om brugerens egen dag, filteret nu skjuler.
 */
function FilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      title={translate('entries.empty_filtered_title')}
      description={translate('entries.empty_filtered_body')}
      action={{ label: translate('entries.clear_filter'), onPress: onClear, testID: 'time-clear-filter' }}
      compact
    />
  );
}

type TimeHeaderProps = {
  mode: PeriodMode;
  date: Date;
  period: ReturnType<typeof usePeriod>;
  filter: EntryFilter;
  onFilter: (filter: EntryFilter) => void;
  onMode: (mode: 'day' | 'week' | 'month') => void;
  projects: { id: string; name: string }[];
  projectsError: boolean;
};

/** Offline-banner, periodevælger, periode-navigation og de tre filtre. */
function TimeHeader({ mode, date, period, filter, onFilter, onMode, projects, projectsError }: TimeHeaderProps) {
  const options = React.useMemo(() => [
    { value: 'day' as const, label: translate('entries.day') },
    { value: 'week' as const, label: translate('entries.week') },
    { value: 'month' as const, label: translate('entries.month') },
  ], []);
  return (
    <View className="gap-3">
      <OfflineBanner className="mb-0" />
      <Segmented options={options} value={mode} onChange={onMode} testID="time-mode" />
      <PeriodHeader
        title={periodTitle(mode, date)}
        showToday={!periodContainsToday(mode, date)}
        onPrev={() => period.go(-1)}
        onNext={() => period.go(1)}
        onToday={period.today}
      />
      {/* "Alle projekter" ligger først, så valget også ER nulstillingen. */}
      <EntryFilters filter={filter} onChange={onFilter} projects={projects} projectsError={projectsError} />
    </View>
  );
}

type TimeContentProps = {
  isError: boolean;
  hidesAll: boolean;
  onRetry: () => void;
  onClearFilter: () => void;
  children: React.ReactNode;
};

/**
 * Fejl, tom-tilstand eller indhold — i den rækkefølge.
 *
 * Uden denne tjek lå de tre tilstande i én ternær inde i skærmen, hvor den
 * fyldte flere linjer end selve visningen. Rækkefølgen er vigtig: en fejl må
 * aldrig erstattes af "ingen data", og et filter må aldrig skjule en fejl.
 */
function TimeContent({ isError, hidesAll, onRetry, onClearFilter, children }: TimeContentProps) {
  if (isError)
    return <ErrorState onRetry={onRetry} />;
  if (hidesAll)
    return <FilteredEmpty onClear={onClearFilter} />;
  return <>{children}</>;
}

export function TimeScreen() {
  const router = useRouter();
  const period = usePeriod();
  const { mode, date } = period;
  const range = React.useMemo(() => fetchRange(mode, date), [mode, date]);
  const [filter, setFilter] = React.useState<EntryFilter>(NO_FILTER);
  const query = useEntriesInRange(range, filter);
  const projects = trpc.projects.list.useQuery(undefined);
  const pendingDeletes = usePendingDeletes();
  // Ventende rettelser lægges ovenpå serverens data, så en offline-redigering
  // viser den nye værdi med en "venter"-badge frem for de gamle tal.
  const entries = useEntriesWithPending(
    (query.data?.entries ?? []).filter(e => !pendingDeletes.has(e.id)),
  );
  // Fakturerbarhed og faktureret-status filtreres lokalt over de poster der
  // allerede er hentet, så query-nøglen og kaldet er uændrede — se
  // `matchesBillable`/`matchesBilled` for hvorfor serverens kolonner ikke kan
  // bruges i query-inputtet.
  const visible = React.useMemo(() => applyLocalFilters(entries, filter), [entries, filter]);
  const dayEntries = React.useMemo(() => entriesOnDay(visible, date), [visible, date]);
  const pendingEntries = usePendingEntries(dateKey(date));
  const visiblePending = React.useMemo(() => applyLocalFilters(pendingEntries, filter), [pendingEntries, filter]);
  const isCurrentWeek = periodContainsToday('week', date);
  const goal = trpc.time.weeklyGoalProgress.useQuery(undefined, { enabled: mode === 'week' && isCurrentWeek });
  // Kalenderen er skærmens skeleton-gate. Uge-Målet er et sekundært kort, så det
  // skal ikke holde "indlæst" tilbage — men det slås kun fra i ugetilstand.
  useAnnounceLoaded(query, translate('common.loaded'));
  const copyWeek = useCopyWeek(date);
  const actions = useEntryActions();
  const sheet = useModal();
  const [selected, setSelected] = React.useState<TimeEntry | null>(null);
  const selection = useEntrySelection(visible);
  // Uge- og månedsvisningen viser dage, ikke poster, så valget har ingen steder
  // at sidde. Skift til dem afslutter udvalgstilstanden frem for at efterlade en
  // tom udvalgelse, der dukker op igen når brugeren går tilbage til dagen.
  const changeMode = (next: 'day' | 'week' | 'month') => {
    period.setMode(next);
    selection.leave();
  };

  const openEntry = (entry: TimeEntry) => selection.press(entry, () => router.push(`/entries/${entry.id}`));
  const openActions = (entry: TimeEntry) => {
    setSelected(entry);
    sheet.present();
  };
  const register = () => router.push({ pathname: '/entries/new', params: { date: toISODate(date) } });

  // Ugemålet kommer fra serveren og er derfor UFILTERET, mens "Uge i alt" er
  // summen af den filtrerede liste. Med et filter ville de stride mod
  // hinanden (målet over 100 % ved en halv liste), så `WeekView` viser så i
  // stedet antal poster, som passer med rækkerne.
  const goalForView = filter.billable === ALL_BILLABLE && filter.billed === ALL_BILLED ? goal.data : undefined;

  const header = (
    <TimeHeader mode={mode} date={date} period={period} filter={filter} onFilter={setFilter} onMode={changeMode} projects={projects.data ?? []} projectsError={projects.isError} />
  );

  // Uge- og månedsvisningen henter ikke ventende offline-oprettelser, så de
  // tæller kun med i dagsvisningen, hvor de står i rækken.
  const hidesAll = filterHidesAll({
    active: hasActiveFilter(filter),
    visible: visible.length,
    pending: mode === 'day' ? visiblePending.length : 0,
  });

  const body = mode === 'day'
    ? <DayView entries={dayEntries} pending={visiblePending} isLoading={query.isLoading} onPressEntry={openEntry} onLongPressEntry={openActions} onRegister={register} selectedIds={selection.active ? selection.ids : undefined} />
    : mode === 'week'
      ? <WeekView date={date} entries={visible} isLoading={query.isLoading} goal={goalForView} onSelectDay={period.openDay} onCopyWeek={copyWeek.run} copying={copyWeek.isPending} />
      : <MonthView date={date} entries={visible} isLoading={query.isLoading} onSelectDay={period.openDay} />;

  return (
    <GestureDetector gesture={period.gesture}>
      <View className="flex-1">
        <Screen
          title={translate('entries.title')}
          right={mode === 'day' ? <SelectToggle active={selection.active} onPress={selection.active ? selection.leave : selection.start} /> : undefined}
          header={header}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerClassName={selection.active ? 'px-4 pb-48' : 'px-4 pb-28'}
        >
          <TimeContent isError={query.isError} hidesAll={hidesAll} onRetry={() => void query.refetch()} onClearFilter={() => setFilter(NO_FILTER)}>
            {body}
          </TimeContent>
        </Screen>
        <TimeFooter active={selection.active} count={selection.chosenIds.length} billedState={selection.billedState} busy={selection.busy} onMarkBilled={selection.markBilled} onDelete={selection.deleteChosen} onCancel={selection.leave} onRegister={register} />

        <EntryActionsSheet
          ref={sheet.ref}
          entry={selected}
          onEdit={openEntry}
          onDuplicate={e => actions.duplicate(e.id)}
          onToggleBillable={e => actions.toggleBillable(e.id, e.isBillable === false)}
          onSetBilled={(e, isBilled) => void actions.setBilled(e.id, isBilled)}
          onDelete={e => confirmDelete(() => actions.removeOrQueue(e.id))}
        />
      </View>
    </GestureDetector>
  );
}
