import type { StatusFilter, TeamMember } from './team-logic';
import { CheckCheck, Users } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListRow,
  ListSkeleton,
  Screen,
  Segmented,
  Select,
  Text,
  useModal,
} from '~/components/ui';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { WeekNav } from '../timesheet/components/week-nav';
import { useWeekNavigation } from '../timesheet/use-timesheet';
import { weekStatusKey, weekStatusTone } from '../timesheet/week';
import { MemberSheet } from './components/member-sheet';
import { completenessTone } from './team-logic';
import { useTeamActions, useTeamWeek } from './use-team';

const ALL = '__all__';

/** Teamgodkendelse — uge pr. medarbejder med godkend/afvis/genåbn. */
export function TeamScreen() {
  const caps = useCapabilities();
  const session = useAuthStore.use.session();
  // AuthSession-typen kollapser til never under strict TS (se MOBILE-PLAN.md) — læs id defensivt
  const myUserId = (session as unknown as { user?: { id?: string } } | null)?.user?.id;
  const nav = useWeekNavigation();
  const team = useTeamWeek(nav.weekStart);
  useAnnounceLoaded(team, translate('common.loaded'));
  const actions = useTeamActions(nav.weekStart);
  const sheet = useModal();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = team.members.find(m => m.userId === selectedId) ?? null;

  if (!caps.isLoading && !(caps.isEnterprise && (caps.isManager || caps.isHr))) {
    return (
      <Screen title={translate('enterprise.team.title')} back>
        <EmptyState icon={Users} title={translate('enterprise.team.title')} description={translate('common.requires_manager')} />
      </Screen>
    );
  }

  const department = team.departments.find(d => d.id === team.filter.departmentId) ?? null;
  const filterOptions: Array<{ value: StatusFilter; label: string; badge?: number }> = [
    { value: 'all', label: translate('enterprise.team.filter.all') },
    { value: 'submitted', label: translate('enterprise.team.filter.submitted'), badge: team.counts.submitted },
    { value: 'draft', label: translate('enterprise.team.filter.draft') },
    { value: 'approved', label: translate('enterprise.team.filter.approved') },
  ];
  const open = (m: TeamMember) => {
    setSelectedId(m.userId);
    sheet.present();
  };

  return (
    <Screen
      title={translate('enterprise.team.title')}
      back
      right={department && caps.isManager
        ? <IconButton icon={CheckCheck} label={translate('enterprise.team.approve_department')} onPress={() => actions.approveDepartment(department.id, department.name)} disabled={actions.busy} testID="approve-department" />
        : undefined}
      refreshing={team.isRefetching}
      onRefresh={team.refetch}
      header={(
        <>
          <WeekNav weekStart={nav.weekStart} onPrev={nav.prev} onNext={nav.next} onThisWeek={nav.thisWeek} isThisWeek={nav.isThisWeek} />
          <Segmented className="mt-3" options={filterOptions} value={team.filter.status} onChange={team.filter.setStatus} testID="team-status" />
        </>
      )}
    >
      <Filters team={team} />
      {team.isLoading
        ? <ListSkeleton rows={4} />
        : team.isError
          ? <ErrorState onRetry={team.refetch} />
          : team.members.length === 0
            ? <EmptyState icon={Users} title={translate('enterprise.team.no_members')} description={translate('enterprise.team.no_members_body')} compact />
            : (
                <Card className="p-0">
                  {team.members.map((m, i) => (
                    <MemberRow
                      key={m.userId}
                      member={m}
                      departmentName={team.departments.find(d => d.id === m.departmentId)?.name}
                      onPress={() => open(m)}
                      last={i === team.members.length - 1}
                    />
                  ))}
                </Card>
              )}
      <MemberSheet
        ref={sheet.ref}
        member={selected}
        balances={selected ? team.balanceByUser.get(selected.userId) : undefined}
        days={team.days}
        weekStart={nav.weekStart}
        isManager={caps.isManager}
        isSelf={!!myUserId && selected?.userId === myUserId}
        busy={actions.busy}
        onApprove={actions.approve}
        onReject={actions.reject}
        onReopen={actions.reopen}
      />
    </Screen>
  );
}

function Filters({ team }: { team: ReturnType<typeof useTeamWeek> }) {
  const options = [
    { value: ALL, label: translate('enterprise.common.all_departments') },
    ...team.departments.map(d => ({ value: d.id, label: `${d.name} (${d.memberCount})` })),
  ];
  return (
    <View className="mb-2">
      <Input
        value={team.filter.query}
        onChangeText={team.filter.setQuery}
        placeholder={translate('enterprise.employees.search_placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        testID="team-search"
      />
      {team.departments.length > 0
        ? (
            <Select
              value={team.filter.departmentId ?? ALL}
              options={options}
              onSelect={v => team.filter.setDepartmentId(v === ALL ? null : String(v))}
              placeholder={translate('enterprise.common.all_departments')}
              testID="team-department"
            />
          )
        : null}
    </View>
  );
}

type MemberRowProps = { member: TeamMember; departmentName?: string; onPress: () => void; last: boolean };

function MemberRow({ member, departmentName, onPress, last }: MemberRowProps) {
  const status = weekStatusKey(member.weekStatus);
  const hours = member.total !== null && member.norm !== null
    ? `${formatHours(member.total, { unit: false })} / ${formatHours(member.norm)}`
    : null;
  return (
    <ListRow
      title={member.name}
      subtitle={departmentName ?? translate('enterprise.employees.no_department')}
      left={<Avatar name={member.name} image={member.image} size={36} />}
      right={(
        <View className="items-end gap-1">
          <Badge label={translate(`enterprise.timesheet.status.${status}`)} tone={weekStatusTone(status)} />
          {hours
            ? (
                <Text className={`text-xs ${completenessTone(member.completeness) === 'success' ? 'text-success-600 dark:text-success-400' : 'text-muted-foreground'}`}>
                  {hours}
                </Text>
              )
            : null}
        </View>
      )}
      onPress={onPress}
      chevron={false}
      last={last}
      testID={`team-member-${member.userId}`}
    />
  );
}
