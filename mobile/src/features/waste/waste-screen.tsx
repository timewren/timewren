import type { Period, WasteLog, WasteUser } from './waste-logic';
import { Coffee } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import {
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Screen,
  SectionHeader,
  Segmented,
  StatTile,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { formatGap } from '../logbook/logbook-logic';
import {
  formatGapHours,
  GAP_THRESHOLDS,
  isUnreadable,
  pauseCountKey,
  periodRange,
  PERIODS,
  rangeLabel,
  rankedUsers,
} from './waste-logic';

export function WasteScreen() {
  const caps = useCapabilities();
  const [period, setPeriod] = React.useState<Period>('last_week');
  const [threshold, setThreshold] = React.useState<number>(15);
  const range = periodRange(period);
  // `wasteLog` er orgAdminProcedure. Menuen skjuler vejen for alle andre, men
  // et dybt link må ikke give en rå 403 — derfor tjekker vi begge dele her.
  const allowed = caps.hasOrg && caps.isAdmin;
  const query = trpc.logbook.wasteLog.useQuery({ ...range, minGapMinutes: threshold }, { enabled: allowed });
  const refresh = React.useCallback(() => void query.refetch(), [query]);

  useAnnounceLoaded(query, translate('common.loaded'));

  const data = query.data;
  const body = !allowed
    ? <EmptyState title={translate('waste.no_access_title')} description={translate('waste.no_access_body')} compact />
    : query.isLoading && !data
      ? <ListSkeleton rows={3} />
      : !data
          ? <ErrorState message={errorMessage(query.error)} onRetry={refresh} />
          : <WasteBody data={data} />;

  return (
    <Screen
      title={translate('waste.title')}
      subtitle={rangeLabel(range)}
      back
      header={(
        <View className="gap-2">
          <Segmented
            options={PERIODS.map(p => ({ value: p, label: translate(`waste.period_${p}`) }))}
            value={period}
            onChange={setPeriod}
            testID="waste-period"
          />
          <Segmented
            options={GAP_THRESHOLDS.map(m => ({ value: String(m), label: formatGap(m) }))}
            value={String(threshold)}
            onChange={v => setThreshold(Number(v))}
            testID="waste-threshold"
          />
        </View>
      )}
      refreshing={query.isRefetching}
      onRefresh={refresh}
    >
      {body}
    </Screen>
  );
}

function WasteBody({ data }: { data: WasteLog }) {
  const users = rankedUsers(data);
  const total = data.totals.gapMinutes;

  if (isUnreadable(data)) {
    return <EmptyState icon={Coffee} title={translate('waste.untimed_title')} description={translate('waste.untimed_body')} compact />;
  }
  if (users.length === 0 || total === 0) {
    return (
      <EmptyState
        icon={Coffee}
        title={translate('waste.empty_title')}
        description={translate('waste.empty_body', { minutes: data.minGapMinutes })}
        compact
      />
    );
  }

  return (
    <>
      <View className="flex-row gap-3">
        <StatTile label={translate('waste.total_gap')} value={formatGap(total)} tone="warning" />
        <StatTile
          label={translate('waste.total_pauses')}
          value={String(data.totals.gapCount)}
          hint={translate('waste.above_threshold', { minutes: data.minGapMinutes })}
        />
      </View>
      <SectionHeader title={translate('waste.by_member')} />
      <Card className="gap-4">
        {users.map(u => <UserRow key={u.userId} user={u} peak={total} />)}
      </Card>
      {data.totals.untimedEntries > 0
        ? (
            <Card className="mt-3" testID="waste-untimed">
              <Text className="text-sm font-medium text-foreground" tx="waste.untimed_title" />
              <Text className="mt-1 text-sm text-muted-foreground" tx="waste.untimed_body" />
            </Card>
          )
        : null}
    </>
  );
}

function UserRow({ user, peak }: { user: WasteUser; peak: number }) {
  const share = peak > 0 ? Math.min(1, Math.max(0, user.gapMinutes / peak)) : 0;
  const pauses = translate(pauseCountKey(user.gapCount), { count: user.gapCount });
  const label = `${user.userName}: ${formatGap(user.gapMinutes)}, ${pauses}`;
  return (
    <View accessible accessibilityLabel={label} className="gap-1" testID={`waste-user-${user.userId}`}>
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>{user.userName}</Text>
        <Text className="text-sm text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatGap(user.gapMinutes)}</Text>
        <Text className="w-16 text-right text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatGapHours(user.gapMinutes)}</Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-muted">
        <View className="h-1.5 rounded-full bg-warning-500" style={{ width: `${Math.round(share * 100)}%` }} />
      </View>
      <Text className="text-xs text-muted-foreground">
        {pauses}
        {user.untimedEntries > 0 ? ` · ${translate('waste.untimed_hint', { count: user.untimedEntries })}` : ''}
      </Text>
    </View>
  );
}
