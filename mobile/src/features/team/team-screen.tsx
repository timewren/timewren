import * as React from 'react';
import { View } from 'react-native';
import { Card, Screen, Segmented, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { DayOverview } from './components/day-overview';
import { LiveTimers } from './components/live-timers';
import { MembersList } from './components/members-list';
import { WeekOverview } from './components/week-overview';

type TeamView = 'day' | 'week';

/**
 * Team-fanen (org uden enterprise): live timere, dags-/ugeoverblik (admin) og medlemsliste.
 */
export function TeamScreen() {
  const caps = useCapabilities();
  const utils = trpc.useUtils();
  const [view, setView] = React.useState<TeamView>('day');
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([utils.team.invalidate(), utils.organization.invalidate()]);
    }
    finally {
      setRefreshing(false);
    }
  }, [utils]);

  const options = React.useMemo(
    () => [
      { value: 'day' as const, label: translate('team.day') },
      { value: 'week' as const, label: translate('team.week') },
    ],
    [],
  );

  return (
    <Screen
      title={translate('team.title')}
      subtitle={caps.orgName ?? undefined}
      header={caps.isAdmin ? <Segmented options={options} value={view} onChange={setView} testID="team-view" /> : undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View className="gap-1">
        <LiveTimers />
        <View className="mt-6">
          {caps.isAdmin
            ? (view === 'day' ? <DayOverview /> : <WeekOverview />)
            : caps.isManager
              ? (
                  <Card>
                    <Text className="text-sm text-muted-foreground">{translate('team.admin_only')}</Text>
                  </Card>
                )
              : null}
        </View>
        <MembersList />
      </View>
    </Screen>
  );
}
