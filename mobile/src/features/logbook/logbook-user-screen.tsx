import type { DayDetail } from './logbook-logic';
import { parseISO } from 'date-fns';
import { useLocalSearchParams } from 'expo-router';
import { CalendarDays, Coffee } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import {
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Screen,
  SectionHeader,
  StatTile,
  Text,
} from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { formatGap, gapLabels, hasTimeline, isWeekStart, weekDates, weekStartAt } from './logbook-logic';

export function LogbookUserScreen() {
  // Ruten hedder `[user-id]`, så param-nøglen indeholder en bindestreg og
  // må citeres — og så skal alle nøgler i typen det (ESLint quote-props).
  const params = useLocalSearchParams<{ 'user-id': string; 'weekStart': string }>();
  const userId = params['user-id'];
  // Et dybt link uden `weekStart` må ikke give en død fejlskærm: så falder vi
  // tilbage på den aktuelle uge, præcis som logbogen viser den.
  const start = isWeekStart(params.weekStart) ? params.weekStart : weekStartAt(0);
  const query = trpc.logbook.dayDetail.useQuery({ userId, weekStart: start }, { enabled: !!userId });
  const refresh = React.useCallback(() => void query.refetch(), [query]);

  useAnnounceLoaded(query, translate('common.loaded'));

  const data = query.data;
  const body = query.isLoading && !data
    ? <ListSkeleton rows={3} />
    : !data
        ? <ErrorState message={errorMessage(query.error)} onRetry={refresh} />
        : <DayList days={data.days} weekStart={start} />;

  return (
    <Screen
      title={translate('logbook.day_title')}
      subtitle={translate('logbook.week_of', { date: formatDateShort(parseISO(start)) })}
      back
      refreshing={query.isRefetching}
      onRefresh={refresh}
    >
      {body}
    </Screen>
  );
}

function DayList({ days, weekStart }: { days: DayDetail[]; weekStart: string }) {
  const dates = weekDates(weekStart);
  const byDate = new Map(days.map(d => [d.date, d]));
  const worked = days.reduce((sum, d) => sum + d.summary.workedMinutes, 0);
  const paused = days.reduce((sum, d) => sum + d.summary.gapMinutes, 0);
  const untimed = days.reduce((sum, d) => sum + d.summary.untimedEntries, 0);
  const hasDays = days.length > 0;

  if (!hasDays) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={translate('logbook.day_empty_title')}
        description={translate('logbook.day_empty_body')}
        compact
      />
    );
  }

  return (
    <>
      <View className="flex-row gap-3">
        <StatTile label={translate('logbook.worked')} value={formatGap(worked)} tone="primary" />
        <StatTile
          label={translate('logbook.paused')}
          value={formatGap(paused)}
          tone={paused > 0 ? 'warning' : 'default'}
          hint={untimed > 0 ? translate('logbook.untimed_hint', { count: untimed }) : undefined}
        />
      </View>
      <SectionHeader title={translate('logbook.timeline')} />
      <Card className="gap-4">
        {dates.map((date) => {
          const day = byDate.get(date);
          return day ? <DayBlock key={date} day={day} /> : null;
        })}
      </Card>
      {untimed > 0
        ? (
            <Card className="mt-3 gap-1" testID="logbook-untimed">
              <Text className="text-sm font-medium text-foreground" tx="logbook.untimed_title" />
              <Text className="text-sm text-muted-foreground" tx="logbook.untimed_body" />
            </Card>
          )
        : null}
    </>
  );
}

function DayBlock({ day }: { day: DayDetail }) {
  const label = `${formatDateShort(parseISO(day.date))}: ${formatHours(day.totalHours)}, ${translate('logbook.worked')} ${formatGap(day.summary.workedMinutes)}`;
  return (
    <View accessible accessibilityLabel={label} className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-medium text-foreground">{formatDateShort(parseISO(day.date))}</Text>
        <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHours(day.totalHours)}</Text>
      </View>
      {hasTimeline(day)
        ? (
            <>
              <IntervalList day={day} />
              <GapList day={day} />
            </>
          )
        : (
            <Text className="text-xs text-muted-foreground" tx="logbook.no_timeline" />
          )}
    </View>
  );
}

function IntervalList({ day }: { day: DayDetail }) {
  return (
    <View className="gap-1">
      {day.intervals.map((iv, i) => {
        const name = iv.projectName ?? iv.clientName ?? translate('logbook.unassigned');
        return (
          <View key={`${i}-${iv.start ?? ''}`} className="flex-row items-baseline justify-between gap-2">
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>{name}</Text>
            <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {iv.start ? formatTime(iv.start) : '—'}
              –
              {iv.end ? formatTime(iv.end) : '—'}
            </Text>
            <Text className="w-14 text-right text-sm text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHours(iv.hours)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function GapList({ day }: { day: DayDetail }) {
  const gaps = gapLabels(day);
  if (gaps.length === 0)
    return null;
  return (
    <View className="gap-1" testID="logbook-gaps">
      {gaps.map((gap, i) => (
        <View key={`${i}-${gap.minutes}`} className="flex-row items-center gap-2">
          <Coffee size={12} color="#d97706" />
          <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatGap(gap.minutes)}</Text>
          <Text className={twMerge('flex-1 text-xs text-muted-foreground')} numberOfLines={1}>{gap.label}</Text>
        </View>
      ))}
    </View>
  );
}
