import type { FlexRangeMode } from './flex-logic';
import { parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Avatar } from '~/components/ui/avatar';
import { Card, SectionHeader } from '~/components/ui/card';
import colors from '~/components/ui/colors';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { ListRow } from '~/components/ui/list-row';
import { Screen } from '~/components/ui/screen';
import { Segmented } from '~/components/ui/segmented';
import { ListSkeleton } from '~/components/ui/skeleton';
import { StatTile } from '~/components/ui/stat-tile';
import { Text } from '~/components/ui/text';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { EnterpriseGate } from '~/features/enterprise/absence/components/enterprise-gate';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateLong, formatHours } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { deltaTone, flexRange, formatDelta, shiftAnchor, sumDelta } from './flex-logic';

function RangeNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.neutral[100] : colors.neutral[900];
  return (
    <View className="mb-2 flex-row items-center justify-between">
      <Pressable onPress={onPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.previous')} className="size-11 items-center justify-center rounded-full active:bg-muted" testID="range-prev">
        <ChevronLeft size={22} color={tint} />
      </Pressable>
      <Text className="text-base font-semibold text-foreground">{label}</Text>
      <Pressable onPress={onNext} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.next')} className="size-11 items-center justify-center rounded-full active:bg-muted" testID="range-next">
        <ChevronRight size={22} color={tint} />
      </Pressable>
    </View>
  );
}

function DeltaText({ delta }: { delta: string | number }) {
  const tone = deltaTone(delta);
  const cls = tone === 'success'
    ? 'text-success-600 dark:text-success-400'
    : tone === 'danger' ? 'text-danger-600 dark:text-danger-400' : 'text-muted-foreground';
  return <Text className={`text-base font-semibold ${cls}`}>{formatDelta(delta)}</Text>;
}

function TeamBalances() {
  const query = trpc.enterprise.getTeamBalances.useQuery();
  // Se overtime: to regioner på skærmen, hver med sit eget skelet og sin besked.
  useAnnounceLoaded(query, translate('enterprise.flex.loaded_team'));
  if (query.isLoading)
    return <ListSkeleton rows={2} />;
  if (query.isError)
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0)
    return <Text className="text-sm text-muted-foreground">{translate('enterprise.flex.team_empty')}</Text>;
  return (
    <Card className="p-0">
      {rows.map((m, i) => (
        <ListRow
          key={m.userId}
          title={m.user?.name ?? '—'}
          subtitle={translate('enterprise.flex.entries_count', { count: m.totalEntries })}
          left={<Avatar name={m.user?.name} image={m.user?.image} size={34} />}
          right={<DeltaText delta={m.balance} />}
          last={i === rows.length - 1}
        />
      ))}
    </Card>
  );
}

function FlexBody() {
  const caps = useCapabilities();
  const [mode, setMode] = React.useState<FlexRangeMode>('week');
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [refreshing, setRefreshing] = React.useState(false);
  const range = React.useMemo(() => flexRange(anchor, mode), [anchor, mode]);
  // `asOf` er en ægte WHERE-præmis på serveren (saldo *pr. dato*), så den må
  // ikke stå frosset fra montering: en skærm der står åben over midnat skal
  // vise dagens saldo, og pull-to-refresh skal kunne nå den.
  const today = useToday();

  const balance = trpc.enterprise.getBalance.useQuery({ asOf: today });
  const entries = trpc.enterprise.getEntries.useQuery({ startDate: range.start, endDate: range.end });
  // Kun posteringerne har et skeleton; saldoen viser en tankestreg undervejs.
  useAnnounceLoaded(entries, translate('enterprise.flex.loaded_entries'));
  const list = entries.data ?? [];
  const periodDelta = sumDelta(list);

  const utils = trpc.useUtils();
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      // Invaliderer også teamsaldi (manager/HR-sektionen) — ikke kun egne queries.
      await Promise.all([balance.refetch(), entries.refetch(), utils.enterprise.getTeamBalances.invalidate()]);
    }
    finally {
      setRefreshing(false);
    }
  }, [balance, entries, utils]);

  const modeOptions: { value: FlexRangeMode; label: string }[] = [
    { value: 'week', label: translate('enterprise.flex.week') },
    { value: 'month', label: translate('enterprise.flex.month') },
  ];

  return (
    <Screen
      title={translate('enterprise.flex.title')}
      back
      header={<Segmented options={modeOptions} value={mode} onChange={setMode} testID="flex-mode" />}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <View className="flex-row gap-3">
        <StatTile
          label={translate('enterprise.flex.balance')}
          value={balance.isLoading ? '—' : formatDelta(balance.data?.balance ?? 0)}
          loading={balance.isLoading}
          error={balance.isError}
          hint={translate('enterprise.flex.balance_hint')}
          icon={Clock}
          tone={deltaTone(balance.data?.balance ?? 0)}
          testID="flex-balance"
        />
        <StatTile
          label={translate('enterprise.flex.period_delta')}
          value={entries.isLoading ? '—' : formatDelta(periodDelta)}
          loading={entries.isLoading}
          error={entries.isError}
          hint={range.label}
          tone={deltaTone(periodDelta)}
          testID="flex-period"
        />
      </View>

      <SectionHeader title={translate('enterprise.flex.days')} />
      <RangeNav
        label={range.label}
        onPrev={() => setAnchor(a => shiftAnchor(a, mode, -1))}
        onNext={() => setAnchor(a => shiftAnchor(a, mode, 1))}
      />
      {entries.isLoading
        ? <ListSkeleton />
        : entries.isError
          ? <ErrorState message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
          : list.length === 0
            ? <EmptyState icon={Clock} title={translate('enterprise.flex.empty')} description={translate('enterprise.flex.empty_body')} compact />
            : (
                <Card className="p-0">
                  {list.map((e, i) => (
                    <ListRow
                      key={e.id}
                      title={formatDateLong(parseISO(e.date))}
                      subtitle={`${translate('enterprise.flex.expected')} ${formatHours(e.expectedHours)} · ${translate('enterprise.flex.actual')} ${formatHours(e.actualHours)}${e.note ? ` · ${e.note}` : ''}`}
                      right={<DeltaText delta={e.delta} />}
                      last={i === list.length - 1}
                    />
                  ))}
                </Card>
              )}

      {caps.isManager || caps.isHr
        ? (
            <>
              <SectionHeader title={translate('enterprise.flex.team')} />
              <TeamBalances />
            </>
          )
        : null}
    </Screen>
  );
}

export function FlexScreen() {
  return (
    <EnterpriseGate title={translate('enterprise.flex.title')} back>
      <FlexBody />
    </EnterpriseGate>
  );
}
