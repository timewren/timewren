import type { EmployeeMonth } from './team-absence-month';
import { addMonths, format, getDaysInMonth, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { IconButton } from '~/components/ui/icon-button';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { useToday } from '~/lib/hooks/use-today';
import { dateFnsLocale } from '~/lib/locale';
import { announce } from '~/lib/notify';
import { groupMonthAbsences } from './team-absence-month';
import { useApprovedTeamRequests } from './use-absence';

function EmployeeTimeline({ employee, days }: { employee: EmployeeMonth; days: number }) {
  return (
    <View className="gap-2 border-t border-border pt-3 pb-2">
      <Text accessibilityRole="header" className="font-semibold text-foreground">{employee.name}</Text>
      {employee.periods.map(({ id, firstDay, lastDay, type }) => (
        <View key={id} className="gap-1">
          <View className="h-2 rounded-full bg-muted">
            <View
              className="absolute h-2 rounded-full bg-primary-600 dark:bg-primary-400"
              style={{
                left: `${(firstDay - 1) / days * 100}%`,
                width: `${(lastDay - firstDay + 1) / days * 100}%`,
                ...(type.color ? { backgroundColor: type.color } : {}),
              }}
            />
          </View>
          <Text className="text-sm text-foreground">
            {type.name}
            {'  '}
            {firstDay === lastDay ? firstDay : `${firstDay}–${lastDay}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MonthTimelines({ employees, days }: { employees: EmployeeMonth[]; days: number }) {
  const ticks = Array.from({ length: 6 }, (_, i) => i * 5 + 1);
  return (
    <Card className="gap-2">
      <View className="flex-row" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ticks.map(day => (
          <Text key={day} className="text-xs text-muted-foreground" style={{ width: `${Math.min(5, days - day + 1) / days * 100}%` }}>
            {day}
          </Text>
        ))}
      </View>
      {employees.map(employee => <EmployeeTimeline key={employee.id} employee={employee} days={days} />)}
    </Card>
  );
}

export function TeamAbsenceCalendar() {
  const { t, i18n } = useTranslation();
  const today = useToday('Europe/Copenhagen');
  const [month, setMonth] = React.useState(() => parseISO(`${today.slice(0, 7)}-01`));
  const { data, fetchStatus, isLoading, isError, refetch } = useApprovedTeamRequests();
  const employees = groupMonthAbsences(data ?? [], month, today);
  const locale = i18n.language?.startsWith('en') ? undefined : dateFnsLocale();
  const monthLabel = format(month, 'LLLL yyyy', { locale });

  function changeMonth(offset: number) {
    const next = addMonths(month, offset);
    setMonth(next);
    announce(format(next, 'LLLL yyyy', { locale }));
  }

  let content;
  if (data === undefined && fetchStatus === 'paused') {
    content = <EmptyState title={t('enterprise.absence.team_calendar_offline')} compact />;
  }
  else if (isLoading) {
    content = (
      <View accessible accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }} testID="team-absence-loading">
        <ListSkeleton />
      </View>
    );
  }
  else if (isError) {
    content = <ErrorState onRetry={() => void refetch()} />;
  }
  else if (employees.length === 0) {
    content = <EmptyState title={t('enterprise.absence.team_calendar_empty')} compact />;
  }
  else {
    content = <MonthTimelines employees={employees} days={getDaysInMonth(month)} />;
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <IconButton icon={ChevronLeft} label={t('common.previous_month')} onPress={() => changeMonth(-1)} />
        <Text accessibilityRole="header" className="flex-1 text-center text-lg font-semibold text-foreground">
          {monthLabel}
        </Text>
        <IconButton icon={ChevronRight} label={t('common.next_month')} onPress={() => changeMonth(1)} />
      </View>
      {content}
    </View>
  );
}
