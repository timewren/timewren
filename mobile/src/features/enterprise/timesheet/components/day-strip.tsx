import type { DayTotal } from '../week';
import { format } from 'date-fns';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Text } from '~/components/ui';
import { dateFnsLocale } from '~/lib/locale';
import { dayLabel, parseISODate } from '../week';

type DayStripProps = {
  days: readonly string[];
  selected: string;
  today: string;
  totals: Record<string, DayTotal>;
  /** Norm pr. dag — 0 = fridag/helligdag/fravær */
  norms: Record<string, number>;
  holidays: ReadonlySet<string>;
  onSelect: (day: string) => void;
};

/** M–S som piller. Prik under = dagen har timer; farve følger norm. */
export function DayStrip({ days, selected, today, totals, norms, holidays, onSelect }: DayStripProps) {
  return (
    <View className="flex-row gap-1" testID="day-strip">
      {days.map((day) => {
        const active = day === selected;
        const t = totals[day];
        const norm = norms[day] ?? 0;
        const off = norm <= 0 && !holidays.has(day);
        const hasHours = (t?.total ?? 0) > 0;
        const dot = t && t.work >= norm - 0.01 ? 'bg-success-500' : 'bg-warning-500';
        return (
          <Pressable
            key={day}
            onPress={() => onSelect(day)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={dayLabel({ day, total: t, norm, today, holiday: holidays.has(day) })}
            className={twMerge(
              'flex-1 items-center rounded-full py-2',
              active ? 'bg-primary-600' : '',
              off && !active ? 'opacity-60' : '',
            )}
            testID={`day-strip-${day}`}
          >
            <Text className={twMerge('text-[10px] font-medium uppercase', active ? 'text-white/80' : 'text-muted-foreground')}>
              {format(parseISODate(day), 'EEEEEE', { locale: dateFnsLocale() })}
            </Text>
            <Text className={twMerge('text-base font-semibold', active ? 'text-white' : 'text-foreground', day === today && !active ? 'text-primary-600 dark:text-primary-400' : '')}>
              {format(parseISODate(day), 'd')}
            </Text>
            <View className={twMerge('mt-1 size-1.5 rounded-full', hasHours ? (active ? 'bg-white' : dot) : '')} />
          </Pressable>
        );
      })}
    </View>
  );
}
