import { useRouter } from 'expo-router';
import { AlertCircle, Ticket, TimerOff } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { SectionHeader, StatTile } from '~/components/ui';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { SectionState, TileRow } from './section-state';

/** Samlet klippekort-saldo + pakker der udløber snart / har lav saldo. Alt linker til /prepaid. Skjules uden aktive pakker. */
export function KlippekortSection() {
  const router = useRouter();
  const packages = trpc.prepaid.list.useQuery({ activeOnly: true });
  const expiring = trpc.prepaid.getExpiring.useQuery();
  const low = trpc.prepaid.getLowBalance.useQuery({});

  const balance = React.useMemo(
    () => (packages.data ?? []).reduce((sum, p) => sum + Number.parseFloat(p.remainingHours || '0'), 0),
    [packages.data],
  );
  const goPrepaid = () => router.push(href('/prepaid'));
  const retry = () => {
    void packages.refetch();
    void expiring.refetch();
    void low.refetch();
  };
  const expiringCount = expiring.data?.length ?? 0;
  const lowCount = low.data?.length ?? 0;

  if (packages.isSuccess && (packages.data ?? []).length === 0)
    return null;

  return (
    <View>
      <SectionHeader title={translate('overview.klippekort')} action={{ label: translate('home.see_all'), onPress: goPrepaid }} />
      <SectionState
        isLoading={packages.isLoading}
        isError={packages.isError || expiring.isError || low.isError}
        error={packages.error ?? expiring.error ?? low.error}
        onRetry={retry}
      >
        <View className="gap-3">
          <TileRow>
            <StatTile
              label={translate('overview.klippekort_balance')}
              value={formatHours(balance)}
              hint={translate('overview.klippekort_packages', { count: packages.data?.length ?? 0 })}
              icon={Ticket}
              tone="violet"
              onPress={goPrepaid}
              testID="overview-klippekort-balance"
            />
          </TileRow>
          <TileRow>
            <StatTile
              label={translate('overview.klippekort_expiring')}
              value={String(expiringCount)}
              /* Hvert advarselskort er sit eget kald. Uden `loading` stod de med
                 `0` mens kaldene var på vej, og en `0` her siger "intet
                 udløber" om et svar der ikke kom. Hinten kommer fra samme kald
                 og skal derfor også væk, ellers læser skærmlæseren
                 "0 pakker inden 30 dage" på et kort uden værdi. */
              loading={expiring.isLoading}
              hint={expiring.isLoading ? undefined : translate('overview.klippekort_expiring_hint', { count: expiringCount })}
              icon={TimerOff}
              tone={expiringCount > 0 ? 'warning' : 'default'}
              onPress={goPrepaid}
            />
            <StatTile
              label={translate('overview.klippekort_low')}
              value={String(lowCount)}
              loading={low.isLoading}
              hint={low.isLoading ? undefined : translate('overview.klippekort_low_hint', { count: lowCount })}
              icon={AlertCircle}
              tone={lowCount > 0 ? 'danger' : 'default'}
              onPress={goPrepaid}
            />
          </TileRow>
        </View>
      </SectionState>
    </View>
  );
}
