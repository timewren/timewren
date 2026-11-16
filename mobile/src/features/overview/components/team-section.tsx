import { useRouter } from 'expo-router';
import { CheckSquare, Radio, Users } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { SectionHeader, StatTile } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { getWeekStart } from '~/features/enterprise/timesheet/week';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { SectionState, TileRow } from './section-state';

/**
 * Teamets tal for ledere: i gang nu, timer i dag/uge (kun admin — routerne er orgAdmin),
 * og antal ventende godkendelser (kræver fakturerings-modulet).
 */
export function TeamSection() {
  const router = useRouter();
  const caps = useCapabilities();
  const today = useToday();
  const weekStart = getWeekStart(today);

  const live = trpc.team.liveTimers.useQuery();
  const day = trpc.team.dayOverview.useQuery({ date: today }, { enabled: caps.isAdmin });
  const week = trpc.team.weekOverview.useQuery({ weekStart }, { enabled: caps.isAdmin });
  const approvals = trpc.approvalRequests.list.useQuery({ status: 'pending' }, { enabled: caps.isEnabled('invoicing') });

  const running = (live.data ?? []).filter(t => t.isRunning).length;
  const dayHours = (day.data?.members ?? []).reduce((sum, m) => sum + m.totalHours, 0);
  const weekHours = (week.data?.members ?? []).reduce((sum, m) => sum + m.totalHours, 0);
  const teamHref = href(caps.isEnterprise ? '/enterprise/team' : '/team');

  const retry = () => {
    void live.refetch();
    void day.refetch();
    void week.refetch();
    void approvals.refetch();
  };

  if (live.isSuccess && (live.data ?? []).length === 0)
    return null;

  return (
    <View>
      <SectionHeader title={translate('overview.team')} action={{ label: translate('tabs.team'), onPress: () => router.push(teamHref) }} />
      <SectionState isLoading={live.isLoading} isError={live.isError} error={live.error} onRetry={retry}>
        <View className="gap-3">
          <TileRow>
            <StatTile
              label={translate('overview.team_live')}
              value={String(running)}
              hint={translate((live.data?.length ?? 0) === 1 ? 'overview.team_members_one' : 'overview.team_members_other', { count: live.data?.length ?? 0 })}
              icon={Radio}
              tone={running > 0 ? 'success' : 'default'}
              onPress={() => router.push(teamHref)}
              testID="overview-team-live"
            />
            {caps.isEnabled('invoicing')
              ? (
                  <StatTile
                    label={translate('overview.approvals_pending')}
                    value={String(approvals.data?.length ?? 0)}
                    loading={approvals.isLoading}
                    error={approvals.isError}
                    icon={CheckSquare}
                    tone={(approvals.data?.length ?? 0) > 0 ? 'warning' : 'default'}
                    onPress={() => router.push(href('/invoices'))}
                  />
                )
              : null}
          </TileRow>
          {caps.isAdmin
            ? (
                <TileRow>
                  <StatTile label={translate('overview.team_today')} value={formatHours(dayHours)} loading={day.isLoading} error={day.isError} icon={Users} />
                  <StatTile label={translate('overview.team_week')} value={formatHours(weekHours)} loading={week.isLoading} error={week.isError} icon={Users} />
                </TileRow>
              )
            : null}
        </View>
      </SectionState>
    </View>
  );
}
