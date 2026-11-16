import type { LocalEntry } from '../local-logic';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, ColorDot, ListRow, Text } from '~/components/ui';
import { DayStrip } from '~/features/enterprise/timesheet/components/day-strip';
import { WeekNav } from '~/features/enterprise/timesheet/components/week-nav';
import { getWeekStart, parseISODate, shiftWeek, weekDays } from '~/features/enterprise/timesheet/week';
import { formatDateLong, formatHoursClock } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { entriesOnDay, entrySeconds, formatClock, hoursPerDay, selectionLabel } from '../local-logic';
import { useLocalStore } from '../local-store';

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Blad gennem ugerne, vælg en dag, se og tilføj dens registreringer. */
export function LocalDayView() {
  const router = useRouter();
  const entries = useLocalStore.use.entries();
  const today = useToday();
  const [day, setDay] = React.useState(today);
  const weekStart = getWeekStart(parseISODate(day));
  const days = React.useMemo(() => weekDays(weekStart), [weekStart]);

  const hours = React.useMemo(() => hoursPerDay(entries, days), [entries, days]);
  const totals = React.useMemo(
    () => Object.fromEntries(days.map(d => [d, { work: hours[d] ?? 0, absence: 0, total: hours[d] ?? 0 }])),
    [days, hours],
  );
  // Ingen norm uden konto: hverdage vises normalt, weekend dæmpet; prikken = dagen har tid.
  const norms = React.useMemo(
    () => Object.fromEntries(days.map(d => [d, [0, 6].includes(parseISODate(d).getDay()) ? 0 : 0.01])),
    [days],
  );
  const dayEntries = React.useMemo(() => entriesOnDay(entries, day), [entries, day]);
  const seconds = dayEntries.reduce((acc, e) => acc + entrySeconds(e), 0);
  const thisWeek = getWeekStart(today);

  // Samme ugedag i forrige/næste uge.
  const moveWeek = (weeks: number) => setDay(shiftWeek(day, weeks));
  const addTime = () => router.push({ pathname: '/local/entry', params: { date: day } });

  return (
    <View className="mt-6" testID="local-day-view">
      <WeekNav
        weekStart={weekStart}
        onPrev={() => moveWeek(-1)}
        onNext={() => moveWeek(1)}
        onThisWeek={() => setDay(today)}
        isThisWeek={weekStart === thisWeek}
        testID="local-week"
      />
      <View className="mt-2">
        <DayStrip days={days} selected={day} today={today} totals={totals} norms={norms} holidays={EMPTY_SET} onSelect={setDay} />
      </View>
      <View className="mt-4 mb-2 flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">{formatDateLong(parseISODate(day))}</Text>
          <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHoursClock(seconds / 3600)}</Text>
        </View>
        <Button variant="outline" size="sm" fullWidth={false} label={translate('local.add_manual')} onPress={addTime} testID="local-add-manual">
          <Plus size={16} />
          <Text className="ml-1 text-sm font-medium text-foreground">{translate('local.add_manual')}</Text>
        </Button>
      </View>
      {dayEntries.length === 0
        ? (
            <Card onPress={addTime} className="items-center py-6" testID="local-day-empty" a11yLabel={translate('local.day_empty')}>
              <Text className="text-muted-foreground" tx="local.day_empty" />
            </Card>
          )
        : (
            <Card className="p-0">
              {dayEntries.map((e, i) => <EntryRow key={e.id} entry={e} last={i === dayEntries.length - 1} />)}
            </Card>
          )}
    </View>
  );
}

function EntryRow({ entry, last }: { entry: LocalEntry; last: boolean }) {
  const router = useRouter();
  const clients = useLocalStore.use.clients();
  const projects = useLocalStore.use.projects();
  const tags = useLocalStore.use.tags();
  const label = selectionLabel({ clients, projects }, entry);
  const firstTag = tags.find(t => entry.tagIds.includes(t.id));
  return (
    <ListRow
      title={entry.description || label || translate('local.no_project')}
      subtitle={[`${formatClock(entry.startedAt)}–${formatClock(entry.endedAt)}`, entry.description ? label : null].filter(Boolean).join(' · ')}
      left={firstTag ? <ColorDot color={firstTag.color} /> : undefined}
      right={formatHoursClock(entrySeconds(entry) / 3600)}
      onPress={() => router.push({ pathname: '/local/entry', params: { id: entry.id } })}
      last={last}
      testID={`local-entry-${entry.id}`}
    />
  );
}
