import { Redirect, useRouter } from 'expo-router';
import { ChartColumn, CloudOff, Settings2, X } from 'lucide-react-native';
import * as React from 'react';
import { Card, colors, IconButton, Screen, Text } from '~/components/ui';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { translate } from '~/lib/i18n';
import { LocalDayView } from './components/local-day-view';
import { LocalTimerCard } from './components/local-timer-card';
import { localStore, useLocalStore } from './local-store';

/** Forsiden i "uden konto"-tilstand: timer og dagsvisning med uge-navigation. */
export function LocalHomeScreen() {
  const router = useRouter();
  const status = useAuthStore.use.status();

  // Logget ind (fx efter oprettelse): hovedappen overtager og tilbyder overførsel.
  if (status === 'signIn')
    return <Redirect href="/" />;

  return (
    <Screen
      title="TimeTrack"
      right={(
        <>
          <IconButton icon={ChartColumn} label={translate('local.stats.title')} onPress={() => router.push('/local/stats')} testID="local-stats" />
          <IconButton icon={Settings2} label={translate('local.manage')} onPress={() => router.push('/local/manage')} testID="local-manage" />
        </>
      )}
    >
      <AccountBanner />
      <LocalTimerCard />
      <LocalDayView />
    </Screen>
  );
}

/** Kompakt og lukbart — appen skal ikke presse; kontoen tilbydes også under Administrér. */
function AccountBanner() {
  const router = useRouter();
  const dismissed = useLocalStore.use.bannerDismissed();
  if (dismissed)
    return null;
  return (
    <Card className="mb-3 flex-row items-center gap-3 py-2.5 pr-1.5">
      <CloudOff size={16} color={colors.neutral[500]} />
      <Text className="flex-1 text-[13px] text-muted-foreground" numberOfLines={2}>
        {translate('local.account_short')}
        {' '}
        <Text className="text-[13px] font-medium text-primary-600 dark:text-primary-400" onPress={() => router.push('/signup')} testID="local-signup">{translate('local.account_cta')}</Text>
        {' · '}
        <Text className="text-[13px] font-medium text-foreground" onPress={() => router.push('/login')} testID="local-login">{translate('local.log_in')}</Text>
      </Text>
      <IconButton icon={X} size={16} label={translate('common.close')} onPress={() => localStore().dismissBanner()} testID="local-banner-close" />
    </Card>
  );
}
