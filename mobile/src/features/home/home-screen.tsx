import { CalendarDays, Plus } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { IconButton, Screen } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { parseISODate } from '~/features/enterprise/timesheet/week';
import { OfflineBanner } from '~/features/offline/components/offline-banner';
import { TimerCard } from '~/features/timer/components/timer-card';
import { useTimer } from '~/features/timer/use-timer';
import { trpc } from '~/lib/api';
import { formatDateLong } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { ScreenLoad } from '~/lib/notify-load';
import { EnterpriseCard } from './components/enterprise-card';
import { PrepaidCard } from './components/prepaid-card';
import { QuickStartCard } from './components/quick-start-card';
import { RecentCard } from './components/recent-card';
import { TodayCard } from './components/today-card';
import { WeekCard } from './components/week-card';
import { goTo, ROUTES } from './navigation';

/**
 * Hjem: timer øverst, dagens tid, ugemål, seneste opgaver, klippekort
 * (modul-gated) og enterprise-fremmøde (tier-gated). Pull-to-refresh
 * genhenter alt inkl. serverens timer-tilstand.
 */
export function HomeScreen() {
  const caps = useCapabilities();
  const controller = useTimer();
  const utils = trpc.useUtils();
  const [refreshing, setRefreshing] = React.useState(false);
  const today = useToday();

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        controller.reconcile(),
        utils.time.invalidate(),
        utils.prepaid.invalidate(),
        utils.timerSync.invalidate(),
        caps.isEnterprise ? utils.enterprise.invalidate() : Promise.resolve(),
      ]);
    }
    finally {
      setRefreshing(false);
    }
  }, [controller, utils, caps.isEnterprise]);

  const showPrepaid = caps.isEnabled('klippekort') && !caps.isEnterprise;

  return (
    <ScreenLoad message={translate('common.loaded')}>
      <Screen
        title={translate('home.title')}
        subtitle={formatDateLong(parseISODate(today))}
        right={caps.isEnterprise
          ? <IconButton icon={CalendarDays} label={translate('home.open_timesheet')} onPress={() => goTo(ROUTES.time)} testID="home-open-timesheet" />
          : <IconButton icon={Plus} label={translate('home.add_entry')} onPress={() => goTo(ROUTES.newEntry)} testID="home-add-entry" />}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <OfflineBanner />
        <View className="gap-1">
          <TimerCard controller={controller} />
          <QuickStartCard onStart={opts => void controller.start(opts)} disabled={controller.isRunning || controller.isBusy} />
          {caps.isEnterprise ? <EnterpriseCard /> : null}
          <TodayCard />
          <WeekCard />
          <RecentCard onStart={opts => void controller.start(opts)} disabled={controller.isRunning || controller.isBusy} />
          {showPrepaid ? <PrepaidCard /> : null}
        </View>
      </Screen>
    </ScreenLoad>
  );
}
