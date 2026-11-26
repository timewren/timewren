import type { CalendarCell } from '../period';
import { format } from 'date-fns';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Text } from '~/components/ui';
import { dateFnsLocale, dayOfMonth } from '~/lib/locale';
import { dateKey, intensity, isSameDate, monthGrid, weekDays } from '../period';

type CalendarGridProps = {
  /** Måneden der vises (enhver dato i den) */
  month: Date;
  /** Timer pr. dag (yyyy-MM-dd) → prik-intensitet */
  hoursByDay?: Map<string, number>;
  selected?: Date | null;
  onSelectDay: (day: Date) => void;
  /** Vis timetal under dagen (månedsvisning) i stedet for kun prik */
  showHours?: boolean;
};

const DOT_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-transparent',
  1: 'bg-primary-200 dark:bg-primary-900',
  2: 'bg-primary-300 dark:bg-primary-700',
  3: 'bg-primary-500',
  4: 'bg-primary-700 dark:bg-primary-400',
};

/** Ugedags-overskrifter: ma ti on to fr lø sø */
function WeekdayHeader() {
  const days = React.useMemo(() => weekDays(new Date()), []);
  return (
    <View className="mb-1 flex-row">
      {days.map(d => (
        <View key={d.getDay()} className="flex-1 items-center">
          <Text className="text-xs font-medium text-muted-foreground uppercase">
            {format(d, 'EEEEEE', { locale: dateFnsLocale() })}
          </Text>
        </View>
      ))}
    </View>
  );
}

type DayCellProps = {
  cell: CalendarCell;
  hours: number;
  isSelected: boolean;
  showHours: boolean;
  onPress: () => void;
};

function DayCell({ cell, hours, isSelected, showHours, onPress }: DayCellProps) {
  const level = intensity(hours);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={format(cell.date, `${dayOfMonth()} MMMM`, { locale: dateFnsLocale() })}
      className={twMerge(
        'flex-1 items-center rounded-xl py-1.5',
        isSelected ? 'bg-primary-600' : cell.isToday ? 'bg-muted' : '',
      )}
      testID={`cal-${dateKey(cell.date)}`}
    >
      <Text
        className={twMerge(
          'text-sm',
          isSelected ? 'font-semibold text-white' : cell.inMonth ? 'text-foreground' : 'text-muted-foreground opacity-50',
          cell.isToday && !isSelected ? 'font-bold text-primary-600 dark:text-primary-400' : '',
        )}
      >
        {cell.date.getDate()}
      </Text>
      {showHours && hours > 0
        ? (
            <Text className={twMerge('text-[10px]', isSelected ? 'text-white' : 'text-muted-foreground')}>
              {Math.round(hours * 10) / 10}
            </Text>
          )
        : <View className={twMerge('mt-1 size-1.5 rounded-full', isSelected ? 'bg-white' : DOT_CLASS[level])} />}
    </Pressable>
  );
}

/** Kalendergrid (mandag-start) med prikker/timer pr. dag. Bruges af månedsvisning og datovælger. */
export function CalendarGrid({ month, hoursByDay, selected, onSelectDay, showHours = false }: CalendarGridProps) {
  const rows = React.useMemo(() => monthGrid(month), [month]);
  return (
    <View>
      <WeekdayHeader />
      {rows.map(row => (
        <View key={dateKey(row[0]!.date)} className="flex-row">
          {row.map(cell => (
            <DayCell
              key={dateKey(cell.date)}
              cell={cell}
              hours={hoursByDay?.get(dateKey(cell.date)) ?? 0}
              isSelected={!!selected && isSameDate(selected, cell.date)}
              showHours={showHours}
              onPress={() => onSelectDay(cell.date)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
