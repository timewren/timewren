import type { Period } from '../period';
import { useRouter } from 'expo-router';
import { Clock, FolderKanban, Receipt, TrendingUp } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { StatTile } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatHours, formatMoney, formatPercent } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { billableShare, estimateRevenue, periodRange } from '../period';
import { SectionState, TileRow } from './section-state';

type Props = { period: Period };

/** Timer · fakturerbart · omsætning · ufaktureret · aktive projekter for valgt periode. */
export function KeyFigures({ period }: Props) {
  const router = useRouter();
  const caps = useCapabilities();
  const showMoney = !caps.isEnterprise;
  const range = React.useMemo(() => periodRange(period), [period]);

  const profit = trpc.time.getProfitability.useQuery({ from: range.from, to: range.to });
  const monthlyRevenue = trpc.time.monthlyRevenue.useQuery(undefined, { enabled: showMoney && period === 'month' });
  const unbilled = trpc.time.unbilledStats.useQuery(undefined, { enabled: showMoney });
  const projectCount = trpc.projects.count.useQuery(undefined, { enabled: !caps.isEnterprise && caps.isEnabled('projects') });

  const retry = () => {
    void profit.refetch();
    void monthlyRevenue.refetch();
    void unbilled.refetch();
    void projectCount.refetch();
  };

  const totalHours = profit.data?.totalHours ?? 0;
  const billableHours = profit.data?.billableHours ?? 0;
  const revenue = period === 'month' && monthlyRevenue.data != null
    ? monthlyRevenue.data
    : estimateRevenue(billableHours, profit.data?.agreedRate ?? null);

  return (
    <SectionState
      isLoading={profit.isLoading}
      isError={profit.isError}
      error={profit.error}
      onRetry={retry}
    >
      <View className="gap-3">
        <TileRow>
          <StatTile
            label={translate('overview.hours')}
            value={formatHours(totalHours)}
            icon={Clock}
            tone="primary"
            testID="overview-hours"
          />
          <StatTile
            label={translate('overview.billable_hours')}
            value={formatHours(billableHours)}
            hint={translate('overview.billable_share', { percent: formatPercent(billableShare(totalHours, billableHours)) })}
            tone="success"
          />
        </TileRow>
        {showMoney
          ? (
              <TileRow>
                <StatTile
                  label={translate('overview.revenue')}
                  value={revenue == null ? '–' : formatMoney(revenue)}
                  /* Månedsomsætningen er sit eget kald. Faller den, ville kortet
                     vise den estimerede sum som var den rigtige — på en måned er
                     der ingen "estimeret"-påskrift. Samme grund gælder mens kallet
                     er på vej: estimatet er en tilfældighed, ikke månedens tal. */
                  loading={period === 'month' && monthlyRevenue.isLoading}
                  error={monthlyRevenue.isError && period === 'month'}
                  hint={period === 'month' ? undefined : translate('overview.revenue_estimated')}
                  icon={TrendingUp}
                />
                <StatTile
                  label={translate('overview.unbilled')}
                  value={formatMoney(unbilled.data?.value ?? 0)}
                  loading={unbilled.isLoading}
                  error={unbilled.isError}
                  hint={translate('overview.unbilled_hint', {
                    hours: formatHours(unbilled.data?.hours ?? 0),
                    count: unbilled.data?.count ?? 0,
                  })}
                  icon={Receipt}
                  tone={(unbilled.data?.value ?? 0) > 0 ? 'warning' : 'default'}
                  onPress={caps.isEnabled('invoicing') ? () => router.push(href('/invoices')) : undefined}
                />
              </TileRow>
            )
          : null}
        {!caps.isEnterprise && caps.isEnabled('projects')
          ? (
              <TileRow>
                <StatTile
                  label={translate('overview.active_projects')}
                  value={String(projectCount.data ?? 0)}
                  loading={projectCount.isLoading}
                  error={projectCount.isError}
                  icon={FolderKanban}
                  onPress={() => router.push(href('/projects'))}
                />
              </TileRow>
            )
          : null}
      </View>
    </SectionState>
  );
}
