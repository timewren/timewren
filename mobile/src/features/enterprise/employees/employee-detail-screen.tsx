import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import {
  Avatar,
  Badge,
  Card,
  ErrorState,
  ListRow,
  ListSkeleton,
  Screen,
  SectionHeader,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';
import { screenLoad, useAnnounceLoaded } from '~/lib/notify';
import { employmentTypeKey, formatWorkingDays, roleKey } from './employees-logic';

type Profile = RouterOutputs['enterprise']['getProfileById'];
type Period = RouterOutputs['enterprise']['listEmploymentPeriods'][number];

/** Medarbejderdetalje: profil, arbejdstid/norm, ansættelseshistorik (read-only). */
export function EmployeeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const caps = useCapabilities();
  const allowed = caps.isEnterprise && (caps.isManager || caps.isHr) && !!id;
  const profile = trpc.enterprise.getProfileById.useQuery({ id: id ?? '' }, { enabled: allowed });
  const periods = trpc.enterprise.listEmploymentPeriods.useQuery({ profileId: id ?? '' }, { enabled: allowed });
  // Ansættelsesperioderne fylder historikken under profilen — ét stop for hele skærmen.
  useAnnounceLoaded(screenLoad(profile, periods), translate('common.loaded'));
  const p = profile.data;
  const name = p?.user?.name ?? '';
  const refetchAll = () => {
    void profile.refetch();
    void periods.refetch();
  };

  return (
    <Screen
      title={name || translate('enterprise.employees.profile')}
      back
      refreshing={profile.isRefetching}
      onRefresh={refetchAll}
    >
      {profile.isLoading
        ? <ListSkeleton rows={3} />
        : profile.isError || !p
          ? <ErrorState onRetry={() => void profile.refetch()} />
          : (
              <>
                <Header profile={p} />
                <SectionHeader title={translate('enterprise.employees.working_time')} />
                <Card className="p-0">
                  <ListRow title={translate('enterprise.employees.weekly_hours')} right={formatHours(p.weeklyHours)} />
                  <ListRow title={translate('enterprise.employees.daily_norm')} right={p.dailyNormHours ? formatHours(p.dailyNormHours) : '—'} />
                  <ListRow title={translate('enterprise.employees.working_days')} right={formatWorkingDays(p.workingDays)} />
                  <ListRow title={translate('enterprise.employees.break_minutes')} right={p.breakMinutes != null ? `${p.breakMinutes} min` : '—'} />
                  <ListRow title={translate('enterprise.employees.vacation_days')} right={String(p.vacationDaysPerYear ?? '—')} />
                  <ListRow title={translate('enterprise.employees.conversion_factor')} right={p.conversionFactor ? String(Number(p.conversionFactor).toLocaleString(intlLocale())) : '—'} last />
                </Card>
                <SectionHeader title={translate('enterprise.employees.employment')} />
                <Card className="p-0">
                  <ListRow title={translate('enterprise.employees.employment_type')} right={translate(`enterprise.employees.employment_type.${employmentTypeKey(p.employmentType)}`)} />
                  <ListRow title={translate('enterprise.employees.start_date')} right={p.startDate ? formatDateShort(p.startDate) : '—'} />
                  <ListRow title={translate('enterprise.employees.end_date')} right={p.endDate ? formatDateShort(p.endDate) : translate('enterprise.employees.open_ended')} />
                  <ListRow title={translate('enterprise.employees.employee_number')} right={p.employeeNumber ?? '—'} />
                  <ListRow title={translate('enterprise.employees.self_scheduler')} right={p.isSelfScheduler ? 'Ja' : 'Nej'} last />
                </Card>
                {periods.isError
                  ? <ErrorState message={errorMessage(periods.error)} onRetry={() => void periods.refetch()} />
                  : <PeriodList periods={periods.data ?? []} />}
              </>
            )}
    </Screen>
  );
}

function Header({ profile }: { profile: Profile }) {
  const name = profile.user?.name ?? 'Ukendt';
  return (
    <Card className="flex-row items-center gap-3">
      <Avatar name={name} image={profile.user?.image} size={52} />
      <View className="flex-1">
        <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>{name}</Text>
        <Text className="text-sm text-muted-foreground" numberOfLines={1}>{profile.user?.email}</Text>
        <Text className="text-sm text-muted-foreground" numberOfLines={1}>{profile.department?.name ?? translate('enterprise.employees.no_department')}</Text>
      </View>
      <View className="items-end gap-1">
        <Badge label={translate(`enterprise.employees.role.${roleKey(profile.role)}`)} tone="primary" />
        <Badge label={translate(profile.isActive ? 'enterprise.employees.active' : 'enterprise.employees.inactive')} tone={profile.isActive ? 'success' : 'default'} />
      </View>
    </Card>
  );
}

function PeriodList({ periods }: { periods: Period[] }) {
  return (
    <>
      <SectionHeader title={translate('enterprise.employees.employment_periods')} />
      {periods.length === 0
        ? <Text className="text-sm text-muted-foreground" tx="enterprise.employees.no_periods" />
        : (
            <Card className="p-0">
              {periods.map((period, i) => (
                <ListRow
                  key={period.id}
                  title={`${period.validFrom ? formatDateShort(period.validFrom) : '…'} – ${period.validTo ? formatDateShort(period.validTo) : translate('enterprise.employees.open_ended')}`}
                  subtitle={[
                    translate(`enterprise.employees.employment_type.${employmentTypeKey(period.employmentType)}`),
                    period.position,
                    period.department?.name,
                  ].filter(Boolean).join(' · ')}
                  right={formatHours(period.weeklyHours)}
                  last={i === periods.length - 1}
                />
              ))}
            </Card>
          )}
    </>
  );
}
