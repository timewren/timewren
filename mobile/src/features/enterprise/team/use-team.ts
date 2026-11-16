import type { StatusFilter, TeamMember } from './team-logic';
import * as React from 'react';
import { Alert } from 'react-native';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { countByStatus, filterMembers, fromMemberList, fromOverview } from './team-logic';

function showError(error: unknown) {
  showMessage({ message: errorMessage(error), type: 'danger' });
}

/**
 * Teamets uge. Manager+ bruger getTeamWeekOverview (timer pr. dag); HR må
 * ikke kalde den (orgManagerProcedure) og får i stedet listMembers med
 * ugestatus — uden timer. Saldi hentes for begge.
 */
export function useTeamWeek(weekStart: string) {
  const caps = useCapabilities();
  const canSeeHours = caps.isManager;
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [departmentId, setDepartmentId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const overview = trpc.enterprise.getTeamWeekOverview.useQuery(
    { weekStart, departmentId: departmentId ?? undefined },
    { enabled: canSeeHours },
  );
  const memberList = trpc.enterprise.listMembers.useQuery(
    { weekStart },
    { enabled: !canSeeHours && caps.isHr },
  );
  const balances = trpc.enterprise.getTeamWeekBalances.useQuery(
    { weekStart, departmentId: departmentId ?? undefined },
    { enabled: caps.isManager || caps.isHr },
  );
  const departments = trpc.enterprise.listDepartments.useQuery();

  const members: TeamMember[] = React.useMemo(() => {
    if (canSeeHours)
      return overview.data ? fromOverview(overview.data.members) : [];
    return memberList.data ? fromMemberList(memberList.data) : [];
  }, [canSeeHours, overview.data, memberList.data]);

  const filtered = React.useMemo(
    () => filterMembers(members, { status, departmentId, query }),
    [members, status, departmentId, query],
  );
  const counts = React.useMemo(() => countByStatus(members), [members]);
  const balanceByUser = React.useMemo(
    () => new Map((balances.data?.members ?? []).map(m => [m.userId, m])),
    [balances.data],
  );

  const source = canSeeHours ? overview : memberList;
  return {
    canSeeHours,
    days: overview.data?.days ?? null,
    members: filtered,
    counts,
    balanceByUser,
    departments: departments.data ?? [],
    filter: { status, setStatus, departmentId, setDepartmentId, query, setQuery },
    isLoading: source.isLoading,
    isError: source.isError,
    isRefetching: source.isRefetching,
    refetch: () => {
      void source.refetch();
      void balances.refetch();
    },
  };
}

/** Godkend/afvis/genåbn + afdelingsgodkendelse. Invaliderer alle enterprise-queries. */
export function useTeamActions(weekStart: string) {
  const utils = trpc.useUtils();
  const done = (key: 'approved_toast' | 'rejected_toast' | 'reopened_toast') => () => {
    void utils.enterprise.invalidate();
    showMessage({ message: translate(`enterprise.team.${key}`), type: 'success' });
  };
  const invalidate = () => void utils.enterprise.invalidate();

  const approve = trpc.enterprise.approveTimesheetWeek.useMutation({
    onSuccess: done('approved_toast'),
    onError: showError,
  });
  const reject = trpc.enterprise.rejectTimesheetWeek.useMutation({
    onSuccess: done('rejected_toast'),
    onError: showError,
  });
  const reopen = trpc.enterprise.reopenTimesheetWeek.useMutation({
    onSuccess: done('reopened_toast'),
    onError: showError,
  });
  const approveDepartment = trpc.enterprise.approveDepartmentWeek.useMutation({
    onSuccess: (result) => {
      invalidate();
      showMessage({
        message: translate('enterprise.team.approve_department_result', { approved: result.approved.length, failed: result.failed.length }),
        description: result.failed.length > 0 ? result.failed.map(f => f.message).join('\n') : undefined,
        type: result.failed.length > 0 ? 'warning' : 'success',
        duration: result.failed.length > 0 ? 6000 : 3000,
      });
    },
    onError: showError,
  });

  return {
    approve: (userId: string) => approve.mutate({ userId, weekStart }),
    reject: (userId: string, reason: string) => reject.mutate({ userId, weekStart, reason }),
    reopen: (userId: string, reason: string) => reopen.mutate({ userId, weekStart, reason }),
    approveDepartment: (departmentId: string, departmentName: string) => {
      Alert.alert(
        translate('enterprise.team.approve_department'),
        translate('enterprise.team.approve_department_body', { department: departmentName }),
        [
          { text: translate('enterprise.common.cancel'), style: 'cancel' },
          { text: translate('enterprise.team.approve'), onPress: () => approveDepartment.mutate({ departmentId, weekStart }) },
        ],
      );
    },
    busy: approve.isPending || reject.isPending || reopen.isPending || approveDepartment.isPending,
  };
}
