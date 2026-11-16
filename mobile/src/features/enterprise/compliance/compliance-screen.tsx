import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { ComplianceEmployee, ComplianceResult } from './compliance-logic';
import { ShieldAlert, ShieldCheck } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import {
  Avatar,
  Badge,
  Card,
  colors,
  EmptyState,
  ErrorState,
  ListRow,
  ListSkeleton,
  Modal,
  Screen,
  SectionHeader,
  StatTile,
  Text,
  useModal,
} from '~/components/ui';
import { BottomSheetScrollView } from '~/components/ui/bottom-sheet';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { formatDateShort, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { complianceTone, findingCounts, summarize, withIssues } from './compliance-logic';

/** Arbejdstidslov-overblik: tiles + medarbejdere med afvigelser. */
export function ComplianceScreen() {
  const caps = useCapabilities();
  const allowed = caps.isEnterprise && (caps.isManager || caps.isHr);
  const query = trpc.enterprise.getComplianceOverview.useQuery(undefined, { enabled: allowed });
  useAnnounceLoaded(query, translate('common.loaded'));
  const sheet = useModal();
  const [selected, setSelected] = React.useState<ComplianceEmployee | null>(null);
  const open = (e: ComplianceEmployee) => {
    setSelected(e);
    sheet.present();
  };

  if (!caps.isLoading && !allowed) {
    return (
      <Screen title={translate('enterprise.compliance.title')} back>
        <EmptyState icon={ShieldCheck} title={translate('enterprise.compliance.title')} description={translate('common.requires_manager')} />
      </Screen>
    );
  }

  const data = query.data;
  const summary = data ? summarize(data.employees) : null;
  const issues = data ? withIssues(data.employees) : [];

  return (
    <Screen
      title={translate('enterprise.compliance.title')}
      subtitle={data ? `${translate('enterprise.compliance.period')}: ${formatDateShort(data.period.from)} – ${formatDateShort(data.period.to)}` : undefined}
      back
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading
        ? <ListSkeleton rows={3} />
        : query.isError || !data || !summary
          ? <ErrorState onRetry={() => void query.refetch()} />
          : (
              <>
                <View className="flex-row gap-3">
                  <StatTile label={translate('enterprise.compliance.ok')} value={String(summary.ok)} tone="success" icon={ShieldCheck} />
                  <StatTile label={translate('enterprise.compliance.warnings')} value={String(summary.warning)} tone={summary.warning > 0 ? 'warning' : 'default'} />
                  <StatTile label={translate('enterprise.compliance.violations')} value={String(summary.violation)} tone={summary.violation > 0 ? 'danger' : 'default'} icon={ShieldAlert} />
                </View>
                <SectionHeader title={translate('enterprise.compliance.employees_with_issues')} />
                {issues.length === 0
                  ? <EmptyState icon={ShieldCheck} title={translate('enterprise.compliance.no_issues')} description={translate('enterprise.compliance.no_issues_body')} compact />
                  : (
                      <Card className="p-0">
                        {issues.map((e, i) => (
                          <EmployeeRow key={e.profile.id} employee={e} last={i === issues.length - 1} onPress={() => open(e)} />
                        ))}
                      </Card>
                    )}
              </>
            )}
      <DetailSheet ref={sheet.ref} employee={selected} />
    </Screen>
  );
}

function EmployeeRow({ employee, last, onPress }: { employee: ComplianceEmployee; last: boolean; onPress: () => void }) {
  const c = employee.compliance;
  const counts = findingCounts(c);
  const parts: string[] = [];
  if (counts.weeklyAverage)
    parts.push(`${translate('enterprise.compliance.weekly_average')} ${formatHours(c.weeklyAverage.averageHoursPerWeek)}`);
  if (counts.dailyRest > 0)
    parts.push(`${counts.dailyRest} × ${translate('enterprise.compliance.daily_rest')}`);
  if (counts.weeklyRest > 0)
    parts.push(`${counts.weeklyRest} × ${translate('enterprise.compliance.weekly_rest')}`);
  if (counts.longDays > 0)
    parts.push(`${counts.longDays} × ${translate('enterprise.compliance.long_day')}`);
  const name = employee.profile.user?.name ?? 'Ukendt';
  return (
    <ListRow
      title={name}
      subtitle={parts.join(' · ')}
      left={<Avatar name={name} image={employee.profile.user?.image} size={36} />}
      right={<Badge label={translate(`enterprise.compliance.status_${c.overallStatus}`)} tone={complianceTone(c.overallStatus)} />}
      onPress={onPress}
      chevron={false}
      last={last}
      testID={`compliance-${employee.profile.id}`}
    />
  );
}

type DetailSheetProps = { ref: React.RefObject<BottomSheetModal | null>; employee: ComplianceEmployee | null };

function DetailSheet({ ref, employee }: DetailSheetProps) {
  const { theme } = useUniwind();
  const detail = trpc.enterprise.getEmployeeCompliance.useQuery(
    { employeeProfileId: employee?.profile.id ?? '' },
    { enabled: !!employee },
  );
  const result: ComplianceResult | undefined = detail.data ?? employee?.compliance;
  return (
    <Modal ref={ref} snapPoints={['75%']} title={employee?.profile.user?.name ?? undefined} backgroundStyle={{ backgroundColor: theme === 'dark' ? colors.neutral[900] : colors.white }}>
      <BottomSheetScrollView contentContainerClassName="px-4 pb-10">
        {result ? <ResultDetails result={result} /> : null}
      </BottomSheetScrollView>
    </Modal>
  );
}

function ResultDetails({ result }: { result: ComplianceResult }) {
  if (result.exempt)
    return <Text className="text-center text-muted-foreground" tx="enterprise.compliance.exempt" />;
  const wa = result.weeklyAverage;
  return (
    <>
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-foreground" tx="enterprise.compliance.weekly_average" />
        <Badge label={translate(`enterprise.compliance.status_${wa.status}`)} tone={complianceTone(wa.status)} />
      </View>
      <Text className="mt-1 text-sm text-muted-foreground">
        {translate('enterprise.compliance.weekly_average_detail', { avg: formatHours(wa.averageHoursPerWeek, { unit: false }), weeks: wa.weeksInPeriod })}
      </Text>

      <SectionHeader title={translate('enterprise.compliance.daily_rest')} />
      {result.dailyRestViolations.length === 0
        ? <Text className="text-sm text-muted-foreground" tx="enterprise.compliance.no_issues" />
        : result.dailyRestViolations.map(v => (
            <Text key={v.date} className="text-sm text-danger-600">
              {translate('enterprise.compliance.daily_rest_detail', { rest: formatHours(v.restHours, { unit: false }), date: formatDateShort(v.date) })}
            </Text>
          ))}

      <SectionHeader title={translate('enterprise.compliance.weekly_rest')} />
      {result.weeklyRestViolations.length === 0
        ? <Text className="text-sm text-muted-foreground" tx="enterprise.compliance.no_issues" />
        : result.weeklyRestViolations.map(v => (
            <Text key={v.weekStart} className="text-sm text-danger-600">
              {translate('enterprise.compliance.weekly_rest_detail', { rest: formatHours(v.maxConsecutiveRestHours, { unit: false }), date: formatDateShort(v.weekStart) })}
            </Text>
          ))}

      {result.longDays.length > 0
        ? (
            <>
              <SectionHeader title={translate('enterprise.compliance.long_day')} />
              {result.longDays.map(v => (
                <Text key={v.date} className="text-sm text-warning-600">
                  {translate('enterprise.compliance.long_day_detail', { hours: formatHours(v.hours), date: formatDateShort(v.date) })}
                </Text>
              ))}
            </>
          )
        : null}
    </>
  );
}
