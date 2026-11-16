import type { OverviewMember } from './logbook-logic';
import type { RouterOutputs } from '~/api/app-router';
import { parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import {
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListSkeleton,
  Screen,
  SectionHeader,
  StatTile,
  Text,
} from '~/components/ui';
import { href } from '~/features/more/links';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import {
  activeDates,
  canGoForward,
  clockRange,
  dayShort,
  hasPreciseTimes,
  memberHours,
  weekDates,
  weekStartAt,
} from './logbook-logic';

type Overview = RouterOutputs['logbook']['weekOverview'];

export function LogbookScreen() {
  // Logbogen er historik: den starter ved denne uge og kan ikke rulle frem.
  const [offset, setOffset] = React.useState(0);
  const weekStart = weekStartAt(offset);
  const query = trpc.logbook.weekOverview.useQuery({ weekStart });
  const refresh = React.useCallback(() => void query.refetch(), [query]);

  useAnnounceLoaded(query, translate('common.loaded'));

  const data = query.data;
  const body = query.isLoading && !data
    ? <ListSkeleton rows={3} />
    : !data
        ? <ErrorState message={errorMessage(query.error)} onRetry={refresh} />
        : <OverviewBody data={data} weekStart={weekStart} />;

  return (
    <Screen
      title={translate('logbook.title')}
      subtitle={translate('logbook.week_of', { date: formatDateShort(parseISO(weekStart)) })}
      back
      refreshing={query.isRefetching}
      onRefresh={refresh}
    >
      <WeekNav offset={offset} onChange={setOffset} />
      {body}
    </Screen>
  );
}

function WeekNav({ offset, onChange }: { offset: number; onChange: (offset: number) => void }) {
  return (
    <View className="mb-4 flex-row items-center justify-between">
      <IconButton icon={ChevronLeft} label={translate('logbook.prev_week')} onPress={() => onChange(offset - 1)} testID="logbook-prev-week" />
      <Text className="text-sm text-muted-foreground" testID="logbook-week-label">
        {offset === 0 ? translate('logbook.this_week') : translate('logbook.weeks_ago', { count: Math.abs(offset) })}
      </Text>
      <IconButton
        icon={ChevronRight}
        label={translate('logbook.next_week')}
        disabled={!canGoForward(offset)}
        onPress={() => onChange(offset + 1)}
        testID="logbook-next-week"
      />
    </View>
  );
}

function OverviewBody({ data, weekStart }: { data: Overview; weekStart: string }) {
  const router = useRouter();
  const dates = weekDates(weekStart);
  const total = data.members.reduce((sum, m) => sum + memberHours(m), 0);
  const active = data.members.reduce((n, m) => n + activeDates(m, weekStart).length, 0);

  if (data.members.length === 0 || total === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={translate('logbook.empty_title')}
        description={translate('logbook.empty_body')}
        action={{ label: translate('logbook.register_time'), onPress: () => router.push(href('/time')), testID: 'logbook-empty-action' }}
        compact
      />
    );
  }

  return (
    <>
      <View className="flex-row gap-3">
        <StatTile label={translate('logbook.registered')} value={formatHours(total)} tone="primary" />
        <StatTile
          label={translate('logbook.active_days')}
          value={String(active)}
          hint={data.canSeeAll ? translate('logbook.all_members') : undefined}
        />
      </View>
      <SectionHeader title={translate('logbook.days_at_a_glance')} />
      <Card className="gap-3">
        {data.members.map(m => <MemberRow key={m.userId} member={m} dates={dates} />)}
      </Card>
      {data.canSeeAll
        ? <Text className="mt-3 text-xs text-muted-foreground" tx="logbook.all_members_hint" />
        : <Text className="mt-3 text-xs text-muted-foreground" tx="logbook.only_self" />}
    </>
  );
}

function MemberRow({ member, dates }: { member: OverviewMember; dates: string[] }) {
  const router = useRouter();
  const hours = memberHours(member);
  return (
    <Card
      className="gap-2"
      onPress={() => router.push(href(`/logbook/${member.userId}?weekStart=${dates[0]}`))}
      accessible
      accessibilityLabel={`${member.name}: ${formatHours(hours)}`}
      testID={`logbook-member-${member.userId}`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>{member.name}</Text>
        <Text className="text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHours(hours)}</Text>
      </View>
      <View className="flex-row gap-1">
        {dates.map(date => <DayCell key={date} date={date} member={member} />)}
      </View>
    </Card>
  );
}

function DayCell({ date, member }: { date: string; member: OverviewMember }) {
  const cell = member.days[date];
  const empty = !cell || cell.entriesCount === 0;
  const range = clockRange(cell);
  // Uden tidsstemplede registreringer viser vi kun varigheden, ellers ville vi
  // påstå præcise komme/gå-tider for timer der aldrig fik nogen.
  const precise = hasPreciseTimes(cell);
  const caption = empty ? '—' : (precise && range) || formatHours(cell!.totalHours, { unit: false });
  const label = empty
    ? `${dayShort(date)}: ${translate('logbook.no_time')}`
    : `${dayShort(date)}: ${formatHours(cell!.totalHours)}${precise && range ? `, ${range}` : ''}`;
  return (
    <View
      className={twMerge('flex-1 items-center rounded-md py-1', empty ? 'bg-muted/40' : 'bg-primary-600/10')}
      accessible
      accessibilityLabel={label}
    >
      <Text className="text-[10px] text-muted-foreground">{dayShort(date)}</Text>
      <Text
        className={twMerge('text-[11px]', empty ? 'text-muted-foreground' : 'font-medium text-foreground')}
        numberOfLines={1}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {caption}
      </Text>
    </View>
  );
}
