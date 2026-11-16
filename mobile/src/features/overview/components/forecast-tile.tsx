import { TrendingDown, TrendingUp } from 'lucide-react-native';
import * as React from 'react';
import { StatTile } from '~/components/ui';
import { trpc } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { SectionState } from './section-state';

/** Omsætningsprognose for indeværende måned — én tile. */
export function ForecastTile() {
  const query = trpc.time.revenueForecast.useQuery();
  const trend = query.data?.trendPercentage ?? 0;
  const trendText = `${trend >= 0 ? '+' : ''}${Math.round(trend)} %`;

  return (
    <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
      <StatTile
        label={translate('overview.forecast')}
        value={formatMoney(query.data?.forecastRevenue ?? 0)}
        hint={translate('overview.forecast_hint', {
          current: formatMoney(query.data?.currentRevenue ?? 0),
          trend: trendText,
        })}
        icon={trend >= 0 ? TrendingUp : TrendingDown}
        tone={trend >= 0 ? 'success' : 'warning'}
        testID="overview-forecast"
      />
    </SectionState>
  );
}
