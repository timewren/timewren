import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Plus, Timer } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Card, SectionHeader } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { IconButton } from '~/components/ui/icon-button';
import { ListRow } from '~/components/ui/list-row';
import { Screen } from '~/components/ui/screen';
import { ListSkeleton } from '~/components/ui/skeleton';
import { StatTile } from '~/components/ui/stat-tile';
import { Text } from '~/components/ui/text';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { EnterpriseGate } from '~/features/enterprise/absence/components/enterprise-gate';
import { deltaTone, formatDelta } from '~/features/enterprise/flex/flex-logic';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { AddEntrySheet } from './add-entry-sheet';
import { overtimeTypeKey, overtimeTypeTone } from './overtime-logic';

function DeltaText({ hours }: { hours: string | number }) {
  const tone = deltaTone(hours);
  const cls = tone === 'success'
    ? 'text-success-600 dark:text-success-400'
    : tone === 'danger' ? 'text-danger-600 dark:text-danger-400' : 'text-muted-foreground';
  return <Text className={`text-base font-semibold ${cls}`}>{formatDelta(hours)}</Text>;
}

function MyEntries() {
  const query = trpc.enterprise.getMyOvertime.useQuery();
  // To regioner på skærmen, hver med sit skelet. Én samlet stop ville kræve at
  // begge kald løftes op i OvertimeBody; hver sin besked er ærligere — brugeren
  // ved hvilken del der kom.
  useAnnounceLoaded(query, translate('enterprise.overtime.loaded_mine'));
  if (query.isLoading)
    return <ListSkeleton />;
  if (query.isError)
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const entries = query.data?.entries ?? [];
  return (
    <View>
      <View className="flex-row gap-3">
        <StatTile
          label={translate('enterprise.overtime.balance')}
          value={formatDelta(query.data?.balance ?? 0)}
          hint={translate('enterprise.overtime.balance_hint')}
          icon={Timer}
          tone={deltaTone(query.data?.balance ?? 0)}
          testID="overtime-balance"
        />
      </View>
      <SectionHeader title={translate('enterprise.overtime.entries')} />
      {entries.length === 0
        ? <EmptyState icon={Timer} title={translate('enterprise.overtime.empty')} description={translate('enterprise.overtime.empty_body')} compact />
        : (
            <Card className="p-0">
              {entries.map((e, i) => (
                <ListRow
                  key={e.id}
                  title={translate(overtimeTypeKey(e.type))}
                  subtitle={`${formatDateShort(e.createdAt)}${e.note ? ` · ${e.note}` : ''}`}
                  left={<Badge label={translate(overtimeTypeKey(e.type))} tone={overtimeTypeTone(e.type)} />}
                  right={<DeltaText hours={e.hours} />}
                  last={i === entries.length - 1}
                />
              ))}
            </Card>
          )}
    </View>
  );
}

function TeamOverview({ sheetRef }: { sheetRef: React.RefObject<BottomSheetModal | null> }) {
  const query = trpc.enterprise.getOvertimeOverview.useQuery();
  useAnnounceLoaded(query, translate('enterprise.overtime.loaded_team'));
  if (query.isLoading)
    return <ListSkeleton rows={2} />;
  if (query.isError)
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  return (
    <View>
      {rows.length === 0
        ? <Text className="text-sm text-muted-foreground">{translate('enterprise.overtime.team_empty')}</Text>
        : (
            <Card className="p-0">
              {rows.map((m, i) => (
                <ListRow
                  key={m.userId}
                  title={m.name}
                  subtitle={m.email || undefined}
                  left={<Avatar name={m.name} size={34} />}
                  right={<DeltaText hours={m.balance} />}
                  last={i === rows.length - 1}
                />
              ))}
            </Card>
          )}
      <AddEntrySheet sheetRef={sheetRef} members={rows.map(r => ({ userId: r.userId, name: r.name }))} />
    </View>
  );
}

function OvertimeBody() {
  const caps = useCapabilities();
  const utils = trpc.useUtils();
  const [refreshing, setRefreshing] = React.useState(false);
  const sheetRef = React.useRef<BottomSheetModal>(null);
  const canPost = caps.isManager;
  const seesTeam = caps.isManager || caps.isHr;

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([utils.enterprise.getMyOvertime.invalidate(), utils.enterprise.getOvertimeOverview.invalidate()]);
    setRefreshing(false);
  }, [utils]);

  return (
    <Screen
      title={translate('enterprise.overtime.title')}
      back
      right={canPost ? <IconButton icon={Plus} label={translate('enterprise.overtime.add_entry')} variant="primary" onPress={() => sheetRef.current?.present()} testID="overtime-add" /> : undefined}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <MyEntries />
      {seesTeam
        ? (
            <>
              <SectionHeader title={translate('enterprise.overtime.team')} />
              <TeamOverview sheetRef={sheetRef} />
            </>
          )
        : null}
    </Screen>
  );
}

export function OvertimeScreen() {
  return (
    <EnterpriseGate title={translate('enterprise.overtime.title')} back>
      <OvertimeBody />
    </EnterpriseGate>
  );
}
