import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { IconButton } from '~/components/ui/icon-button';
import { Screen } from '~/components/ui/screen';
import { Segmented } from '~/components/ui/segmented';
import { Text } from '~/components/ui/text';
import { isDefaultOrgName, useCapabilities } from '~/features/capabilities/use-capabilities';
import { useInboxUnreadCount } from '~/features/enterprise/inbox/use-inbox';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { AbsenceApprove } from './absence-approve';
import { AbsenceOverview } from './absence-overview';
import { AbsenceRequests } from './absence-requests';
import { EnterpriseGate } from './components/enterprise-gate';
import { usePendingTeamRequests } from './use-absence';

type Tab = 'overview' | 'requests' | 'approve';

function InboxButton() {
  const router = useRouter();
  const unread = useInboxUnreadCount();
  return (
    <View>
      <IconButton icon={Bell} label={translate('enterprise.inbox.title')} onPress={() => router.push('/enterprise/inbox')} testID="open-inbox" />
      {unread > 0
        ? (
            <View className="absolute top-0 right-0 min-w-4 items-center rounded-full bg-danger-600 px-1">
              <Text className="text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</Text>
            </View>
          )
        : null}
    </View>
  );
}

function AbsenceTabs() {
  const caps = useCapabilities();
  const [tab, setTab] = React.useState<Tab>('overview');
  const [refreshing, setRefreshing] = React.useState(false);
  const utils = trpc.useUtils();
  const { pending } = usePendingTeamRequests(caps.isManager);

  const options = React.useMemo(() => {
    const base: { value: Tab; label: string; badge?: number }[] = [
      { value: 'overview', label: translate('enterprise.absence.tab_overview') },
      { value: 'requests', label: translate('enterprise.absence.tab_requests') },
    ];
    if (caps.isManager)
      base.push({ value: 'approve', label: translate('enterprise.absence.tab_approve'), badge: pending.length });
    return base;
  }, [caps.isManager, pending.length]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      utils.enterprise.listRequests.invalidate(),
      utils.enterprise.getVacationBalance.invalidate(),
      utils.enterprise.listHolidays.invalidate(),
      utils.enterprise.listClosurePeriods.invalidate(),
      utils.enterprise.inboxUnreadCount.invalidate(),
    ]);
    setRefreshing(false);
  }, [utils]);

  return (
    <Screen
      title={translate('enterprise.absence.title')}
      subtitle={caps.orgName && !isDefaultOrgName(caps.orgName) ? caps.orgName : undefined}
      right={<InboxButton />}
      header={<Segmented options={options} value={tab} onChange={setTab} testID="absence-tabs" />}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      {tab === 'overview' ? <AbsenceOverview /> : null}
      {tab === 'requests' ? <AbsenceRequests /> : null}
      {tab === 'approve' && caps.isManager ? <AbsenceApprove /> : null}
    </Screen>
  );
}

export function AbsenceScreen() {
  return (
    <EnterpriseGate title={translate('enterprise.absence.title')}>
      <AbsenceTabs />
    </EnterpriseGate>
  );
}
