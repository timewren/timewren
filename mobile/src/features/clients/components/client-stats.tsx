import type { RouterOutputs } from '~/api/app-router';
import { Banknote, Clock, Receipt, Timer } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { ErrorState, StatTile } from '~/components/ui';
import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';

type Client = RouterOutputs['clients']['getById'];
type Stats = RouterOutputs['clients']['listWithStats'][number]['stats'];

type Props = {
  client: Client;
  stats: Stats | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Allerede omsat af `errorMessage(error)` — denne komponent kender ikke API'et. */
  errorMessage?: string;
  onRetry: () => void;
};

/**
 * Nøgletallene på kundedetaljen, med egen fejltilstand *og* egen
 * indlæsningstilstand.
 *
 * R5 rettede den fejlede kald: et kald der svarer 500 gav først "0,0 t" og
 * "0,00 kr.". Men `stats` er også `undefined` mens det første kald er i
 * gang, og `?? 0` gør de samme tal uden nogen fejl — på en skærm hvis
 * formål er fakturering. Derfor `loading` på de tre kort der læser kallet:
 * `StatTile` maler en Skeleton og læser ingen værdi op, så hverken øjet eller
 * en skærmlæser hører et nul der ikke findes. Timesatsen kommer fra kunden,
 * ikke fra kallet, og står derfor ikke i skeletons.
 */
export function ClientStats({ client, stats, isLoading, isError, errorMessage, onRetry }: Props) {
  if (isError)
    return <View className="mt-3"><ErrorState message={errorMessage} onRetry={onRetry} /></View>;

  const rate = client.defaultHourlyRate ? formatMoney(client.defaultHourlyRate) : '—';
  return (
    <View className="mt-3 gap-2">
      <View className="flex-row gap-2">
        <StatTile label={translate('clients.stat_total_hours')} value={formatHours(stats?.totalHours ?? 0)} icon={Clock} loading={isLoading} />
        <StatTile
          label={translate('clients.stat_unbilled')}
          value={formatHours(stats?.unbilledHours ?? 0)}
          icon={Timer}
          tone={stats && stats.unbilledHours > 0 ? 'warning' : 'default'}
          loading={isLoading}
        />
      </View>
      <View className="flex-row gap-2">
        <StatTile label={translate('clients.stat_unbilled_value')} value={formatMoney(stats?.unbilledAmount ?? 0)} icon={Receipt} tone="primary" loading={isLoading} />
        <StatTile
          label={translate('clients.stat_rate')}
          value={rate}
          hint={client.defaultHourlyRate ? undefined : translate('clients.stat_rate_global')}
          icon={Banknote}
        />
      </View>
    </View>
  );
}
