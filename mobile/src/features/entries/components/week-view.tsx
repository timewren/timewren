import type { TimeEntry } from '../use-entries';
import { format } from 'date-fns';
import { Copy } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import { Button, Card, colors, ListSkeleton, StatTile, Text } from '~/components/ui';
import { formatHours } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { dateFnsLocale, dayOfMonth } from '~/lib/locale';
import { dateKey, hoursByDay, sumHours, weekDays } from '../period';

type WeekGoal = { hoursWorked: number; weeklyGoal: number; progressPercentage: number } | undefined;

type WeekViewProps = {
  date: Date;
  entries: TimeEntry[];
  isLoading: boolean;
  /** Ugemål — kun sat når den viste uge er indeværende uge */
  goal: WeekGoal;
  onSelectDay: (day: Date) => void;
  onCopyWeek: () => void;
  copying: boolean;
};

type DayRowProps = { day: Date; hours: number; max: number; isToday: boolean; last: boolean; onPress: () => void };

function DayRow({ day, hours, max, isToday, last, onPress }: DayRowProps) {
  const fraction = max > 0 ? hours / max : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={twMerge('flex-row items-center gap-3 px-4 py-3 active:bg-muted', last ? '' : 'border-b border-border')}
      testID={`week-day-${dateKey(day)}`}
    >
      <View className="w-14">
        <Text className={twMerge('text-sm font-semibold', isToday ? 'text-primary-600 dark:text-primary-400' : 'text-foreground')}>
          {format(day, 'EEE', { locale: dateFnsLocale() })}
        </Text>
        <Text className="text-xs text-muted-foreground">{format(day, `${dayOfMonth()} MMM`, { locale: dateFnsLocale() })}</Text>
      </View>
      <View className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <View className="h-full rounded-full bg-primary-500" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </View>
      <Text className={twMerge('w-14 text-right text-sm font-medium', hours > 0 ? 'text-foreground' : 'text-muted-foreground')}>
        {hours > 0 ? formatHours(hours) : '–'}
      </Text>
    </Pressable>
  );
}

function confirmCopyWeek(onConfirm: () => void) {
  Alert.alert(translate('entries.copy_week_title'), translate('entries.copy_week_body'), [
    { text: translate('entries.actions.cancel'), style: 'cancel' },
    { text: translate('entries.copy_week'), onPress: onConfirm },
  ]);
}

/** Ugevisning: 7 dagsrækker med totaler, ugetotal + ugemål og "Kopiér sidste uge". */
export function WeekView({ date, entries, isLoading, goal, onSelectDay, onCopyWeek, copying }: WeekViewProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const days = React.useMemo(() => weekDays(date), [date]);
  const byDay = React.useMemo(() => hoursByDay(entries), [entries]);
  const today = useToday();
  if (isLoading)
    return <ListSkeleton rows={7} />;

  const total = sumHours(entries);
  const max = Math.max(...days.map(d => byDay.get(dateKey(d)) ?? 0), 0);
  return (
    <View className="gap-4">
      <View className="flex-row gap-3">
        <StatTile label={translate('entries.week_total')} value={formatHours(total)} tone="primary" testID="week-total" />
        {goal
          ? (
              <StatTile
                label={translate('entries.week_goal')}
                value={`${goal.progressPercentage} %`}
                hint={translate('entries.week_goal_hint', { goal: formatHours(goal.weeklyGoal) })}
                tone={goal.progressPercentage >= 100 ? 'success' : 'default'}
                testID="week-goal"
              />
            )
          : <StatTile label={translate('entries.count_label')} value={String(entries.length)} />}
      </View>
      <Card className="p-0">
        {days.map((day, i) => (
          <DayRow
            key={dateKey(day)}
            day={day}
            hours={byDay.get(dateKey(day)) ?? 0}
            max={max}
            isToday={dateKey(day) === today}
            last={i === days.length - 1}
            onPress={() => onSelectDay(day)}
          />
        ))}
      </Card>
      <Button
        variant="outline"
        label={translate('entries.copy_week')}
        loading={copying}
        onPress={() => confirmCopyWeek(onCopyWeek)}
        testID="copy-week"
      >
        <View className="flex-row items-center gap-2">
          <Copy size={16} color={dark ? colors.neutral[100] : colors.neutral[800]} />
          <Text className="text-base font-semibold text-foreground">{translate('entries.copy_week')}</Text>
        </View>
      </Button>
    </View>
  );
}
