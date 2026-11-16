import type { DayMark } from '../absence-logic';
import type { AbsenceRequest, ClosurePeriod, Holiday } from '../use-absence';
import { parseISO } from 'date-fns';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { translate } from '~/lib/i18n';
import { calendarWeeks, dayInRange, dayMarkLabel, WEEKDAY_HEADERS } from '../absence-logic';

type Props = {
  requests: readonly AbsenceRequest[];
  holidays: readonly Holiday[];
  closures: readonly ClosurePeriod[];
  today: string;
};

type Mark = { color: string; label: NonNullable<DayMark> };

function markFor(day: string, props: Props): Mark | null {
  const request = props.requests.find(r =>
    (r.status === 'approved' || r.status === 'pending') && dayInRange(day, r, props.today));
  if (request)
    return { color: request.absenceType.color ?? '#3b82f6', label: { name: request.absenceType.name, pending: request.status === 'pending' } };
  const closure = props.closures.find(c => day >= c.startDate && day <= c.endDate);
  if (closure)
    return { color: closure.absenceType?.color ?? '#8b5cf6', label: { name: closure.absenceType?.name ?? translate('enterprise.absence.closure_badge'), pending: false } };
  return null;
}

/** Fire uger fra i dag med farvede blokke pr. fraværstype, helligdage som prik. */
export function CalendarStrip(props: Props) {
  const { holidays, today } = props;
  const weeks = React.useMemo(() => calendarWeeks(parseISO(today)), [today]);
  const holidaySet = React.useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const legend = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of props.requests) {
      if ((r.status === 'approved' || r.status === 'pending') && !seen.has(r.absenceType.name))
        seen.set(r.absenceType.name, r.absenceType.color ?? '#3b82f6');
    }
    return [...seen.entries()];
  }, [props.requests]);

  return (
    <Card className="p-3">
      <View className="mb-1 flex-row" accessible accessibilityLabel={translate('enterprise.absence.weekday_order')}>
        {WEEKDAY_HEADERS.map(w => (
          <Text
            key={w.key}
            accessible={false}
            className="flex-1 text-center text-[10px] font-medium text-muted-foreground"
          >
            {w.label}
          </Text>
        ))}
      </View>
      {weeks.map(week => (
        <View key={week[0]} className="flex-row">
          {week.map((day) => {
            const mark = markFor(day, props);
            const isToday = day === today;
            const past = day < today;
            const holiday = holidaySet.has(day);
            return (
              <View
                key={day}
                accessible
                accessibilityLabel={dayMarkLabel({ day, mark: mark?.label ?? null, holiday, today })}
                className="flex-1 items-center py-0.5"
                testID={`absence-day-${day}`}
              >
                <View
                  accessible={false}
                  // `min-h-9`, ikke `h-9`: tallet skalerer med systemets skrift,
                  // så cellen skal kunne vokse. 36 px er stadig minimum ved
                  // normal skrift — porten i `text-scale.test.ts` dømmer `h-9`.
                  className={twMerge('min-h-9 w-full items-center justify-center rounded-md', isToday ? 'border border-primary-600' : '')}
                  style={mark ? { backgroundColor: mark.color, opacity: mark.label.pending ? 0.45 : 0.9 } : undefined}
                >
                  <Text className={twMerge('text-xs', mark ? 'font-semibold text-white' : past ? 'text-muted-foreground opacity-50' : 'text-foreground')}>
                    {Number(day.slice(8, 10))}
                  </Text>
                </View>
                {holiday ? <View accessible={false} className="mt-0.5 size-1 rounded-full bg-danger-500" /> : <View className="mt-0.5 size-1" />}
              </View>
            );
          })}
        </View>
      ))}
      {legend.length > 0
        ? (
            <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
              {legend.map(([name, color]) => (
                <View key={name} className="flex-row items-center gap-1">
                  <View className="size-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <Text className="text-xs text-muted-foreground">{name}</Text>
                </View>
              ))}
              <View className="flex-row items-center gap-1">
                <View className="size-1.5 rounded-full bg-danger-500" />
                <Text className="text-xs text-muted-foreground">{translate('enterprise.absence.holiday')}</Text>
              </View>
            </View>
          )
        : null}
    </Card>
  );
}
