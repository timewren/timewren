import { useRouter } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, ListRow, SectionHeader } from '~/components/ui';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { SectionState } from './section-state';

const DAYS_SILENT = 60;

/** Kunder med tidligere aktivitet, men ingen tid de sidste 60 dage. Skjules når listen er tom. */
export function AtRiskClients() {
  const router = useRouter();
  const query = trpc.clients.getAtRiskClients.useQuery({ daysSilent: DAYS_SILENT });
  const list = query.data ?? [];

  if (query.isSuccess && list.length === 0)
    return null;

  return (
    <View>
      <SectionHeader title={translate('overview.at_risk')} />
      <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
        <Card className="p-0">
          {list.slice(0, 5).map((client, i) => (
            <ListRow
              key={client.clientId}
              title={client.clientName}
              subtitle={translate('overview.at_risk_days', { days: client.daysSinceLastActivity })}
              left={<AlertTriangle size={18} color="#d97706" />}
              right={client.recentRevenue > 0 ? <Badge label={formatMoney(client.recentRevenue)} tone="warning" /> : undefined}
              onPress={() => router.push(href(`/clients/${client.clientId}`))}
              last={i === Math.min(list.length, 5) - 1}
            />
          ))}
        </Card>
      </SectionState>
    </View>
  );
}
