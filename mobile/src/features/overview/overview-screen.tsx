import type { Period } from './period';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { IconButton, Screen, Segmented } from '~/components/ui';
import { isDefaultOrgName, useCapabilities } from '~/features/capabilities/use-capabilities';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { AtRiskClients } from './components/at-risk-clients';
import { Deadlines } from './components/deadlines';
import { EnterpriseSection } from './components/enterprise-section';
import { ForecastTile } from './components/forecast-tile';
import { Heatmap } from './components/heatmap';
import { KeyFigures } from './components/key-figures';
import { KlippekortSection } from './components/klippekort-section';
import { TeamSection } from './components/team-section';
import { TopClients } from './components/top-clients';
import { PERIODS } from './period';

/**
 * Overblik — adaptivt efter capabilities: freelance-nøgletal, klippekort, team (ledere)
 * og enterprise-saldi. Hver sektion henter selv og har egen skeleton/fejl.
 */
export function OverviewScreen() {
  const router = useRouter();
  const caps = useCapabilities();
  const utils = trpc.useUtils();
  const [period, setPeriod] = React.useState<Period>('month');
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await utils.invalidate();
    }
    finally {
      setRefreshing(false);
    }
  }, [utils]);

  const periodOptions = React.useMemo(
    () => PERIODS.map(value => ({ value, label: translate(`overview.period_${value}`) })),
    [],
  );

  const showTeam = caps.isManager && caps.hasOrg && caps.tier !== 'solo';
  const freelance = !caps.isEnterprise;

  return (
    <Screen
      title={translate('overview.title')}
      subtitle={caps.orgName && !isDefaultOrgName(caps.orgName) ? caps.orgName : undefined}
      right={<IconButton icon={Search} label={translate('more.search')} onPress={() => router.push(href('/search'))} testID="overview-search" />}
      header={<Segmented options={periodOptions} value={period} onChange={setPeriod} testID="overview-period" />}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View className="gap-1">
        <KeyFigures period={period} />
        {caps.isEnterprise ? <EnterpriseSection /> : null}
        {freelance && caps.isEnabled('klippekort') ? <KlippekortSection /> : null}
        {showTeam ? <TeamSection /> : null}
        {freelance && caps.isEnabled('clients') ? <TopClients /> : null}
        {freelance && caps.isEnabled('clients') ? <AtRiskClients /> : null}
        <Heatmap />
        {freelance
          ? (
              <View className="mt-6">
                <ForecastTile />
              </View>
            )
          : null}
        {freelance ? <Deadlines /> : null}
      </View>
    </Screen>
  );
}
