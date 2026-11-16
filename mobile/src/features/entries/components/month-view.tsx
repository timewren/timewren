import type { TimeEntry } from '../use-entries';
import * as React from 'react';
import { View } from 'react-native';
import { Card, ListSkeleton, StatTile } from '~/components/ui';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { formatWords } from '~/lib/locale';
import { hoursByDay, sumHours } from '../period';
import { CalendarGrid } from './calendar-grid';

type MonthViewProps = {
  date: Date;
  entries: TimeEntry[];
  isLoading: boolean;
  onSelectDay: (day: Date) => void;
};

/** Månedsvisning: kalendergrid med timer pr. dag + månedstotal. */
export function MonthView({ date, entries, isLoading, onSelectDay }: MonthViewProps) {
  const byDay = React.useMemo(() => hoursByDay(entries), [entries]);
  if (isLoading)
    return <ListSkeleton rows={3} />;

  const total = sumHours(entries);
  const daysWithTime = Array.from(byDay.values()).filter(h => h > 0).length;
  return (
    <View className="gap-4">
      <View className="flex-row gap-3">
        <StatTile label={translate('entries.month_total')} value={formatHours(total)} tone="primary" testID="month-total" />
        <StatTile
          label={translate('entries.count_label')}
          value={String(entries.length)}
          hint={daysWithTime > 0 ? formatHours(total / daysWithTime).concat(`/${formatWords().day}`) : undefined}
        />
      </View>
      <Card>
        <CalendarGrid month={date} hoursByDay={byDay} onSelectDay={onSelectDay} showHours />
      </Card>
    </View>
  );
}
