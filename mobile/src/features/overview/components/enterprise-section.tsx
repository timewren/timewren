import type { WeekStatus } from '../timesheet-status';
import type { StatTone } from '~/components/ui';
import { useRouter } from 'expo-router';
import { ClipboardCheck, Hourglass, Palmtree, Scale } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { SectionHeader, StatTile } from '~/components/ui';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatHours, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { periodRange } from '../period';
import { timesheetStatus } from '../timesheet-status';
import { SectionState, TileRow } from './section-state';

const STATUS_TONE: Record<WeekStatus, StatTone> = {
  draft: 'default',
  submitted: 'primary',
  approved: 'success',
  rejected: 'danger',
};

/** Flex, ferie, overtid og ugens timeseddel-status — hver tile linker til enterprise-ruten. */
export function EnterpriseSection() {
  const router = useRouter();
  const weekStart = toISODate(periodRange('week').from);

  const flex = trpc.enterprise.getBalance.useQuery();
  const vacation = trpc.enterprise.getVacationBalance.useQuery();
  const overtime = trpc.enterprise.getMyOvertime.useQuery();
  const timesheet = trpc.enterprise.getTimesheetWeek.useQuery({ weekStart });

  const retry = () => {
    void flex.refetch();
    void vacation.refetch();
    void overtime.refetch();
    void timesheet.refetch();
  };
  const current = vacation.data?.[0];
  const status = timesheetStatus(timesheet.data?.weekStatus);
  const flexBalance = flex.data?.balance ?? 0;

  return (
    <View>
      <SectionHeader title={translate('overview.enterprise')} />
      <SectionState
        isLoading={flex.isLoading || vacation.isLoading}
        isError={flex.isError || vacation.isError || overtime.isError || timesheet.isError}
        error={flex.error ?? vacation.error ?? overtime.error ?? timesheet.error}
        onRetry={retry}
      >
        <View className="gap-3">
          <TileRow>
            <StatTile
              label={translate('overview.flex_balance')}
              value={`${flexBalance > 0 ? '+' : ''}${formatHours(flexBalance)}`}
              icon={Scale}
              tone={flexBalance < 0 ? 'warning' : 'primary'}
              onPress={() => router.push(href('/enterprise/flex'))}
              testID="overview-flex"
            />
            <StatTile
              label={translate('overview.vacation_balance')}
              value={translate('overview.vacation_days', { count: Math.round((current?.remaining ?? 0) * 10) / 10 })}
              hint={current?.periodLabel}
              icon={Palmtree}
              tone="violet"
              onPress={() => router.push(href('/absence'))}
            />
          </TileRow>
          <TileRow>
            <StatTile
              label={translate('overview.overtime')}
              value={formatHours(overtime.data?.balance ?? 0)}
              /* Eget kald: `SectionState` venter på flex og ferie, så uden
                 `loading` stod saldoen som `0 t` under indlæsning. */
              loading={overtime.isLoading}
              icon={Hourglass}
              onPress={() => router.push(href('/enterprise/overtime'))}
            />
            <StatTile
              label={translate('overview.timesheet_week')}
              /* `timesheetStatus(undefined)` svarer `draft`, så et kald på vej
                 læste "Kladde" — en påstand om brugerens egen uge. */
              value={translate(`overview.timesheet_status.${status}`)}
              loading={timesheet.isLoading}
              hint={timesheet.data ? formatHours(timesheet.data.weeklyHours) : undefined}
              icon={ClipboardCheck}
              tone={STATUS_TONE[status]}
              onPress={() => router.push(href('/enterprise/timesheet'))}
            />
          </TileRow>
        </View>
      </SectionState>
    </View>
  );
}
