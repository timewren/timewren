import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
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
import { TeamAbsenceCalendar } from './team-absence-calendar';
import { usePendingTeamRequests } from './use-absence';

type Tab = 'overview' | 'requests' | 'approve' | 'team';

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
  const { t } = useTranslation();
  const caps = useCapabilities();
  const canSeeTeam = caps.isManager || caps.isHr;
  const [tab, setTab] = React.useState<Tab>('overview');
  const [refreshing, setRefreshing] = React.useState(false);
  const utils = trpc.useUtils();
  const { pending } = usePendingTeamRequests(caps.isManager);

  const options = React.useMemo(() => {
    const base: { value: Tab; label: string; badge?: number }[] = [
      { value: 'overview', label: t('enterprise.absence.tab_overview') },
      { value: 'requests', label: t('enterprise.absence.tab_requests') },
    ];
    if (caps.isManager)
      base.push({ value: 'approve', label: t('enterprise.absence.tab_approve'), badge: pending.length });
    if (canSeeTeam)
      base.push({ value: 'team', label: t('enterprise.absence.tab_team') });
    return base;
  }, [canSeeTeam, caps.isManager, pending.length, t]);

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

  const activeTab = tab === 'team' && !canSeeTeam ? 'overview' : tab;

  return (
    <Screen
      title={translate('enterprise.absence.title')}
      subtitle={caps.orgName && !isDefaultOrgName(caps.orgName) ? caps.orgName : undefined}
      right={<InboxButton />}
      header={<Segmented options={options} value={activeTab} onChange={setTab} testID="absence-tabs" />}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      {activeTab === 'overview' ? <AbsenceOverview /> : null}
      {activeTab === 'requests' ? <AbsenceRequests /> : null}
      {activeTab === 'approve' && caps.isManager ? <AbsenceApprove /> : null}
      {activeTab === 'team' ? <TeamAbsenceCalendar /> : null}
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
