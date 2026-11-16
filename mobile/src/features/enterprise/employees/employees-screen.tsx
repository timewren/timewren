import type { Employee } from './employees-logic';
import { useRouter } from 'expo-router';
import { Users } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  ListRow,
  ListSkeleton,
  Screen,
  Select,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { screenLoad, useAnnounceLoaded } from '~/lib/notify';
import { employmentTypeKey, filterEmployees, roleKey } from './employees-logic';

const ALL = '__all__';

/** Medarbejderliste (leder/HR) — read-only i denne omgang. */
export function EmployeesScreen() {
  const caps = useCapabilities();
  const router = useRouter();
  const allowed = caps.isEnterprise && (caps.isManager || caps.isHr);
  const members = trpc.enterprise.listMembers.useQuery(undefined, { enabled: allowed });
  const departments = trpc.enterprise.listDepartments.useQuery(undefined, { enabled: allowed });
  // Afdelingerne filtrerer medlemsrækkerne, så skærmen er først færdig når begge er det.
  useAnnounceLoaded(screenLoad(members, departments), translate('common.loaded'));
  const [query, setQuery] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState<string | null>(null);

  const list = React.useMemo(
    () => filterEmployees(members.data ?? [], { query, departmentId }),
    [members.data, query, departmentId],
  );

  if (!caps.isLoading && !allowed) {
    return (
      <Screen title={translate('enterprise.employees.title')} back>
        <EmptyState icon={Users} title={translate('enterprise.employees.title')} description={translate('common.requires_manager')} />
      </Screen>
    );
  }

  const deptOptions = [
    { value: ALL, label: translate('enterprise.common.all_departments') },
    ...(departments.data ?? []).map(d => ({ value: d.id, label: `${d.name} (${d.memberCount})` })),
  ];

  return (
    <Screen
      title={translate('enterprise.employees.title')}
      subtitle={members.data ? `${list.length} / ${members.data.filter(m => m.isActive).length}` : undefined}
      back
      refreshing={members.isRefetching}
      onRefresh={() => void members.refetch()}
      header={(
        <View>
          <Input value={query} onChangeText={setQuery} placeholder={translate('enterprise.employees.search_placeholder')} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" testID="employees-search" />
          {departments.isError
            ? (
                <ErrorState
                  message={errorMessage(departments.error)}
                  onRetry={() => void departments.refetch()}
                />
              )
            : (departments.data?.length ?? 0) > 0
                ? <Select value={departmentId ?? ALL} options={deptOptions} onSelect={v => setDepartmentId(v === ALL ? null : String(v))} testID="employees-department" />
                : null}
        </View>
      )}
    >
      {members.isLoading
        ? <ListSkeleton rows={5} />
        : members.isError
          ? <ErrorState onRetry={() => void members.refetch()} />
          : list.length === 0
            ? <EmptyState icon={Users} title={translate('enterprise.employees.no_employees')} description={translate('enterprise.employees.no_employees_body')} compact />
            : (
                <Card className="p-0">
                  {list.map((e, i) => (
                    <EmployeeRow key={e.id} employee={e} last={i === list.length - 1} onPress={() => router.push(`/enterprise/employees/${e.id}`)} />
                  ))}
                </Card>
              )}
    </Screen>
  );
}

function EmployeeRow({ employee, last, onPress }: { employee: Employee; last: boolean; onPress: () => void }) {
  const name = employee.user?.name ?? 'Ukendt';
  const subtitle = [
    employee.department?.name ?? translate('enterprise.employees.no_department'),
    employee.employmentType ? translate(`enterprise.employees.employment_type.${employmentTypeKey(employee.employmentType)}`) : null,
  ].filter(Boolean).join(' · ');
  return (
    <ListRow
      title={name}
      subtitle={subtitle}
      left={<Avatar name={name} image={employee.user?.image} size={36} />}
      right={<Badge label={translate(`enterprise.employees.role.${roleKey(employee.role)}`)} tone={employee.role === 'member' ? 'default' : 'primary'} />}
      onPress={onPress}
      last={last}
      testID={`employee-${employee.id}`}
    />
  );
}
